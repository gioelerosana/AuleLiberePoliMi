# TODO — Rinnovamento AuleLiberePoliMi Bot

Stato progetto: **🚀 Bot live su Cloudflare Workers + Mini App su Pages — sviluppo su branch `dev` con ambiente locale end-to-end**

Legenda: `[ ]` da fare · `[~]` in corso · `[x]` fatto

---

## ✅ Fase 0 — Pulizia fondazioni (COMPLETATA)

- [x] Progetto migrato a `uv` con Python 3.13 (`pyproject.toml`)
- [x] Rimosso `Procfile` (Heroku legacy)
- [x] Rimosse directory `log/` e file di log
- [x] Rimosso `aulelibere_pp` (pickle file)
- [x] `.gitignore` aggiornato (.venv, .env, log/, __pycache__, legacy)
- [x] Logging: solo `StreamHandler` (stdout), niente `FileHandler`
- [x] Dipendenze aggiornate: `python-telegram-bot==22.8`, moderne
- [x] Verificato che il modulo si importi senza errori

## ✅ Fase 1 — Bot stateless (COMPLETATA)

- [x] Rimosso `PicklePersistence` da `bot.py`
- [x] Lingua: ottenuta da `update.effective_user.language_code`
- [x] Eliminati stati SET_LANG, SET_CAMPUS, SET_TIME dal ConversationHandler
- [x] Aggiunto handler per `web_app_data` (fuori dal ConversationHandler)
- [x] Preferenze in `context.user_data` solo ephemeral (sessione)
- [x] "Ora": se preferenze in sessione → le usa; altrimenti → invita a Mini App
- [x] `functions/user_data_handler.py` rimosso (non più necessario)
- [x] `functions/regex_builder.py` rimosso (regex inline in bot.py)
- [x] `functions/input_check.py`: rimossi check lingue/tempo/campus
- [x] Bottone Web App in `keyboard_builder.py` (inline keyboard)
- [x] `bot.py` riscritto per PTB v22 API (async, ContextTypes, nuovi filtri)

## ✅ Fase 2 — Mini App impostazioni (STRUTTURA COMPLETATA)

### 2a — Struttura statica
- [x] `webapp/settings/index.html`
- [x] `webapp/settings/style.css` (tema Telegram via CSS variables)
- [x] `webapp/settings/script.js` (logica Mini App)

### 2b — Mini App: requisiti funzionali
- [x] Carica preferenze da `localStorage` all'apertura
- [x] Campo Lingua: dropdown 🇮🇹 Italiano / 🇬🇧 English
- [x] Campo Campus: dropdown 43 sedi (embedded in JS)
- [x] Campo Durata: slider 1-8 ore
- [x] Bottone "💾 Salva preferenze": salva in localStorage + sendData() + close()
- [x] Integrazione CDN `telegram-web-app.js`
- [x] Tema: `Telegram.WebApp.themeParams` per chiaro/scuro
- [x] Pagina responsive

### 2c — Deploy
- [x] Deploy su Cloudflare Pages con `wrangler pages deploy`
- [x] URL Mini App: `https://aule-libere-polimi-settings.pages.dev`
- [x] URL della Mini App come variabile d'ambiente (`WEBAPP_URL`)
- [~] Test funzionamento end-to-end (testato bot, Mini App in attesa di test su Telegram)

## ✅ Fase 3 — Containerizzazione e test (COMPLETATA)

- [x] `Dockerfile` multi-stage (builder + runtime python:3.13-slim, USER non-root)
- [x] `.dockerignore`
- [x] Suite automatica per validazione, ricerca, formattazione e preferenze
- [x] Verificata build locale dell'immagine
- [x] Verificati avvio, healthcheck e arresto pulito del bot nel container
- [x] Verificata ricerca live contro il sito PoliMi

## 🟨 Fase 4 — Cloudflare Worker TypeScript (IN CORSO)

- [x] Scelto Cloudflare Workers per concentrare bot e Mini App
- [x] Riscritto runtime Telegram come webhook TypeScript stateless
- [x] Portato scraper PoliMi su `fetch` + `HTMLRewriter`
- [x] Aggiunti callback compatti e suite automatica Worker
- [x] Validati typecheck e build Wrangler dry-run
- [x] Verificata parità live Python/TypeScript (37 edifici, 80 aule)
- [x] Unificata la sorgente dati campus tra Worker e Mini App
- [ ] Ruotare il token Telegram prima del deploy
- [ ] Salvare token e webhook secret nei Worker Secrets
- [ ] Deploy su Cloudflare Workers Free
- [ ] Verificare CPU time reale sotto 10 ms
- [ ] Eseguire smoke test dopo il deploy
- [ ] Verificare funzionamento bot dopo deploy

## ✅ Fase 5 — Ownership & documentazione (COMPLETATA)

- [x] README.md principale aggiornato (rebranding, crediti, nuovo repo)
- [x] docs/README.md aggiornato
- [x] json/lang/*.json: welcome, info, exception aggiornati (contatti → @JoelShepard, repo → JoelShepard/AuleLiberePoliMi, crediti originali preservati)
- [x] bot.py docstring aggiornata
- [x] pyproject.toml autori aggiornati
- [x] LICENSE: copyright (c) 2026 Joel Shepard aggiunto (accanto a © 2021 Daniele Ferrazzo)
- [x] `.env.example` creato

---

## ✅ Fase 6 — Ambiente dev e fix preferenze (COMPLETATA)

- [x] Branch `dev` come ramo di sviluppo, `main` resta la produzione
- [x] `npm run dev:local`: Mini App statica + `wrangler dev` + quick tunnel
      Cloudflare + `setWebhook` automatico sul bot di test
- [x] `npm run dev:webapp` per provare la Mini App nel browser
- [x] `worker/.dev.vars.example` e download automatico di `cloudflared` in `.tools/`
- [x] Fix “🕒Ora”: la tastiera persistente legge le preferenze dal messaggio
      pinnato (stateless) e fa la ricerca a un tap; se il pin manca ripiega sul
      flusso inline campus → durata (superato in Fase 7)
- [x] Menù campus limitato ai 10 campus principali (`json/campuses.json`); i
      codici delle singole sedi restano validi per le preferenze già salvate
- [x] Messaggi post-salvataggio riordinati: la tastiera si aggiorna prima,
      il pulsante rapido resta l'ultimo messaggio
- [x] Test end-to-end con bot di test in locale
- [x] Merge su `main`, deploy del Worker e `/health` di produzione verificato

## 🟨 Fase 7 — Preferenze nel label di “Ora” (IN CORSO)

- [x] Abbandonato il messaggio pinnato: le preferenze vivono nel label del
      pulsante persistente `🕒Ora` (es. `🕒Ora · Milano Bovisa 2h 🇮🇹`)
- [x] `parseNowLabel` ricava campus/durata/lingua dal testo rimandato da
      Telegram; i codici delle singole sedi restano validi
- [x] Fallback inline campus → durata per label assente, malformato o semplice
      `🕒Ora`
- [x] Rimossi `getChat`, `pinChatMessage` e `editMessageText` dal Worker
- [x] Test aggiornati (label, sede legacy, label malformato) e `npm run check`
- [ ] Verifica end-to-end sul bot di test
- [ ] Merge su `main` e deploy del Worker

## 📝 Note

- Il bot è stato riscritto per **PTB v22.8** (API async, ContextTypes)
- Architettura **stateless**: zero persistenza server, preferenze client-side
- Mini App settings come aggiunta, non sostituzione del bot inline
- Per test Mini App: serve HTTPS (Telegram test environment o tunnel)
