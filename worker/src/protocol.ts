import type { Language } from "./i18n";
import { CAMPUSES, LOCATION_CODES, LOCATIONS } from "./data";

export const MIN_HOUR = 8;
export const MAX_HOUR = 20;
export const QUARTER = 0.25;
export const MAX_DURATION = 8;
// How far ahead (hours after the search start) the "freeing up" section looks.
export const MIN_LOOKAHEAD = 1;
export const MAX_LOOKAHEAD = 8;
export const DEFAULT_LOOKAHEAD = 2;

// CAMPUSES drives the search menus (one entry per campus). LOCATIONS still
// holds every PoliMi site so preferences saved before the menu was trimmed to
// main campuses keep resolving, and so callback data can be validated.
export { CAMPUSES };

export type CampusName = keyof typeof CAMPUSES;
export type LocationName = keyof typeof LOCATIONS;

/**
 * Optional flags carried as a trailing callback field:
 * - powerOnly: show only rooms with power plugs
 * - drawing: show drawing rooms instead of lecture rooms
 * - fresh: the button sits under search results, so answer with a new
 *   message instead of editing the results away
 */
export interface CallbackFlags {
  powerOnly?: boolean;
  drawing?: boolean;
  fresh?: boolean;
}

export type CallbackState =
  | { action: "search"; lang: Language }
  | { action: "campus"; lang: Language; campus: string }
  | ({ action: "date"; lang: Language; campus: string; date: string } & CallbackFlags)
  | {
      action: "start";
      lang: Language;
      campus: string;
      date: string;
      startHour: number;
    }
  | ({
      action: "end";
      lang: Language;
      campus: string;
      date: string;
      startHour: number;
      endHour: number;
    } & CallbackFlags)
  | ({ action: "quickCampus"; lang: Language; campus: string } & CallbackFlags)
  | ({
      action: "quick";
      lang: Language;
      campus: string;
      duration: number;
      lookahead: number;
    } & CallbackFlags)
  | { action: "campusMenu"; lang: Language; quick: boolean; more: boolean }
  | { action: "info"; lang: Language }
  | { action: "cancel"; lang: Language };

const actionCodes: Record<CallbackState["action"], string> = {
  search: "s",
  campus: "c",
  date: "d",
  start: "b",
  end: "e",
  quickCampus: "qc",
  quick: "q",
  campusMenu: "m",
  info: "i",
  cancel: "x",
};

export function encodeCallback(state: CallbackState): string {
  const base = [actionCodes[state.action], state.lang];
  switch (state.action) {
    case "search":
    case "info":
    case "cancel":
      break;
    case "campus":
    case "quickCampus":
      base.push(state.campus);
      break;
    case "campusMenu":
      base.push(state.quick ? "q" : "s", state.more ? "1" : "0");
      break;
    case "date":
      base.push(state.campus, compactDate(state.date));
      break;
    case "start":
      base.push(state.campus, compactDate(state.date), String(state.startHour));
      break;
    case "end":
      base.push(
        state.campus,
        compactDate(state.date),
        String(state.startHour),
        String(state.endHour),
      );
      break;
    case "quick":
      base.push(state.campus, String(state.duration), String(state.lookahead));
      break;
  }
  if ("fresh" in state || "powerOnly" in state || "drawing" in state) {
    const flags = encodeFlags(state);
    if (flags) base.push(flags);
  }
  const encoded = base.join(":");
  if (new TextEncoder().encode(encoded).length > 64) {
    throw new Error("Telegram callback_data exceeds 64 bytes");
  }
  return encoded;
}

