import { quickSearchSlot } from "./clock";
import { languageFromCode, translations, type Language } from "./i18n";
import {
  DEFAULT_LOOKAHEAD,
  MAX_DURATION,
  campusCodeFromName,
  campusCodeFromShortName,
  decodeCallback,
  isValidLookahead,
  type CallbackFlags,
  type CallbackState,
} from "./protocol";
import {
  DEFAULT_FILTERS,
  campusScreen,
  dayScreen,
  durationScreen,
  endScreen,
  mainKeyboard,
  preferencesSummary,
  resultHeader,
  resultsKeyboard,
  retryKeyboard,
  startScreen,
  type InlineKeyboard,
  type Preferences,
  type Screen,
  type SearchFilters,
  type SearchSource,
} from "./screens";

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
  /** Hours after `startHour` within which to list rooms freeing up. */
  lookahead: number;
  powerOnly: boolean;
  /** Drawing rooms instead of lecture rooms. */
  drawing: boolean;
  /** The whole campus instead of its central zone. */
  allZones: boolean;
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

type TelegramApi = ReturnType<typeof createTelegramApi>;

/** The message hosting the search card; without messageId a new one is sent. */
interface Card {
  chatId: number;
  messageId?: number | undefined;
}

type MenuAction = "search" | "now" | "info" | "menu";

interface MenuEntry {
  action: MenuAction;
  lang?: Language;
}

const DEFAULT_WEBAPP_URL = "https://aule-libere-polimi-settings.pages.dev";
const MAX_WEB_APP_DATA_LENGTH = 2048;
const LANGUAGES: readonly Language[] = ["it", "en"];
const HTML_OPTIONS = { parse_mode: "HTML", disable_web_page_preview: true } as const;
const HTTP_CLIENT_ERROR = 400;
const HTTP_SERVER_ERROR = 500;

const COMMANDS: Record<string, MenuAction> = {
  "/cerca": "search",
  "/search": "search",
  "/ora": "now",
  "/now": "now",
  "/info": "info",
  "/help": "info",
  "/cancel": "menu",
  "/terminate": "menu",
  "/back": "menu",
  "/indietro": "menu",
};

// Older releases used these labels and their keyboards may still be on
// users' devices until the next /start.
const LABELS: Record<string, MenuEntry> = {
  "🔍Cerca": { action: "search", lang: "it" },
  "🔍Search": { action: "search", lang: "en" },
  "🕒Ora": { action: "now", lang: "it" },
  "🕒Now": { action: "now", lang: "en" },
  ℹinfo: { action: "info" },
  ...Object.fromEntries(
    LANGUAGES.flatMap((lang) => [
      [translations[lang].search, { action: "search", lang }],
      [translations[lang].now, { action: "now", lang }],
    ]),
  ),
};

interface NowLabelFormat {
  prefix: string;
  lang: Language;
  pattern: RegExp;
}

const FLAG_LANGUAGES: Record<string, Language> = { "🇮🇹": "it", "🇬🇧": "en" };

const NOW_LABEL_FORMATS: readonly NowLabelFormat[] = [
  ...LANGUAGES.map((lang) => ({
    prefix: `${translations[lang].now} · `,
    lang,
    // Short campus name, duration and optional lookahead after the prefix:
    // matches "Bovisa 2h" and "Bovisa 2h ⏳4h", rejects "Bovisa 2h 🇮🇹".
    pattern: /^(.+?) (\d{1,2})h(?: ⏳(\d{1,2})h)?$/u,
  })),
  ...[
    { prefix: "🕒Ora · ", lang: "it" as const },
    { prefix: "🕒Now · ", lang: "en" as const },
  ].map((format) => ({
    ...format,
    // Legacy label: full campus name, duration, optional lookahead and a
    // language flag: matches "Milano Bovisa 2h ⏳4h 🇮🇹", rejects "Bovisa 2h".
    pattern: /^(.+?) (\d{1,2})h(?: ⏳(\d{1,2})h)? (🇮🇹|🇬🇧)$/u,
  })),
];

/** A Bot API call answered with an error, with Telegram's error code. */
export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly status: number,
    description: string,
  ) {
    super(description);
    this.name = "TelegramApiError";
  }
}

/**
 * Telegram 4xx errors (bad request, bot blocked, rate limit) would fail again
 * on a webhook retry, or resend the result messages already delivered: only
 * network and 5xx errors are worth a retry.
 */
export function isRetryableError(error: unknown): boolean {
  return !(
    error instanceof TelegramApiError &&
    error.status >= HTTP_CLIENT_ERROR &&
    error.status < HTTP_SERVER_ERROR
  );
}

