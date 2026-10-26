import { addRomeDays, isOpenDay, romeQuarterHour, weekdayOf } from "./clock";
import { formatTime } from "./format";
import { escapeHtml, translations, type Language } from "./i18n";
import { campusHasDrawingRooms, campusHasZones } from "./rooms";
import {
  CAMPUSES,
  DEFAULT_LOOKAHEAD,
  MAX_DURATION,
  MAX_HOUR,
  MIN_HOUR,
  QUARTER,
  campusName,
  encodeCallback,
  shortCampusName,
  type CallbackState,
} from "./protocol";

export interface InlineButton {
  text: string;
  callback_data: string;
}

export type InlineKeyboard = InlineButton[][];

/** One state of the search card: the same message is edited at every step. */
export interface Screen {
  text: string;
  keyboard?: InlineKeyboard | undefined;
}

export interface Preferences {
  lang: Language;
  campus: string;
  duration: number;
  /** Hours after the start within which to list rooms freeing up. */
  lookahead: number;
}

/** What produced a result list, so its buttons can repeat or adjust it. */
export type SearchSource =
  | { kind: "range"; campus: string; date: string; startHour: number; endHour: number }
  | { kind: "quick"; campus: string; duration: number; lookahead: number };

/**
 * Result filters toggled by the buttons under the results. After
 * "🕐 Change time" the pickers carry them up to the new search.
 */
export interface SearchFilters {
  powerOnly: boolean;
  drawing: boolean;
  allZones: boolean;
}

export const DEFAULT_FILTERS: SearchFilters = { powerOnly: false, drawing: false, allZones: false };

export interface ResultContext extends SearchFilters {
  lang: Language;
  campus: string;
  date: string;
  startHour: number;
  endHour: number;
  closed: boolean;
}

const MAIN_CAMPUS_NAMES = ["Milano Città Studi", "Milano Bovisa"];
const CAMPUS_COLUMNS = 2;
const DAY_COLUMNS = 3;
const HOUR_COLUMNS = 4;
const DAYS_AHEAD = 7;
// PoliMi lessons run from :15 to :15 (08:15–10:15…): the picker follows them.
const LESSON_OFFSET = QUARTER;
const LAST_START = MAX_HOUR - QUARTER;
// dd/mm of a dd/mm/yyyy date, and its day of month.
const DAY_MONTH_LENGTH = 5;
const DAY_LENGTH = 2;

export function campusScreen(lang: Language, quick: boolean, more: boolean): Screen {
  const t = translations[lang];
  const buttons = Object.entries(CAMPUSES)
    .filter(([name]) => MAIN_CAMPUS_NAMES.includes(name) !== more)
    .map(([name, campus]) =>
      button(
        shortCampusName(name),
        quick ? { action: "quickCampus", lang, campus } : { action: "campus", lang, campus },
      ),
    );
  const keyboard = chunk(buttons, CAMPUS_COLUMNS);
  const menu = (toMore: boolean): CallbackState => ({ action: "campusMenu", lang, quick, more: toMore });
  if (more) keyboard.push(navRow(lang, menu(false)));
  else keyboard.push([button(t.otherCampuses, menu(true))], navRow(lang));
  return { text: `<b>${t.location}</b>`, keyboard };
}

export function dayScreen(
  lang: Language,
  campus: string,
  now: Date,
  filters: SearchFilters = DEFAULT_FILTERS,
): Screen {
  const t = translations[lang];
  const relativeDays = [t.today, t.tomorrow];
  // From 19:45 today has no lesson slot left: the week starts tomorrow.
  const firstDay = romeQuarterHour(now) >= LAST_START ? 1 : 0;
  const buttons = range(firstDay, firstDay + DAYS_AHEAD)
    .map((offset) => ({ offset, date: addRomeDays(now, offset) }))
    .filter(({ date }) => isOpenDay(date))
    .map(({ offset, date }) => {
      const label =
        relativeDays[offset] ?? `${t.weekdays[weekdayOf(date)]} ${Number(date.slice(0, DAY_LENGTH))}`;
      return button(label, { action: "date", lang, campus, date, ...filters });
    });
  return {
    text: question(breadcrumb(lang, { campus }), t.day),
    keyboard: [...chunk(buttons, DAY_COLUMNS), navRow(lang, campusMenuFor(lang, campus, false))],
  };
}

