/* ── AuleLiberePoliMi — Mini App Settings ──────────────────────────
 *  This script runs inside Telegram's Mini App WebView.
 *  Uses window.Telegram.WebApp to communicate with the Telegram client.
 *
 *  PERSISTENCE STRATEGY:
 *  - Uses Telegram CloudStorage (Bot API 6.9+) when available → persists
 *    across Mini App sessions within Telegram.
 *  - Falls back to browser localStorage when outside Telegram.
 *
 *  WARNING: Telegram.WebApp.sendData() ONLY works when Mini App is
 *  launched from a KeyboardButton (reply keyboard), NOT from an
 *  InlineKeyboardButton. The bot's ⚙️ button is a KeyboardButton.
 *
 *  CONTRACT: sends a JSON string {"lang","campus","duration"} to the
 *  bot via sendData(). Do not rename these keys (see worker/src/telegram.ts).
 */

const STORAGE_KEY = "auleliberepolimi_prefs";

// ── Translations ──────────────────────────────────────────────
const I18N = {
    en: {
        settingsTitle: "AuleLiberePoliMi — Settings",
        title: "Preferences",
        subtitle: "Set your preferences for quick search.",
        languageLabel: "Language",
        campusLabel: "Preferred campus",
        durationLabel: "Search duration (hours)",
        campusPlaceholder: "— Select a campus —",
        saveBtn: "Save preferences",
        footer: "Preferences are stored on your device.",
        selectCampusAlert: "Please select a campus.",
    },
    it: {
        settingsTitle: "AuleLiberePoliMi — Impostazioni",
        title: "Preferenze",
        subtitle: "Imposta le tue preferenze per la ricerca rapida.",
        languageLabel: "Lingua",
        campusLabel: "Campus preferito",
        durationLabel: "Durata ricerca (ore)",
        campusPlaceholder: "— Seleziona un campus —",
        saveBtn: "Salva preferenze",
        footer: "Le preferenze sono salvate sul tuo dispositivo.",
        selectCampusAlert: "Seleziona un campus.",
    },
};

function applyLanguage(lang) {
    const t = I18N[lang] || I18N.en;
    document.documentElement.lang = lang === "it" ? "it" : "en";
    if (t.settingsTitle) document.title = t.settingsTitle;

    document.querySelectorAll("[data-i18n]").forEach((el) => {
        const key = el.dataset.i18n;
        if (t[key] !== undefined) el.textContent = t[key];
    });

    const placeholderOpt = campusSelect.querySelector('option[value=""]');
    if (placeholderOpt && t.campusPlaceholder !== undefined) {
        placeholderOpt.textContent = t.campusPlaceholder;
    }
}

// ── DOM refs ──────────────────────────────────────────────────
const langSegmented = document.getElementById("lang-segmented");
const langButtons = langSegmented.querySelectorAll(".segmented__btn");
const campusSelect = document.getElementById("campus");
const durationSlider = document.getElementById("duration");
const durationValue = document.getElementById("duration-value");
const sliderEl = durationSlider.parentElement; // .slider container
const saveBtn = document.getElementById("save-btn");

// ── Language (segmented button) ───────────────────────────────
function getSelectedLang() {
    const selected = langSegmented.querySelector(".segmented__btn.is-selected");
    return selected ? selected.dataset.lang : "en";
}

function setSelectedLang(lang) {
    let match = null;
    langButtons.forEach((btn) => {
        if (btn.dataset.lang === lang) match = btn;
        btn.classList.remove("is-selected");
        btn.setAttribute("aria-selected", "false");
    });
    if (!match) match = langButtons[0];
    match.classList.add("is-selected");
    match.setAttribute("aria-selected", "true");
    applyLanguage(match.dataset.lang);
}

langButtons.forEach((btn) => {
    btn.addEventListener("click", () => setSelectedLang(btn.dataset.lang));
});

// ── Populate campus dropdown ──────────────────────────────────
function populateCampuses() {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "— Select a campus —";
    campusSelect.appendChild(placeholder);
    CAMPUSES.forEach((name) => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        campusSelect.appendChild(opt);
    });
}

