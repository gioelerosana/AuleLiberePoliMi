#!/usr/bin/env python3
"""
AuleLiberePoliMi Bot — Telegram bot to find free classrooms at PoliMi.

Rewrite for PTB v22+, stateless, with Mini App support.
Original bot by Daniele Ferrazzo (2021). Adapted and maintained by Joel Shepard (2026).
"""
import asyncio
import json
import logging
import os
import re
import pytz
from os.path import join, dirname
from dotenv import load_dotenv
from datetime import datetime, timedelta

from telegram import Update, ReplyKeyboardMarkup, ReplyKeyboardRemove
from telegram.constants import ParseMode, ChatAction
from telegram.ext import (
    Application,
    CommandHandler,
    ConversationHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from search.free_classroom import find_free_room
from search.find_classrooms import TIME_SHIFT, MAX_TIME, MIN_TIME
from functions import errorhandler, string_builder, input_check, keyboard_builder

# ── Paths & environment ────────────────────────────────────────────
DIRPATH = dirname(__file__)
dotenv_path = join(DIRPATH, ".env")
load_dotenv(dotenv_path)

# ── Logging: solo stdout ───────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler()],
)
logging.getLogger("httpx").setLevel(logging.WARNING)

# ── Load static data (shipped in Docker image) ─────────────────────
location_dict = {}
with open(join(DIRPATH, "json", "location.json")) as f:
    location_dict = json.load(f)

texts = {}
for lang_file in os.listdir(join(DIRPATH, "json", "lang")):
    with open(join(DIRPATH, "json", "lang", lang_file)) as f:
        texts[lang_file[:2]] = json.load(f)

# ── Build cross-language command maps ──────────────────────────────
# _label_to_handler: user-facing label → handler name (search/now/preferences/info)
_label_to_handler: dict[str, str] = {}
# _cancel_aliases: set of all cancel labels across languages
_cancel_aliases: set[str] = set()
# _today_aliases / _tomorrow_aliases: for date regex
_today_aliases: set[str] = set()
_tomorrow_aliases: set[str] = set()

for lang in texts:
    kb = texts[lang]["keyboards"]
    _cancel_aliases.add(kb["cancel"])
    _today_aliases.add(kb["today"])
    _tomorrow_aliases.add(kb["tomorrow"])
    for key in ("search", "now", "preferences", "info"):
        if key not in _label_to_handler:
            # First mapping: handler_name → list of labels
            pass

# Rebuild properly: map each label to its handler name
# command_keys is a dict: logical_key → [list of translated labels]
command_keys: dict[str, list[str]] = {}
for lang in texts:
    for key, label in texts[lang]["keyboards"].items():
        if key not in ("cancel", "today", "tomorrow"):
            command_keys.setdefault(key, []).append(label)

for key, labels in command_keys.items():
    # NOTE: "preferences" is NOT added to _label_to_handler
    # because it's now a KeyboardButton with web_app type.
    # Tapping it opens the Mini App directly — the bot never sees a text message.
    # (If someone types the label manually, it won't match the regex.)
    if key in ("search", "now", "info"):
        for label in labels:
            _label_to_handler[label] = key

# ── Regex patterns ─────────────────────────────────────────────────
# Cancel regex: matches any cancel alias
_cancel_regex = "^(" + "|".join(re.escape(a) for a in _cancel_aliases) + ")$"

# Initial state regex: matches search/now/preferences/info in any language
_initial_regex = "^(" + "|".join(
    re.escape(l) for l, h in _label_to_handler.items()
) + ")$"

# Date regex components
_date_format_regex = r"^([0]?[1-9]|[1|2][0-9]|[3][0|1])[./-]([0]?[1-9]|[1][0-2])[./-]([0-9]{4}|[0-9]{2})$"
_today_regex = "^(" + "|".join(re.escape(a) for a in _today_aliases) + ")$"
_tomorrow_regex = "^(" + "|".join(re.escape(a) for a in _tomorrow_aliases) + ")$"
# Combined: day accepts either date format OR today OR tomorrow
_day_regex = f"({_date_format_regex})|({_today_regex})|({_tomorrow_regex})"

