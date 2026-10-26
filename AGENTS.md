# AGENTS.md — Contesto per AI agent

Questo file documenta le decisioni, l'architettura e le convenzioni
del progetto **AuleLiberePoliMi**, emerse dalla conversazione con
l'utente (Joel Shepard). Leggilo prima di lavorare sul progetto.

Collocato nella root del progetto per essere caricato automaticamente
dall'harness pi.

---

## ⚙️ Visione del progetto

Bot Telegram per trovare aule libere al PoliMi.
Rinnovamento tecnologico completo di un bot esistente (originariamente
di Daniele Ferrazzo, 2021). L'obiettivo è portarlo su cloud con
stack moderno e architettura stateless.

**Approccio**: stateless, serverless, preferenze client-side.

---

## 🧠 Decisioni architetturali

### Stateless
- Il bot **non deve** avere alcuna persistenza lato server
- Niente KV, Durable Objects, database o filesystem a runtime
- Le preferenze utente vivono nella Mini App (CloudStorage di Telegram,
  con fallback `localStorage`), non sul server

### Preferenze client-side via Telegram Mini App
- Una **Telegram Web App (Mini App)** HTML+CSS+JS statica gestisce:
  - Lingua preferita (it/en)
  - Campus preferito
  - Durata della ricerca rapida (1-8 ore)
  - Quante ore guardare avanti per le aule che si liberano (1-8, default 2):
    la sezione "⏳ Si liberano entro N ore" in fondo ai risultati
- La Mini App è hostata su **Cloudflare Pages** (statica)
- I dati arrivano al bot via `web_app_data` quando l'utente salva
- La Mini App è solo per le *impostazioni* — il bot rimane **inline**
  (testo e tastiere) per tutta la ricerca

### Interazione impostazioni
- Nella tastiera persistente `⚙️ Preferenze` è un bottone `web_app` che apre
  direttamente la Mini App (deve restare un bottone della reply keyboard:
  `sendData()` non funziona dal menu button né da bottoni inline)
- La Mini App **non sostituisce** l'intero bot, solo le impostazioni

### Cloudflare Workers (aggiornato 09/2026)
- Runtime TypeScript su **Cloudflare Workers Free**, webhook Telegram
- Mini App statica su **Cloudflare Pages**
- Segreti `BOT_TOKEN` e `WEBHOOK_SECRET` via `wrangler secret` / `.dev.vars`
- `WEBAPP_URL` è una variabile d'ambiente; in locale la inietta `npm run dev:local`
- Niente dominio personalizzato per ora

### Ricerca rapida "Ora"
- Un pulsante della tastiera persistente non può trasportare dati, ma il suo
  **testo viene rimandato al bot come messaggio**: le preferenze salvate sono
  quindi codificate nel label del pulsante `🕒 Ora` (es. `🕒 Ora · Bovisa 2h`,
  oppure `🕒 Ora · Bovisa 2h ⏳4h`), nessun KV/DB e nessun messaggio pinnato
- Il label usa il nome breve del campus (senza "Milano ") e niente bandiera:
  la lingua si ricava dal prefisso (`🕒 Ora` = it, `🕒 Now` = en); `⏳Nh`
  compare solo se l'orizzonte delle aule in liberazione non è quello di default
- Dopo il salvataggio la Mini App invia `web_app_data`: il bot risponde con un
  solo messaggio `✅ Preferenze salvate` che porta la nuova tastiera
- Al tap del pulsante persistente il bot ricava campus/durata/lingua dal testo
  con `parseNowLabel` e fa la ricerca; se il label è assente, malformato o è il
  semplice `🕒 Ora`, ripiega sul picker inline campus → durata
- `parseNowLabel` accetta anche il formato legacy `🕒Ora · Milano Bovisa 2h ⏳4h 🇮🇹`
  (con o senza `⏳`)
  e `LABELS` i vecchi `🔍Cerca`/`ℹinfo`: le tastiere vecchie restano sui
  telefoni finché l'utente non rifà `/start`
- I codici delle singole sedi (es. `MIA11`) restano trasportabili perché
  `campusCodeFromShortName` riconduce sia il nome breve sia quello esteso

### Interfaccia di ricerca
- Una sola "scheda" per ricerca: i passi (campus → giorno → ora inizio → ora
  fine, oppure campus → durata) modificano lo stesso messaggio con
  `editMessageText`, mostrano un riepilogo `📍 · 📅 · 🕐` e hanno
  `⬅ Indietro` + `✖ Annulla` (che cancella la scheda)
- La scheda diventa `🔎 Cerco…` e poi il primo messaggio dei risultati; i
  bottoni `🔄 Aggiorna`/`🔌 Solo con prese`/`🕐 Cambia orario` stanno
  sotto l'ultimo messaggio
- I bottoni sotto i risultati hanno il flag `fresh` (`n` nel callback): non
  modificano i risultati ma ne mandano di nuovi, togliendo i bottoni vecchi;
  il flag `p` attiva il filtro prese
- Callback non validi o scaduti: toast con `answerCallbackQuery`, niente
  messaggi in chat
- I comandi del menu `/` si registrano con `npm run commands:set`
  (automatico in `dev:local`)

### Sviluppo
- `main` = produzione (bot di tutti); si sviluppa su `dev`
- `npm run dev:local` avvia Mini App + Worker + due quick tunnel Cloudflare +
  webhook sul **bot di test** (token in `worker/.dev.vars`)
