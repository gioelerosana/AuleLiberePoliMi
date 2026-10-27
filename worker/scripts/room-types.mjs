/**
 * Pure helpers of fetch-room-types.mjs and generate-data.mjs, kept apart so
 * the tests can import them without running the scripts.
 */

const SATURDAY = 6;
const SUNDAY = 0;
const SAFE_UTC_HOUR = 12;

/** The next Monday–Friday after `now`, on the Rome calendar like worker/src/clock.ts. */
export function nextRomeWeekday(now = new Date()) {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .split("-")
    .map(Number);
  for (let offset = 1; ; offset += 1) {
    const date = new Date(Date.UTC(year, month - 1, day + offset, SAFE_UTC_HOUR));
    const weekday = date.getUTCDay();
    if (weekday !== SATURDAY && weekday !== SUNDAY) {
      return { day: date.getUTCDate(), month: date.getUTCMonth() + 1, year: date.getUTCFullYear() };
    }
  }
}

/**
 * Builds json/roomTypes.json from the rooms listed today and their details.
 *
 * A detail page that failed to download (`null`) keeps the previous entry of
 * the room, or leaves it out so the bot counts it as a lecture room: an empty
 * category would classify a real room as excluded. Campuses that listed no
 * room on the chosen day keep their previous entries too.
 */
export function mergeRoomTypes({ rooms, details, previous = {}, emptyCampuses = [] }) {
  const output = {};
  const failed = [];
  for (const [id, room] of rooms) {
    const detail = details.get(id);
    if (detail) {
      output[id] = { ...room, ...detail };
    } else {
      failed.push(id);
      if (previous[id]) output[id] = previous[id];
    }
  }
  const keptCampuses = new Set(emptyCampuses);
  for (const [id, entry] of Object.entries(previous)) {
    if (keptCampuses.has(entry.campus) && !(id in output)) output[id] = entry;
  }
  return { output, failed };
}

/** Id of the first malformed json/roomTypes.json entry, or undefined. */
export function invalidRoomTypeId(roomTypes) {
  return Object.entries(roomTypes).find(
    ([id, room]) =>
      !/^\d+$/.test(id) ||
      typeof room?.campus !== "string" ||
      typeof room?.site !== "string" ||
      typeof room?.type !== "string" ||
      // An empty category means a failed download and would exclude the room.
      typeof room?.category !== "string" ||
      room.category === "",
  )?.[0];
}
