import {
  CAMPUSES,
  MAX_HOUR,
  MIN_HOUR,
  campusCodeFromName,
  decodeCallback,
  encodeCallback,
} from "./protocol";
import {
  languageFromCode,
  translations,
  type Language,
} from "./i18n";
import { LOCATIONS } from "./data";

export interface TelegramEnv {
  BOT_TOKEN: string;
  WEBAPP_URL?: string;
}

export interface SearchRequest {
  campus: string;
  date: string;
  startHour: number;
  endHour: number;
  lang: Language;
}

export interface TelegramDependencies {
  search(request: SearchRequest): Promise<string[]>;
  fetch?: typeof fetch;
  now?: () => Date;
}

interface TelegramUser {
  id: number;
  first_name?: string;
  language_code?: string;
}

interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  from?: TelegramUser;
  text?: string;
  web_app_data?: { data: string; button_text?: string };
}

interface CallbackQuery {
  id: string;
  from: TelegramUser;
  data?: string;
  message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: CallbackQuery;
}

interface InlineButton {
  text: string;
  callback_data: string;
}

interface Preferences {
  lang: Language;
  campus: string;
  duration: number;
}

const DEFAULT_WEBAPP_URL =
  "https://aule-libere-polimi-settings.pages.dev";

export function validateTelegramSecret(
  request: Request,
  expectedSecret: string | undefined,
): boolean {
  if (!expectedSecret) return false;
  const actual = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (actual.length !== expectedSecret.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ expectedSecret.charCodeAt(index);
  }
  return difference === 0;
}

export async function handleTelegramUpdate(
  update: TelegramUpdate,
  env: TelegramEnv,
  deps: TelegramDependencies,
): Promise<void> {
  if (!env.BOT_TOKEN) throw new Error("BOT_TOKEN is required");
  const api = createTelegramApi(env.BOT_TOKEN, deps.fetch ?? fetch);

  if (update.callback_query) {
    await api.answerCallbackQuery(update.callback_query.id);
    await handleCallback(update.callback_query, api, deps);
    return;
  }

  const message = update.message;
  if (!message) return;
  const lang = languageFromCode(message.from?.language_code);

  if (message.web_app_data) {
    await handleWebAppData(message, lang, env, api);
    return;
  }

  const text = message.text?.trim();
  if (!text) return;
  if (text === "/start" || text.startsWith("/start@")) {
    await api.sendMessage(message.chat.id, translations[lang].welcome(message.from?.first_name ?? ""), {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: mainKeyboard(lang, env.WEBAPP_URL),
    });
    return;
  }
  if (isLabel(text, "search")) {
    await sendCampusPicker(message.chat.id, lang, api);
    return;
  }
  if (isLabel(text, "infoButton")) {
    await sendInfo(message.chat.id, lang, api);
    return;
  }
  if (
    text === "/cancel" ||
    text === "/terminate" ||
    text === "/Back" ||
    text === "/Indietro"
  ) {
    await api.sendMessage(message.chat.id, translations[lang].cancel, {
      reply_markup: mainKeyboard(lang, env.WEBAPP_URL),
    });
    return;
  }
  if (nowLabelPrefix(text)) {
    // The label is the only carrier of the saved preferences. A malformed one
    // (stale keyboard, edited text) still falls back to the inline flow.
    const preferences = parseNowLabel(text);
    await sendQuickSearch(message.chat.id, preferences, lang, api, deps);
    return;
  }
  if (isLabel(text, "now")) {
    await sendQuickSearch(message.chat.id, null, lang, api, deps);
  }
}

/**
 * Quick search from the persistent keyboard. The Worker keeps no state: the
 * preferences travel inside the label of the 🕒Ora reply-keyboard button, which
 * Telegram echoes back as the message text. When the label has none (or the
 * user typed the plain button text) fall back to the inline flow.
 */
