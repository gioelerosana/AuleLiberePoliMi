import unittest

import bot


class PreferenceValidationTests(unittest.TestCase):
    def test_accepts_known_preferences_and_drops_extra_fields(self):
        payload = {
            "lang": "it",
            "campus": "Milano Città Studi",
            "duration": 2,
            "ignored": "value",
        }
        self.assertEqual(
            bot.validate_preferences(payload),
            {
                "lang": "it",
                "campus": "Milano Città Studi",
                "duration": 2,
            },
        )

    def test_rejects_invalid_payloads(self):
        invalid = [
            [],
            {"lang": "de", "campus": "Milano Città Studi", "duration": 2},
            {"lang": "it", "campus": "Atlantide", "duration": 2},
            {"lang": "it", "campus": "Milano Città Studi", "duration": "2"},
            {"lang": "it", "campus": "Milano Città Studi", "duration": 9},
        ]
        for payload in invalid:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                bot.validate_preferences(payload)


if __name__ == "__main__":
    unittest.main()
