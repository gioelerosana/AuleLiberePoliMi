export type Language = "it" | "en";

export interface Translation {
  welcome: (firstName: string) => string;
  info: string;
  location: string;
  day: string;
  startingTime: string;
  endingTime: string;
  quickDuration: string;
  error: string;
  /** PoliMi is closed: the search starts when it reopens, on `day` at `time`. */
  closed: (day: string, time: string) => string;
  cancelled: string;
  menu: string;
  success: string;
  invalidPreferences: string;
  noRooms: string;
  freeingUpTitle: (hours: number) => string;
  /** When a room freeing up is free: "dalle 13:15 alle 16:15". */
  freeingUpRange: (from: string, until: string) => string;
  searchError: string;
  searching: string;
  search: string;
  now: string;
  preferences: string;
  placeholder: string;
  today: string;
  tomorrow: string;
  weekdays: readonly string[];
  back: string;
  cancel: string;
  otherCampuses: string;
  fromNow: string;
  untilClosing: string;
  quickCrumb: string;
  refresh: string;
  retry: string;
  powerOnly: string;
  allRooms: string;
  powerFilterActive: string;
  drawingRooms: string;
  lectureRooms: string;
  drawingFilterActive: string;
  allZones: string;
  centralZone: string;
  allZonesActive: string;
  otherZonesHint: (count: number) => string;
  changeTime: string;
}

const GITHUB_URL = "https://github.com/JoelShepard/AuleLiberePoliMi";