async function sendQuickSearch(
  chatId: number,
  preferences: Preferences | null,
  fallbackLang: Language,
  api: ReturnType<typeof createTelegramApi>,
  deps: TelegramDependencies,
): Promise<void> {
  if (!preferences) {
    await sendCampusPicker(chatId, fallbackLang, api, "quickCampus");
    return;
  }

  const t = translations[preferences.lang];
  const slot = quickSearchSlot(deps.now?.() ?? new Date(), preferences.duration);
  if (slot.closed) await api.sendMessage(chatId, t.closed);
  await performSearch(
    chatId,
    {
      ...preferences,
      date: slot.date,
      startHour: slot.startHour,
      endHour: slot.endHour,
    },
    api,
    deps,
  );
}

async function handleCallback(
  query: CallbackQuery,
  api: ReturnType<typeof createTelegramApi>,
  deps: TelegramDependencies,
): Promise<void> {
  const chatId = query.message?.chat.id;
  if (!chatId) return;
  const state = query.data ? decodeCallback(query.data) : null;
  if (!state) {
    await api.sendMessage(chatId, translations[languageFromCode(query.from.language_code)].error);
    return;
  }
  const t = translations[state.lang];
  switch (state.action) {
    case "search":
      await sendCampusPicker(chatId, state.lang, api);
      return;
    case "campus":
      await api.sendMessage(chatId, t.day, {
        reply_markup: { inline_keyboard: dayKeyboard(state.lang, state.campus, deps.now?.() ?? new Date()) },
      });
      return;
    case "date":
      await api.sendMessage(chatId, t.startingTime, {
        reply_markup: { inline_keyboard: hourKeyboard(state.lang, state.campus, state.date) },
      });
      return;
    case "quickCampus":
      await api.sendMessage(chatId, t.quickDuration, {
        reply_markup: { inline_keyboard: durationKeyboard(state.lang, state.campus) },
      });
      return;
    case "start":
      await api.sendMessage(chatId, t.endingTime, {
        reply_markup: {
          inline_keyboard: endHourKeyboard(state.lang, state.campus, state.date, state.startHour),
        },
      });
      return;
    case "end":
      await performSearch(chatId, state, api, deps);
      return;
    case "quick": {
      const slot = quickSearchSlot(deps.now?.() ?? new Date(), state.duration);
      if (slot.closed) await api.sendMessage(chatId, t.closed);
      await performSearch(
        chatId,
        {
          ...state,
          date: slot.date,
          startHour: slot.startHour,
          endHour: slot.endHour,
        },
        api,
        deps,
      );
      return;
    }
    case "info":
      await sendInfo(chatId, state.lang, api);
      return;
    case "cancel":
      await api.sendMessage(chatId, t.cancel);
  }
}

