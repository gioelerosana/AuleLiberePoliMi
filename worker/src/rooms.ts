import { CAMPUS_ZONES, LOCATIONS, ROOM_TYPES } from "./data";

/**
 * - standard: ordinary lecture rooms, shown by default
 * - drawing: drawing rooms, shown on request
 * - excluded: labs, conference halls, study rooms, exhibition spaces, …
 */
export type RoomKind = "standard" | "drawing" | "excluded";

export type ListedRoomKind = Exclude<RoomKind, "excluded">;

/** "main" rooms sit in the central zone of their campus (json/campusZones.json). */
export type RoomZone = "main" | "other";

export interface RoomInfo {
  kind: RoomKind;
  zone: RoomZone;
}

const DIDACTIC_CATEGORY = "AULA DIDATTICA";
const DRAWING_TYPE = "DISEGNO";
const STANDARD_TYPES = new Set(["PLATEA FRONTALE", "INFORMATIZZATA"]);

/** Classify a room from the "Categoria" and "Tipologia" of its PoliMi page. */
export function classifyRoom(category: string, type: string): RoomKind {
  if (category !== DIDACTIC_CATEGORY) return "excluded";
  if (type === DRAWING_TYPE) return "drawing";
  return STANDARD_TYPES.has(type) ? "standard" : "excluded";
}

/** Campuses without a configured central zone have only "main" rooms. */
export function zoneOf(campus: string, site: string): RoomZone {
  const mainSites = CAMPUS_ZONES[campus];
  return !mainSites || mainSites.includes(site) ? "main" : "other";
}

export function roomInfo(roomId: number | undefined): RoomInfo {
  const entry = roomId === undefined ? undefined : ROOM_TYPES[String(roomId)];
  // Rooms added after the last `npm run rooms:fetch` count as standard and central.
  if (!entry) return { kind: "standard", zone: "main" };
  const [campus, category, type, site] = entry;
  return { kind: classifyRoom(category, type), zone: zoneOf(campus, site) };
}

/** Campus (MIA) and single-site (MIA01) codes with at least one drawing room. */
const DRAWING_LOCATIONS = new Set(
  Object.values(ROOM_TYPES)
    .filter(([, category, type]) => classifyRoom(category, type) === "drawing")
    .flatMap(([campus, , , site]) => [campus, ...siteCode(site)]),
);

/** The site names of json/roomTypes.json are the names of json/location.json. */
function siteCode(site: string): string[] {
  return site in LOCATIONS ? [LOCATIONS[site as keyof typeof LOCATIONS]] : [];
}

/** Legacy single-site preferences (MIA04) search only that site. */
export function campusHasDrawingRooms(campus: string): boolean {
  return DRAWING_LOCATIONS.has(campus);
}

/**
 * Only whole-campus searches are narrowed to the central zone: a single-site
 * code (MIA04) already names the area the user wants.
 */
export function campusHasZones(campus: string): boolean {
  return campus in CAMPUS_ZONES;
}
