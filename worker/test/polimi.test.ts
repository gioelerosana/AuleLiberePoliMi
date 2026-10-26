import { describe, expect, it, vi } from "vitest";
// Vite loads this fixture as text when Vitest runs; no Node filesystem API is
// pulled into the Worker implementation.
// @ts-ignore Vite raw imports are resolved by the test runner.
import fixtureHtml from "./fixtures/occupancies.html?raw";
import { RESULT_HEADER_RESERVE, TELEGRAM_MAX_MESSAGE_LENGTH, formatRoomMessages } from "../src/format";
import { searchAndFormat } from "../src/index";
import {
  campusHasDrawingRooms,
  campusHasZones,
  classifyRoom,
  zoneOf,
  type RoomInfo,
  type RoomKind,
} from "../src/rooms";
import {
  freeingGap,
  freeingTime,
  isRoomFree,
  parseOccupancyResponse,
  searchFreeRooms,
  searchRooms,
  type HtmlRewriterConstructor,
  type HtmlRewriterLike,
} from "../src/polimi";
import type { SearchRequest } from "../src/types";

type TestHandler = Parameters<HtmlRewriterLike["on"]>[1];

class TestElement {
  readonly #endCallbacks: Array<() => void> = [];

  constructor(private readonly attributes: Record<string, string>) {}

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  onEndTag(callback: () => void): void {
    this.#endCallbacks.push(callback);
  }

  finish(): void {
    for (const callback of this.#endCallbacks) callback();
  }
}

function attributesOf(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/gu)) {
    if (match[1] !== undefined && match[2] !== undefined) {
      attributes[match[1]] = match[2];
    }
  }
  return attributes;
}

function htmlText(source: string): string {
  return source
    .replace(/<[^>]*>/gu, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"');
}

/** Minimal test adapter; production always uses Cloudflare's HTMLRewriter. */
class TestHTMLRewriter implements HtmlRewriterLike {
  readonly #handlers = new Map<string, TestHandler>();

  on(selector: string, handler: TestHandler): HtmlRewriterLike {
    this.#handlers.set(selector, handler);
    return this;
  }

  transform(response: Response): Response {
    const handlers = this.#handlers;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const source = await response.text();
        const rowHandler = handlers.get("#tableContainer tr");
        const cellHandler = handlers.get("#tableContainer tr td");
        const anchorHandler = handlers.get("#tableContainer tr td a");

        for (const rowMatch of source.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/giu)) {
          const row = new TestElement(attributesOf(rowMatch[1] ?? ""));
          rowHandler?.element?.(row);
          const rowBody = rowMatch[2] ?? "";
          for (const cellMatch of rowBody.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/giu)) {
            const cell = new TestElement(attributesOf(cellMatch[1] ?? ""));
            cellHandler?.element?.(cell);
            const cellBody = cellMatch[2] ?? "";
            cellHandler?.text?.({ text: htmlText(cellBody) });
            const anchorMatch = /<a([^>]*)>([\s\S]*?)<\/a>/iu.exec(cellBody);
            if (anchorMatch) {
              const anchor = new TestElement(attributesOf(anchorMatch[1] ?? ""));
              anchorHandler?.element?.(anchor);
              anchorHandler?.text?.({ text: htmlText(anchorMatch[2] ?? "") });
              anchor.finish();
            }
            cell.finish();
          }
          row.finish();
        }
        controller.enqueue(new TextEncoder().encode(source));
        controller.close();
      },
    });
    return new Response(stream, { headers: response.headers });
  }
}

const RuntimeHTMLRewriter: HtmlRewriterConstructor = TestHTMLRewriter;

