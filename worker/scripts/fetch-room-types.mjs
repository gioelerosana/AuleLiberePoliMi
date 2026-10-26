#!/usr/bin/env node
/**
 * Downloads site, building, category and typology of every room listed by PoliMi in the
 * campuses of json/campuses.json and writes them to json/roomTypes.json.
 *
 * The bot never fetches room details at runtime: this snapshot is static data
 * like the other files in json/. Run it again when PoliMi adds rooms, then
 * `npm run data:generate`.
 *
 * A detail page that fails to download keeps the previous entry of the room
 * (or leaves the room out, so it counts as a lecture room) and makes the
 * script exit with code 1 after writing the file: run it again later. A
 * campus listing no room on the chosen day keeps its previous entries.
 *
 * Usage:
 *   npm run rooms:fetch                 next weekday (Rome calendar)
 *   npm run rooms:fetch -- 27/10/2026   specific day (dd/mm/yyyy)
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeRoomTypes, nextRomeWeekday } from "./room-types.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const outputPath = resolve(repositoryRoot, "json/roomTypes.json");

const CONTROLLER_URL = "https://onlineservices.polimi.it/spazi/spazi/controller/";
const HEADERS = {
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "it-IT,it;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (compatible; AuleLiberePoliMi/3.0; +https://github.com/JoelShepard/AuleLiberePoliMi)",
};
const CONCURRENCY = 4;

function searchDay() {
  const argument = process.argv.slice(2).find((value) => /^\d{2}\/\d{2}\/\d{4}$/.test(value));
  if (argument) {
    const [day, month, year] = argument.split("/").map(Number);
    return { day, month, year };
  }
  return nextRomeWeekday();
}

async function fetchText(url) {
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

function decodeHtml(value) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

/** Room ids and names of a campus, from the daily occupancy table. */
async function campusRooms(code, { day, month, year }) {
  const url = new URL("OccupazioniGiornoEsatto.do", CONTROLLER_URL);
  url.search = new URLSearchParams({
    csic: code,
    categoria: "tutte",
    tipologia: "tutte",
    giorno_day: String(day),
    giorno_month: String(month),
    giorno_year: String(year),
    jaf_giorno_date_format: "dd/MM/yyyy",
    evn_visualizza: "",
  }).toString();
  const html = await fetchText(url);
  const rooms = new Map();
  // The room cell links its detail page: <td class="dove"><a href="...idaula=123">2.0.1</a>
  const pattern = /class="dove"[^>]*>\s*<a[^>]*idaula=(\d+)[^>]*>([\s\S]*?)<\/a>/g;
  for (const [, id, rawName] of html.matchAll(pattern)) {
    // Same normalization as worker/src/polimi.ts: names without whitespace.
    rooms.set(Number(id), decodeHtml(rawName.replace(/<[^>]+>/g, "")).replace(/\s+/g, ""));
  }
  return rooms;
}

/** Site ("Dove"), building, category and typology from a room detail page. */
async function roomDetails(id) {
  const html = await fetchText(`${CONTROLLER_URL}Aula.do?evn_init=espandi&idaula=${id}`);
  const lines = decodeHtml(html.replace(/<(script|style)[\s\S]*?<\/\1>/g, "").replace(/<[^>]+>/g, "\n"))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const field = (label) => {
    const index = lines.indexOf(label);
    return index >= 0 ? lines[index + 1] ?? "" : "";
  };
  const details = {
    site: field("Dove"),
    building: field("Edificio"),
    category: field("Categoria"),
    type: field("Tipologia"),
  };
  // A page without a category is an error page or a changed layout.
  if (!details.category) throw new Error("categoria assente nella scheda");
  return details;
}

async function mapConcurrently(items, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index], index);
      }
    }),
  );
  return results;
}

const campuses = JSON.parse(await readFile(resolve(repositoryRoot, "json/campuses.json"), "utf8"));
const day = searchDay();
console.log(`Elenco aule del ${day.day}/${day.month}/${day.year}…`);

const previous = JSON.parse(await readFile(outputPath, "utf8").catch(() => "{}"));

const rooms = new Map();
const emptyCampuses = [];
for (const [name, code] of Object.entries(campuses)) {
  const found = await campusRooms(code, day);
  console.log(`  ${name}: ${found.size} aule`);
  if (found.size === 0) {
    console.warn(`  ⚠️ ${name} non elenca aule in questo giorno: tengo le voci precedenti`);
    emptyCampuses.push(code);
  }
  for (const [id, roomName] of found) rooms.set(id, { campus: code, name: roomName });
}

const ids = [...rooms.keys()].sort((a, b) => a - b);
console.log(`Scarico ${ids.length} schede aula…`);
const details = new Map();
await mapConcurrently(ids, async (id, index) => {
  if (index > 0 && index % 50 === 0) console.log(`  ${index}/${ids.length}`);
  try {
    details.set(id, await roomDetails(id));
  } catch (error) {
    console.warn(`  scheda ${id} non disponibile: ${error.message}`);
    details.set(id, null);
  }
});

const { output, failed } = mergeRoomTypes({ rooms, details, previous, emptyCampuses });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Scritto ${outputPath}`);
if (failed.length > 0) {
  console.error(
    `${failed.length} schede non scaricate (${failed.join(", ")}): tenute le voci precedenti, ` +
      "le aule nuove mancano. Rilancia npm run rooms:fetch.",
  );
  process.exitCode = 1;
}
