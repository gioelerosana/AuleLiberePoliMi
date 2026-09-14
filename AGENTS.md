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
- La Mini App è hostata su **Cloudflare Pages** (statica)
- I dati arrivano al bot via `web_app_data` quando l'utente salva
- La Mini App è solo per le *impostazioni* — il bot rimane **inline**
  (testo e tastiere) per tutta la ricerca

### Interazione impostazioni
- Nella tastiera persistente `⚙️Preferenze` è un bottone `web_app` che apre
  direttamente la Mini App
- La Mini App **non sostituisce** l'intero bot, solo le impostazioni

### Cloudflare Workers (aggiornato 09/2026)
- Runtime TypeScript su **Cloudflare Workers Free**, webhook Telegram
- Mini App statica su **Cloudflare Pages**
- Segreti `BOT_TOKEN` e `WEBHOOK_SECRET` via `wrangler secret` / `.dev.vars`
- `WEBAPP_URL` è una variabile d'ambiente; in locale la inietta `npm run dev:local`
- Niente dominio personalizzato per ora

### Ricerca rapida "Ora"
- Il pulsante `🕒Ora` della tastiera persistente **non può leggere** le
  preferenze Mini App (Worker stateless): avvia il flusso rapido inline
  campus → durata → ricerca
- Dopo il salvataggio della Mini App il bot invia un pulsante `🕒Ora` inline
  con le preferenze codificate in `callback_data`: un tap per la ricerca
- La lingua si ottiene da `message.from.language_code`; la lingua scelta nella
  Mini App vale per il flusso immediato (callback e tastiera post-salvataggio)

### Sviluppo
- `main` = produzione (bot di tutti); si sviluppa su `dev`
- `npm run dev:local` avvia Mini App + Worker + due quick tunnel Cloudflare +
  webhook sul **bot di test** (token in `worker/.dev.vars`)
- `npm run dev:webapp` per provare la Mini App nel browser
- Verifiche prima del commit: `npm run check`, `npm test`, `npm run data:check`

### Logging
- Solo stdout, visibile nei log Cloudflare / `wrangler tail`

### roomsWithPower.json
- Sorgente unica in `json/`, genera `worker/src/data.ts` e
  `webapp/settings/data.js` con `npm run data:generate`
- Check, test e deploy falliscono se le copie generate non sono aggiornate

### Ownership
- Repository: `github.com/JoelShepard/AuleLiberePoliMi`
- Credits a Daniele Ferrazzo per il lavoro originale
- Licenza: MIT (invariata)

---

## 📦 Struttura file importante

| File | Ruolo |
|---|---|
| `worker/src/index.ts` | Entry point Worker, routing webhook, health |
| `worker/src/telegram.ts` | Handler update, tastiere, flusso ricerca |
| `worker/src/protocol.ts` | Callback compatti encode/decode, campus |
| `worker/src/i18n.ts` | Traduzioni it/en |
| `worker/src/polimi.ts` | Scraper aule libere (`fetch` + `HTMLRewriter`) |
| `worker/scripts/dev-local.mjs` | Stack di sviluppo locale end-to-end |
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