describe("PoliMi occupancy scraper", () => {
  it("drops excluded rooms and tags drawing rooms", async () => {
    const row = (id: number, name: string) =>
      `<tr class="normalRow"><td class="dove"><a href="DettaglioAula.do?idaula=${id}">${name}</a></td><td></td></tr>`;
    const html = `<div id="tableContainer"><table>
      <tr><td class="innerEdificio">Milano - Via - Edificio BL27</td></tr>
      ${row(1, "BL.27.1.1")}
      ${row(2, "CORRIDOIO")}
      ${row(3, "T.0.1")}
      ${row(4, "L.05-D.I.")}
    </table></div>`;
    const kinds: Record<number, RoomKind> = { 1: "standard", 2: "excluded", 3: "drawing", 4: "drawing" };
    const parsed = await parseOccupancyResponse(new Response(html), [], RuntimeHTMLRewriter, (id) => ({
      kind: id === undefined ? "standard" : kinds[id] ?? "standard",
      zone: id === 3 ? "other" : "main",
    }));
    const building = parsed["Edificio BL27"] ?? {};
    // L.05-D.I. is excluded by name in json/excludedRooms.json.
    expect(Object.keys(building)).toEqual(["BL.27.1.1", "T.0.1"]);
    expect(building["T.0.1"]).toMatchObject({ kind: "drawing", zone: "other" });
  });

  it("keeps the first building, parses quarter-hour slots and power plugs", async () => {
    const parsed = await parseOccupancyResponse(
      new Response(fixtureHtml, { headers: { "content-type": "text/html" } }),
      [123],
      RuntimeHTMLRewriter,
    );

    const building = parsed["Edificio 2 - Piano Terra"];
    expect(building).toBeDefined();
    if (!building) throw new Error("fixture building was not parsed");
    expect(building["2.0.1"]).toEqual({
      link: "https://onlineservices.polimi.it/spazi/spazi/controller/DettaglioAula.do?idaula=123",
      lessons: [
        { name: "Lezione & laboratorio", from: 8, to: 9 },
        { name: "Occupata", from: 9, to: 9.5 },
      ],
      powerPlugs: true,
      kind: "standard",
      zone: "main",
    });
    expect(building["2.0.2"]?.powerPlugs).toBe(false);
    expect(building.PROVA_ASICT).toBeUndefined();
    expect(parsed["-"]).toBeUndefined();
  });

  it("matches Python overlap and adjacency semantics", () => {
    const lessons = [{ name: "lesson", from: 10, to: 11 }];
    expect(isRoomFree(lessons, 9, 10)).toEqual({ free: true, until: 10 });
    expect(isRoomFree(lessons, 10, 11)).toEqual({ free: false, until: null });
    expect(isRoomFree(lessons, 11, 12)).toEqual({ free: true, until: 20 });
    expect(
      isRoomFree(
        [
          { name: "late", from: 14, to: 15 },
          { name: "early", from: 12, to: 13 },
        ],
        9,
        10,
      ),
    ).toEqual({ free: true, until: 12 });
  });

  it("finds when a busy room frees up, following back-to-back lessons", () => {
    const lessons = [
      { name: "second", from: 10, to: 11 },
      { name: "first", from: 8, to: 10 },
      { name: "later", from: 12, to: 13 },
    ];
    expect(freeingTime(lessons, 9)).toBe(11);
    expect(freeingTime(lessons, 10)).toBe(11);
    expect(freeingTime(lessons, 11)).toBeNull();
    expect(freeingTime(lessons, 7)).toBeNull();
    expect(freeingTime([], 9)).toBeNull();
    expect(freeingGap(lessons, 9, 2)).toEqual({ from: 11, until: 12 });
    // A 30-minute gap before the next lesson is too short to suggest.
    expect(
      freeingGap(
        [
          { name: "first", from: 8, to: 10 },
          { name: "next", from: 10.5, to: 12 },
        ],
        9,
        2,
      ),
    ).toBeNull();
    // Frees at 19:15: less than an hour left before the 20:00 closing.
    expect(freeingGap([{ name: "late", from: 18, to: 19.25 }], 18.25, 2)).toBeNull();
  });

  it("lists rooms freeing up within the lookahead with their free range", async () => {
    // Grid starts at 07:45: one empty cell reaches 08:00, a slot cell is
    // colspan / 4 hours long.
    const row = (id: number, name: string, cells: string) =>
      `<tr class="normalRow"><td class="dove"><a href="DettaglioAula.do?idaula=${id}">${name}</a></td>${cells}</tr>`;
    const slot = (quarters: number) =>
      `<td class="slot" colspan="${quarters}"><a>Lezione</a></td>`;
    const empty = (quarters: number) => "<td></td>".repeat(quarters);
    const html = `<div id="tableContainer"><table>
      <tr><td class="innerEdificio">Milano - Via - Edificio 1</td></tr>
      ${row(1, "frees-1h30", `<td></td>${slot(10)}${empty(8)}${slot(4)}`)}
      ${row(2, "frees-in-3h", `<td></td>${slot(18)}`)}
      ${row(3, "frees-in-30m", `<td></td>${slot(6)}`)}
      ${row(4, "chained", `<td></td>${slot(8)}${slot(2)}`)}
      ${row(5, "short-gap", `<td></td>${slot(6)}${empty(2)}${slot(4)}`)}
      ${row(6, "already-free", "")}
    </table></div>`;
    const search = (lookaheadHours?: number) =>
      searchRooms(
        {
          location: "MIA",
          day: 27,
          month: 8,
          year: 2026,
          startTime: 9,
          endTime: 10,
          ...(lookaheadHours === undefined ? {} : { lookaheadHours }),
          roomsWithPower: [],
        },
        {
          fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(html)),
          htmlRewriter: RuntimeHTMLRewriter,
        },
      );
    const freeing = (result: Awaited<ReturnType<typeof search>>) =>
      result.freeingUp["Edificio 1"]?.map((room) => [room.name, room.from, room.until]);

    const byDefault = await search();
    expect(byDefault.free["Edificio 1"]?.map((room) => room.name)).toEqual([
      "already-free",
    ]);
    // Default window: up to two hours after the 09:00 start; short-gap (free
    // 09:30–10:00) is dropped because it stays free for less than an hour.
    expect(freeing(byDefault)).toEqual([
      ["frees-1h30", 10.5, 12.5],
      ["frees-in-30m", 9.5, 20],
      ["chained", 10.5, 20],
    ]);
    expect(freeing(await search(1))).toEqual([["frees-in-30m", 9.5, 20]]);
    // Frees at 12:30, three and a half hours after the start.
    expect(freeing(await search(4))).toEqual([
      ["frees-1h30", 10.5, 12.5],
      ["frees-in-3h", 12.5, 20],
      ["frees-in-30m", 9.5, 20],
      ["chained", 10.5, 20],
    ]);
    expect(freeing(await search(3))).toEqual(freeing(byDefault));
  });

  it("sees rooms busy until a :15 lesson end as free in the :15 picker slots", async () => {
    // Lesson 11:15–13:15: 14 empty quarters from the 07:45 grid start, then 8.
    const html = `<div id="tableContainer"><table>
      <tr><td class="innerEdificio">Milano - Via - Edificio 1</td></tr>
      <tr class="normalRow"><td class="dove"><a href="DettaglioAula.do?idaula=1">1.1</a></td>${"<td></td>".repeat(14)}<td class="slot" colspan="8"><a>Lezione</a></td></tr>
    </table></div>`;
    const search = (startTime: number, endTime: number) =>
      searchRooms(
        { location: "MIA", day: 28, month: 10, year: 2026, startTime, endTime, roomsWithPower: [] },
        { fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(html)), htmlRewriter: RuntimeHTMLRewriter },
      );
    // Full hours (the old picker) miss the room by a quarter of an hour…
    const fullHours = await search(13, 14);
    expect(fullHours.free["Edificio 1"]).toBeUndefined();
    expect(fullHours.freeingUp["Edificio 1"]?.map((room) => room.name)).toEqual(["1.1"]);
    // …the lesson slots of the picker find it free.
    const lessonSlots = await search(13.25, 14.25);
    expect(lessonSlots.free["Edificio 1"]?.map((room) => room.name)).toEqual(["1.1"]);
  });

  it("checks HTTP status and builds the expected upstream query", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("upstream unavailable", { status: 503, statusText: "Unavailable" }),
    );

    await expect(
      searchFreeRooms(
        {
          location: "MIA",
          day: 27,
          month: 8,
          year: 2026,
          startTime: 9,
          endTime: 10,
          roomsWithPower: [],
        },
        { fetch: fetchMock, htmlRewriter: RuntimeHTMLRewriter },
      ),
    ).rejects.toThrow("503 Unavailable");

    const firstRequest = fetchMock.mock.calls[0]?.[0];
    expect(firstRequest).toBeDefined();
    const requested = new URL(String(firstRequest));
    expect(requested.searchParams.get("csic")).toBe("MIA");
    expect(requested.searchParams.get("giorno_day")).toBe("27");
    const requestInit = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(requestInit?.headers);
    expect(headers.get("user-agent")).toContain("AuleLiberePoliMi/3.0");
    expect(headers.get("accept-language")).toContain("it-IT");
  });

  it("aborts a stalled upstream request", async () => {
    const stalledFetch = vi.fn<typeof fetch>((_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
    );
    await expect(
      searchFreeRooms(
        {
          location: "MIA",
          day: 27,
          month: 8,
          year: 2026,
          startTime: 9,
          endTime: 10,
          roomsWithPower: [],
        },
        { fetch: stalledFetch, timeoutMs: 1, htmlRewriter: RuntimeHTMLRewriter },
      ),
    ).rejects.toThrow("timed out");
  });
});