# ── Bot config ────────────────────────────────────────────────────
TOKEN = os.environ.get("TOKEN")
WEBAPP_URL = os.environ.get(
    "WEBAPP_URL", "https://aule-libere-polimi-settings.pages.dev"
)

# ── Keyboard builder ───────────────────────────────────────────────
KEYBOARDS = keyboard_builder.KeyboadBuilder(texts, location_dict, WEBAPP_URL)

# ── Conversation states ────────────────────────────────────────────
(
    INITIAL_STATE,
    SET_LOCATION,
    SET_DAY,
    SET_START_TIME,
    SET_END_AND_SEND,
) = range(5)


# ══════════════════════════════════════════════════════════════════
#  HELPERS
# ══════════════════════════════════════════════════════════════════
def get_lang(update: Update, context: ContextTypes.DEFAULT_TYPE = None) -> str:
    """Get user's language from Mini App preferences or Telegram language_code."""
    prefs = context.user_data.get("preferences", {}) if context else {}
    pref_lang = prefs.get("lang")
    if pref_lang and pref_lang in texts:
        return pref_lang
    user = update.effective_user
    if user and user.language_code and user.language_code in texts:
        return user.language_code
    return "en"


def get_preferences(context: ContextTypes.DEFAULT_TYPE) -> dict:
    """Get ephemeral Mini App preferences from session (empty dict if none)."""
    return context.user_data.get("preferences", {})


def validate_preferences(data: object) -> dict:
    """Validate and normalize the Mini App payload before using it."""
    if not isinstance(data, dict):
        raise ValueError("preferences must be a JSON object")

    lang = data.get("lang")
    campus = data.get("campus")
    duration = data.get("duration")
    if lang not in texts:
        raise ValueError("unsupported language")
    if campus not in location_dict:
        raise ValueError("unknown campus")
    if isinstance(duration, bool) or not isinstance(duration, int):
        raise ValueError("duration must be an integer")
    if not 1 <= duration <= 8:
        raise ValueError("duration must be between 1 and 8")

    return {"lang": lang, "campus": campus, "duration": duration}


