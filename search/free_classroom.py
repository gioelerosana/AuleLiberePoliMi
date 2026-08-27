from collections import defaultdict

from .find_classrooms import MAX_TIME, find_classrooms


def _is_room_free(lessons, starting_time, ending_time):
    """Return whether the room is free and the next occupation start time."""
    until = MAX_TIME

    for lesson in sorted(lessons, key=lambda item: float(item["from"])):
        start = float(lesson["from"])
        end = float(lesson["to"])

        if start < ending_time and end > starting_time:
            return False, None
        if start >= ending_time:
            until = min(until, start)

    return True, until


def find_free_room(starting_time, ending_time, location, day, month, year):
    free_rooms = defaultdict(list)
    infos = find_classrooms(location , day , month , year)

    for building in infos:
        for room in infos[building]:
            lessons = infos[building][room]["lessons"]
            free, until = _is_room_free(lessons, starting_time, ending_time)
            if free:
                room_info = {
                    "name": room,
                    "link": infos[building][room]["link"],
                    "until": until,
                    "powerPlugs": infos[building][room]["powerPlugs"],
                }

                free_rooms[building].append(room_info)

    return free_rooms