async function performSearch(
  chatId: number,
  state: {
    lang: Language;
    campus: string;
    date: string;
    startHour: number;
    endHour: number;
  },
  api: ReturnType<typeof createTelegramApi>,
  deps: TelegramDependencies,
): Promise<void> {
  const t = translations[state.lang];
  await api.sendChatAction(chatId, "typing");
  try {
    const messages = await deps.search({
      campus: state.campus,
      date: state.date,
      startHour: state.startHour,
      endHour: state.endHour,
      lang: state.lang,
    });
    await api.sendMessage(
      chatId,
      `${state.date}  ${campusLabel(state.campus)}  ${state.startHour}-${state.endHour}`,
    );
    for (const result of messages.length ? messages : [t.noRooms]) {
      await api.sendMessage(chatId, result, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    }
  } catch (error) {
    console.error("Classroom search failed", error);
    await api.sendMessage(chatId, t.searchError);
  }
}

async function handleWebAppData(
  message: TelegramMessage,
  fallbackLang: Language,
  env: TelegramEnv,
  api: ReturnType<typeof createTelegramApi>,
): Promise<void> {
  const preferences = parsePreferences(message.web_app_data?.data);
  if (!preferences) {
    await api.sendMessage(message.chat.id, translations[fallbackLang].invalidPreferences);
    return;
  }
  const t = translations[preferences.lang];
  // Restore the translated persistent keyboard with the preferences encoded in
  // the 🕒Ora label: the Worker keeps no state, Telegram echoes the label back.
  // It is a separate message because Telegram cannot attach an inline keyboard
  // and a reply keyboard to the same message.
  await api.sendMessage(message.chat.id, t.menuReady, {
    reply_markup: mainKeyboard(preferences.lang, env.WEBAPP_URL, preferences),
  });
  await sendPreferences(message.chat.id, preferences, api, t);
}

function preferencesSummary(preferences: Preferences): string {
  const flag = preferences.lang === "it" ? "🇮🇹" : "🇬🇧";
  return `${campusLabel(preferences.campus)} · ${preferences.duration}h · ${flag}`;
}

function nowButtonLabel(preferences: Preferences, now: string): string {
  const flag = preferences.lang === "it" ? "🇮🇹" : "🇬🇧";
  return `${now} · ${campusLabel(preferences.campus)} ${preferences.duration}h ${flag}`;
}

function nowLabelPrefix(text: string): string | null {
  return [translations.it.now, translations.en.now]
    .map((label) => `${label} · `)
    .find((prefix) => text.startsWith(prefix)) ?? null;
}

function parseNowLabel(text: string): Preferences | null {
  const prefix = nowLabelPrefix(text);
  if (!prefix) return null;
  const suffix = text.slice(prefix.length);
  const match = /^(.+?) (\d{1,2})h (🇮🇹|🇬🇧)$/u.exec(suffix);
  if (!match) return null;
  const campus = campusCodeFromName(match[1]!.trim());
  const duration = Number(match[2]);
  const lang: Language = match[3] === "🇮🇹" ? "it" : "en";
  if (!campus || !Number.isInteger(duration) || duration < 1 || duration > 8) return null;
  return { lang, campus, duration };
}

async function sendPreferences(
  chatId: number,
  preferences: Preferences,
  api: ReturnType<typeof createTelegramApi>,
  t: (typeof translations)[Language],
): Promise<void> {
  const text = `${preferencesSummary(preferences)}\n${t.success}`;
  const reply_markup = {
    inline_keyboard: [
      [
        {
          text: t.now,
          callback_data: encodeCallback({
            action: "quick",
            lang: preferences.lang,
            campus: preferences.campus,
            duration: preferences.duration,
          }),
        },
      ],
    ],
  };
  try {
    await api.sendMessage(chatId, text, { reply_markup });
  } catch (error) {
    console.error("Unable to send the preferences message", error);
  }
}

function parsePreferences(raw: string | undefined): Preferences | null {
  if (!raw || raw.length > 2048) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const lang = value.lang;
    const campus = campusCodeFromName(value.campus);
    const duration = value.duration;
    if (
      (lang !== "it" && lang !== "en") ||
      !campus ||
      typeof duration !== "number" ||
      !Number.isInteger(duration) ||
      duration < 1 ||
      duration > 8
    )
      return null;
    return { lang, campus, duration };
  } catch {
    return null;
  }
}

async function sendCampusPicker(
  chatId: number,
  lang: Language,
  api: ReturnType<typeof createTelegramApi>,
  action: "campus" | "quickCampus" = "campus",
): Promise<void> {
  const rows: InlineButton[][] = Object.entries(CAMPUSES).map(([name, campus]) => [
    { text: name, callback_data: encodeCallback({ action, lang, campus }) },
  ]);
  rows.unshift(cancelRow(lang));
  await api.sendMessage(chatId, translations[lang].location, {
    reply_markup: { inline_keyboard: rows },
  });
}

function durationKeyboard(lang: Language, campus: string): InlineButton[][] {
  const buttons: InlineButton[] = [];
  for (let duration = 1; duration <= 8; duration += 1) {
    buttons.push({
      text: `${duration}h`,
      callback_data: encodeCallback({ action: "quick", lang, campus, duration }),
    });
  }
  return [cancelRow(lang), ...chunk(buttons, 4)];
}

