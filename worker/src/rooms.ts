import { ROOM_TYPES } from "./data";

/**
 * - standard: ordinary lecture rooms, shown by default
 * - drawing: drawing rooms, shown on request
 * - excluded: labs, conference halls, study rooms, exhibition spaces, …
 */
export type RoomKind = "standard" | "drawing" | "excluded";

export type ListedRoomKind = Exclude<RoomKind, "excluded">;

const DIDACTIC_CATEGORY = "AULA DIDATTICA";
const DRAWING_TYPE = "DISEGNO";
const STANDARD_TYPES = new Set(["PLATEA FRONTALE", "INFORMATIZZATA"]);
const CAMPUS_CODE_LENGTH = 3;

/** Classify a room from the "Categoria" and "Tipologia" of its PoliMi page. */
export function classifyRoom(category: string, type: string): RoomKind {
  if (category !== DIDACTIC_CATEGORY) return "excluded";
  if (type === DRAWING_TYPE) return "drawing";
  return STANDARD_TYPES.has(type) ? "standard" : "excluded";
}

export function roomKind(roomId: number | undefined): RoomKind {
  const entry = roomId === undefined ? undefined : ROOM_TYPES[String(roomId)];
  // Rooms added after the last `npm run rooms:fetch` count as standard.
  return entry ? classifyRoom(entry[1], entry[2]) : "standard";
}

const DRAWING_CAMPUSES = new Set(
  Object.values(ROOM_TYPES)
    .filter(([, category, type]) => classifyRoom(category, type) === "drawing")
    .map(([campus]) => campus),
);

/** Single-site codes (MIA11) belong to the campus of their prefix (MIA). */
export function campusHasDrawingRooms(campus: string): boolean {
  return DRAWING_CAMPUSES.has(campus.slice(0, CAMPUS_CODE_LENGTH));
}