# ══════════════════════════════════════════════════════════════════
#  WEB APP DATA HANDLER (outside ConversationHandler)
# ══════════════════════════════════════════════════════════════════
async def handle_web_app_data(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    """
    Receive preferences from Telegram Mini App.
    Stored ephemerally in context.user_data — lost on bot restart.

    On save we re-send the main menu keyboard in the newly chosen
    language so the interface buttons update immediately — no /start
    needed. This handler is registered before the ConversationHandler
    and only matches WEB_APP_DATA (not TEXT), so it never disturbs the
    conversation state; the ⚙️ button is reachable only from the main
    menu, so the user is effectively at INITIAL_STATE.
    """
    web_app_data = update.effective_message.web_app_data
    if not web_app_data:
        return

    try:
        preferences = validate_preferences(json.loads(web_app_data.data))
        context.user_data["preferences"] = preferences

        pref_lang = preferences.get("lang")
        lang = pref_lang if pref_lang in texts else get_lang(update, context)

        # Re-send the main menu so the ReplyKeyboard buttons reflect the
        # new language right away.
        keyboard = KEYBOARDS.initial_keyboard(lang)
        await update.message.reply_text(
            texts[lang]["texts"].get("success", "✅ Preferences saved!"),
            reply_markup=ReplyKeyboardMarkup(keyboard),
        )
        logging.info(
            "Preferences saved for %s: %s",
            update.effective_user.username if update.effective_user else "unknown",
            preferences,
        )
    except (json.JSONDecodeError, TypeError, ValueError) as e:
        lang = get_lang(update, context)
        logging.warning("Invalid web_app_data: %s", e)
        await update.message.reply_text(
            texts[lang]["texts"].get(
                "invalid_preferences", "❌ Invalid preferences received."
            )
        )


# ══════════════════════════════════════════════════════════════════
#  CONVERSATION HANDLERS
# ══════════════════════════════════════════════════════════════════

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Welcome message and main menu."""
    lang = get_lang(update, context)
    user = update.effective_user
    keyboard = KEYBOARDS.initial_keyboard(lang)

    logging.info(
        "%s (%d) started conversation",
        user.username if user else "unknown",
        user.id if user else 0,
    )

    await update.message.reply_text(
        texts[lang]["texts"]["welcome"].format(
            user.first_name if user else ""
        ),
        disable_web_page_preview=True,
        parse_mode=ParseMode.HTML,
        reply_markup=ReplyKeyboardMarkup(keyboard),
    )
    return INITIAL_STATE


async def initial_state(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Route user's main-menu choice to the right handler."""
    message = update.message.text
    lang = get_lang(update, context)

    handler_name = _label_to_handler.get(message)

    if handler_name == "search":
        await update.message.reply_text(
            texts[lang]["texts"]["location"],
            reply_markup=ReplyKeyboardMarkup(
                KEYBOARDS.location_keyboard(lang), one_time_keyboard=True
            ),
        )
        return SET_LOCATION

    elif handler_name == "now":
        return await _cmd_now(update, context, lang)

    elif handler_name == "info":
        user = update.effective_user
        logging.info(
            "%d : %s asked for info",
            user.id if user else 0,
            user.username if user else "unknown",
        )
        keyboard = KEYBOARDS.initial_keyboard(lang)
        await update.message.reply_text(
            texts[lang]["texts"]["info"],
            parse_mode=ParseMode.HTML,
            reply_markup=ReplyKeyboardMarkup(keyboard),
        )
        return INITIAL_STATE

    # Shouldn't reach here if regex works, but just in case
    await errorhandler.bonk(update, texts, lang)
    return INITIAL_STATE


async def _cmd_now(update: Update, context: ContextTypes.DEFAULT_TYPE, lang: str) -> int:
    """
    Quick search "Ora".
    If Mini App preferences exist in session → use them.
    Otherwise → ask user to set preferences via Mini App.
    """
    user = update.effective_user
    logging.info(
        "%d : %s in now",
        user.id if user else 0,
        user.username if user else "unknown",
    )

    prefs = get_preferences(context)
    campus = prefs.get("campus")
    duration = prefs.get("duration", 2)

    if not campus:
        # Show main keyboard — ⚙️Preferenze button is now a Web App button
        keyboard = KEYBOARDS.initial_keyboard(lang)
        await update.message.reply_text(
            texts[lang]["texts"].get(
                "missing",
                "Set your preferences first via the ⚙️ button in the menu!",
            ),
            reply_markup=ReplyKeyboardMarkup(keyboard),
        )
        return INITIAL_STATE

    # Do quick search. Outside opening hours, use the next useful opening.
    now = datetime.now(pytz.timezone("Europe/Rome"))
    start_hour = int(now.strftime("%H"))

    if start_hour < MIN_TIME:
        await update.message.reply_text(texts[lang]["texts"]["ops"])
        start_hour = MIN_TIME
    elif start_hour >= MAX_TIME:
        await update.message.reply_text(texts[lang]["texts"]["ops"])
        now += timedelta(days=1)
        start_hour = MIN_TIME

    end_hour = start_hour + duration
    if end_hour > MAX_TIME:
        end_hour = MAX_TIME

    return await _perform_search(
        update, context, lang, campus, now.strftime("%d/%m/%Y"), start_hour, end_hour
    )


# ── Search-flow state handlers ─────────────────────────────────────
async def set_location_state(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> int:
    """Save chosen campus and ask for day."""
    message = update.message.text
    lang = get_lang(update, context)

    if not input_check.location_check(message, location_dict):
        await errorhandler.bonk(update, texts, lang)
        return SET_LOCATION

    context.user_data["location"] = message
    await update.message.reply_text(
        texts[lang]["texts"]["day"],
        reply_markup=ReplyKeyboardMarkup(
            KEYBOARDS.day_keyboard(lang), one_time_keyboard=True
        ),
    )
    return SET_DAY


async def set_day_state(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> int:
    """Save chosen day and ask for start time."""
    message = update.message.text
    lang = get_lang(update, context)

    ok, chosen_date = input_check.day_check(message, texts, lang)
    if not ok:
        await errorhandler.bonk(update, texts, lang)
        return SET_DAY

    context.user_data["date"] = chosen_date
    await update.message.reply_text(
        texts[lang]["texts"]["starting_time"],
        reply_markup=ReplyKeyboardMarkup(
            KEYBOARDS.start_time_keyboard(lang), one_time_keyboard=True
        ),
    )
    return SET_START_TIME


async def set_start_time_state(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> int:
    """Save start time and ask for end time."""
    message = update.message.text
    lang = get_lang(update, context)

    ok, start_time = input_check.start_time_check(message)
    if not ok:
        await errorhandler.bonk(update, texts, lang)
        return SET_START_TIME

    context.user_data["start_time"] = start_time
    await update.message.reply_text(
        texts[lang]["texts"]["ending_time"],
        reply_markup=ReplyKeyboardMarkup(
            KEYBOARDS.end_time_keyboard(lang, start_time), one_time_keyboard=True
        ),
    )
    return SET_END_AND_SEND


async def end_state(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> int:
    """Validate end time, execute search, show results."""
    message = update.message.text
    lang = get_lang(update, context)

    start_time = context.user_data.get("start_time")
    date = context.user_data.get("date")
    location = context.user_data.get("location")

    ok, end_time = input_check.end_time_check(message, start_time)
    if not ok:
        await errorhandler.bonk(update, texts, lang)
        return SET_END_AND_SEND

    return await _perform_search(
        update, context, lang, location, date, start_time, end_time
    )


# ── Shared search executor ─────────────────────────────────────────
async def _perform_search(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    lang: str,
    location: str,
    date: str,
    start_time: int,
    end_time: int,
) -> int:
    """Query PoliMi website and send formatted results to user."""
    user = update.effective_user
    keyboard = KEYBOARDS.initial_keyboard(lang)

    logging.info(
        "%d : %s search — %s %s %d-%d",
        user.id if user else 0,
        user.username if user else "unknown",
        location,
        date,
        start_time,
        end_time,
    )

    day, month, year = date.split("/")

    try:
        available_rooms = await asyncio.to_thread(
            find_free_room,
            float(start_time + TIME_SHIFT),
            float(end_time + TIME_SHIFT),
            location_dict[location],
            int(day),
            int(month),
            int(year),
        )

        await update.message.reply_text(
            "{}  {}  {}-{}".format(date, location, start_time, end_time)
        )

        result_messages = string_builder.room_builder_str(
            available_rooms, texts[lang]["texts"]["until"]
        )
        if not result_messages:
            result_messages = [texts[lang]["texts"]["no_rooms"]]

        for msg in result_messages:
            await update.message.reply_chat_action(ChatAction.TYPING)
            await update.message.reply_text(
                msg,
                parse_mode=ParseMode.HTML,
                reply_markup=ReplyKeyboardMarkup(keyboard),
            )

    except Exception as e:
        logging.exception(
            "Search exception: %s %s %d-%d", date, location, start_time, end_time
        )
        await update.message.reply_text(
            texts[lang]["texts"]["exception"],
            parse_mode=ParseMode.HTML,
            reply_markup=ReplyKeyboardMarkup(keyboard),
            disable_web_page_preview=True,
        )

    return INITIAL_STATE


# ── Fallbacks ──────────────────────────────────────────────────────
async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Cancel current operation and return to initial state."""
    lang = get_lang(update, context)
    keyboard = KEYBOARDS.initial_keyboard(lang)
    logging.info(
        "%s canceled operation",
        update.effective_user.username if update.effective_user else "unknown",
    )
    await update.message.reply_text(
        texts[lang]["texts"]["cancel"],
        parse_mode=ParseMode.HTML,
        reply_markup=ReplyKeyboardMarkup(keyboard),
    )
    return INITIAL_STATE


async def terminate(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """End the conversation entirely."""
    lang = get_lang(update, context)
    context.user_data.clear()
    logging.info(
        "%s terminated conversation",
        update.effective_user.username if update.effective_user else "unknown",
    )
    await update.message.reply_text(
        texts[lang]["texts"]["terminate"],
        reply_markup=ReplyKeyboardRemove(),
    )
    return ConversationHandler.END


async def info_fallback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """
    Info handler reachable from any state (fallback).
    Shows info and returns to the same state (or initial).
    """
    lang = get_lang(update, context)
    keyboard = KEYBOARDS.initial_keyboard(lang)
    await update.message.reply_text(
        texts[lang]["texts"]["info"],
        parse_mode=ParseMode.HTML,
        reply_markup=ReplyKeyboardMarkup(keyboard),
    )
    return INITIAL_STATE


# ══════════════════════════════════════════════════════════════════
#  BOT INITIALISATION
# ══════════════════════════════════════════════════════════════════
def build_info_regex() -> str:
    """Build regex matching 'info' in all languages."""
    patterns = [re.escape(l) for l, h in _label_to_handler.items() if h == "info"]
    if not patterns:
        return r"^$"  # never match
    return "^(" + "|".join(patterns) + ")$"


def main() -> None:
    """Build, configure and start the bot."""
    if not TOKEN:
        raise RuntimeError("TOKEN environment variable is required")

    application = Application.builder().token(TOKEN).build()

    # ── 1. Web App data handler (before ConversationHandler) ────
    application.add_handler(
        MessageHandler(filters.StatusUpdate.WEB_APP_DATA, handle_web_app_data)
    )

    # ── 2. Conversation handler ─────────────────────────────────
    info_regex = build_info_regex()

    conv_handler = ConversationHandler(
        entry_points=[
            CommandHandler("start", start),
            # Keep reply-keyboard buttons usable after a process restart,
            # when ConversationHandler has no in-memory state for the user.
            MessageHandler(filters.Regex(_initial_regex), initial_state),
        ],
        states={
            INITIAL_STATE: [
                MessageHandler(
                    filters.Regex(_initial_regex),
                    initial_state,
                )
            ],
            SET_LOCATION: [
                MessageHandler(
                    filters.TEXT & ~filters.COMMAND,
                    set_location_state,
                )
            ],
            SET_DAY: [
                MessageHandler(
                    filters.Regex(_day_regex),
                    set_day_state,
                )
            ],
            SET_START_TIME: [
                MessageHandler(
                    filters.TEXT & ~filters.COMMAND,
                    set_start_time_state,
                )
            ],
            SET_END_AND_SEND: [
                MessageHandler(
                    filters.TEXT & ~filters.COMMAND,
                    end_state,
                )
            ],
        },
        fallbacks=[
            CommandHandler("terminate", terminate),
            CommandHandler("cancel", cancel),
            # Text-based cancel (/Back, /Indietro, etc.)
            MessageHandler(filters.Regex(_cancel_regex), cancel),
            # Info from any state
            MessageHandler(filters.Regex(info_regex), info_fallback),
        ],
        allow_reentry=True,
    )

    application.add_handler(conv_handler)

    # ── 3. Error handler ────────────────────────────────────────
    application.add_error_handler(errorhandler.error_handler)

    # ── Start polling ───────────────────────────────────────────
    logging.info("Bot starting — polling mode")
    application.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
