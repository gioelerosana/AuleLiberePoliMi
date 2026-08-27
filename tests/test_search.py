import unittest
from unittest.mock import Mock, patch

from search.find_classrooms import REQUEST_TIMEOUT, find_classrooms
from search.free_classroom import _is_room_free


class FreeRoomTests(unittest.TestCase):
    def test_overlap_and_adjacent_lessons(self):
        lessons = [{"from": 10.0, "to": 11.0}]
        self.assertEqual(_is_room_free(lessons, 9.0, 10.0), (True, 10.0))
        self.assertEqual(_is_room_free(lessons, 10.0, 11.0), (False, None))
        self.assertEqual(_is_room_free(lessons, 11.0, 12.0), (True, 20))

    def test_uses_earliest_future_lesson_even_if_unsorted(self):
        lessons = [
            {"from": 14.0, "to": 15.0},
            {"from": 12.0, "to": 13.0},
        ]
        self.assertEqual(_is_room_free(lessons, 9.0, 10.0), (True, 12.0))


class ScraperTests(unittest.TestCase):
    @patch("search.find_classrooms.requests.get")
    def test_keeps_first_building_header_and_parses_room(self, get):
        response = Mock()
        response.text = """
            <div id="tableContainer"><table>
              <tr class="normalRow"></tr>
              <tr><td class="innerEdificio">
                Milano Città Studi - Piazza Leonardo da Vinci 32 - Edificio 2 - Piano Terra
              </td></tr>
              <tr><td class="innerDataDove">Data</td></tr>
              <tr class="normalRow">
                <td class="data"></td>
                <td class="dove"><a href="DettaglioAula.do?idaula=123">2.0.1</a></td>
                <td class="slot" colspan="4"><a>Lezione</a></td>
              </tr>
            </table></div>
        """
        get.return_value = response

        result = find_classrooms("MIA", 27, 8, 2026)

        self.assertNotIn("-", result)
        room = result["Edificio 2 - Piano Terra"]["2.0.1"]
        self.assertEqual(room["lessons"], [{"name": "Lezione", "from": 8.0, "to": 9.0}])
        response.raise_for_status.assert_called_once_with()

    @patch("search.find_classrooms.requests.get")
    def test_http_errors_are_not_silently_parsed(self, get):
        response = Mock()
        response.raise_for_status.side_effect = RuntimeError("upstream error")
        get.return_value = response

        with self.assertRaisesRegex(RuntimeError, "upstream error"):
            find_classrooms("MIA", 27, 8, 2026)

        self.assertEqual(get.call_args.kwargs["timeout"], REQUEST_TIMEOUT)


if __name__ == "__main__":
    unittest.main()
