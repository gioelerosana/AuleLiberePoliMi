export interface RoomDetails {
  site: string;
  building: string;
  category: string;
  type: string;
}

export interface ListedRoom {
  campus: string;
  name: string;
}

export type RoomTypeEntry = ListedRoom & RoomDetails;

export function nextRomeWeekday(now?: Date): { day: number; month: number; year: number };

export function mergeRoomTypes(input: {
  rooms: ReadonlyMap<number, ListedRoom>;
  details: ReadonlyMap<number, RoomDetails | null>;
  previous?: Record<string, RoomTypeEntry>;
  emptyCampuses?: readonly string[];
}): { output: Record<string, RoomTypeEntry>; failed: number[] };

export function invalidRoomTypeId(roomTypes: Record<string, unknown>): string | undefined;