// ── Match a saved campus to one of the main campuses ──────────
// Older preferences could hold a single site (e.g. "Milano Città Studi -
// Via Golgi 40"); the menu now lists only main campuses, so map those to the
// parent campus instead of losing the selection.
function matchCampusName(saved) {
    if (!saved) return null;
    if (CAMPUSES.includes(saved)) return saved;
    return CAMPUSES.find((name) => saved.startsWith(name + " - ")) || null;
}

// ── Apply loaded preferences to form ──────────────────────────
function applyPrefs(prefs) {
    console.log("Applying preferences:", prefs);
    if (prefs.lang) setSelectedLang(prefs.lang);
    const campus = matchCampusName(prefs.campus);
    if (campus) campusSelect.value = campus;
    if (prefs.duration >= 1 && prefs.duration <= 8) {
        durationSlider.value = prefs.duration;
    }
    updateDurationDisplay();
}

// ── Load saved preferences from Telegram CloudStorage ─────────
function loadPreferences() {
    const tg = window.Telegram && window.Telegram.WebApp;

    // Prefer Telegram CloudStorage (persists across Mini App sessions).
    // CloudStorage may be present as an object but throw synchronously on
    // unsupported WebApp versions (< 6.9) — guard with try/catch so a
    // failure can't abort init() and leave the slider/save button dead.
    if (tg && tg.CloudStorage) {
        console.log("Loading from Telegram CloudStorage...");
        try {
            tg.CloudStorage.getItem(STORAGE_KEY, function (err, value) {
                if (!err && value) {
                    try {
                        applyPrefs(JSON.parse(value));
                    } catch (e) {
                        console.warn("CloudStorage parse error:", e);
                        applyTelegramDefaultLang();
                        updateDurationDisplay();
                    }
                } else {
                    console.log("No CloudStorage data found");
                    applyTelegramDefaultLang();
                    loadFromLocalStorage();
                }
            });
        } catch (e) {
            console.warn("CloudStorage getItem unsupported, using localStorage:", e);
            applyTelegramDefaultLang();
            loadFromLocalStorage();
        }
    } else {
        // No CloudStorage → browser localStorage
        applyTelegramDefaultLang();
        loadFromLocalStorage();
    }
}

// ── Preselect language from Telegram user language_code ───────
function applyTelegramDefaultLang() {
    const tg = window.Telegram && window.Telegram.WebApp;
    const userLang =
        tg && tg.initDataUnsafe && tg.initDataUnsafe.user
            ? tg.initDataUnsafe.user.language_code
            : null;
    if (userLang && userLang.toLowerCase().startsWith("it")) {
        setSelectedLang("it");
    }
}

// ── Fallback: load from browser localStorage ──────────────────
function loadFromLocalStorage() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            console.log("Loaded from localStorage:", saved);
            applyPrefs(JSON.parse(saved));
        } else {
            console.log("No localStorage data found");
        }
    } catch (e) {
        console.warn("localStorage load failed:", e);
    }
}

// ── Save to persistent storage + send to bot + close ──────────
function savePreferences() {
    const lang = getSelectedLang();
    const campus = campusSelect.value;
    const duration = parseInt(durationSlider.value, 10);
    const t = I18N[lang] || I18N.en;

    if (!campus) {
        if (window.Telegram && window.Telegram.WebApp) {
            window.Telegram.WebApp.showAlert(t.selectCampusAlert);
        } else {
            window.alert(t.selectCampusAlert);
        }
        return;
    }

    const data = JSON.stringify({ lang, campus, duration });
    console.log("Saving preferences:", data);

    const tg = window.Telegram && window.Telegram.WebApp;

    // 1. Persist via Telegram CloudStorage (cross-session).
    //    Guard against synchronous throw on unsupported WebApp versions.
    if (tg && tg.CloudStorage) {
        try {
            tg.CloudStorage.setItem(STORAGE_KEY, data, function (err) {
                if (err) console.warn("CloudStorage save failed:", err);
                else console.log("CloudStorage save OK");
            });
        } catch (e) {
            console.warn("CloudStorage setItem unsupported:", e);
        }
    }

    // 2. Also save to localStorage as fallback
    try {
        localStorage.setItem(STORAGE_KEY, data);
        console.log("localStorage save OK");
    } catch (e) {
        console.warn("localStorage save failed:", e);
    }

    // 3. Send data to bot via Telegram WebApp API
    //    sendData() auto-closes the Mini App — no need to call close()
    if (tg) {
        tg.sendData(data);
        console.log("sendData() called — Mini App will close");
    } else {
        // Running outside Telegram (browser dev)
        console.log("Outside Telegram — data:", data);
        window.alert("Preferences saved (outside Telegram): " + data);
    }
}