export function decodeCallback(value: string): CallbackState | null {
  const parts = value.split(":");
  const [code, rawLang] = parts;
  if (rawLang !== "it" && rawLang !== "en") return null;
  const lang = rawLang;
  if (code === "s" && parts.length === 2) return { action: "search", lang };
  if (code === "i" && parts.length === 2) return { action: "info", lang };
  if (code === "x" && parts.length === 2) return { action: "cancel", lang };

  if (code === "m" && parts.length === 4) {
    const [, , scope, page] = parts;
    if ((scope !== "q" && scope !== "s") || (page !== "0" && page !== "1")) return null;
    return { action: "campusMenu", lang, quick: scope === "q", more: page === "1" };
  }

  const campus = parts[2];
  if (!campus || !isCampusCode(campus)) return null;
  if (code === "c" && parts.length === 3)
    return { action: "campus", lang, campus };
  if (code === "b" && parts.length === 5) {
    const date = expandDate(parts[3]!);
    const startHour = parseHour(parts[4]!, MIN_HOUR, MAX_HOUR - QUARTER, QUARTER);
    return date && startHour !== null
      ? { action: "start", lang, campus, date, startHour }
      : null;
  }

  // Quick buttons sent before the lookahead existed carry no lookahead part.
  // Digits only: matches "4", rejects the flags field "pn".
  const hasLookahead = code === "q" && /^\d+$/.test(parts[4] ?? "");
  // The remaining actions accept one optional trailing flags field.
  const baseLength = { qc: 3, d: 4, q: hasLookahead ? 5 : 4, e: 6 }[code ?? ""];
  if (!baseLength || (parts.length !== baseLength && parts.length !== baseLength + 1))
    return null;
  const flags = decodeFlags(parts[baseLength]);
  if (!flags) return null;
  if (code === "qc") return { action: "quickCampus", lang, campus, ...flags };
  if (code === "d") {
    const date = expandDate(parts[3]!);
    return date ? { action: "date", lang, campus, date, ...flags } : null;
  }
  if (code === "e") {
    const date = expandDate(parts[3]!);
    const startHour = parseHour(parts[4]!, MIN_HOUR, MAX_HOUR - QUARTER, QUARTER);
    const endHour = parseHour(parts[5]!, MIN_HOUR + 1, MAX_HOUR, 1);
    return date && startHour !== null && endHour !== null && endHour > startHour
      ? { action: "end", lang, campus, date, startHour, endHour, ...flags }
      : null;
  }
  const duration = Number(parts[3]);
  const lookahead = hasLookahead ? Number(parts[4]) : DEFAULT_LOOKAHEAD;
  return Number.isInteger(duration) &&
    duration >= 1 &&
    duration <= MAX_DURATION &&
    isValidLookahead(lookahead)
    ? { action: "quick", lang, campus, duration, lookahead, ...flags }
    : null;
}

export function isValidLookahead(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_LOOKAHEAD &&
    value <= MAX_LOOKAHEAD
  );
}

function encodeFlags(flags: CallbackFlags): string {
  return `${flags.powerOnly ? "p" : ""}${flags.drawing ? "d" : ""}${flags.fresh ? "n" : ""}`;
}

function decodeFlags(raw: string | undefined): CallbackFlags | null {
  if (raw === undefined) return {};
  // Flags in fixed order, each at most once: matches "pdn" and "d", rejects "np".
  if (!/^p?d?n?$/.test(raw) || raw === "") return null;
  const flags: CallbackFlags = {};
  if (raw.includes("p")) flags.powerOnly = true;
  if (raw.includes("d")) flags.drawing = true;
  if (raw.includes("n")) flags.fresh = true;
  return flags;
}

export function isCampusCode(value: string): boolean {
  return LOCATION_CODES.has(value);
}

export function campusCodeFromName(value: unknown): string | null {
  return typeof value === "string" && value in LOCATIONS
    ? LOCATIONS[value as LocationName]
    : null;
}

const MILAN_PREFIX = "Milano ";

/** Compact campus name for buttons: "Milano Bovisa" → "Bovisa". */
export function shortCampusName(name: string): string {
  return name.startsWith(MILAN_PREFIX) ? name.slice(MILAN_PREFIX.length) : name;
}

export function campusCodeFromShortName(value: string): string | null {
  return campusCodeFromName(value) ?? campusCodeFromName(MILAN_PREFIX + value);
}

export function campusName(code: string): string {
  return Object.entries(LOCATIONS).find(([, value]) => value === code)?.[0] ?? code;
}

function compactDate(date: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
  if (!match) throw new Error("Invalid callback date");
  return `${match[3]}${match[2]}${match[1]}`;
}

function expandDate(compact: string): string | null {
  const match = /^(20\d{2})(\d{2})(\d{2})$/.exec(compact);
  if (!match) return null;
  const day = Number(match[3]);
  const month = Number(match[2]);
  const year = Number(match[1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function parseHour(value: string, min: number, max: number, step: number): number | null {
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(value)) return null;
  const hour = Number(value);
  return Number.isInteger(hour / step) && hour >= min && hour <= max ? hour : null;
}