describe("room classification", () => {
  it("keeps lecture rooms, separates drawing rooms and drops the rest", () => {
    expect(classifyRoom("AULA DIDATTICA", "PLATEA FRONTALE")).toBe("standard");
    expect(classifyRoom("AULA DIDATTICA", "INFORMATIZZATA")).toBe("standard");
    expect(classifyRoom("AULA DIDATTICA", "DISEGNO")).toBe("drawing");
    expect(classifyRoom("AULA DIDATTICA", "ALTRO")).toBe("excluded");
    expect(classifyRoom("AULA CONVEGNI", "PLATEA FRONTALE")).toBe("excluded");
    expect(classifyRoom("LABORATORIO DIDATTICO", "ALTRO")).toBe("excluded");
    expect(classifyRoom("AULA MAGNA", "PLATEA FRONTALE")).toBe("excluded");
  });

  it("puts Leonardo and Bonardi in the central zone of Città Studi", () => {
    expect(zoneOf("MIA", "Milano Città Studi - Piazza Leonardo da Vinci 32")).toBe("main");
    expect(zoneOf("MIA", "Milano Città Studi - Via Bonardi")).toBe("main");
    expect(zoneOf("MIA", "Milano Città Studi - Via Golgi 40")).toBe("other");
    // Campuses without a configured zone keep every room.
    expect(zoneOf("MIB", "Milano Bovisa - Via Durando")).toBe("main");
    expect(campusHasZones("MIA")).toBe(true);
    // A single site is already a narrow area.
    expect(campusHasZones("MIA04")).toBe(false);
  });

  it("knows which campuses have drawing rooms", () => {
    expect(campusHasDrawingRooms("MIA")).toBe(true);
    expect(campusHasDrawingRooms("PCL")).toBe(false);
    // Single sites: Leonardo 32 has drawing rooms, Golgi 40 has none.
    expect(campusHasDrawingRooms("MIA01")).toBe(true);
    expect(campusHasDrawingRooms("MIA04")).toBe(false);
    expect(campusHasDrawingRooms("MIB02")).toBe(true);
  });
});

