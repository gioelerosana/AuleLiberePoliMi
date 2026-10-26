import { describe, expect, it } from "vitest";
import { invalidRoomTypeId, mergeRoomTypes, nextRomeWeekday } from "../scripts/room-types.mjs";

const lecture = {
  site: "Milano Bovisa - Via Durando",
  building: "Edificio B1",
  category: "AULA DIDATTICA",
  type: "PLATEA FRONTALE",
};

describe("room types snapshot (npm run rooms:fetch)", () => {
  it("keeps the previous entry of a room whose page failed to download", () => {
    const previous = { "2": { campus: "MIB", name: "B.2", ...lecture, type: "DISEGNO" } };
    const { output, failed } = mergeRoomTypes({
      rooms: new Map([
        [1, { campus: "MIB", name: "B.1" }],
        [2, { campus: "MIB", name: "B.2" }],
        [3, { campus: "MIB", name: "B.3" }],
      ]),
      details: new Map([
        [1, lecture],
        [2, null],
        [3, null],
      ]),
      previous,
    });
    expect(failed).toEqual([2, 3]);
    expect(output["1"]).toEqual({ campus: "MIB", name: "B.1", ...lecture });
    expect(output["2"]).toEqual(previous["2"]);
    // Unknown rooms stay out of the snapshot, so the bot lists them as lecture rooms.
    expect(output).not.toHaveProperty("3");
  });

  it("keeps the previous entries of a campus listing no room that day", () => {
    const previous = {
      "7": { campus: "COE", name: "C.1", ...lecture },
      "8": { campus: "MIB", name: "B.8", ...lecture },
    };
    const { output } = mergeRoomTypes({
      rooms: new Map(),
      details: new Map(),
      previous,
      emptyCampuses: ["COE"],
    });
    expect(output).toEqual({ "7": previous["7"] });
  });

  it("rejects entries with an empty category", () => {
    expect(invalidRoomTypeId({ "1": { campus: "MIB", ...lecture } })).toBeUndefined();
    expect(invalidRoomTypeId({ "1": { campus: "MIB", ...lecture, category: "" } })).toBe("1");
    expect(invalidRoomTypeId({ x: { campus: "MIB", ...lecture } })).toBe("x");
  });

  it.each([
    // Friday 23:30 in Rome: the next weekday is Monday.
    ["2026-10-23T21:30:00.000Z", { day: 26, month: 10, year: 2026 }],
    // Monday 00:30 in Rome, still Sunday in UTC: the next weekday is Tuesday.
    ["2026-10-25T23:30:00.000Z", { day: 27, month: 10, year: 2026 }],
    ["2026-10-26T10:00:00.000Z", { day: 27, month: 10, year: 2026 }],
  ])("picks the next weekday on the Rome calendar from %s", (now, expected) => {
    expect(nextRomeWeekday(new Date(now))).toEqual(expected);
  });
});
