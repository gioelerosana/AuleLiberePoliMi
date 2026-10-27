#!/usr/bin/env node
/**
 * Registers the bot commands shown in Telegram's "/" menu, in Italian for
 * Italian clients and in English for everyone else.
 *
 * This is one-off bot configuration, not runtime state: run it again only
 * when the command list changes.
 *
 * Usage:
 *   BOT_TOKEN=123:abc npm run commands:set
 *
 * `npm run dev:local` runs it automatically on the test bot.
 */

import { fileURLToPath } from "node:url";

const COMMANDS = {
  it: [
    { command: "ora", description: "Aule libere da adesso" },
    { command: "cerca", description: "Scegli campus, giorno e orario" },
    { command: "info", description: "Come funziona e crediti" },
    { command: "start", description: "Mostra il menu" },
  ],
  en: [
    { command: "now", description: "Rooms free from now" },
    { command: "search", description: "Pick campus, day and time" },
    { command: "info", description: "How it works and credits" },
    { command: "start", description: "Show the menu" },
  ],
};

async function call(token, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!payload.ok) throw new Error(`${method}: ${payload.description ?? `HTTP ${response.status}`}`);
}

export async function setBotCommands(token) {
  // The default list (no language_code) is the English one.
  await call(token, "setMyCommands", { commands: COMMANDS.en });
  await call(token, "setMyCommands", { commands: COMMANDS.it, language_code: "it" });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.error("BOT_TOKEN mancante: BOT_TOKEN=... npm run commands:set");
    process.exit(1);
  }
  setBotCommands(token)
    .then(() => console.log("Comandi del bot registrati (it + default en)."))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
