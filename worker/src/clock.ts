import { MAX_HOUR, MIN_HOUR } from "./protocol";

const MINUTES_PER_QUARTER = 15;
const QUARTERS_PER_HOUR = 4;
// Noon keeps the UTC date stable whatever the Rome DST offset is.
const SAFE_UTC_HOUR = 12;
const TWO_DIGITS = 2;
const SUNDAY = 0;

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
  const nowHour = romeQuarterHour(now);
  const today = addRomeDays(now, 0);
  if (isOpenDay(today) && nowHour >= MIN_HOUR && nowHour < MAX_HOUR) {
    return { date: today, startHour: nowHour, endHour: Math.min(nowHour + duration, MAX_HOUR), closed: false };
  }
  // Closed: search from the next opening, today before 08:00, else tomorrow.
  // Sunday is the only closed day, so skipping one day is always enough.
  const nextDay = nowHour < MIN_HOUR ? 0 : 1;
  const offset = isOpenDay(addRomeDays(now, nextDay)) ? nextDay : nextDay + 1;
  const date = addRomeDays(now, offset);
  return { date, startHour: MIN_HOUR, endHour: Math.min(MIN_HOUR + duration, MAX_HOUR), closed: true };
}

/** PoliMi is closed on Sundays: every room would look free. */
export function isOpenDay(date: string): boolean {
  return weekdayOf(date) !== SUNDAY;
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
