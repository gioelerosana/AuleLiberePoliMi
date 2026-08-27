import unittest

from functions.string_builder import MAX_MESSAGE_LENGTH, room_builder_str


class StringBuilderTests(unittest.TestCase):
    def test_empty_results_produce_no_empty_telegram_message(self):
        self.assertEqual(room_builder_str({}, "fino alle"), [])

    def test_escapes_external_html(self):
        rooms = {
            "Edificio <2>": [
                {
                    "name": "A&<1>",
                    "link": 'https://example.test/?x=1&y="2"',
                    "until": 12,
                    "powerPlugs": True,
                }
            ]
        }
        result = room_builder_str(rooms, "fino alle")
        self.assertEqual(len(result), 1)
        self.assertIn("Edificio &lt;2&gt;", result[0])
        self.assertIn("A&amp;&lt;1&gt;", result[0])
        self.assertNotIn("Edificio <2>", result[0])

    def test_splits_large_results_within_telegram_limit(self):
        rooms = {
            "Edificio": [
                {
                    "name": f"Aula-{index:04d}-" + "x" * 40,
                    "link": "https://example.test/room",
                    "until": 20,
                    "powerPlugs": False,
                }
                for index in range(200)
            ]
        }
        result = room_builder_str(rooms, "free until")
        self.assertGreater(len(result), 1)
        self.assertTrue(all(0 < len(message) <= MAX_MESSAGE_LENGTH for message in result))
        self.assertTrue(all("<b>Edificio</b>" in message for message in result))


if __name__ == "__main__":
    unittest.main()
