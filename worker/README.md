# AuleLiberePoliMi Cloudflare Worker

Backend stateless del bot Telegram. Telegram invia gli update via webhook, il
Worker interroga il servizio PoliMi e risponde tramite Bot API. Non usa KV,
Durable Objects, database o API Node.js a runtime; la Mini App resta su
Cloudflare Pages.

## Sviluppo e verifica

Richiede Node.js 20 o successivo.

```bash
cd worker
npm install
npm run check
npm test
npm run dev
```

Il server locale espone `GET /health`. Il webhook è
`POST /telegram/webhook`, richiede l'header Telegram
`X-Telegram-Bot-Api-Secret-Token` con il secret configurato e accetta esclusivamente
un oggetto con `update_id` intero. Il processing viene atteso prima della
risposta: gli errori transitori (rete o 5xx) restituiscono HTTP 500 così
Telegram ritenta, mentre gli errori 4xx non transitori della Bot API (es. 400,
403, 429) vengono loggati e chiusi con HTTP 200 per evitare retry infiniti o
messaggi duplicati.

### Dati statici e generazione (`json/`)

I file in `json/` sono l'unica sorgente dei dati per il Worker (`src/data.ts`)
e per la Mini App (`webapp/settings/data.js`):

- `json/location.json`: tutte le sedi PoliMi note (nome → codice `csic`).
- `json/campuses.json`: i 10 campus principali mostrati nei menu (sottoinsieme
  di `location.json`). I codici delle singole vie restano validi per le
  preferenze già salvate, ma non compaiono più nei menu.
- `json/roomsWithPower.json`: ID delle aule dotate di prese elettriche.
- `json/roomTypes.json`: snapshot statico di campus, sede ("Dove"), edificio,
  categoria e tipologia per ogni ID aula PoliMi. Permette a `src/rooms.ts` di
  distinguere le aule didattiche normali (mostrate di default), le aule da
  disegno (mostrate con il filtro `✏️ Aule da disegno`) e gli spazi esclusi
  (laboratori, aule magne, convegni, studio, ecc.). Le aule non presenti nello
  snapshot vengono trattate come normali.
- `json/campusZones.json`: per campus, l'elenco delle sedi della "zona
  centrale" mostrate di default nelle ricerche sull'intero campus (per Città
  Studi: Piazza Leonardo da Vinci 32 e Via Bonardi); le aule delle altre zone
  vengono contate in fondo e mostrate attivando `🗺️ Tutte le zone`.
- `json/excludedRooms.json`: esclusioni manuali per nome aula, per i casi non
  coperti dalle categorie di `roomTypes.json`.

Dopo qualsiasi modifica ai file in `json/` eseguire:

```bash
npm run data:generate
```

`npm run check`, `npm test` e `npm run deploy` eseguono `npm run data:check` e
falliscono se le copie generate non sono aggiornate, se un campus non esiste in
`location.json` o se `roomTypes.json` contiene categorie vuote.

### Aggiornamento dello snapshot `json/roomTypes.json`

