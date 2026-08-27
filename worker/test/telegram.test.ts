import { describe, expect, it, vi } from "vitest";
import { CAMPUSES, decodeCallback, encodeCallback } from "../src/protocol";
import {
  handleTelegramUpdate,
  type TelegramDependencies,
  type TelegramUpdate,
} from "../src/telegram";

const env = {
  BOT_TOKEN: "test-token",
  WEBAPP_URL: "https://settings.example.test",
};

function telegramFetch() {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      method: String(input).split("/").at(-1) ?? "",
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ ok: true, result: {} }), {
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { mock, calls };
}

function messageUpdate(text: string, language_code = "en"): TelegramUpdate {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      chat: { id: 42 },
      from: { id: 7, first_name: "Ada <3", language_code },
      text,
    },
  };
}

function callbackUpdate(data: string): TelegramUpdate {
  return {
    update_id: 2,
    callback_query: {
      id: "callback-id",
      from: { id: 7, language_code: "en" },
      data,
      message: { message_id: 4, chat: { id: 42 } },
    },
  };
}

describe("stateless callback protocol", () => {
  it("round-trips a complete search and stays below Telegram's 64-byte limit", () => {
    const value = encodeCallback({
      action: "end",
      lang: "it",
      campus: "MIA11",
      date: "28/08/2026",
      startHour: 8,
      endHour: 20,
    });
    expect(new TextEncoder().encode(value).length).toBeLessThanOrEqual(64);
    expect(decodeCallback(value)).toEqual({
      action: "end",
      lang: "it",
      campus: "MIA11",
      date: "28/08/2026",
      startHour: 8,
      endHour: 20,
    });
  });

  it("rejects forged campuses, invalid dates and time ranges", () => {
    expect(decodeCallback("e:en:NOPE:20260828:8:10")).toBeNull();
    expect(decodeCallback("e:en:MIA:20260231:8:10")).toBeNull();
    expect(decodeCallback("e:en:MIA:20260828:12:10")).toBeNull();
  });
});

describe("Telegram handler", () => {
  it("sends the localized main keyboard on /start", async () => {
    const api = telegramFetch();
    await handleTelegramUpdate(messageUpdate("/start", "it-IT"), env, {
      fetch: api.mock,
      search: vi.fn(async () => []),
    });

    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.method).toBe("sendMessage");
    const body = api.calls[0]?.body;
    expect(body?.text).toContain("Ciao");
    expect(body?.text).toContain("Ada &lt;3");
    expect(JSON.stringify(body?.reply_markup)).toContain("https://settings.example.test");
  });

  it("validates Mini App data and returns a self-contained quick-search button", async () => {
    const api = telegramFetch();
    const update = messageUpdate("");
    if (!update.message) throw new Error("fixture error");
    delete update.message.text;
    update.message.web_app_data = {
      data: JSON.stringify({
        lang: "it",
        campus: "Milano Città Studi - Piazza Leonardo da Vinci 26",
        duration: 3,
      }),
    };
    await handleTelegramUpdate(update, env, {
      fetch: api.mock,
      search: vi.fn(async () => []),
    });

    expect(api.calls).toHaveLength(2);
    const markup = api.calls[0]?.body.reply_markup as {
      inline_keyboard: Array<Array<{ callback_data: string }>>;
    };
    const callback = markup.inline_keyboard[0]?.[0]?.callback_data;
    expect(callback && decodeCallback(callback)).toEqual({
      action: "quick",
      lang: "it",
      campus: "MIA11",
      duration: 3,
    });
  });

  it("rejects malformed Mini App preferences", async () => {
    const api = telegramFetch();
    const update = messageUpdate("");
    if (!update.message) throw new Error("fixture error");
    delete update.message.text;
    update.message.web_app_data = {
      data: JSON.stringify({ lang: "en", campus: "not a campus", duration: 3 }),
    };
    await handleTelegramUpdate(update, env, {
      fetch: api.mock,
      search: vi.fn(async () => []),
    });
    expect(api.calls[0]?.body.text).toContain("invalid");
  });

  it("answers callbacks and performs a full search without server state", async () => {
    const api = telegramFetch();
    const search = vi.fn(async () => ["<b>Building 1</b>\nRoom 1"]);
    const data = encodeCallback({
      action: "end",
      lang: "en",
      campus: CAMPUSES["Milano Città Studi"],
      date: "28/08/2026",
      startHour: 9,
      endHour: 11,
    });
    await handleTelegramUpdate(callbackUpdate(data), env, { fetch: api.mock, search });

    expect(api.calls[0]).toMatchObject({
      method: "answerCallbackQuery",
      body: { callback_query_id: "callback-id" },
    });
    expect(search).toHaveBeenCalledWith({
      campus: "MIA",
      date: "28/08/2026",
      startHour: 9,
      endHour: 11,
      lang: "en",
    });
    expect(api.calls.some((call) => call.method === "sendChatAction")).toBe(true);
    expect(api.calls.at(-1)?.body).toMatchObject({
      parse_mode: "HTML",
      text: "<b>Building 1</b>\nRoom 1",
    });
  });

  it("derives a Rome-time quick slot from callback preferences", async () => {
    const api = telegramFetch();
    const search = vi.fn(async () => []);
    await handleTelegramUpdate(
      callbackUpdate(
        encodeCallback({ action: "quick", lang: "it", campus: "MIB", duration: 4 }),
      ),
      env,
      {
        fetch: api.mock,
        search,
        now: () => new Date("2026-08-28T07:30:00.000Z"), // 09:30 in Rome
      },
    );
    expect(search).toHaveBeenCalledWith({
      campus: "MIB",
      date: "28/08/2026",
      startHour: 9,
      endHour: 13,
      lang: "it",
    });
    expect(api.calls.at(-1)?.body.text).toContain("Non sono state trovate");
  });
});
