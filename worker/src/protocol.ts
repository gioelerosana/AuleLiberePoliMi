import type { Language } from "./i18n";
import { LOCATIONS } from "./data";

export const MIN_HOUR = 8;
export const MAX_HOUR = 20;

// The values are the canonical location codes accepted by the PoliMi endpoint.
export const CAMPUSES = LOCATIONS;

export type CampusName = keyof typeof CAMPUSES;

export type CallbackState =
  | { action: "search"; lang: Language }
  | { action: "campus"; lang: Language; campus: string }
  | { action: "date"; lang: Language; campus: string; date: string }
  | {
      action: "start";
      lang: Language;
      campus: string;
      date: string;
      startHour: number;
    }
  | {
      action: "end";
      lang: Language;
      campus: string;
      date: string;
      startHour: number;
      endHour: number;
    }
  | { action: "quickCampus"; lang: Language; campus: string }
  | { action: "quick"; lang: Language; campus: string; duration: number }
  | { action: "info" | "cancel"; lang: Language };

const actionCodes: Record<CallbackState["action"], string> = {
  search: "s",
  campus: "c",
  date: "d",
  start: "b",
  end: "e",
  quickCampus: "qc",
  quick: "q",
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
      base.push(state.campus, String(state.duration));
      break;
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

  const campus = parts[2];
  if (!campus || !isCampusCode(campus)) return null;
  if (code === "c" && parts.length === 3)
    return { action: "campus", lang, campus };
  if (code === "qc" && parts.length === 3)
    return { action: "quickCampus", lang, campus };
  if (code === "d" && parts.length === 4) {
    const date = expandDate(parts[3]!);
    return date ? { action: "date", lang, campus, date } : null;
  }
  if (code === "b" && parts.length === 5) {
    const date = expandDate(parts[3]!);
    const startHour = parseHour(parts[4]!, MIN_HOUR, MAX_HOUR - 1);
    return date && startHour !== null
      ? { action: "start", lang, campus, date, startHour }
      : null;
  }
  if (code === "e" && parts.length === 6) {
    const date = expandDate(parts[3]!);
    const startHour = parseHour(parts[4]!, MIN_HOUR, MAX_HOUR - 1);
    const endHour = parseHour(parts[5]!, MIN_HOUR + 1, MAX_HOUR);
    return date && startHour !== null && endHour !== null && endHour > startHour
      ? { action: "end", lang, campus, date, startHour, endHour }
      : null;
  }
  if (code === "q" && parts.length === 4) {
    const duration = Number(parts[3]);
    return Number.isInteger(duration) && duration >= 1 && duration <= 8
      ? { action: "quick", lang, campus, duration }
      : null;
  }
  return null;
}

export function isCampusCode(value: string): boolean {
  return Object.values(CAMPUSES).includes(value as (typeof CAMPUSES)[CampusName]);
}

export function campusCodeFromName(value: unknown): string | null {
  return typeof value === "string" && value in CAMPUSES
    ? CAMPUSES[value as CampusName]
    : null;
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

function parseHour(value: string, min: number, max: number): number | null {
  const hour = Number(value);
  return Number.isInteger(hour) && hour >= min && hour <= max ? hour : null;
}