- `npm run dev:webapp` per provare la Mini App nel browser
- `npm run dev:preview` come `dev:local`, ma il bot di test apre la preview
  Cloudflare Pages del branch corrente (`<branch>.aule-libere-polimi-settings.pages.dev`)
  invece del tunnel locale; richiede branch pushato e build di Pages completata
- Workflow completo nella sezione "Workflow di sviluppo (dev → main)"

### Logging
- Solo stdout, visibile nei log Cloudflare / `wrangler tail`

### Dati statici (`json/`)
- `location.json`: tutte le sedi PoliMi note (nome → codice `csic`)
- `campuses.json`: campus mostrati nei menu, una voce per campus e niente
  singole vie; deve restare un sottoinsieme di `location.json`
- `roomsWithPower.json`: ID delle aule con prese
- Generano `worker/src/data.ts` e `webapp/settings/data.js` con
  `npm run data:generate`; check, test e deploy falliscono se le copie generate
  non sono aggiornate
- I codici delle singole sedi (es. `MIA11`) restano validi per le preferenze
  già salvate, ma non vengono più mostrati nel menu

### Ownership
- Repository: `github.com/JoelShepard/AuleLiberePoliMi`
- Credits a Daniele Ferrazzo per il lavoro originale
- Licenza: MIT (invariata)

---

## 🔀 Workflow di sviluppo (dev → main)

`main` è la produzione: ci si arriva **solo** con merge da `dev`.
Passi usati finora (seguirli nell'ordine):

1. Aggiorna e lavora su `dev`:
   ```bash
   git switch dev && git pull --ff-only
   ```
2. Sviluppa e prova in locale con il bot di test:
   ```bash
   cd worker && npm run dev:local
   ```
3. Check obbligatori prima del commit (dalla cartella `worker/`):
   ```bash
   npm run check && npm test && npm run data:check
   ```
4. Commit su `dev` con prefisso conventional e messaggio conciso:
   - `fix:` correzione di comportamento
   - `feat:` funzionalità nuova
   - `docs:`/`chore:` documentazione e manutenzione
   - mai committare `.dev.vars`, `.tools/`, `.wrangler/`
5. Push del branch:
   ```bash
   git push origin dev
   ```
6. Merge lineare in `main` (niente merge commit):
   ```bash
   git switch main && git pull --ff-only
   git merge --ff-only dev
   git push origin main
   ```
7. Deploy del Worker (da `worker/`):
   ```bash
   npm run deploy
   ```
   `predeploy` esegue `data:check`; `--keep-vars` conserva `WEBAPP_URL`.
   Se la lista comandi è cambiata: `BOT_TOKEN=... npm run commands:set` con
   il token di produzione.
8. Smoke test in produzione:
   ```bash
   curl https://aule-libere-polimi.gioelegr3.workers.dev/health
   ```
   poi `/start`, `🔍 Cerca` e `🕒 Ora` sul bot di produzione. In caso di errori:
   `wrangler tail`.

**Regole**
- Mai committare o pushare direttamente su `main`
- Mai fare deploy da `dev`: si deploya solo ciò che è su `main`
- Il merge deve restare `--ff-only` per mantenere la storia lineare
- `dev:local` usa esclusivamente il bot di test, mai quello di produzione
- La Mini App su Cloudflare Pages si aggiorna via Git integration: le
  modifiche a `webapp/settings/` seguono lo stesso percorso `dev` → `main`,
  senza comandi di deploy manuali

---

## 📦 Struttura file importante

| File | Ruolo |
|---|---|
| `worker/src/index.ts` | Entry point Worker, routing webhook, health |
| `worker/src/telegram.ts` | Handler update, routing, scheda e ricerca |
| `worker/src/screens.ts` | Schermate inline, tastiera persistente, label |
| `worker/src/clock.ts` | Orari e date nel fuso Europe/Rome |
| `worker/src/protocol.ts` | Callback compatti encode/decode, campus |
| `worker/src/i18n.ts` | Traduzioni it/en |
| `worker/src/polimi.ts` | Scraper aule libere (`fetch` + `HTMLRewriter`) |
| `worker/scripts/dev-local.mjs` | Stack di sviluppo locale end-to-end |
| `worker/scripts/set-commands.mjs` | Registra i comandi del menu `/` |
| `webapp/settings/` | Mini App statica (Cloudflare Pages) |
| `worker/README.md` | Deploy, test locale, limiti Free |
| `docs/TODO.md` | Tracking del rinnovamento |

Il runtime Python (`bot.py`, `functions/`, `search/`, `Dockerfile`) è
**legacy**: non più usato in produzione, mantenuto come riferimento.

---

## 🔮 Futuro (non implementare ora)

- Dominio personalizzato e valutazione webhook vs polling
- Mini App più completa che diventa interfaccia principale
- JSON logging strutturato
- CI/CD con GitHub Actions
- Rotazione automatica del token

---

## 🚫 Convenzioni da ricordare

- Non salvare mai nulla su filesystem/KV/Durable Objects
  (solo JSON statici generati e bundled)
- Niente PicklePersistence (legacy)
- Le preferenze sono sempre opzionali
- Il bot deve funzionare anche senza Mini App (fallback inline)
- I file JSON in `json/` sono l'unica sorgente dei dati campus
- `callback_data` ha un limite di 64 byte: usare sempre `encodeCallback`