export const translations: Record<Language, Translation> = {
  it: {
    welcome: (name) =>
      `Ciao <b>${escapeHtml(name)}</b>! 👋 Trovo le aule libere del PoliMi.\n\n` +
      "🕒 <b>Ora</b> · aule libere da adesso\n" +
      "🔍 <b>Cerca</b> · scegli campus, giorno e orario\n" +
      "⚙️ <b>Preferenze</b> · campus e durata per «Ora»\n\n" +
      "Crediti e codice sorgente: /info",
    info:
      "<b>Aule Libere PoliMi</b>\n\n" +
      "• <b>🕒 Ora</b>: cerca da adesso con campus e durata salvati nelle Preferenze\n" +
      "• <b>🔍 Cerca</b>: campus → giorno → orario\n" +
      "• 🔌 indica le aule con prese, ✏️ mostra le aule da disegno\n\n" +
      `Codice su <a href="${GITHUB_URL}">GitHub</a> · bot originale di <b>Daniele Ferrazzo</b>.`,
    location: "Quale campus?",
    day: "Che giorno?",
    startingTime: "Da che ora?",
    endingTime: "Fino a che ora?",
    quickDuration: "Per quante ore?",
    error: "Pulsante non più valido, riprova dal menu.",
    closed: (day, time) => `🌙 Il PoliMi è chiuso: cerco dalla riapertura, ${day} alle ${time}.`,
    cancelled: "Ricerca annullata.",
    menu: "Menu principale 👇",
    success: "✅ Preferenze salvate",
    invalidPreferences: "❌ Preferenze non valide. Riapri ⚙️ Preferenze e riprova.",
    noRooms: "😕 Nessuna aula libera in questa fascia oraria.",
    freeingUpTitle: (hours) => `⏳ Si liberano entro ${hours} ${hours === 1 ? "ora" : "ore"}`,
    freeingUpRange: (from, until) => `dalle ${from} alle ${until}`,
    searchError: "⚠️ Ricerca non riuscita, riprova tra poco.",
    searching: "🔎 Cerco aule libere…",
    search: "🔍 Cerca",
    now: "🕒 Ora",
    preferences: "⚙️ Preferenze",
    placeholder: "Scegli un'azione",
    today: "Oggi",
    tomorrow: "Domani",
    weekdays: ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"],
    back: "⬅ Indietro",
    cancel: "✖ Annulla",
    otherCampuses: "Altri campus ▸",
    fromNow: "⏱ Adesso",
    untilClosing: "🏁 Fino a chiusura",
    quickCrumb: "🕒 da adesso",
    refresh: "🔄 Aggiorna",
    retry: "🔄 Riprova",
    powerOnly: "🔌 Solo con prese",
    allRooms: "📋 Tutte le aule",
    powerFilterActive: "🔌 Solo aule con prese",
    drawingRooms: "✏️ Aule da disegno",
    lectureRooms: "🏫 Aule normali",
    drawingFilterActive: "✏️ Aule da disegno",
    allZones: "🗺️ Tutte le zone",
    centralZone: "🎯 Zona centrale",
    allZonesActive: "🗺️ Tutte le zone del campus",
    otherZonesHint: (count) =>
      count === 1
        ? "🗺️ C'è un'altra aula libera fuori dalla zona centrale."
        : `🗺️ Ci sono altre ${count} aule libere fuori dalla zona centrale.`,
    changeTime: "🕐 Cambia orario",
  },
  en: {
    welcome: (name) =>
      `Hi <b>${escapeHtml(name)}</b>! 👋 I find free classrooms at PoliMi.\n\n` +
      "🕒 <b>Now</b> · rooms free from now\n" +
      "🔍 <b>Search</b> · pick campus, day and time\n" +
      "⚙️ <b>Preferences</b> · campus and duration for “Now”\n\n" +
      "Credits and source code: /info",
    info:
      "<b>Aule Libere PoliMi</b>\n\n" +
      "• <b>🕒 Now</b>: search from now with the campus and duration saved in Preferences\n" +
      "• <b>🔍 Search</b>: campus → day → time\n" +
      "• 🔌 marks rooms with power plugs, ✏️ shows drawing rooms\n\n" +
      `Code on <a href="${GITHUB_URL}">GitHub</a> · original bot by <b>Daniele Ferrazzo</b>.`,
    location: "Which campus?",
    day: "Which day?",
    startingTime: "From what time?",
    endingTime: "Until what time?",
    quickDuration: "For how many hours?",
    error: "This button has expired, start again from the menu.",
    closed: (day, time) => `🌙 PoliMi is closed: searching from the reopening, ${day} at ${time}.`,
    cancelled: "Search cancelled.",
    menu: "Main menu 👇",
    success: "✅ Preferences saved",
    invalidPreferences: "❌ Invalid preferences. Reopen ⚙️ Preferences and try again.",
    noRooms: "😕 No free classrooms in this time slot.",
    freeingUpTitle: (hours) => `⏳ Freeing up within ${hours} ${hours === 1 ? "hour" : "hours"}`,
    freeingUpRange: (from, until) => `from ${from} to ${until}`,
    searchError: "⚠️ The search failed, try again shortly.",
    searching: "🔎 Looking for free rooms…",
    search: "🔍 Search",
    now: "🕒 Now",
    preferences: "⚙️ Preferences",
    placeholder: "Pick an action",
    today: "Today",
    tomorrow: "Tomorrow",
    weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    back: "⬅ Back",
    cancel: "✖ Cancel",
    otherCampuses: "Other campuses ▸",
    fromNow: "⏱ Now",
    untilClosing: "🏁 Until closing",
    quickCrumb: "🕒 from now",
    refresh: "🔄 Refresh",
    retry: "🔄 Retry",
    powerOnly: "🔌 Power plugs only",
    allRooms: "📋 All rooms",
    powerFilterActive: "🔌 Rooms with power plugs only",
    drawingRooms: "✏️ Drawing rooms",
    lectureRooms: "🏫 Lecture rooms",
    drawingFilterActive: "✏️ Drawing rooms",
    allZones: "🗺️ All zones",
    centralZone: "🎯 Central zone",
    allZonesActive: "🗺️ All campus zones",
    otherZonesHint: (count) =>
      count === 1
        ? "🗺️ One more free room outside the central zone."
        : `🗺️ ${count} more free rooms outside the central zone.`,
    changeTime: "🕐 Change time",
  },
};

export function languageFromCode(code?: string): Language {
  return code?.toLowerCase().startsWith("it") ? "it" : "en";
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
