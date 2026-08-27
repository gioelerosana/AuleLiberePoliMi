import { describe, expect, it, vi } from "vitest";
// Vite loads this fixture as text when Vitest runs; no Node filesystem API is
// pulled into the Worker implementation.
// @ts-ignore Vite raw imports are resolved by the test runner.
import fixtureHtml from "./fixtures/occupancies.html?raw";
import { formatRoomMessages } from "../src/format";
import {
  isRoomFree,
  parseOccupancyResponse,
  searchFreeRooms,
  type HtmlRewriterConstructor,
  type HtmlRewriterLike,
} from "../src/polimi";

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

describe("Telegram room formatting", () => {
  it("escapes external values and handles no results", () => {
    expect(
      formatRoomMessages({}, { untilLabel: "fino alle", noResultsText: "Nessuna <aula>" }),
    ).toEqual(["Nessuna &lt;aula&gt;"]);

    const [message] = formatRoomMessages(
      {
        "Edificio <2>": [
          {
            name: "A&<1>",
            link: 'https://example.test/?x=1&y="2"',
            until: 12,
            powerPlugs: true,
          },
        ],
      },
      { untilLabel: "fino alle" },
    );
    expect(message).toContain("Edificio &lt;2&gt;");
    expect(message).toContain("A&amp;&lt;1&gt;");
    expect(message).toContain("&quot;2&quot;");
  });

  it("splits large results into complete Telegram-sized messages", () => {
    const messages = formatRoomMessages(
      {
        Edificio: Array.from({ length: 200 }, (_, index) => ({
          name: `Aula-${String(index).padStart(4, "0")}-${"x".repeat(40)}`,
          link: "https://example.test/room",
          until: 20,
          powerPlugs: false,
        })),
      },
      { untilLabel: "free until" },
    );
    expect(messages.length).toBeGreaterThan(1);
    expect(messages.every((message) => message.length <= 4096)).toBe(true);
    expect(messages.every((message) => message.includes("<b>Edificio</b>"))).toBe(true);
  });
});
