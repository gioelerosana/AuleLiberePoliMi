import unittest
from datetime import datetime, timedelta

import pytz

from functions import input_check


TEXTS = {
    "it": {"keyboards": {"today": "Oggi", "tomorrow": "Domani"}}
}


class InputCheckTests(unittest.TestCase):
    def test_time_boundaries_match_keyboards(self):
        self.assertEqual(input_check.start_time_check("8"), (True, 8))
        self.assertEqual(input_check.start_time_check("19"), (True, 19))
        self.assertEqual(input_check.start_time_check("20"), (False, 0))
        self.assertEqual(input_check.end_time_check("20", 19), (True, 20))
        self.assertEqual(input_check.end_time_check("21", 19), (False, 0))
        self.assertEqual(input_check.end_time_check("10", None), (False, 0))

    def test_relative_days(self):
        today = datetime.now(pytz.timezone("Europe/Rome")).date()
        self.assertEqual(
            input_check.day_check("Oggi", TEXTS, "it"),
            (True, today.strftime("%d/%m/%Y")),
        )
        self.assertEqual(
            input_check.day_check("Domani", TEXTS, "it"),
            (True, (today + timedelta(days=1)).strftime("%d/%m/%Y")),
        )

    def test_rejects_dates_outside_seven_day_window(self):
        today = datetime.now(pytz.timezone("Europe/Rome")).date()
        too_late = (today + timedelta(days=7)).strftime("%d/%m/%Y")
        self.assertEqual(input_check.day_check(too_late, TEXTS, "it")[0], False)


if __name__ == "__main__":
    unittest.main()