export function startScreen(
  lang: Language,
  campus: string,
  date: string,
  now: Date,
  filters: SearchFilters = DEFAULT_FILTERS,
): Screen {
  const t = translations[lang];
  const nowHour = romeQuarterHour(now);
  const isToday = date === addRomeDays(now, 0);
  const openNow = isToday && nowHour >= MIN_HOUR && nowHour < MAX_HOUR;
  const startState = (startHour: number): CallbackState => ({
    action: "start",
    lang,
    campus,
    date,
    startHour,
    ...filters,
  });
  // Earlier hours of today are useless: start from the next lesson slot.
  const hours = lessonTimes(MIN_HOUR)
    .filter((hour) => !isToday || hour > nowHour)
    .map((hour) => button(formatTime(hour), startState(hour)));
  const rows: InlineKeyboard = openNow
    ? [[button(`${t.fromNow} · ${formatTime(nowHour)}`, startState(nowHour))]]
    : [];
  rows.push(...chunk(hours, HOUR_COLUMNS), navRow(lang, { action: "campus", lang, campus, ...filters }));
  return { text: question(breadcrumb(lang, { campus, date }), t.startingTime), keyboard: rows };
}

export function endScreen(
  lang: Language,
  campus: string,
  date: string,
  startHour: number,
  filters: SearchFilters = DEFAULT_FILTERS,
): Screen {
  const t = translations[lang];
  const endState = (endHour: number): CallbackState => ({
    action: "end",
    lang,
    campus,
    date,
    startHour,
    endHour,
    ...filters,
  });
  const hours = lessonTimes(MIN_HOUR + 1)
    .filter((hour) => hour > startHour)
    .map((hour) => button(formatTime(hour), endState(hour)));
  return {
    text: question(breadcrumb(lang, { campus, date, startHour }), t.endingTime),
    keyboard: [
      ...chunk(hours, HOUR_COLUMNS),
      [button(`${t.untilClosing} · ${formatTime(MAX_HOUR)}`, endState(MAX_HOUR))],
      navRow(lang, { action: "date", lang, campus, date, ...filters }),
    ],
  };
}

export function durationScreen(
  lang: Language,
  campus: string,
  filters: SearchFilters = DEFAULT_FILTERS,
): Screen {
  const t = translations[lang];
  const buttons = range(1, MAX_DURATION + 1).map((duration) =>
    button(`${duration}h`, { action: "quick", lang, campus, duration, lookahead: DEFAULT_LOOKAHEAD, ...filters }),
  );
  return {
    text: question(breadcrumb(lang, { campus, quick: true }), t.quickDuration),
    keyboard: [...chunk(buttons, HOUR_COLUMNS), navRow(lang, campusMenuFor(lang, campus, true))],
  };
}

export function resultHeader(context: ResultContext): string {
  const t = translations[context.lang];
  const lines = [
    `<b>📍 ${campusCrumb(context.campus)} · ${dayCrumb(context.lang, context.date)} · ` +
      `${formatTime(context.startHour)}–${formatTime(context.endHour)}</b>`,
  ];
  if (context.closed) lines.push(t.closed(dayCrumb(context.lang, context.date), formatTime(context.startHour)));
  if (context.allZones && campusHasZones(context.campus)) lines.push(t.allZonesActive);
  if (context.drawing) lines.push(t.drawingFilterActive);
  if (context.powerOnly) lines.push(t.powerFilterActive);
  return lines.join("\n");
}

export function resultsKeyboard(lang: Language, source: SearchSource, filters: SearchFilters): InlineKeyboard {
  const t = translations[lang];
  const { powerOnly, drawing, allZones } = filters;
  const toggle = (text: string, changed: Partial<SearchFilters>) =>
    button(text, repeatSearch(lang, source, { ...filters, ...changed }));
  const changeTime = button(
    t.changeTime,
    source.kind === "range"
      ? { action: "date", lang, campus: source.campus, date: source.date, ...filters, fresh: true }
      : { action: "quickCampus", lang, campus: source.campus, ...filters, fresh: true },
  );
  // Campuses without drawing rooms or zones would only show a useless toggle.
  const roomKindToggle = campusHasDrawingRooms(source.campus)
    ? [toggle(drawing ? t.lectureRooms : t.drawingRooms, { drawing: !drawing })]
    : [];
  const zoneToggle = campusHasZones(source.campus)
    ? [toggle(allZones ? t.centralZone : t.allZones, { allZones: !allZones })]
    : [];
  return [
    [button(t.refresh, repeatSearch(lang, source, filters)), toggle(powerOnly ? t.allRooms : t.powerOnly, { powerOnly: !powerOnly })],
    [...roomKindToggle, ...zoneToggle],
    [changeTime],
  ].filter((row) => row.length > 0);
}