export function validateTelegramSecret(
  request: Request,
  expectedSecret: string | undefined,
): boolean {
  if (!expectedSecret) return false;
  const actual = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (actual.length !== expectedSecret.length) return false;
  // Constant-time comparison: always inspect every character.
  const difference = Array.from(
    { length: actual.length },
    (_, index) => actual.charCodeAt(index) ^ expectedSecret.charCodeAt(index),
  ).reduce((accumulator, value) => accumulator | value, 0);
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
    await handleCallback(update.callback_query, api, deps);
    return;
  }

  const message = update.message;
  if (!message) return;
  const chatId = message.chat.id;
  const lang = languageFromCode(message.from?.language_code);
  const webappUrl = env.WEBAPP_URL || DEFAULT_WEBAPP_URL;

  if (message.web_app_data) {
    await handleWebAppData(message, lang, webappUrl, api);
    return;
  }

  const text = message.text?.trim();
  if (!text) return;
  if (text === "/start" || text.startsWith("/start@")) {
    await api.sendMessage(chatId, translations[lang].welcome(message.from?.first_name ?? ""), {
      ...HTML_OPTIONS,
      reply_markup: mainKeyboard(lang, webappUrl),
    });
    return;
  }

  const nowLabel = parseNowLabel(text);
  if (nowLabel) {
    // A malformed label (stale keyboard, edited text) falls back to the picker.
    if (nowLabel.preferences) {
      const { lang: labelLang, campus, duration, lookahead } = nowLabel.preferences;
      const source: SearchSource = { kind: "quick", campus, duration, lookahead };
      await performSearch(api, deps, { chatId }, labelLang, source, DEFAULT_FILTERS);
    } else {
      await showScreen(api, { chatId }, campusScreen(nowLabel.lang, true, false));
    }
    return;
  }

  const entry = menuEntry(text);
  if (!entry) return;
  await MENU_HANDLERS[entry.action]({ api, chatId, lang: entry.lang ?? lang, webappUrl });
}

interface MenuContext {
  api: TelegramApi;
  chatId: number;
  lang: Language;
  webappUrl: string;
}

const MENU_HANDLERS: Record<MenuAction, (context: MenuContext) => Promise<unknown>> = {
  search: ({ api, chatId, lang }) => showScreen(api, { chatId }, campusScreen(lang, false, false)),
  now: ({ api, chatId, lang }) => showScreen(api, { chatId }, campusScreen(lang, true, false)),
  info: ({ api, chatId, lang }) => api.sendMessage(chatId, translations[lang].info, HTML_OPTIONS),
  menu: ({ api, chatId, lang, webappUrl }) =>
    api.sendMessage(chatId, translations[lang].menu, { reply_markup: mainKeyboard(lang, webappUrl) }),
};

async function handleCallback(
  query: CallbackQuery,
  api: TelegramApi,
  deps: TelegramDependencies,
): Promise<void> {
  const chatId = query.message?.chat.id;
  const state = query.data ? decodeCallback(query.data) : null;
  if (!chatId || !state) {
    await answerCallback(api, query.id, translations[languageFromCode(query.from.language_code)].error);
    return;
  }
  await answerCallback(api, query.id);
  const context: CallbackContext = {
    api,
    deps,
    chatId,
    card: await cardForCallback(api, chatId, query.message?.message_id, state),
    now: deps.now?.() ?? new Date(),
  };
  // TypeScript cannot correlate state.action with its handler's state type.
  const handler = CALLBACK_HANDLERS[state.action] as CallbackHandler<CallbackState>;
  await handler(state, context);
}

/** Best effort: Telegram refuses answers to queries older than a few seconds. */
async function answerCallback(api: TelegramApi, queryId: string, text?: string): Promise<void> {
  await api.answerCallbackQuery(queryId, text).catch((error: unknown) => {
    console.warn("Unable to answer the callback query", error);
  });
}

interface CallbackContext {
  api: TelegramApi;
  deps: TelegramDependencies;
  chatId: number;
  card: Card;
  now: Date;
}

type CallbackHandler<S extends CallbackState> = (state: S, context: CallbackContext) => Promise<unknown>;

