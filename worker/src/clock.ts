import { MAX_HOUR, MIN_HOUR } from "./protocol";

const MINUTES_PER_QUARTER = 15;
const QUARTERS_PER_HOUR = 4;
// Noon keeps the UTC date stable whatever the Rome DST offset is.
const SAFE_UTC_HOUR = 12;
const TWO_DIGITS = 2;

export interface QuickSlot {
  date: string;
  startHour: number;
  endHour: number;
  closed: boolean;
}

/** Current Rome time floored to the quarter hour (14:21 → 14.25). */
export function romeQuarterHour(now: Date): number {
  const parts = romeParts(now);
  // Lessons run :15 to :15, so truncating to the hour would still see a lesson
  // that ended minutes ago; floor to the quarter hour instead.
  return parts.hour + Math.floor(parts.minute / MINUTES_PER_QUARTER) / QUARTERS_PER_HOUR;
}

export function quickSearchSlot(now: Date, duration: number): QuickSlot {
  let date = addRomeDays(now, 0);
  let startHour = romeQuarterHour(now);
  let closed = false;
  if (startHour < MIN_HOUR) {
    startHour = MIN_HOUR;
    closed = true;
  } else if (startHour >= MAX_HOUR) {
    date = addRomeDays(now, 1);
    startHour = MIN_HOUR;
    closed = true;
  }
  return { date, startHour, endHour: Math.min(startHour + duration, MAX_HOUR), closed };
}

/** dd/mm/yyyy of the Rome calendar day `offset` days from now. */
export function addRomeDays(now: Date, offset: number): string {
  const parts = romeParts(now);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offset, SAFE_UTC_HOUR));
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}

/** 0 = Sunday, like Date#getUTCDay. */
export function weekdayOf(date: string): number {
  const [day, month, year] = date.split("/").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
}

export function pad(value: number): string {
  return String(value).padStart(TWO_DIGITS, "0");
}

function romeParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute") };
}