async function sendInfo(
  chatId: number,
  lang: Language,
  api: ReturnType<typeof createTelegramApi>,
): Promise<void> {
  await api.sendMessage(chatId, translations[lang].info, {
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

function dayKeyboard(lang: Language, campus: string, now: Date): InlineButton[][] {
  const rows: InlineButton[][] = [cancelRow(lang)];
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addRomeDays(now, offset);
    const text = offset === 0
      ? translations[lang].today
      : offset === 1
        ? translations[lang].tomorrow
        : date;
    rows.push([{ text, callback_data: encodeCallback({ action: "date", lang, campus, date }) }]);
  }
  return rows;
}

function hourKeyboard(lang: Language, campus: string, date: string): InlineButton[][] {
  const buttons: InlineButton[] = [];
  for (let hour = MIN_HOUR; hour < MAX_HOUR; hour += 1) {
    buttons.push({
      text: String(hour),
      callback_data: encodeCallback({ action: "start", lang, campus, date, startHour: hour }),
    });
  }
  return [cancelRow(lang), ...chunk(buttons, 4)];
}

function endHourKeyboard(
  lang: Language,
  campus: string,
  date: string,
  startHour: number,
): InlineButton[][] {
  const buttons: InlineButton[] = [];
  for (let hour = startHour + 1; hour <= MAX_HOUR; hour += 1) {
    buttons.push({
      text: String(hour),
      callback_data: encodeCallback({ action: "end", lang, campus, date, startHour, endHour: hour }),
    });
  }
  return [cancelRow(lang), ...chunk(buttons, 4)];
}

function cancelRow(lang: Language): InlineButton[] {
  return [{ text: translations[lang].back, callback_data: encodeCallback({ action: "cancel", lang }) }];
}

function mainKeyboard(
  lang: Language,
  webappUrl = DEFAULT_WEBAPP_URL,
  preferences?: Preferences,
) {
  const t = translations[lang];
  const now = preferences ? nowButtonLabel(preferences, t.now) : t.now;
  return {
    keyboard: [
      [{ text: t.search }],
      [{ text: now }],
      [{ text: t.infoButton }, { text: t.preferences, web_app: { url: webappUrl } }],
    ],
    resize_keyboard: true,
  };
}

function quickSearchSlot(now: Date, duration: number) {
  const parts = romeParts(now);
  let date = `${pad(parts.day)}/${pad(parts.month)}/${parts.year}`;
  let startHour = parts.hour;
  let closed = false;
  if (startHour < MIN_HOUR) {
    startHour = MIN_HOUR;
    closed = true;
  } else if (startHour >= MAX_HOUR) {
    date = addRomeDays(now, 1);
    startHour = MIN_HOUR;
    closed = true;
  }
  return { date, startHour, endHour: Math.min(startHour + duration, MAX_HOUR), closed };
}

function addRomeDays(now: Date, offset: number): string {
  const parts = romeParts(now);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offset, 12));
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}

function romeParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour") };
}

function campusLabel(code: string): string {
  return Object.entries(LOCATIONS).find(([, value]) => value === code)?.[0] ?? code;
}

function isLabel(text: string, key: "search" | "now" | "infoButton"): boolean {
  return text === translations.it[key] || text === translations.en[key];
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) rows.push(items.slice(index, index + size));
  return rows;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function createTelegramApi(token: string, fetchImpl: typeof fetch) {
  const call = async (method: string, body: Record<string, unknown>): Promise<unknown> => {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Telegram ${method} failed with HTTP ${response.status}`);
    const result = (await response.json()) as {
      ok?: boolean;
      description?: string;
      result?: unknown;
    };
    if (!result.ok) throw new Error(result.description ?? `Telegram ${method} failed`);
    return result.result;
  };
  return {
    sendMessage: (chat_id: number, text: string, options: Record<string, unknown> = {}) =>
      call("sendMessage", { chat_id, text, ...options }),
    sendChatAction: (chat_id: number, action: string) =>
      call("sendChatAction", { chat_id, action }),
    answerCallbackQuery: (callback_query_id: string) =>
      call("answerCallbackQuery", { callback_query_id }),
  };
}