export function retryKeyboard(lang: Language, source: SearchSource, filters: SearchFilters): InlineKeyboard {
  return [[button(translations[lang].retry, repeatSearch(lang, source, filters))]];
}

export function mainKeyboard(lang: Language, webappUrl: string, preferences?: Preferences) {
  const t = translations[lang];
  return {
    keyboard: [
      [{ text: preferences ? nowButtonLabel(preferences) : t.now }],
      [{ text: t.search }, { text: t.preferences, web_app: { url: webappUrl } }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: t.placeholder,
  };
}

/**
 * The 🕒 Ora label is the only carrier of the saved preferences: Telegram
 * echoes it back as message text. The prefix already tells the language.
 */
export function nowButtonLabel(preferences: Preferences): string {
  const t = translations[preferences.lang];
  // The default lookahead is implied, keeping the common label short.
  const lookahead = preferences.lookahead === DEFAULT_LOOKAHEAD ? "" : ` ⏳${preferences.lookahead}h`;
  return `${t.now} · ${campusCrumb(preferences.campus, false)} ${preferences.duration}h${lookahead}`;
}

export function preferencesSummary(preferences: Preferences): string {
  return `📍 ${campusCrumb(preferences.campus)} · ${preferences.duration}h · ⏳ ${preferences.lookahead}h`;
}

function repeatSearch(lang: Language, source: SearchSource, filters: SearchFilters): CallbackState {
  return source.kind === "range"
    ? { action: "end", lang, ...source, ...filters, fresh: true }
    : {
        action: "quick",
        lang,
        campus: source.campus,
        duration: source.duration,
        lookahead: source.lookahead,
        ...filters,
        fresh: true,
      };
}

function campusMenuFor(lang: Language, campus: string, quick: boolean): CallbackState {
  const more = Object.entries(CAMPUSES).some(
    ([name, code]) => code === campus && !MAIN_CAMPUS_NAMES.includes(name),
  );
  return { action: "campusMenu", lang, quick, more };
}

function breadcrumb(
  lang: Language,
  step: { campus: string; date?: string; startHour?: number; quick?: boolean },
): string {
  const parts = [`📍 ${campusCrumb(step.campus)}`];
  if (step.date) parts.push(`📅 ${dayCrumb(lang, step.date)}`);
  if (step.startHour !== undefined) parts.push(`🕐 ${formatTime(step.startHour)}–…`);
  if (step.quick) parts.push(translations[lang].quickCrumb);
  return parts.join(" · ");
}

function question(crumb: string, text: string): string {
  return `${crumb}\n<b>${text}</b>`;
}

function campusCrumb(code: string, escaped = true): string {
  const name = shortCampusName(campusName(code));
  return escaped ? escapeHtml(name) : name;
}

function dayCrumb(lang: Language, date: string): string {
  return `${translations[lang].weekdays[weekdayOf(date)]} ${date.slice(0, DAY_MONTH_LENGTH)}`;
}

function navRow(lang: Language, back?: CallbackState): InlineButton[] {
  const t = translations[lang];
  const cancel = button(t.cancel, { action: "cancel", lang });
  return back ? [button(t.back, back), cancel] : [cancel];
}

function button(text: string, state: CallbackState): InlineButton {
  return { text, callback_data: encodeCallback(state) };
}

/** Lesson boundaries from `firstHour`:15 to the last one before closing. */
function lessonTimes(firstHour: number): number[] {
  return range(firstHour, MAX_HOUR).map((hour) => hour + LESSON_OFFSET);
}

/** Integers from `from` (inclusive) to `to` (exclusive). */
function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, index) => from + index);
}

function chunk<T>(items: T[], size: number): T[][] {
  return range(0, Math.ceil(items.length / size)).map((row) =>
    items.slice(row * size, (row + 1) * size),
  );
}
