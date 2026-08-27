export type Language = "it" | "en";

export interface Translation {
  welcome: (firstName: string) => string;
  location: string;
  day: string;
  startingTime: string;
  endingTime: string;
  error: string;
  closed: string;
  cancel: string;
  info: string;
  success: string;
  missingPreferences: string;
  invalidPreferences: string;
  noRooms: string;
  searchError: string;
  search: string;
  now: string;
  preferences: string;
  infoButton: string;
  today: string;
  tomorrow: string;
  back: string;
  searching: string;
  menuReady: string;
}

export const translations: Record<Language, Translation> = {
  it: {
    welcome: (name) =>
      `Ciao <b>${escapeHtml(name)}</b>! Con Aule Libere PoliMi puoi cercare le aule libere per tutta la settimana.\n\nBot originale di <b>Daniele Ferrazzo</b>, ora mantenuto da <a href="https://t.me/joelshepard"><b>Joel Shepard</b></a>.`,
    location: "Seleziona il campus",
    day: "Seleziona il giorno",
    startingTime: "Seleziona l'orario iniziale",
    endingTime: "Seleziona l'orario finale",
    error: "Scelta non valida. Usa i pulsanti disponibili.",
    closed: "Il PoliMi adesso è chiuso. Cercherò dalla prossima apertura.",
    cancel: "Torno al menu principale ⬅",
    info: 'Premi “🔍Cerca” per scegliere campus, giorno e fascia oraria. Dopo aver salvato le preferenze nella Mini App puoi usare “🕒Ora” per una ricerca rapida.\n\nIl codice è disponibile su <a href="https://github.com/JoelShepard/AuleLiberePoliMi">GitHub</a>. Bot originale di <b>Daniele Ferrazzo</b>.',
    success: "Preferenze salvate 👍🏻",
    missingPreferences:
      "Prima imposta campus e durata con il pulsante ⚙️Preferenze.",
    invalidPreferences:
      "❌ Le preferenze ricevute non sono valide. Riapri la Mini App e riprova.",
    noRooms: "Non sono state trovate aule libere in questa fascia oraria.",
    searchError: "C'è stato un problema durante la ricerca. Riprova più tardi.",
    search: "🔍Cerca",
    now: "🕒Ora",
    preferences: "⚙️Preferenze",
    infoButton: "ℹinfo",
    today: "Oggi",
    tomorrow: "Domani",
    back: "Annulla",
    searching: "Ricerca in corso…",
    menuReady: "Menu aggiornato.",
  },
  en: {
    welcome: (name) =>
      `Hi <b>${escapeHtml(name)}</b>! Aule Libere PoliMi helps you find free classrooms throughout the week.\n\nOriginal bot by <b>Daniele Ferrazzo</b>, now maintained by <a href="https://t.me/joelshepard"><b>Joel Shepard</b></a>.`,
    location: "Choose a campus",
    day: "Choose a day",
    startingTime: "Choose the starting time",
    endingTime: "Choose the ending time",
    error: "Invalid choice. Please use the available buttons.",
    closed: "PoliMi is currently closed. I will search from the next opening.",
    cancel: "Back to the main menu ⬅",
    info: 'Press “🔍Search” to choose a campus, day and time range. After saving preferences in the Mini App, use “🕒Now” for a quick search.\n\nThe source code is available on <a href="https://github.com/JoelShepard/AuleLiberePoliMi">GitHub</a>. Original bot by <b>Daniele Ferrazzo</b>.',
    success: "Preferences saved 👍🏻",
    missingPreferences:
      "Set a campus and duration first with the ⚙️Preferences button.",
    invalidPreferences:
      "❌ The received preferences are invalid. Reopen the Mini App and try again.",
    noRooms: "No free classrooms were found for this time slot.",
    searchError: "There was a problem during the search. Try again later.",
    search: "🔍Search",
    now: "🕒Now",
    preferences: "⚙️Preferences",
    infoButton: "ℹinfo",
    today: "Today",
    tomorrow: "Tomorrow",
    back: "Cancel",
    searching: "Searching…",
    menuReady: "Menu updated.",
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
