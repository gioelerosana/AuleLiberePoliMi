import type { FreeRoomsByBuilding } from "./polimi";

export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

export interface FormatRoomMessagesOptions {
  untilLabel: string;
  /** Returned as the sole message when the search has no results. */
  noResultsText?: string;
  maxLength?: number;
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

function makeRoomLine(
  room: FreeRoomsByBuilding[string][number],
  untilLabel: string,
  availableLength: number,
): string {
  const suffix = ` (${escapeTelegramHtml(untilLabel)} ${escapeTelegramHtml(room.until)}) ${room.powerPlugs ? "🔌" : ""}\n`;
  const escapedName = escapeTelegramHtml(room.name);
  const escapedLink = escapeTelegramHtml(room.link, true);
  const linked = ` <a href="${escapedLink}">${escapedName}</a>${suffix}`;
  if (linked.length <= availableLength) return linked;

  // A pathological upstream URL must not create an invalid Telegram message.
  // Drop the link first, then safely truncate user-controlled text if needed.
  const plainPrefix = " ";
  const roomNameBudget = Math.max(
    0,
    availableLength - plainPrefix.length - suffix.length,
  );
  const plain = `${plainPrefix}${truncateEscaped(room.name, roomNameBudget)}${suffix}`;
  return plain.length <= availableLength
    ? plain
    : truncateEscaped(
        `${room.name} ${untilLabel} ${room.until}${room.powerPlugs ? " 🔌" : ""}`,
        availableLength,
      );
}

/** Format free rooms as valid Telegram HTML messages of at most 4096 chars. */
export function formatRoomMessages(
  availableRooms: FreeRoomsByBuilding,
  options: FormatRoomMessagesOptions,
): string[] {
  const maxLength = options.maxLength ?? TELEGRAM_MAX_MESSAGE_LENGTH;
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
      const line = makeRoomLine(
        room,
        options.untilLabel,
        maxLength - header.length,
      );
      if (current && current.length + prefix.length + line.length > maxLength) {
        messages.push(current);
        current = "";
        needsHeader = true;
        prefix = header;
      }
      if (line.length === 0 || current.length + prefix.length + line.length > maxLength) {
        // This only occurs with an exceptionally long localized suffix.
        if (current) messages.push(current);
        current = truncateEscaped(`${room.name} ${options.untilLabel} ${room.until}`, maxLength);
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
