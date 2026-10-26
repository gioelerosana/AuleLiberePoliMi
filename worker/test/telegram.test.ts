import { describe, expect, it, vi } from "vitest";
import {
  CAMPUSES,
  campusCodeFromName,
  campusCodeFromShortName,
  decodeCallback,
  encodeCallback,
  shortCampusName,
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

const CHAT_ID = 42;
const USER_ID = 7;
const CARD_MESSAGE_ID = 4;
const SENT_MESSAGE_ID = 99;
const CALLBACK_DATA_LIMIT = 64;
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;

type Call = { method: string; body: Record<string, unknown> };
type Keyboard = Array<Array<{ text: string; callback_data: string }>>;

function telegramFetch(
  results: Record<string, unknown> = {},
  failures: Record<string, string> = {},
) {
  const calls: Call[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = String(input).split("/").at(-1) ?? "";
    calls.push({
      method,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const failure = failures[method];
    const payload = failure
      ? { ok: false, description: failure }
      : { ok: true, result: results[method] ?? {} };
    return new Response(JSON.stringify(payload), {
      status: failure ? HTTP_BAD_REQUEST : HTTP_OK,
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
      chat: { id: CHAT_ID },
      from: { id: USER_ID, first_name: "Ada <3", language_code },
      text,
    },
  };
}

function callbackUpdate(data: string): TelegramUpdate {
  return {
    update_id: 2,
    callback_query: {
      id: "callback-id",
      from: { id: USER_ID, language_code: "en" },
      data,
      message: { message_id: CARD_MESSAGE_ID, chat: { id: CHAT_ID } },
    },
  };
}

function deps(
  api: ReturnType<typeof telegramFetch>,
  overrides: Partial<TelegramDependencies> = {},
): TelegramDependencies {
  return { fetch: api.mock, search: vi.fn(async () => []), ...overrides };
}

function keyboardOf(call: Call | undefined): Keyboard {
  return (call?.body.reply_markup as { inline_keyboard: Keyboard }).inline_keyboard;
}

function labels(keyboard: Keyboard): string[][] {
  return keyboard.map((row) => row.map((button) => button.text));
}

function methods(calls: Call[]): string[] {
  return calls.map((call) => call.method);
}

// 09:20 in Rome on Saturday 24/10/2026: tomorrow is a Sunday.
const SATURDAY_MORNING = new Date("2026-10-24T07:20:00.000Z");

describe("stateless callback protocol", () => {
  it("round-trips a complete search and stays below Telegram's 64-byte limit", () => {
    const state = {
      action: "end",
      lang: "it",
      campus: "MIA11",
      date: "28/08/2026",
      startHour: 19.75,
      endHour: 20,
      powerOnly: true,
      fresh: true,
    } as const;
    const value = encodeCallback(state);
    expect(new TextEncoder().encode(value).length).toBeLessThanOrEqual(CALLBACK_DATA_LIMIT);
    expect(decodeCallback(value)).toEqual(state);
  });

  it("keeps decoding callbacks of older messages without flags", () => {
    expect(decodeCallback("e:it:MIA:20260828:8:20")).toEqual({
      action: "end",
      lang: "it",
      campus: "MIA",
      date: "28/08/2026",
      startHour: 8,
      endHour: 20,
    });
    // Buttons sent before the lookahead existed carry no lookahead part.
    expect(decodeCallback("q:en:MIB:3")).toEqual({
      action: "quick",
      lang: "en",
      campus: "MIB",
      duration: 3,
      lookahead: 2,
    });
  });

  it("round-trips flagged quick searches and campus navigation", () => {
    const quick = {
      action: "quick",
      lang: "en",
      campus: "MIB",
      duration: 2,
      lookahead: 4,
      powerOnly: true,
    } as const;
    expect(decodeCallback(encodeCallback(quick))).toEqual(quick);
    const menu = { action: "campusMenu", lang: "en", quick: true, more: true } as const;
    expect(decodeCallback(encodeCallback(menu))).toEqual(menu);
    expect(decodeCallback("m:en:x:1")).toBeNull();
  });

  it("rejects forged campuses, dates, hours and flags", () => {
    expect(decodeCallback("e:en:NOPE:20260828:8:10")).toBeNull();
    expect(decodeCallback("e:en:MIA:20260231:8:10")).toBeNull();
    expect(decodeCallback("e:en:MIA:20260828:12:10")).toBeNull();
    expect(decodeCallback("e:en:MIA:20260828:9.3:10")).toBeNull();
    expect(decodeCallback("e:en:MIA:20260828:9:10.5")).toBeNull();
    expect(decodeCallback("e:en:MIA:20260828:9:10:x")).toBeNull();
    expect(decodeCallback("e:en:MIA:20260828:9:10:")).toBeNull();
    expect(decodeCallback("qc:en:NOPE")).toBeNull();
    expect(decodeCallback("q:en:MIA11:3:0")).toBeNull();
    expect(decodeCallback("q:en:MIA11:3:9")).toBeNull();
    expect(decodeCallback("q:en:MIA11:3:4:x")).toBeNull();
  });

  it("decodes the lookahead and the flags of quick buttons independently", () => {
    expect(decodeCallback("q:en:MIA11:3:1")).toMatchObject({ lookahead: 1 });
    expect(decodeCallback("q:en:MIA11:3:p")).toMatchObject({ lookahead: 2, powerOnly: true });
    expect(decodeCallback("q:en:MIA11:3:5:pn")).toMatchObject({ lookahead: 5, powerOnly: true, fresh: true });
    expect(decodeCallback("q:en:MIA11:3:5:pdn")).toMatchObject({ powerOnly: true, drawing: true, fresh: true });
    expect(decodeCallback("q:en:MIA11:3:5:dp")).toBeNull();
    expect(decodeCallback("q:en:MIA11:3:5:zn")).toMatchObject({ allZones: true, fresh: true });
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

  it("shortens Milan campus names reversibly", () => {
    expect(shortCampusName("Milano Bovisa")).toBe("Bovisa");
    expect(shortCampusName("Como")).toBe("Como");
    expect(campusCodeFromShortName("Bovisa")).toBe("MIB");
    expect(campusCodeFromShortName("Città Studi - Via Golgi 40")).toBe("MIA04");
    expect(campusCodeFromShortName("Milano Bovisa")).toBe("MIB");
    expect(campusCodeFromShortName("Como")).toBe("COE");
  });
});

describe("persistent keyboard", () => {
  it("sends a compact localized keyboard on /start", async () => {
    const api = telegramFetch();
    await handleTelegramUpdate(messageUpdate("/start", "it-IT"), env, deps(api));

    expect(methods(api.calls)).toEqual(["sendMessage"]);
    const body = api.calls[0]?.body;
    expect(body?.text).toContain("Ciao");
    expect(body?.text).toContain("Ada &lt;3");
    expect(body?.reply_markup).toEqual({
      keyboard: [
        [{ text: "🕒 Ora" }],
        [{ text: "🔍 Cerca" }, { text: "⚙️ Preferenze", web_app: { url: "https://settings.example.test" } }],
      ],
      resize_keyboard: true,
      is_persistent: true,
      input_field_placeholder: "Scegli un'azione",
    });
  });

  it("saves Mini App preferences in the 🕒 Ora label with a single message", async () => {
    const api = telegramFetch();
    const update = messageUpdate("");
    if (!update.message) throw new Error("fixture error");
    delete update.message.text;
    update.message.web_app_data = {
      data: JSON.stringify({ lang: "it", campus: "Milano Bovisa", duration: 3, lookahead: 5 }),
    };
    await handleTelegramUpdate(update, env, deps(api));

    expect(methods(api.calls)).toEqual(["sendMessage"]);
    const body = api.calls[0]?.body;
    expect(body?.text).toBe("✅ Preferenze salvate\n📍 Bovisa · 3h · ⏳ 5h");
    const keyboard = (body?.reply_markup as { keyboard: Array<Array<{ text: string }>> }).keyboard;
    expect(keyboard[0]?.[0]?.text).toBe("🕒 Ora · Bovisa 3h ⏳5h");
  });

  it("omits the default lookahead from the label, also for older Mini App builds", async () => {
    const api = telegramFetch();
    const update = messageUpdate("");
    if (!update.message) throw new Error("fixture error");
    delete update.message.text;
    update.message.web_app_data = {
      data: JSON.stringify({ lang: "en", campus: "Milano Città Studi", duration: 2 }),
    };
    await handleTelegramUpdate(update, env, deps(api));
    const keyboard = (api.calls[0]?.body.reply_markup as { keyboard: Array<Array<{ text: string }>> }).keyboard;
    expect(keyboard[0]?.[0]?.text).toBe("🕒 Now · Città Studi 2h");
  });

  it("rejects malformed Mini App preferences", async () => {
    const api = telegramFetch();
    const update = messageUpdate("");
    if (!update.message) throw new Error("fixture error");
    delete update.message.text;
    update.message.web_app_data = {
      data: JSON.stringify({ lang: "en", campus: "not a campus", duration: 3 }),
    };
    await handleTelegramUpdate(update, env, deps(api));
    expect(api.calls[0]?.body.text).toContain("Invalid");
  });

  it.each([
    ["🕒 Ora · Città Studi 4h", "MIA", 13.5, "it", 2],
    ["🕒 Now · Bovisa 2h ⏳6h", "MIB", 11.5, "en", 6],
    ["🕒 Ora · Città Studi - Via Golgi 40 4h", "MIA04", 13.5, "it", 2],
    // Labels of keyboards saved by older releases.
    ["🕒Ora · Milano Città Studi 4h 🇮🇹", "MIA", 13.5, "it", 2],
    ["🕒Ora · Milano Bovisa 2h ⏳6h 🇬🇧", "MIB", 11.5, "en", 6],
    ["🕒Ora · Milano Città Studi - Via Golgi 40 2h 🇬🇧", "MIA04", 11.5, "en", 2],
  ])("searches straight from the label %s", async (text, campus, endHour, lang, lookahead) => {
    const api = telegramFetch({ sendMessage: { message_id: SENT_MESSAGE_ID } });
    const search = vi.fn(async () => []);
    await handleTelegramUpdate(messageUpdate(text, "en"), env, deps(api, {
      search,
      now: () => new Date("2026-08-28T07:30:00.000Z"), // 09:30 in Rome
    }));

    expect(search).toHaveBeenCalledWith({
      campus,
      date: "28/08/2026",
      startHour: 9.5,
      endHour,
      lang,
      lookahead,
      powerOnly: false,
      drawing: false,
      allZones: false,
    });
    // One "searching" message, then edited into the results.
    expect(methods(api.calls)).toEqual(["sendMessage", "editMessageText"]);
    expect(api.calls[1]?.body.message_id).toBe(SENT_MESSAGE_ID);
  });

  it.each([
    "🕒 Ora · NOPE 3h",
    "🕒 Ora · Bovisa 12h",
    "🕒 Ora · Bovisa 3h ⏳9h",
    "🕒Ora · NOPE 3h 🇮🇹",
    "🕒Ora · Milano Bovisa 3h ⏳0h 🇮🇹",
    "🕒 Ora",
    "🕒Ora",
  ])(
    "falls back to the quick campus picker for %s",
    async (text) => {
      const api = telegramFetch();
      const search = vi.fn(async () => []);
      await handleTelegramUpdate(messageUpdate(text, "en"), env, deps(api, { search }));

      expect(methods(api.calls)).toEqual(["sendMessage"]);
      const firstCampus = keyboardOf(api.calls[0])[0]?.[0];
      expect(firstCampus && decodeCallback(firstCampus.callback_data)).toEqual({
        action: "quickCampus",
        lang: "it",
        campus: CAMPUSES["Milano Città Studi"],
      });
      expect(search).not.toHaveBeenCalled();
    },
  );

  it.each(["🔍 Cerca", "🔍Cerca", "/cerca", "/search@AuleBot"])("opens the campus picker for %s", async (text) => {
    const api = telegramFetch();
    await handleTelegramUpdate(messageUpdate(text, "it"), env, deps(api));
    expect(methods(api.calls)).toEqual(["sendMessage"]);
    expect(api.calls[0]?.body.text).toBe("<b>Quale campus?</b>");
  });

  it.each(["ℹinfo", "/info", "/help"])("answers %s with the info text", async (text) => {
    const api = telegramFetch();
    await handleTelegramUpdate(messageUpdate(text, "it"), env, deps(api));
    expect(String(api.calls[0]?.body.text)).toContain("Daniele Ferrazzo");
  });
});

describe("search card", () => {
  it("shows the main campuses in two columns and the others in a submenu", async () => {
    const api = telegramFetch();
    await handleTelegramUpdate(callbackUpdate(encodeCallback({ action: "search", lang: "it" })), env, deps(api));
    expect(methods(api.calls)).toEqual(["answerCallbackQuery", "editMessageText"]);
    expect(labels(keyboardOf(api.calls[1]))).toEqual([
      ["Città Studi", "Bovisa"],
      ["Altri campus ▸"],
      ["✖ Annulla"],
    ]);

    api.calls.length = 0;
    await handleTelegramUpdate(
      callbackUpdate(encodeCallback({ action: "campusMenu", lang: "it", quick: false, more: true })),
      env,
      deps(api),
    );
    const more = labels(keyboardOf(api.calls[1]));
    expect(more[0]).toEqual(["Como", "Cremona"]);
    expect(more.flat()).toContain("Tortona");
    expect(more.flat()).not.toContain("Bovisa");
    expect(more.at(-1)).toEqual(["⬅ Indietro", "✖ Annulla"]);
  });

  it("edits the card into a compact day picker without Sundays", async () => {
    const api = telegramFetch();
    await handleTelegramUpdate(
      callbackUpdate(encodeCallback({ action: "campus", lang: "it", campus: "COE" })),
      env,
      deps(api, { now: () => SATURDAY_MORNING }),
    );
    const edit = api.calls[1];
    expect(edit?.method).toBe("editMessageText");
    expect(edit?.body).toMatchObject({ chat_id: CHAT_ID, message_id: CARD_MESSAGE_ID, parse_mode: "HTML" });
    expect(edit?.body.text).toBe("📍 Como\n<b>Che giorno?</b>");
    const keyboard = keyboardOf(edit);
    expect(labels(keyboard)).toEqual([
      ["Oggi", "Lun 26", "Mar 27"],
      ["Mer 28", "Gio 29", "Ven 30"],
      ["⬅ Indietro", "✖ Annulla"],
    ]);
    // Como lives in the "other campuses" page: Back returns there.
    expect(decodeCallback(keyboard[2]![0]!.callback_data)).toEqual({
      action: "campusMenu",
      lang: "it",
      quick: false,
      more: true,
    });
  });

  it("offers 'now' and only upcoming hours when searching today", async () => {
    const api = telegramFetch();
    await handleTelegramUpdate(
      callbackUpdate(encodeCallback({ action: "date", lang: "en", campus: "MIB", date: "24/10/2026" })),
      env,
      deps(api, { now: () => SATURDAY_MORNING }),
    );
    const edit = api.calls[1];
    expect(edit?.body.text).toBe("📍 Bovisa · 📅 Sat 24/10\n<b>From what time?</b>");
    const keyboard = keyboardOf(edit);
    expect(labels(keyboard)).toEqual([
      ["⏱ Now · 09:15"],
      ["10:00", "11:00", "12:00", "13:00"],
      ["14:00", "15:00", "16:00", "17:00"],
      ["18:00", "19:00"],
      ["⬅ Back", "✖ Cancel"],
    ]);
    expect(decodeCallback(keyboard[0]![0]!.callback_data)).toMatchObject({ action: "start", startHour: 9.25 });
  });

  it("lists every hour for a future day", async () => {
    const api = telegramFetch();
    await handleTelegramUpdate(
      callbackUpdate(encodeCallback({ action: "date", lang: "en", campus: "MIB", date: "26/10/2026" })),
      env,
      deps(api, { now: () => SATURDAY_MORNING }),
    );
    const rows = labels(keyboardOf(api.calls[1]));
    expect(rows[0]).toEqual(["08:00", "09:00", "10:00", "11:00"]);
    expect(rows.flat()).not.toContain("⏱ Now · 09:15");
  });

  it("asks the end hour with an 'until closing' shortcut", async () => {
    const api = telegramFetch();
    await handleTelegramUpdate(
      callbackUpdate(
        encodeCallback({ action: "start", lang: "it", campus: "MIA", date: "26/10/2026", startHour: 17.25 }),
      ),
      env,
      deps(api),
    );
    const edit = api.calls[1];
    expect(edit?.body.text).toBe("📍 Città Studi · 📅 Lun 26/10 · 🕐 17:15–…\n<b>Fino a che ora?</b>");
    const keyboard = keyboardOf(edit);
    expect(labels(keyboard)).toEqual([
      ["18:00", "19:00"],
      ["🏁 Fino a chiusura · 20:00"],
      ["⬅ Indietro", "✖ Annulla"],
    ]);
    expect(decodeCallback(keyboard[1]![0]!.callback_data)).toMatchObject({ action: "end", endHour: 20 });
    expect(decodeCallback(keyboard[2]![0]!.callback_data)).toMatchObject({ action: "date", date: "26/10/2026" });
  });

  it("asks the quick duration after a quick campus choice", async () => {
    const api = telegramFetch();
    await handleTelegramUpdate(
      callbackUpdate(encodeCallback({ action: "quickCampus", lang: "en", campus: "MIA" })),
      env,
      deps(api),
    );
    const keyboard = keyboardOf(api.calls[1]);
    expect(api.calls[1]?.body.text).toBe("📍 Città Studi · 🕒 from now\n<b>For how many hours?</b>");
    expect(keyboard[0]?.[3]?.text).toBe("4h");
    expect(decodeCallback(keyboard[0]![3]!.callback_data)).toEqual({
      action: "quick",
      lang: "en",
      campus: "MIA",
      duration: 4,
      lookahead: 2,
    });
  });

  it("turns the card into the results with action buttons", async () => {
    const api = telegramFetch();
    const search = vi.fn(async () => ["\n<b>Building 1</b>\n• Room 1 → 12:15\n"]);
    const state = {
      action: "end",
      lang: "en",
      campus: "MIA",
      date: "28/08/2026",
      startHour: 9,
      endHour: 11,
    } as const;
    await handleTelegramUpdate(callbackUpdate(encodeCallback(state)), env, deps(api, { search }));

    expect(search).toHaveBeenCalledWith({
      campus: "MIA",
      date: "28/08/2026",
      startHour: 9,
      endHour: 11,
      lang: "en",
      lookahead: 2,
      powerOnly: false,
      drawing: false,
      allZones: false,
    });
    expect(methods(api.calls)).toEqual(["answerCallbackQuery", "editMessageText", "editMessageText"]);
    const header = "<b>📍 Città Studi · Fri 28/08 · 09:00–11:00</b>";
    expect(api.calls[1]?.body.text).toBe(`${header}\n\n🔎 Looking for free rooms…`);
    const results = api.calls[2];
    expect(results?.body.text).toBe(`${header}\n\n<b>Building 1</b>\n• Room 1 → 12:15\n`);
    const keyboard = keyboardOf(results);
    expect(labels(keyboard)).toEqual([
      ["🔄 Refresh", "🔌 Power plugs only"],
      ["✏️ Drawing rooms", "🗺️ All zones"],
      ["🕐 Change time"],
    ]);
    expect(decodeCallback(keyboard[0]![1]!.callback_data)).toEqual({
      ...state,
      powerOnly: true,
      fresh: true,
    });
    expect(decodeCallback(keyboard[1]![0]!.callback_data)).toEqual({ ...state, drawing: true, fresh: true });
    expect(decodeCallback(keyboard[1]![1]!.callback_data)).toEqual({ ...state, allZones: true, fresh: true });
    expect(decodeCallback(keyboard[2]![0]!.callback_data)).toEqual({
      action: "date",
      lang: "en",
      campus: "MIA",
      date: "28/08/2026",
      fresh: true,
    });
  });

  it("puts the action buttons under the last of several result messages", async () => {
    const api = telegramFetch();
    const search = vi.fn(async () => ["\n<b>A</b>\n", "\n<b>B</b>\n"]);
    await handleTelegramUpdate(
      callbackUpdate(encodeCallback({ action: "quick", lang: "it", campus: "MIA", duration: 2, lookahead: 2 })),
      env,
      deps(api, { search, now: () => SATURDAY_MORNING }),
    );
    expect(methods(api.calls)).toEqual([
      "answerCallbackQuery",
      "editMessageText",
      "editMessageText",
      "sendMessage",
    ]);
    expect(api.calls[2]?.body.reply_markup).toBeUndefined();
    expect(api.calls[3]?.body.text).toBe("<b>B</b>\n");
    expect(labels(keyboardOf(api.calls[3]))[0]).toEqual(["🔄 Aggiorna", "🔌 Solo con prese"]);
  });

  it("answers result buttons with a new message and retires the old buttons", async () => {
    const api = telegramFetch({ sendMessage: { message_id: SENT_MESSAGE_ID } });
    const search = vi.fn(async () => []);
    const data = encodeCallback({
      action: "quick",
      lang: "it",
      campus: "MIB",
      duration: 2,
      lookahead: 2,
      powerOnly: true,
      fresh: true,
    });
    await handleTelegramUpdate(callbackUpdate(data), env, deps(api, { search, now: () => SATURDAY_MORNING }));

    expect(methods(api.calls)).toEqual([
      "answerCallbackQuery",
      "editMessageReplyMarkup",
      "sendMessage",
      "editMessageText",
    ]);
    expect(api.calls[1]?.body).toEqual({ chat_id: CHAT_ID, message_id: CARD_MESSAGE_ID });
    expect(api.calls[3]?.body.message_id).toBe(SENT_MESSAGE_ID);
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ campus: "MIB", powerOnly: true }));
    const text = String(api.calls[3]?.body.text);
    expect(text).toContain("🔌 Solo aule con prese");
    expect(text).toContain("😕 Nessuna aula libera");
    expect(labels(keyboardOf(api.calls[3]))[0]).toEqual(["🔄 Aggiorna", "📋 Tutte le aule"]);
  });

  it("switches to drawing rooms and back", async () => {
    const api = telegramFetch({ sendMessage: { message_id: SENT_MESSAGE_ID } });
    const search = vi.fn(async () => []);
    const state = {
      action: "end",
      lang: "it",
      campus: "MIA",
      date: "28/10/2026",
      startHour: 10,
      endHour: 12,
      drawing: true,
      fresh: true,
    } as const;
    await handleTelegramUpdate(callbackUpdate(encodeCallback(state)), env, deps(api, { search }));

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ drawing: true, powerOnly: false, allZones: false }),
    );
    const results = api.calls.at(-1);
    expect(String(results?.body.text)).toContain("</b>\n✏️ Aule da disegno");
    const keyboard = keyboardOf(results);
    expect(labels(keyboard).slice(1)).toEqual([["🏫 Aule normali", "🗺️ Tutte le zone"], ["🕐 Cambia orario"]]);
    expect(decodeCallback(keyboard[1]![0]!.callback_data)).toEqual({ ...state, drawing: undefined });
  });

  it("hides the drawing and zone buttons where a campus has neither", async () => {
    const api = telegramFetch();
    await handleTelegramUpdate(
      callbackUpdate(
        encodeCallback({ action: "end", lang: "it", campus: "PCL", date: "28/10/2026", startHour: 10, endHour: 12 }),
      ),
      env,
      deps(api),
    );
    expect(labels(keyboardOf(api.calls.at(-1)))[1]).toEqual(["🕐 Cambia orario"]);
  });

  it("widens the search to every zone of the campus", async () => {
    const api = telegramFetch();
    const search = vi.fn(async () => []);
    const state = {
      action: "end",
      lang: "it",
      campus: "MIA",
      date: "28/10/2026",
      startHour: 10,
      endHour: 12,
      allZones: true,
      fresh: true,
    } as const;
    await handleTelegramUpdate(callbackUpdate(encodeCallback(state)), env, deps(api, { search }));
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ allZones: true }));
    const results = api.calls.at(-1);
    expect(String(results?.body.text)).toContain("</b>\n🗺️ Tutte le zone del campus");
    expect(labels(keyboardOf(results))[1]).toEqual(["✏️ Aule da disegno", "🎯 Zona centrale"]);
  });

  it("offers a retry button when the search fails", async () => {
    const api = telegramFetch();
    const search = vi.fn(async () => {
      throw new Error("upstream down");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await handleTelegramUpdate(
      callbackUpdate(encodeCallback({ action: "quick", lang: "en", campus: "MIA", duration: 2, lookahead: 2 })),
      env,
      deps(api, { search, now: () => SATURDAY_MORNING }),
    );
    const last = api.calls.at(-1);
    expect(String(last?.body.text)).toContain("⚠️");
    expect(labels(keyboardOf(last))).toEqual([["🔄 Retry"]]);
  });

  it("ignores Telegram's 'message is not modified' error", async () => {
    const api = telegramFetch({}, { editMessageText: "Bad Request: message is not modified" });
    await handleTelegramUpdate(callbackUpdate(encodeCallback({ action: "search", lang: "it" })), env, deps(api));
    expect(methods(api.calls)).toEqual(["answerCallbackQuery", "editMessageText"]);
  });

  it("deletes the card on cancel", async () => {
    const api = telegramFetch();
    await handleTelegramUpdate(callbackUpdate(encodeCallback({ action: "cancel", lang: "it" })), env, deps(api));
    expect(methods(api.calls)).toEqual(["answerCallbackQuery", "deleteMessage"]);
    expect(api.calls[1]?.body).toEqual({ chat_id: CHAT_ID, message_id: CARD_MESSAGE_ID });
  });

  it("answers invalid buttons with a toast instead of a message", async () => {
    const api = telegramFetch();
    await handleTelegramUpdate(callbackUpdate("e:en:NOPE:20260828:8:10"), env, deps(api));
    expect(methods(api.calls)).toEqual(["answerCallbackQuery"]);
    expect(api.calls[0]?.body.text).toContain("expired");
  });

  it("floors the quick slot to the quarter hour, not the hour", async () => {
    const api = telegramFetch();
    const search = vi.fn(async () => []);
    await handleTelegramUpdate(
      callbackUpdate(encodeCallback({ action: "quick", lang: "it", campus: "MIA", duration: 2, lookahead: 2 })),
      env,
      deps(api, { search, now: () => new Date("2026-10-22T10:21:00.000Z") }), // 12:21 in Rome
    );
    expect(search).toHaveBeenCalledWith({
      campus: "MIA",
      date: "22/10/2026",
      startHour: 12.25,
      endHour: 14.25,
      lang: "it",
      lookahead: 2,
      powerOnly: false,
      drawing: false,
      allZones: false,
    });
  });

  it("explains in the header when PoliMi is closed", async () => {
    const api = telegramFetch();
    const search = vi.fn(async () => []);
    await handleTelegramUpdate(
      callbackUpdate(encodeCallback({ action: "quick", lang: "it", campus: "MIB", duration: 4, lookahead: 2 })),
      env,
      deps(api, { search, now: () => new Date("2026-10-22T19:30:00.000Z") }), // 21:30 in Rome
    );
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ date: "23/10/2026", startHour: 8, endHour: 12 }),
    );
    const text = String(api.calls.at(-1)?.body.text);
    expect(text).toContain("<b>📍 Bovisa · Ven 23/10 · 08:00–12:00</b>\n🌙 Il PoliMi è chiuso");
  });
});