// ── Update duration display + track fill + bubble position ────
function updateDurationDisplay() {
    const min = parseInt(durationSlider.min, 10);
    const max = parseInt(durationSlider.max, 10);
    const val = parseInt(durationSlider.value, 10);
    const pct = (val - min) / (max - min);

    durationValue.textContent = val + "h";
    // Track fill (left of thumb = primary) and bubble position are driven
    // purely by CSS using this fraction — no JS pixel math, so the bubble
    // stays aligned with the browser-positioned thumb across resize/font load.
    sliderEl.style.setProperty("--slider-fill", pct * 100 + "%");
    sliderEl.style.setProperty("--pct", String(pct));
}

// ── Apply Telegram theme ──────────────────────────────────────
function applyTheme() {
    if (window.Telegram && window.Telegram.WebApp) {
        document.documentElement.style.colorScheme =
            window.Telegram.WebApp.colorScheme;
    }
}

// ── Ripple effect for the save button ─────────────────────────
function attachRipple(el) {
    el.addEventListener("click", function (e) {
        const rect = el.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const ripple = document.createElement("span");
        ripple.className = "ripple";
        ripple.style.width = ripple.style.height = size + "px";
        ripple.style.left = e.clientX - rect.left - size / 2 + "px";
        ripple.style.top = e.clientY - rect.top - size / 2 + "px";
        el.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
    });
}

// ── Slider bubble: only visible while dragging ────────────────
function attachSliderDragBehavior() {
    const start = () => sliderEl.classList.add("is-dragging");
    const end = () => sliderEl.classList.remove("is-dragging");

    // Pointer events cover mouse/touch/stylus in modern WebViews.
    durationSlider.addEventListener("pointerdown", start);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);

    // Fallback for older WebViews without pointer events.
    durationSlider.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchend", end);
    durationSlider.addEventListener("mousedown", start);
    window.addEventListener("mouseup", end);
}

// ── Init ──────────────────────────────────────────────────────
function init() {
    console.log("Mini App initialized");
    populateCampuses();

    const tg = window.Telegram && window.Telegram.WebApp;

    if (tg) {
        console.log("Telegram WebApp API available — version:", tg.version);
        console.log("CloudStorage available:", !!tg.CloudStorage);
        console.log("DeviceStorage available:", !!tg.DeviceStorage);
        applyTheme();
        tg.ready();
        tg.expand();
        tg.onEvent("themeChanged", applyTheme);
    } else {
        console.log("Running outside Telegram — browser localStorage fallback");
    }

    // Default language before loading prefs (seg-btns need a selection)
    setSelectedLang("en");

    loadPreferences();

    // Align slider fill + value bubble to the initial input value, even
    // when no preferences are saved (applyPrefs only runs async on load).
    // Position is pure CSS (fraction-based), so this is layout-independent.
    updateDurationDisplay();

    durationSlider.addEventListener("input", updateDurationDisplay);
    attachSliderDragBehavior();
    saveBtn.addEventListener("click", savePreferences);
    attachRipple(saveBtn);

    // Recompute on resize / orientation change / full load (defensive)
    window.addEventListener("resize", updateDurationDisplay);
    window.addEventListener("load", updateDurationDisplay);
}

document.addEventListener("DOMContentLoaded", init);
