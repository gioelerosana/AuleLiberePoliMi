# Migrazione completa a Cloudflare

## Obiettivo

Portare il backend del bot da un processo Python in polling a un Cloudflare
Worker TypeScript attivato dal webhook Telegram. La Mini App rimane su
Cloudflare Pages. Il backend non usa database, KV, D1 o Durable Objects.

Il bot Python rimane nel repository come implementazione di riferimento fino
a quando il Worker non supera tutti i gate di migrazione.

## Architettura

```text
Telegram ──POST webhook──> Cloudflare Worker ──fetch──> Telegram Bot API
                                │
                                └────fetch + HTMLRewriter──> PoliMi

Telegram Mini App ─────────> Cloudflare Pages
```

Il Worker espone soltanto:

- `GET /health`, per verifica operativa;
- `POST /telegram/webhook`, protetto dal secret header di Telegram.

`BOT_TOKEN` e `WEBHOOK_SECRET` sono Cloudflare Worker Secrets. Nessun segreto
deve essere presente nel bundle o in `wrangler.toml`.

## Stato client-side

Il Worker non conserva lo stato delle conversazioni. Ogni pulsante inline usa
un `callback_data` compatto che contiene i valori raccolti fino a
quel punto:

```text
azione | lingua | campus | data | inizio | fine
```

Il payload deve restare sotto il limite Telegram di 64 byte. Campus e azioni
usano codici brevi, la data usa `YYYYMMDD` nel callback e viene convertita in
`dd/mm/yyyy` solo al confine con lo scraper.

Le preferenze restano nella Mini App. Quando `web_app_data` arriva al Worker,
il payload viene validato: la tastiera persistente viene ricostruita con le
preferenze codificate nel label del pulsante `🕒Ora` (che Telegram rimanda come
testo del messaggio) e viene inviato un pulsante di ricerca rapida inline che
incorpora campus, durata e lingua. Il Worker non memorizza nulla: lo stato
resta su Telegram.

## Moduli Worker

- `src/index.ts`: routing HTTP, healthcheck e composizione dipendenze;
- `src/telegram.ts`: parsing update e chiamate Bot API;
- `src/protocol.ts`: codec del callback stateless;
- `src/i18n.ts`: testi e tastiere italiano/inglese;
- `src/polimi.ts`: fetch e parsing streaming delle occupazioni;
- `src/format.ts`: filtro aule libere e messaggi HTML Telegram;
- `src/data.ts`: sedi e ID delle aule con prese incorporati nel bundle.

Il contratto tra Telegram e ricerca è:

```ts
type SearchRequest = {
  campus: string;
  date: string; // dd/mm/yyyy
  startHour: number;
  endHour: number;
  lang: "it" | "en";
};

type Search = (request: SearchRequest) => Promise<string[]>;
```

## Gate prima della sostituzione

1. Typecheck e test unitari completi.
2. Parità del parser su una fixture reale PoliMi anonimizzata.
3. Stesso insieme di aule libere tra Python e TypeScript per una ricerca live.
4. Ogni messaggio Telegram non supera 4096 caratteri ed è HTML-safe.
5. Ogni callback non supera 64 byte ed è decodificabile senza stato server.
6. Webhook con secret errato restituisce `401` senza elaborare l'update.
7. Test Mini App → `web_app_data` → pulsante ricerca rapida.
8. Misura reale del CPU time sul runtime Cloudflare: obiettivo sotto 10 ms per
   invocazione sul piano Free.
9. Smoke test Telegram completo dopo il deploy.

I gate 1-7 sono verificati localmente. Nel confronto live del 28/08/2026,
Milano Città Studi dalle 09:00 alle 11:00 ha prodotto lo stesso risultato in
entrambe le implementazioni: 37 edifici e 80 aule. I gate 8-9 richiedono il
deploy e un client Telegram reale.

Se il parsing live supera stabilmente 10 ms di CPU, il Worker gratuito non è
un target affidabile: prima si ottimizza il parser; solo in seguito si valuta
Workers Paid o Cloud Run.