const CALLBACK_HANDLERS: {
  [A in CallbackState["action"]]: CallbackHandler<Extract<CallbackState, { action: A }>>;
} = {
  search: ({ lang }, { api, card }) => showScreen(api, card, campusScreen(lang, false, false)),
  campusMenu: ({ lang, quick, more }, { api, card }) => showScreen(api, card, campusScreen(lang, quick, more)),
  campus: ({ lang, campus }, { api, card, now }) => showScreen(api, card, dayScreen(lang, campus, now)),
  date: ({ lang, campus, date }, { api, card, now }) =>
    showScreen(api, card, startScreen(lang, campus, date, now)),
  start: ({ lang, campus, date, startHour }, { api, card }) =>
    showScreen(api, card, endScreen(lang, campus, date, startHour)),
  quickCampus: ({ lang, campus }, { api, card }) => showScreen(api, card, durationScreen(lang, campus)),
  end: ({ lang, campus, date, startHour, endHour, ...flags }, { api, deps, card }) =>
    performSearch(api, deps, card, lang, { kind: "range", campus, date, startHour, endHour }, searchFilters(flags)),
  quick: ({ lang, campus, duration, lookahead, ...flags }, { api, deps, card }) =>
    performSearch(api, deps, card, lang, { kind: "quick", campus, duration, lookahead }, searchFilters(flags)),
  info: ({ lang }, { api, chatId }) => api.sendMessage(chatId, translations[lang].info, HTML_OPTIONS),
  cancel: ({ lang }, { api, card }) => closeCard(api, card, lang),
};

/**
 * Wizard buttons edit their own message. Buttons under search results are
 * "fresh": they keep the results and answer with a new message, so the old
 * result list loses its now superseded buttons.
 */
async function cardForCallback(
  api: TelegramApi,
  chatId: number,
  messageId: number | undefined,
  state: CallbackState,
): Promise<Card> {
  const fresh = "fresh" in state && Boolean(state.fresh);
  if (!fresh) return { chatId, messageId };
  if (messageId !== undefined) {
    await api.editMessageReplyMarkup(chatId, messageId).catch((error: unknown) => {
      if (!isNotModified(error)) console.warn("Unable to clear the result buttons", error);
    });
  }
  return { chatId };
}

async function performSearch(
  api: TelegramApi,
  deps: TelegramDependencies,
  card: Card,
  lang: Language,
  source: SearchSource,
  filters: SearchFilters,
): Promise<void> {
  const t = translations[lang];
  const slot = source.kind === "quick"
    ? quickSearchSlot(deps.now?.() ?? new Date(), source.duration)
    : { ...source, closed: false };
  const request: SearchRequest = {
    campus: source.campus,
    date: slot.date,
    startHour: slot.startHour,
    endHour: slot.endHour,
    lang,
    lookahead: source.kind === "quick" ? source.lookahead : DEFAULT_LOOKAHEAD,
    ...filters,
  };
  const header = resultHeader({ ...request, closed: slot.closed });
  const searchCard = await showScreen(api, card, { text: `${header}\n\n${t.searching}` });

  let results: string[];
  try {
    results = await deps.search(request);
  } catch (error) {
    console.error("Classroom search failed", error);
    await showScreen(api, searchCard, {
      text: `${header}\n\n${t.searchError}`,
      keyboard: retryKeyboard(lang, source, filters),
    });
    return;
  }

  const [first = t.noRooms, ...rest] = results.map((result) => result.trimStart());
  const keyboard = resultsKeyboard(lang, source, filters);
  await showScreen(api, searchCard, {
    text: `${header}\n\n${first}`,
    keyboard: rest.length ? undefined : keyboard,
  });
  // Results longer than one Telegram message continue in new messages; the
  // action buttons always sit under the last one.
  await rest.reduce(async (previous, text, index) => {
    await previous;
    const isLast = index === rest.length - 1;
    await api.sendMessage(card.chatId, text, { ...HTML_OPTIONS, ...inlineMarkup(isLast ? keyboard : undefined) });
  }, Promise.resolve());
}

/** Edit the card in place, or send it as a new message when there is none. */
async function showScreen(api: TelegramApi, card: Card, screen: Screen): Promise<Card> {
  if (card.messageId !== undefined) {
    try {
      await api.editMessageText(card.chatId, card.messageId, screen.text, {
        ...HTML_OPTIONS,
        ...inlineMarkup(screen.keyboard),
      });
      return card;
    } catch (error) {
      if (isNotModified(error)) return card;
      console.warn("Unable to edit the search card, sending a new one", error);
    }
  }
  const sent = await api.sendMessage(card.chatId, screen.text, {
    ...HTML_OPTIONS,
    ...inlineMarkup(screen.keyboard),
  });
  return { chatId: card.chatId, messageId: messageIdOf(sent) };
}

async function closeCard(api: TelegramApi, card: Card, lang: Language): Promise<void> {
  if (card.messageId === undefined) return;
  try {
    await api.deleteMessage(card.chatId, card.messageId);
  } catch {
    // Bots can only delete messages younger than 48 hours.
    await showScreen(api, card, { text: translations[lang].cancelled });
  }
}

