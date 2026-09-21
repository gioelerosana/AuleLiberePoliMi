import { describe, expect, it, vi } from "vitest";
import {
  CAMPUSES,
  campusCodeFromName,
  decodeCallback,
  encodeCallback,
} from "../src/protocol";
import {
  handleTelegramUpdate,
  type TelegramDependencies,
  type TelegramUpdate,
} from "../src/telegram";

const env = {
  BOT_TOKEN: "test-token",
  WEBAPP_URL: "https://settings.example.test",
};

function telegramFetch(results: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = String(input).split("/").at(-1) ?? "";
    calls.push({
      method,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ ok: true, result: results[method] ?? {} }), {
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

  it("round-trips a quick-search campus choice", () => {
    const value = encodeCallback({ action: "quickCampus", lang: "it", campus: "MIA11" });
    expect(decodeCallback(value)).toEqual({
      action: "quickCampus",
      lang: "it",
      campus: "MIA11",
    });
  });

  it("rejects forged campuses, invalid dates and time ranges", () => {
    expect(decodeCallback("e:en:NOPE:20260828:8:10")).toBeNull();
    expect(decodeCallback("e:en:MIA:20260231:8:10")).toBeNull();
    expect(decodeCallback("e:en:MIA:20260828:12:10")).toBeNull();
    expect(decodeCallback("qc:en:NOPE")).toBeNull();
  });

  it("offers only main campuses while resolving legacy site preferences", () => {
    expect(Object.keys(CAMPUSES)).toEqual([
      "Milano Città Studi",
      "Milano Bovisa",
      "Como",
      "Cremona",
      "Genova",
      "Piacenza",
      "Lecco",
      "Mantova",
      "Milano Tortona",
      "Sesto Ulteriano",
    ]);
    expect(campusCodeFromName("Milano Città Studi")).toBe("MIA");
    expect(campusCodeFromName("Milano Città Studi - Via Golgi 40")).toBe("MIA04");
    expect(campusCodeFromName("not a campus")).toBeNull();
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

  it("encodes Mini App preferences in the persistent keyboard without pinning", async () => {
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

    // The reply keyboard label itself carries the preferences, so the Worker
    // needs no server state when the user taps 🕒Ora again.
    const keyboard = api.calls[0]?.body.reply_markup as {
      keyboard: Array<Array<{ text: string }>>;
    };
    expect(keyboard.keyboard[1]?.[0]?.text).toBe(
      "🕒Ora · Milano Città Studi - Piazza Leonardo da Vinci 26 3h 🇮🇹",
    );
    expect(api.calls.some((call) => call.method === "pinChatMessage")).toBe(false);

    const prefsMessage = api.calls.find(
      (call) => call.method === "sendMessage" && String(call.body.text).includes("Milano Città Studi"),
    );
    expect(String(prefsMessage?.body.text)).toContain("3h");
    const markup = prefsMessage?.body.reply_markup as {
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

  it("round-trips the keyboard label into a quick search", async () => {
    const api = telegramFetch();
    const search = vi.fn(async () => []);
    await handleTelegramUpdate(
      messageUpdate("🕒Ora · Milano Città Studi 4h 🇮🇹", "it"),
      env,
      {
        fetch: api.mock,
        search,
        now: () => new Date("2026-08-28T07:30:00.000Z"), // 09:30 in Rome
      },
    );

    expect(search).toHaveBeenCalledWith({
      campus: "MIA",
      date: "28/08/2026",
      startHour: 9,
      endHour: 13,
      lang: "it",
    });
    expect(api.calls.some((call) => call.method === "getChat")).toBe(false);
  });

  it("keeps legacy site codes searchable from the keyboard label", async () => {
    const api = telegramFetch();
    const search = vi.fn(async () => []);
    await handleTelegramUpdate(
      messageUpdate("🕒Ora · Milano Città Studi - Via Golgi 40 2h 🇬🇧", "en"),
      env,
      {
        fetch: api.mock,
        search,
        now: () => new Date("2026-08-28T07:30:00.000Z"), // 09:30 in Rome
      },
    );

    expect(search).toHaveBeenCalledWith({
      campus: "MIA04",
      date: "28/08/2026",
      startHour: 9,
      endHour: 11,
      lang: "en",
    });
  });

  it("falls back to the inline flow for a malformed 🕒Ora label", async () => {
    const api = telegramFetch();
    const search = vi.fn(async () => []);
    for (const text of ["🕒Ora · NOPE 3h 🇮🇹", "🕒Ora · Milano Bovisa 12h 🇮🇹"]) {
      api.calls.length = 0;
      await handleTelegramUpdate(messageUpdate(text, "it"), env, {
        fetch: api.mock,
        search,
      });
      expect(api.calls.map((call) => call.method)).toEqual(["sendMessage"]);
      const markup = api.calls[0]?.body.reply_markup as {
        inline_keyboard: Array<Array<{ callback_data: string }>>;
      };
      const campusButton = markup.inline_keyboard[1]?.[0];
      expect(campusButton && decodeCallback(campusButton.callback_data)).toEqual({
        action: "quickCampus",
        lang: "it",
        campus: CAMPUSES["Milano Città Studi"],
      });
    }
    expect(search).not.toHaveBeenCalled();
  });

  it("falls back to the inline quick flow for the plain 🕒Ora text", async () => {
    const api = telegramFetch();
    await handleTelegramUpdate(messageUpdate("🕒Ora", "it"), env, {
      fetch: api.mock,
      search: vi.fn(async () => []),
    });

    expect(api.calls.map((call) => call.method)).toEqual(["sendMessage"]);
    const message = api.calls.find((call) => call.method === "sendMessage");
    const markup = message?.body.reply_markup as {
      inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
    };
    const campusButton = markup.inline_keyboard[1]?.[0];
    expect(campusButton && decodeCallback(campusButton.callback_data)).toEqual({
      action: "quickCampus",
      lang: "it",
      campus: CAMPUSES["Milano Città Studi"],
    });
  });

  it("asks for the duration after a quick campus choice", async () => {
    const api = telegramFetch();
    const data = encodeCallback({
      action: "quickCampus",
      lang: "en",
      campus: CAMPUSES["Milano Città Studi"],
    });
    await handleTelegramUpdate(callbackUpdate(data), env, {
      fetch: api.mock,
      search: vi.fn(async () => []),
    });

    const markup = api.calls[1]?.body.reply_markup as {
      inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
    };
    const durationButton = markup.inline_keyboard[1]?.[3];
    expect(durationButton?.text).toBe("4h");
    expect(durationButton && decodeCallback(durationButton.callback_data)).toEqual({
      action: "quick",
      lang: "en",
      campus: "MIA",
      duration: 4,
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
