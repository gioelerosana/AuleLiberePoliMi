export const POLIMI_OCCUPANCY_URL =
  "https://onlineservices.polimi.it/spazi/spazi/controller/OccupazioniGiornoEsatto.do";

const POLIMI_CONTROLLER_URL =
  "https://onlineservices.polimi.it/spazi/spazi/controller/";
const QUARTER_HOUR = 0.25;
const FIRST_GRID_TIME = 7.75;
const LAST_OPENING_TIME = 20;
// Rooms freeing up this many hours after the search start are worth listing.
const FREEING_WINDOW_FROM = 1;
const FREEING_WINDOW_TO = 2;
const DEFAULT_TIMEOUT_MS = 20_000;
const GARBAGE_ROOMS = new Set(["PROVA_ASICT", "2.2.1-D.I.", "OSVALDODEDONATO"]);
const UPSTREAM_HEADERS = {
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
  // The PoliMi edge rejects workerd's default client fingerprint with 403.
  // Identify the project explicitly; this is not used to bypass authentication.
  "User-Agent":
    "Mozilla/5.0 (compatible; AuleLiberePoliMi/3.0; +https://github.com/JoelShepard/AuleLiberePoliMi)",
} as const;

export interface Lesson {
  name: string;
  from: number;
  to: number;
}

export interface RoomOccupancy {
  link: string;
  lessons: Lesson[];
  powerPlugs: boolean;
}

export type OccupanciesByBuilding = Record<
  string,
  Record<string, RoomOccupancy>
>;

export interface FreeRoom {
  name: string;
  link: string;
  until: number;
  powerPlugs: boolean;
}

export type FreeRoomsByBuilding = Record<string, FreeRoom[]>;

/** Rooms and lookahead produced by a single upstream fetch. */
export interface RoomSearchResult {
  free: FreeRoomsByBuilding;
  /**
   * Rooms busy at `startTime` that become free between one and two hours
   * later. `until` holds the time the room frees up, not the end of a gap.
   */
  freeingUp: FreeRoomsByBuilding;
}

export interface SearchFreeRoomsInput {
  location: string;
  day: number;
  month: number;
  year: number;
  startTime: number;
  endTime: number;
  /** Static contents of roomsWithPower.json, bundled by the caller. */
  roomsWithPower: readonly number[];
}

interface RewriterElement {
  getAttribute(name: string): string | null;
  onEndTag(callback: () => void): void;
}

interface RewriterTextChunk {
  text: string;
}

interface RewriterHandler {
  element?(element: RewriterElement): void;
  text?(chunk: RewriterTextChunk): void;
}

export interface HtmlRewriterLike {
  on(selector: string, handler: RewriterHandler): HtmlRewriterLike;
  transform(response: Response): Response;
}

export type HtmlRewriterConstructor = new () => HtmlRewriterLike;

export interface SearchDependencies {
  fetch?: typeof fetch;
  htmlRewriter?: HtmlRewriterConstructor;
  timeoutMs?: number;
  upstreamUrl?: string;
}

interface ParsedCell {
  classes: string[];
  colspan: number;
  text: string;
  anchorText: string;
  href?: string;
}

interface ParsedRow {
  hasClassAttribute: boolean;
  cells: ParsedCell[];
}