describe("Telegram room formatting", () => {
  it("escapes external values and handles no results", () => {
    expect(formatRoomMessages({})).toEqual([]);

    const [message] = formatRoomMessages(
      {
        "Edificio <2>": [
          {
            name: "A&<1>",
            link: 'https://example.test/?x=1&y="2"',
            from: 9,
            until: 12,
            powerPlugs: true,
            kind: "standard",
            zone: "main",
          },
        ],
      },
      {},
    );
    expect(message).toContain("Edificio &lt;2&gt;");
    expect(message).toContain("A&amp;&lt;1&gt;");
    expect(message).toContain("&quot;2&quot;");
    expect(message).toContain("• <a href=");
    expect(message).toContain("</a> → 12:00 🔌\n");
  });

  it("splits large results into complete Telegram-sized messages", () => {
    const messages = formatRoomMessages(
      {
        Edificio: Array.from({ length: 200 }, (_, index) => ({
          name: `Aula-${String(index).padStart(4, "0")}-${"x".repeat(40)}`,
          link: "https://example.test/room",
          from: 9,
          until: 20,
          powerPlugs: false,
          kind: "standard",
          zone: "main",
        })),
      },
      {},
    );
    expect(messages.length).toBeGreaterThan(1);
    expect(messages.every((message) => message.length <= 4096)).toBe(true);
    expect(messages.every((message) => message.includes("<b>Edificio</b>"))).toBe(true);
  });
});

