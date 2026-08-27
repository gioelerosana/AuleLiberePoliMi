# Aule Libere Polimi

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Bot Telegram per trovare aule libere al Politecnico di Milano.
~~Puoi aggiungerlo su Telegram con questo [link](https://telegram.me/auleliberepolimi_bot).~~

Il bot cerca lo stato delle aule nel sito del PoliMi nel giorno scelto e trova le aule libere
nel tuo slot orario preferito.

<table>
  <tr>
    <td>Start</td>
     <td>Search</td>
     <td>Day</td>
  </tr>
  <tr>
    <td><img src="photos/README/start.png"></td>
    <td><img src="./photos/README/search.png"></td>
    <td><img src="./photos/README/day.png"></td>
  </tr>
 </table>

## Architettura

```
┌─────────────────────┐   webhook   ┌─────────────────────┐
│ Telegram            │────────────▶│ Cloudflare Worker   │
│                     │◀────────────│ TypeScript          │
│ Mini App settings   │             │ fetch + HTMLRewriter│
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
- **Preferenze**: lato client (Telegram CloudStorage, con fallback `localStorage`)
- **Stateless**: nessun database, nessun file persistente

## Stack

| Componente | Tecnologia |
|---|---|
| Linguaggio produzione | TypeScript su Cloudflare Workers |
| Bot API | Webhook + `fetch` diretto |
| Scraping | `fetch` + Cloudflare `HTMLRewriter` |
| Mini App | HTML5 + CSS3 + JS vanilla (statica) |
| Hosting bot | Cloudflare Workers Free |
| Hosting Mini App | Cloudflare Pages |

## Sviluppo locale

Il runtime di produzione richiede Node.js 20 o successivo:

```bash
cd worker
npm install
npm run check
npm test
npm run dev
```

Il backend Python e il relativo Dockerfile restano temporaneamente nel
repository come riferimento per i test di parità; non sono il target di
produzione. Per eseguire anche la suite legacy:

uv run python -m unittest discover -v
```

Il backend Python resta temporaneamente come implementazione di riferimento.
Per sviluppo e deploy del Worker vedi [worker/README.md](worker/README.md) e il
[piano di migrazione](docs/CLOUDFLARE_MIGRATION.md).

## Come funziona

1. L'utente avvia il bot con `/start`
2. Sceglie tra **Cerca**, **Ora**, **Info** e **Preferenze**
3. **Cerca**: seleziona campus → giorno → ora inizio → ora fine → risultati
4. **Ora**: dopo il salvataggio, il bot invia un pulsante rapido stateless con
   campus e durata incorporati
5. **Preferenze**: apre la Mini App via pulsante testuale o bottone blu Web App
   - Nella Mini App: lingua, campus preferito, durata ricerca rapida
   - I dati sono salvati in Telegram CloudStorage, con fallback `localStorage`
   - Quando si preme "Salva", i dati arrivano al bot via `web_app_data`

Il bot è **stateless**: nessuna preferenza è salvata lato server.

## Crediti

- **Daniele Ferrazzo** ([@feDann](https://github.com/feDann)) — bot originale (2021)
- **Joel Shepard** ([@JoelShepard](https://github.com/JoelShepard)) — fork, rinnovamento e manutenzione (2026)

## Licenza

MIT — vedi [LICENSE](LICENSE) per i dettagli.
