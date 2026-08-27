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
risposta: un errore restituisce HTTP 500, permettendo a Telegram di ritentare.

I dati di `json/location.json` e `json/roomsWithPower.json` generano sia
`src/data.ts` per il Worker sia `webapp/settings/data.js` per la Mini App. In
questo modo le sedi hanno un'unica sorgente. Dopo una modifica ai JSON eseguire
`npm run data:generate`; check, test e deploy falliscono se una copia generata
non è aggiornata.

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

Prima del deploy autenticarsi con `wrangler login`, quindi:

```bash
npm run deploy
curl https://aule-libere-polimi.<account>.workers.dev/health
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