describe("searchAndFormat", () => {
  const row = (id: number, name: string, cells = "") =>
    `<tr class="normalRow"><td class="dove"><a href="DettaglioAula.do?idaula=${id}">${name}</a></td>${cells}</tr>`;
  const slot = (quarters: number) =>
    `<td class="slot" colspan="${quarters}"><a>Lezione</a></td>`;
  const baseRequest: SearchRequest = {
    campus: "MIA",
    date: "28/10/2026",
    startHour: 9,
    endHour: 11,
    lang: "it",
    lookahead: 2,
    powerOnly: false,
    drawing: false,
    allZones: false,
  };

  it("filters by room kind, power plugs and zone, and packs sections together", async () => {
    // Grid starts at 07:45: 1 empty cell + 10 quarters = busy 08:00–10:30,
    // then 8 empty quarters + 4 busy = free 10:30–12:30.
    const busyUntil1030 = `<td></td>${slot(10)}${"<td></td>".repeat(8)}${slot(4)}`;
    const html = `<div id="tableContainer"><table>
      <tr><td class="innerEdificio">Milano - Via - Edificio 1</td></tr>
      ${row(1, "C.1")}
      ${row(2, "C.2")}
      ${row(3, "D.1")}
      ${row(4, "O.1")}
      ${row(5, "O.2")}
      ${row(6, "F.1", busyUntil1030)}
    </table></div>`;
    const classifications: Record<number, RoomInfo> = {
      1: { kind: "standard", zone: "main" },
      2: { kind: "standard", zone: "main" },
      3: { kind: "drawing", zone: "main" },
      4: { kind: "standard", zone: "other" },
      5: { kind: "standard", zone: "other" },
      6: { kind: "standard", zone: "main" },
    };
    const run = (overrides: Partial<SearchRequest> = {}) =>
      searchAndFormat(
        { ...baseRequest, ...overrides },
        {
          fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(html)),
          htmlRewriter: RuntimeHTMLRewriter,
          roomsWithPower: [1, 3, 4],
          roomInfo: (id) => (id !== undefined && classifications[id]) || { kind: "standard", zone: "main" },
        },
      );

    // Central zone by default: C.1 (🔌) and C.2 free, F.1 freeing up, 2 in other zones.
    const defaultResult = await run();
    expect(defaultResult).toHaveLength(1);
    expect(defaultResult[0]).toContain("C.1</a> → 20:00 🔌");
    expect(defaultResult[0]).toContain("C.2</a> → 20:00\n");
    expect(defaultResult[0]).not.toContain("D.1");
    expect(defaultResult[0]).not.toContain("O.1");
    expect(defaultResult[0]).toContain("<b>⏳ Si liberano entro 2 ore</b>");
    expect(defaultResult[0]).toContain("F.1</a> dalle 10:30 alle 12:30");
    expect(defaultResult[0]).toContain("<i>🗺️ Ci sono altre 2 aule libere fuori dalla zona centrale.</i>");

    // Power filter: keeps C.1 in central zone and counts only O.1 outside.
    const powerResult = await run({ powerOnly: true });
    expect(powerResult[0]).toContain("C.1</a> → 20:00 🔌");
    expect(powerResult[0]).not.toContain("C.2");
    expect(powerResult[0]).not.toContain("F.1");
    expect(powerResult[0]).toContain("<i>🗺️ C'è un'altra aula libera fuori dalla zona centrale.</i>");

    // Drawing filter: only D.1.
    const drawingResult = await run({ drawing: true });
    expect(drawingResult[0]).toContain("D.1</a> → 20:00 🔌");
    expect(drawingResult[0]).not.toContain("C.1");
    expect(drawingResult[0]).not.toContain("fuori dalla zona centrale");

    // All zones: lists O.1 and O.2 and drops the other-zones hint.
    const allZonesResult = await run({ allZones: true });
    expect(allZonesResult[0]).toContain("O.1</a> → 20:00 🔌");
    expect(allZonesResult[0]).toContain("O.2</a> → 20:00");
    expect(allZonesResult[0]).not.toContain("fuori dalla zona centrale");
  });

  it("keeps the no-free-rooms notice when only freeing-up or outer-zone rooms exist", async () => {
    const busyUntil10 = `<td></td>${slot(8)}`;
    const html = `<div id="tableContainer"><table>
      <tr><td class="innerEdificio">Milano - Via - Edificio 1</td></tr>
      ${row(1, "F.1", busyUntil10)}
      ${row(2, "O.1")}
    </table></div>`;
    const run = (roomInfo: (id: number | undefined) => RoomInfo) =>
      searchAndFormat(baseRequest, {
        fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(html)),
        htmlRewriter: RuntimeHTMLRewriter,
        roomsWithPower: [],
        roomInfo,
      });

    const [withFreeingAndHint] = await run((id) => ({
      kind: "standard",
      zone: id === 2 ? "other" : "main",
    }));
    expect(withFreeingAndHint).toMatch(/^😕 Nessuna aula libera in questa fascia oraria\.\n\n<b>⏳ Si liberano/);
    expect(withFreeingAndHint).toContain("F.1</a> dalle 10:00 alle 20:00");
    expect(withFreeingAndHint).toContain("<i>🗺️ C'è un'altra aula libera fuori dalla zona centrale.</i>");

    const empty = await run(() => ({ kind: "excluded", zone: "main" }));
    expect(empty).toEqual([]);
  });

  it("keeps packed messages within the budget reserved for the result header", async () => {
    const budget = TELEGRAM_MAX_MESSAGE_LENGTH - RESULT_HEADER_RESERVE;
    const rows = Array.from({ length: 120 }, (_, index) =>
      row(index + 1, `Aula-${String(index).padStart(3, "0")}-${"x".repeat(25)}`),
    ).join("\n");
    const html = `<div id="tableContainer"><table>
      <tr><td class="innerEdificio">Milano - Via - Edificio 1</td></tr>
      ${rows}
    </table></div>`;
    const messages = await searchAndFormat(baseRequest, {
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(html)),
      htmlRewriter: RuntimeHTMLRewriter,
      roomsWithPower: [],
      roomInfo: () => ({ kind: "standard", zone: "main" }),
    });
    expect(messages.length).toBeGreaterThan(1);
    expect(messages.every((message) => message.length <= budget)).toBe(true);
  });
});
