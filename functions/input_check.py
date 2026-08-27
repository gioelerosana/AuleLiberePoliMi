"""
Input validation functions for AuleLiberePoliMi bot.
"""
import pytz
from datetime import datetime, timedelta
from search.find_classrooms import MAX_TIME, MIN_TIME
from typing import Tuple


def location_check(message: str, location) -> bool:
    """Check if the location is in the location_dict"""
    return message in location


def day_check(message: str, texts, lang) -> Tuple[bool, str]:
    """Check if the input is a valid date (today, tomorrow, or dd/mm/yyyy)"""
    return_date = message
    current_date = datetime.now(pytz.timezone("Europe/Rome")).date()

    if message not in (texts[lang]["keyboards"]["today"], texts[lang]["keyboards"]["tomorrow"]):
        try:
            chosen_date = datetime.strptime(message, "%d/%m/%Y").date()
        except ValueError:
            return False, return_date
        if chosen_date < current_date or chosen_date > (current_date + timedelta(days=6)):
            return False, return_date
    else:
        if message == texts[lang]["keyboards"]["today"]:
            return_date = current_date.strftime("%d/%m/%Y")
        else:
            return_date = (current_date + timedelta(days=1)).strftime("%d/%m/%Y")

    return True, return_date


def start_time_check(message: str) -> Tuple[bool, int]:
    """Check if start_time is an integer and within valid range"""
    try:
        start_time = int(message)
    except (ValueError, TypeError):
        return False, 0

    if start_time >= MAX_TIME or start_time < MIN_TIME:
        return False, 0
    return True, start_time


def end_time_check(message: str, start_time: int) -> Tuple[bool, int]:
    """Check if end_time is an integer, > start_time, and <= MAX_TIME+1"""
    try:
        end_time = int(message)
    except (ValueError, TypeError):
        return False, 0

    if start_time is None or start_time >= end_time or end_time > MAX_TIME:
        return False, 0
    return True, end_time
