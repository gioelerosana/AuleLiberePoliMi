# AuleLiberePoliMi Bot

Bot Telegram per la ricerca di aule libere al Politecnico di Milano.

Ti permette di trovare rapidamente le aule libere in qualsiasi sede del PoliMi,
selezionando data, orario e campus. Include una **Telegram Mini App** per la
gestione delle preferenze utente, interamente lato client.

---

## Architettura

```
┌─────────────────────┐   webhook   ┌─────────────────────┐
│ Telegram            │────────────▶│ Cloudflare Worker   │
│ Mini App settings   │             │ TypeScript          │
└──────────┬──────────┘             └──────────┬──────────┘
           │ HTTPS                              │ HTTPS
           ▼                                    ▼
┌─────────────────────┐             ┌─────────────────────┐
│ Cloudflare Pages    │             │ Servizi PoliMi      │
│ HTML + CSS + JS     │             │ occupazione aule    │
└─────────────────────┘             └─────────────────────┘
```

- **Bot**: Cloudflare Worker TypeScript stateless tramite webhook Telegram
- **Scraping**: `fetch` + `HTMLRewriter` → pagine PoliMi
- **Mini App**: HTML+CSS+JS statico su Cloudflare Pages
- **Preferenze**: lato client (Telegram CloudStorage, fallback `localStorage`)
- **Stateless**: nessun database, nessun file persistente

---

## Stack

| Componente | Tecnologia |
|---|---|
| Linguaggio produzione | TypeScript su Cloudflare Workers |
| Bot API | Webhook + `fetch` diretto |
| Scraping | `fetch` + Cloudflare `HTMLRewriter` |
| Mini App | HTML5 + CSS3 + JS vanilla (statica) |
| Hosting bot | Cloudflare Workers Free |
| Hosting Mini App | Cloudflare Pages |

---

## Struttura del progetto

```
AuleLiberePoliMi/
├── worker/                       # Worker TypeScript di produzione
│   ├── src/                      # Router, Telegram, scraper e formatter
│   ├── test/                     # Test Vitest
│   └── wrangler.toml             # Configurazione Cloudflare
├── bot.py                        # Implementazione Python di riferimento
├── pyproject.toml                # Metadati e dipendenze Python
├── uv.lock                       # Lockfile riproducibile
├── Dockerfile                    # Runtime legacy di riferimento
├── .env                          # Variabili locali (NON in Git)
├── .env.example                  # Template per .env
├── .dockerignore
├── functions/
│   ├── __init__.py
│   ├── errorhandler.py           # Gestione errori + bonk
│   ├── input_check.py            # Validazione input utente
│   ├── keyboard_builder.py       # Generazione tastiere
│   └── string_builder.py         # Formattazione risposte
├── search/
│   ├── __init__.py
│   ├── find_classrooms.py        # Scraping occupazioni PoliMi
│   ├── free_classroom.py         # Calcolo aule libere
│   └── powerFileGen.py           # Generatore aule con prese
├── json/
│   ├── location.json             # Sedi PoliMi (codice → nome)
│   ├── roomsWithPower.json       # ID aule con prese elettriche
│   └── lang/
│       ├── it.json               # Testi italiano
│       └── en.json               # Testi inglese
├── webapp/
│   └── settings/
│       ├── index.html            # Mini App impostazioni
│       ├── style.css             # Stile tema Telegram
│       ├── data.js               # Sedi generate dalla sorgente JSON
│       └── script.js             # Logica preferenze client-side
├── photos/
│   └── bonk.jpg                  # Meme per input errati
├── tests/                        # Test automatici unittest
├── AGENTS.md                     # Contesto per AI agent (root)
└── docs/
    ├── README.md                 # Questa documentazione
    ├── CLOUDFLARE_MIGRATION.md   # Architettura e gate di migrazione
    └── TODO.md                   # Piano di rinnovamento
```

---

## Come funziona

1. L'utente avvia il bot con `/start`
2. Sceglie tra **Cerca**, **Ora**, **Info** e **Preferenze**
3. **Cerca**: seleziona campus → giorno → ora inizio → ora fine → risultati
4. **Ora**: ricerca rapida da adesso. Dalla tastiera persistente chiede campus
   e durata inline; dopo il salvataggio in Mini App usa il pulsante rapido a un
   tap inviato dal bot
5. **Preferenze**: apre la Mini App (bottone `web_app` nella tastiera)
   - Nella Mini App: lingua, campus preferito, durata ricerca rapida
   - I dati sono salvati in Telegram CloudStorage, con fallback `localStorage`
   - Quando si preme "Salva", i dati arrivano al bot via `web_app_data`

Il bot è **stateless**: nessuna preferenza è salvata lato server.
Al riavvio del Worker, tutto riparte pulito.
Le preferenze vivono solo nel client Telegram.

---

## Verifica locale

```bash
cd worker
npm install
npm run check
npm test
npm run dev:webapp   # Mini App nel browser
npm run dev:local    # stack completo con bot di test e tunnel
npm run deploy
```

`dev:local` richiede un bot Telegram di test e `worker/.dev.vars`; dettagli in
[worker/README.md](../worker/README.md). Per i test dell'implementazione Python
di riferimento: `uv sync --frozen` e `uv run python -m unittest discover -v`
dalla root.

---

## Licenza

MIT — originale di [Daniele Ferrazzo](https://github.com/feDann).
Fork e rinnovamento a cura di [Joel Shepard](https://github.com/JoelShepard).