async function handleWebAppData(
  message: TelegramMessage,
  fallbackLang: Language,
  webappUrl: string,
  api: TelegramApi,
): Promise<void> {
  const preferences = parsePreferences(message.web_app_data?.data);
  if (!preferences) {
    await api.sendMessage(message.chat.id, translations[fallbackLang].invalidPreferences);
    return;
  }
  // The reply keyboard carries the preferences in the 🕒 Ora label: the Worker
  // keeps no state, Telegram echoes the label back when it is tapped.
  await api.sendMessage(
    message.chat.id,
    `${translations[preferences.lang].success}\n${preferencesSummary(preferences)}`,
    { ...HTML_OPTIONS, reply_markup: mainKeyboard(preferences.lang, webappUrl, preferences) },
  );
}

function menuEntry(text: string): MenuEntry | null {
  if (!text.startsWith("/")) return LABELS[text] ?? null;
  const command = text.split("@")[0]!.toLowerCase();
  const action = COMMANDS[command];
  return action ? { action } : null;
}

function parseNowLabel(text: string): { lang: Language; preferences: Preferences | null } | null {
  const format = NOW_LABEL_FORMATS.find((candidate) => text.startsWith(candidate.prefix));
  if (!format) return null;
  const match = format.pattern.exec(text.slice(format.prefix.length));
  if (!match) return { lang: format.lang, preferences: null };
  const [, name, rawDuration, rawLookahead, flag] = match;
  const lang = (flag && FLAG_LANGUAGES[flag]) || format.lang;
  const campus = campusCodeFromShortName(name!.trim());
  const duration = Number(rawDuration);
  // Labels built before the lookahead existed, or with the default, omit it.
  const lookahead = rawLookahead === undefined ? DEFAULT_LOOKAHEAD : Number(rawLookahead);
  const valid = campus && isValidDuration(duration) && isValidLookahead(lookahead);
  return { lang, preferences: valid ? { lang, campus, duration, lookahead } : null };
}

function parsePreferences(raw: string | undefined): Preferences | null {
  if (!raw || raw.length > MAX_WEB_APP_DATA_LENGTH) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const lang = value.lang;
    const campus = campusCodeFromName(value.campus);
    const duration = value.duration;
    // Mini App builds without the setting omit it: keep their data valid.
    const lookahead = value.lookahead ?? DEFAULT_LOOKAHEAD;
    if (
      (lang !== "it" && lang !== "en") ||
      !campus ||
      typeof duration !== "number" ||
      !isValidDuration(duration) ||
      !isValidLookahead(lookahead)
    )
      return null;
    return { lang, campus, duration, lookahead };
  } catch {
    return null;
  }
}

function searchFilters(flags: CallbackFlags): SearchFilters {
  return {
    powerOnly: Boolean(flags.powerOnly),
    drawing: Boolean(flags.drawing),
    allZones: Boolean(flags.allZones),
  };
}

function isValidDuration(duration: number): boolean {
  return Number.isInteger(duration) && duration >= 1 && duration <= MAX_DURATION;
}

function inlineMarkup(keyboard: InlineKeyboard | undefined) {
  return keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {};
}

function messageIdOf(sent: unknown): number | undefined {
  if (typeof sent !== "object" || sent === null || !("message_id" in sent)) return undefined;
  return typeof sent.message_id === "number" ? sent.message_id : undefined;
}

function isNotModified(error: unknown): boolean {
  return error instanceof Error && error.message.includes("message is not modified");
}

function createTelegramApi(token: string, fetchImpl: typeof fetch) {
  const call = async (method: string, body: Record<string, unknown>): Promise<unknown> => {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error_code?: number;
      description?: string;
      result?: unknown;
    };
    if (!response.ok || !result.ok) {
      const status = result.error_code ?? response.status;
      throw new TelegramApiError(method, status, result.description ?? `Telegram ${method} failed with HTTP ${status}`);
    }
    return result.result;
  };
  return {
    sendMessage: (chat_id: number, text: string, options: Record<string, unknown> = {}) =>
      call("sendMessage", { chat_id, text, ...options }),
    editMessageText: (chat_id: number, message_id: number, text: string, options: Record<string, unknown> = {}) =>
      call("editMessageText", { chat_id, message_id, text, ...options }),
    editMessageReplyMarkup: (chat_id: number, message_id: number) =>
      call("editMessageReplyMarkup", { chat_id, message_id }),
    deleteMessage: (chat_id: number, message_id: number) =>
      call("deleteMessage", { chat_id, message_id }),
    answerCallbackQuery: (callback_query_id: string, text?: string) =>
      call("answerCallbackQuery", { callback_query_id, ...(text ? { text } : {}) }),
  };
}