`json/roomTypes.json` è uno snapshot statico e non viene scaricato a runtime.
Rilanciare lo script quando il PoliMi aggiunge o riclassifica aule (ad esempio
all'inizio di ogni semestre):

```bash
npm run rooms:fetch                 # prossimo giorno feriale (calendario Europe/Rome)
npm run rooms:fetch -- 27/10/2026   # giorno specifico (gg/mm/aaaa)
npm run data:generate
```

Se una scheda aula fallisce il download o un campus non elenca aule nel giorno
scelto, lo script conserva le voci precedenti in `json/roomTypes.json` (così
un errore temporaneo non esclude mai un'aula) ed esce con codice `1` elencando
gli ID non scaricati. Controllare sempre `git diff json/roomTypes.json` prima
di committare.

### Callback e pulsanti sotto i risultati

I pulsanti inline usano callback compatti (≤ 64 byte) codificati da
`src/protocol.ts`. I bottoni sotto i risultati di ricerca portano i flag
combinabili in coda (`p`, `d`, `z`, `n`):

- `p` (`powerOnly`): filtra solo le aule con prese (`🔌`);
- `d` (`drawing`): mostra le aule da disegno (`✏️`) al posto di quelle normali
  (mostrato solo nei campus o sedi che hanno aule da disegno);
- `z` (`allZones`): allarga la ricerca a tutte le zone del campus (`🗺️`);
- `n` (`fresh`): invia i nuovi risultati in un messaggio nuovo e rimuove i
  bottoni dal messaggio precedente.

Quando l'utente preme `🕐 Cambia orario`, i filtri attivi (`p`/`d`/`z`) vengono
propagati lungo i passi del picker fino alla nuova ricerca.

## Test locale

### Mini App senza Telegram

```bash
npm run dev:webapp   # http://127.0.0.1:8788
```

Fuori da Telegram la pagina usa `localStorage` come fallback, quindi impostazioni
e layout si possono provare direttamente nel browser.

### Bot end-to-end con bot di test

Serve un bot Telegram **dedicato**, diverso da quello di produzione. Se
`cloudflared` non è installato, lo script lo scarica una volta sola in
`worker/.tools/` (ignorato da Git).

1. Crea il bot con @BotFather e copia il token.
2. Configura il token:
   ```bash
   cd worker
   cp .dev.vars.example .dev.vars
   # inserisci il token in BOT_TOKEN
   ```
3. Avvia tutto:
   ```bash
   npm run dev:local
   ```

`dev:local` avvia in un solo comando la Mini App statica, `wrangler dev`, due
quick tunnel HTTPS `*.trycloudflare.com` (Mini App e Worker) e registra il
webhook del bot di test verso il tunnel del Worker. `WEBAPP_URL` viene iniettato
automaticamente, quindi il pulsante `⚙️ Preferenze` della tastiera apre la Mini
App locale. Registra anche i comandi del menu `/` sul bot di test. Poi su
Telegram apri il bot di test e premi `/start`.

Alla chiusura con `Ctrl+C` il webhook del bot di test viene rimosso
(`KEEP_WEBHOOK=1` per mantenerlo, `--no-webhook` per non registrarlo affatto).
Il bot di produzione non viene mai toccato.

Per provare la Mini App già costruita da Cloudflare Pages invece di quella
locale usa `npm run dev:preview` (`dev:local -- --preview`): lo script ricava
dal branch git corrente l'alias di preview
`https://<branch>.aule-libere-polimi-settings.pages.dev`, verifica che risponda
e lo usa come `WEBAPP_URL` del bot di test, senza tunnel per la Mini App. Se la
preview non esiste ancora (branch non pushato, build in corso) o è indietro
rispetto ai file locali, lo script lo segnala e, nel primo caso, ripiega sul
tunnel locale. `PREVIEW_URL` forza un URL specifico (per esempio l'URL per
commit di Pages). Le modifiche a `webapp/settings/` compaiono dopo push e build.

Variabili utili: `WORKER_PORT` (default 8787), `WEBAPP_PORT` (default 8788),
`CLOUDFLARED` (percorso del binario).

## Configurazione Cloudflare

Creare un segreto URL-safe casuale di almeno 16 caratteri e configurare i due
segreti senza inserirli in `wrangler.toml` o nel repository:

```bash
wrangler secret put BOT_TOKEN
wrangler secret put WEBHOOK_SECRET
```

`WEBAPP_URL` è opzionale. Per lo sviluppo si può aggiungere a `.dev.vars`
(ignorato da Git); in produzione si configura dalle Variables del Worker o con
la dashboard Cloudflare. Deve essere l'URL HTTPS della Mini App su Pages. Lo
script di deploy usa `--keep-vars` per non cancellare questa variabile remota.

In produzione il deploy è automatico: il Worker è collegato al repository con
Workers Builds e ogni push su `main` lancia il build con questa configurazione
(**Settings → Build** del Worker):

| Campo | Valore |
|---|---|
| Branch di produzione | `main` |
| Directory radice | `worker` |
| Comando di build | `npm ci` |
| Comando di deploy | `npm run deploy` |
| Build dei branch non di produzione | disattivati |

Il comando di deploy deve restare `npm run deploy` e non `npx wrangler deploy`,
altrimenti si perde `--keep-vars` e il deploy cancella `WEBAPP_URL`.

Per un deploy manuale di ripiego, autenticarsi con `wrangler login`, quindi:

```bash
npm run deploy
curl https://aule-libere-polimi.<account>.workers.dev/health
```

Se i comandi del menu `/` (`/ora`, `/cerca`, `/info`, ecc.) sono cambiati,
aggiornarli anche sul bot di produzione:

```bash
BOT_TOKEN=<BOT_TOKEN> npm run commands:set
```

Infine registrare il webhook Telegram, sostituendo i placeholder con i valori
reali. `secret_token` deve coincidere esattamente con `WEBHOOK_SECRET`:

```bash
curl --fail-with-body --request POST \
  "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  --data-urlencode \
  "url=https://aule-libere-polimi.<account>.workers.dev/telegram/webhook" \
  --data-urlencode "secret_token=<WEBHOOK_SECRET>" \
  --data-urlencode 'allowed_updates=["message","callback_query"]'
```

Verificare la registrazione con `getWebhookInfo`. Per revocarla usare
`deleteWebhook`; queste operazioni non sono eseguite automaticamente dal
progetto.

## Limiti Free e benchmark

Il piano Workers Free applica automaticamente il proprio limite CPU per
invocazione (attualmente 10 ms). L'attesa di `fetch()` verso PoliMi e Telegram
non conta come CPU, mentre parsing HTML, logica del bot e formattazione sì. Il
piano Free ha inoltre un tetto di richieste giornaliere: verificare sempre i
limiti Cloudflare correnti prima della pubblicazione.

Il runtime locale non riproduce in modo affidabile il consumo CPU della rete
Cloudflare. Prima di considerare concluso il deploy:

1. inviare almeno 20 ricerche reali, includendo i campus con più risultati;
2. controllare **Workers & Pages → Metrics → CPU time** nella dashboard;
3. verificare che il percentile alto resti sotto 10 ms e che non compaiano
   invocazioni `exceededCpu` nei log (`wrangler tail`);
4. controllare tempi, errori e risposta del bot direttamente in Telegram.

Se il parser supera stabilmente 10 ms, il Worker Free non è adatto allo scraper
attuale: ridurre il lavoro di parsing oppure passare al piano Workers Paid o al
backend Cloud Run, senza introdurre persistenza server-side.
