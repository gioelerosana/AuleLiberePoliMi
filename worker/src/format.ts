import type { FreeRoomsByBuilding } from "./polimi";

export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
/** Room left in the first result message for the search summary header. */
export const RESULT_HEADER_RESERVE = 512;

type Room = FreeRoomsByBuilding[string][number];

export interface FormatRoomMessagesOptions {
  /** Plain text after each room name: "→ 14:15" (free until) by default. */
  timeText?: (room: Room) => string;
  /** Returned as the sole message when the search has no results. */
  noResultsText?: string;
  maxLength?: number;
}

/** Format fractional hours (14.25) as HH:MM. */
export function formatTime(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(totalMinutes / 60))}:${pad(totalMinutes % 60)}`;
}

export function escapeTelegramHtml(value: unknown, quote = false): string {
  let escaped = String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  if (quote) escaped = escaped.replaceAll('"', "&quot;");
  return escaped;
}

function truncateEscaped(raw: string, maximumLength: number): string {
  if (maximumLength <= 0) return "";
  let low = 0;
  let high = raw.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (escapeTelegramHtml(raw.slice(0, middle)).length <= maximumLength) low = middle;
    else high = middle - 1;
  }
  return escapeTelegramHtml(raw.slice(0, low));
}

function makeHeader(building: string, maxLength: number): string {
  const wrapperLength = "\n<b></b>\n".length;
  return `\n<b>${truncateEscaped(building, maxLength - wrapperLength)}</b>\n`;
}

const freeUntil = (room: Room): string => `→ ${formatTime(room.until)}`;

function plainRoomLine(room: Room, time: string): string {
  return `${room.name} ${time}${room.powerPlugs ? " 🔌" : ""}`;
}

function makeRoomLine(room: Room, time: string, availableLength: number): string {
  const suffix = ` ${escapeTelegramHtml(time)}${room.powerPlugs ? " 🔌" : ""}\n`;
  const escapedName = escapeTelegramHtml(room.name);
  const escapedLink = escapeTelegramHtml(room.link, true);
  const linked = `• <a href="${escapedLink}">${escapedName}</a>${suffix}`;
  if (linked.length <= availableLength) return linked;

  // A pathological upstream URL must not create an invalid Telegram message.
  // Drop the link first, then safely truncate user-controlled text if needed.
  const plainPrefix = "• ";
  const roomNameBudget = Math.max(
    0,
    availableLength - plainPrefix.length - suffix.length,
  );
  const plain = `${plainPrefix}${truncateEscaped(room.name, roomNameBudget)}${suffix}`;
  return plain.length <= availableLength
    ? plain
    : truncateEscaped(plainRoomLine(room, time), availableLength);
}

/** Format free rooms as valid Telegram HTML messages of at most 4096 chars. */
export function formatRoomMessages(
  availableRooms: FreeRoomsByBuilding,
  options: FormatRoomMessagesOptions,
): string[] {
  const maxLength = options.maxLength ?? TELEGRAM_MAX_MESSAGE_LENGTH;
  const timeText = options.timeText ?? freeUntil;
  if (!Number.isInteger(maxLength) || maxLength < 32) {
    throw new RangeError("maxLength must be an integer of at least 32");
  }

  const nonEmptyBuildings = Object.entries(availableRooms).filter(
    ([, rooms]) => rooms.length > 0,
  );
  if (nonEmptyBuildings.length === 0) {
    if (!options.noResultsText) return [];
    return [truncateEscaped(options.noResultsText, maxLength)];
  }

  const messages: string[] = [];
  let current = "";
  for (const [building, rooms] of nonEmptyBuildings) {
    const header = makeHeader(building, maxLength);
    let needsHeader = true;
    for (const room of rooms) {
      let prefix = needsHeader ? header : "";
      const time = timeText(room);
      const line = makeRoomLine(room, time, maxLength - header.length);
      if (current && current.length + prefix.length + line.length > maxLength) {
        messages.push(current);
        current = "";
        needsHeader = true;
        prefix = header;
      }
      if (line.length === 0 || current.length + prefix.length + line.length > maxLength) {
        // This only occurs with an exceptionally long localized suffix.
        if (current) messages.push(current);
        current = truncateEscaped(plainRoomLine(room, time), maxLength);
        needsHeader = true;
      } else {
        current += prefix + line;
        needsHeader = false;
      }
    }
  }
  if (current) messages.push(current);
  return messages.filter(Boolean);
}