function classesOf(value: string | null): string[] {
  return (value ?? "").split(/\s+/u).filter(Boolean);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function roomIdFromHref(href: string): number | undefined {
  try {
    const value = new URL(href, POLIMI_CONTROLLER_URL).searchParams.get("idaula");
    if (value !== null && /^\d+$/u.test(value)) return Number(value);
  } catch {
    // Fall through to support the relative links used by older PoliMi pages.
  }

  const finalValue = href.slice(href.lastIndexOf("=") + 1);
  return /^\d+$/u.test(finalValue) ? Number(finalValue) : undefined;
}

function absoluteRoomUrl(href: string): string {
  try {
    return new URL(href, POLIMI_CONTROLLER_URL).toString();
  } catch {
    return POLIMI_CONTROLLER_URL;
  }
}

function buildingName(rawName: string): string {
  const parts = rawName.split("-");
  return (parts.length >= 3 ? parts.slice(2).join("-") : rawName).trim();
}

function consumeRow(
  row: ParsedRow,
  occupancies: OccupanciesByBuilding,
  currentBuilding: { value: string },
  poweredRoomIds: ReadonlySet<number>,
): void {
  if (row.cells.length === 0) return;

  const buildingCell = row.cells.find((cell) =>
    cell.classes.includes("innerEdificio"),
  );
  if (!row.hasClassAttribute && buildingCell) {
    const name = buildingName(normalizeText(buildingCell.text));
    if (name) {
      currentBuilding.value = name;
      occupancies[name] ??= {};
    }
    return;
  }

  // Data rows have a class in the current upstream HTML. Ignoring header rows
  // without one also mirrors the Python implementation.
  if (!row.hasClassAttribute) return;

  let currentRoom = "";
  let time = FIRST_GRID_TIME;
  for (const cell of row.cells) {
    if (cell.classes.includes("dove")) {
      currentRoom = normalizeText(cell.anchorText).replace(/\s+/gu, "");
      if (!currentRoom || !cell.href) continue;

      const rooms = (occupancies[currentBuilding.value] ??= {});
      rooms[currentRoom] ??= {
        link: absoluteRoomUrl(cell.href),
        lessons: [],
        powerPlugs: (() => {
          const roomId = roomIdFromHref(cell.href!);
          return roomId !== undefined && poweredRoomIds.has(roomId);
        })(),
      };
    } else if (cell.classes.includes("slot") && currentRoom) {
      const duration = Number.isFinite(cell.colspan) && cell.colspan > 0
        ? cell.colspan
        : 1;
      const from = time;
      time += duration / 4;
      occupancies[currentBuilding.value]?.[currentRoom]?.lessons.push({
        name: normalizeText(cell.anchorText) || "Occupata",
        from,
        to: time,
      });
    } else {
      time += QUARTER_HOUR;
    }
  }
}

function resolveHtmlRewriter(
  supplied?: HtmlRewriterConstructor,
): HtmlRewriterConstructor {
  if (supplied) return supplied;
  const runtime = globalThis as unknown as {
    HTMLRewriter?: HtmlRewriterConstructor;
  };
  if (!runtime.HTMLRewriter) {
    throw new Error("HTMLRewriter is unavailable in this runtime");
  }
  return runtime.HTMLRewriter;
}

/** Parse PoliMi's occupancy table using the streaming Workers HTMLRewriter. */
export async function parseOccupancyResponse(
  response: Response,
  roomsWithPower: readonly number[],
  htmlRewriter?: HtmlRewriterConstructor,
): Promise<OccupanciesByBuilding> {
  const occupancies: OccupanciesByBuilding = { "-": {} };
  const currentBuilding = { value: "-" };
  const poweredRoomIds = new Set(roomsWithPower);
  let currentRow: ParsedRow | undefined;
  let currentCell: ParsedCell | undefined;

  const Rewriter = resolveHtmlRewriter(htmlRewriter);
  const rewriter = new Rewriter()
    .on("#tableContainer tr", {
      element(element) {
        const row: ParsedRow = {
          hasClassAttribute: element.getAttribute("class") !== null,
          cells: [],
        };
        currentRow = row;
        element.onEndTag(() => {
          consumeRow(row, occupancies, currentBuilding, poweredRoomIds);
          if (currentRow === row) currentRow = undefined;
        });
      },
    })
    .on("#tableContainer tr td", {
      element(element) {
        if (!currentRow) return;
        const parsedColspan = Number.parseInt(
          element.getAttribute("colspan") ?? "1",
          10,
        );
        const cell: ParsedCell = {
          classes: classesOf(element.getAttribute("class")),
          colspan: Number.isFinite(parsedColspan) ? parsedColspan : 1,
          text: "",
          anchorText: "",
        };
        currentRow.cells.push(cell);
        currentCell = cell;
        element.onEndTag(() => {
          if (currentCell === cell) currentCell = undefined;
        });
      },
      text(chunk) {
        if (currentCell) currentCell.text += chunk.text;
      },
    })
    .on("#tableContainer tr td a", {
      element(element) {
        const href = element.getAttribute("href");
        if (currentCell && href !== null) currentCell.href = href;
      },
      text(chunk) {
        if (currentCell) currentCell.anchorText += chunk.text;
      },
    });

  // HTMLRewriter is lazy: consuming the transformed body runs all handlers.
  await rewriter.transform(response).text();

  if (Object.keys(occupancies["-"] ?? {}).length === 0) delete occupancies["-"];
  for (const rooms of Object.values(occupancies)) {
    for (const garbageRoom of GARBAGE_ROOMS) delete rooms[garbageRoom];
  }
  return occupancies;
}

export function isRoomFree(
  lessons: readonly Lesson[],
  startTime: number,
  endTime: number,
): { free: boolean; until: number | null } {
  let until = LAST_OPENING_TIME;
  const sortedLessons = [...lessons].sort((a, b) => a.from - b.from);

  for (const lesson of sortedLessons) {
    if (lesson.from < endTime && lesson.to > startTime) {
      return { free: false, until: null };
    }
    if (lesson.from >= endTime) until = Math.min(until, lesson.from);
  }
  return { free: true, until };
}

/**
 * Time at which a room busy at `time` becomes free, following back-to-back
 * lessons. Returns null when the room is already free at `time`.
 */
export function freeingTime(
  lessons: readonly Lesson[],
  time: number,
): number | null {
  const sortedLessons = [...lessons].sort((a, b) => a.from - b.from);
  let freeAt = time;
  let busy = false;
  for (const lesson of sortedLessons) {
    if (lesson.from <= freeAt && lesson.to > freeAt) {
      freeAt = lesson.to;
      busy = true;
    }
  }
  return busy ? freeAt : null;
}

function validateSearchInput(input: SearchFreeRoomsInput): void {
  if (!input.location.trim()) throw new TypeError("location must not be empty");
  for (const key of ["day", "month", "year", "startTime", "endTime"] as const) {
    if (!Number.isFinite(input[key])) throw new TypeError(`${key} must be finite`);
  }
  if (input.startTime >= input.endTime) {
    throw new RangeError("startTime must be before endTime");
  }
}

/** Fetch occupancies and return only rooms free for the whole requested range. */
export async function searchFreeRooms(
  input: SearchFreeRoomsInput,
  dependencies: SearchDependencies = {},
): Promise<FreeRoomsByBuilding> {
  return (await searchRooms(input, dependencies)).free;
}

/**
 * Like {@link searchFreeRooms}, and also lists the rooms that free up between
 * one and two hours after `startTime`, from the same upstream fetch.
 */
export async function searchRooms(
  input: SearchFreeRoomsInput,
  dependencies: SearchDependencies = {},
): Promise<RoomSearchResult> {
  validateSearchInput(input);
  const requestUrl = new URL(
    dependencies.upstreamUrl ?? POLIMI_OCCUPANCY_URL,
  );
  requestUrl.search = new URLSearchParams({
    csic: input.location,
    categoria: "tutte",
    tipologia: "tutte",
    giorno_day: String(input.day),
    giorno_month: String(input.month),
    giorno_year: String(input.year),
    jaf_giorno_date_format: "dd/MM/yyyy",
    evn_visualizza: "",
  }).toString();

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("PoliMi request timed out")),
    dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    const response = await (dependencies.fetch ?? fetch)(requestUrl, {
      signal: controller.signal,
      headers: UPSTREAM_HEADERS,
    });
    if (!response.ok) {
      throw new Error(
        `PoliMi occupancy request failed: ${response.status} ${response.statusText}`.trim(),
      );
    }

    const occupancies = await parseOccupancyResponse(
      response,
      input.roomsWithPower,
      dependencies.htmlRewriter,
    );
    const free: FreeRoomsByBuilding = {};
    const freeingUp: FreeRoomsByBuilding = {};
    for (const [building, rooms] of Object.entries(occupancies)) {
      for (const [name, room] of Object.entries(rooms)) {
        const availability = isRoomFree(
          room.lessons,
          input.startTime,
          input.endTime,
        );
        if (availability.free && availability.until !== null) {
          (free[building] ??= []).push({
            name,
            link: room.link,
            until: availability.until,
            powerPlugs: room.powerPlugs,
          });
          continue;
        }

        const freeAt = freeingTime(room.lessons, input.startTime);
        if (
          freeAt !== null &&
          freeAt >= input.startTime + FREEING_WINDOW_FROM &&
          freeAt <= input.startTime + FREEING_WINDOW_TO &&
          freeAt < LAST_OPENING_TIME
        ) {
          (freeingUp[building] ??= []).push({
            name,
            link: room.link,
            until: freeAt,
            powerPlugs: room.powerPlugs,
          });
        }
      }
    }
    return { free, freeingUp };
  } finally {
    clearTimeout(timeout);
  }
}
