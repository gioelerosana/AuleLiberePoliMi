import json
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

URL = "https://onlineservices.polimi.it/spazi/spazi/controller/OccupazioniGiornoEsatto.do"
BASE_URL = "https://onlineservices.polimi.it/spazi/spazi/controller/"
BUILDING = 'innerEdificio'
ROOM = 'dove'
LECTURE = 'slot'
TIME_SHIFT = 0.25
MIN_TIME = 8
MAX_TIME = 20

GARBAGE = {"PROVA_ASICT", "2.2.1-D.I."}
REQUEST_TIMEOUT = 20
POWER_ROOMS_PATH = Path(__file__).resolve().parents[1] / "json" / "roomsWithPower.json"


"""
Clean the dict with all the class occupancies from rooms that don't exists or are unreacheable
"""
def clean_data(infos):
    for rooms in infos.values():
        for room in GARBAGE:
            rooms.pop(room, None)

    return infos


"""
Return a dict with all the info about the classrooms for the chosen day , 
the function makes a get requests to the URL and then 
build a dict with the classes information stored on the html table (the code may not be perfect 🥲)
"""

def find_classrooms(location, day, month, year):
    info = {}
    building_name = "-"
    info[building_name] = {}

    params = {
        "csic": location,
        "categoria": "tutte",
        "tipologia": "tutte",
        "giorno_day": day,
        "giorno_month": month,
        "giorno_year": year,
        "jaf_giorno_date_format": "dd/MM/yyyy",
        "evn_visualizza": "",
    }
    response = requests.get(URL, params=params, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "lxml")
    table_container = soup.find("div", {"id": "tableContainer"})
    if table_container is None:
        return {}
    # Do not drop a fixed number of rows: the first building header is near
    # the top of the table and the upstream layout can add/remove header rows.
    table_rows = table_container.find_all("tr")

    with POWER_ROOMS_PATH.open(encoding="utf-8") as power_rooms_file:
        rooms_with_power = set(json.load(power_rooms_file))

    for row in table_rows:
        cells = row.find_all("td")
        if not cells:
            continue

        if "class" not in row.attrs:
            if BUILDING in cells[0].get("class", []):
                raw_name = cells[0].get_text(" ", strip=True)
                parts = raw_name.split("-", 2)
                building_name = (parts[2] if len(parts) == 3 else raw_name).strip()
                info.setdefault(building_name, {})
        else:
            room = ""
            time = 7.75
            for cell in cells:
                classes = cell.get("class", [])
                if ROOM in classes:
                    a_tag = cell.find("a")
                    if a_tag is None:
                        continue
                    room = a_tag.get_text(strip=True).replace(" ", "")
                    link = a_tag.get("href", "")
                    try:
                        room_id = int(link.rsplit("=", 1)[-1])
                    except ValueError:
                        room_id = -1

                    building_rooms = info.setdefault(building_name, {})
                    building_rooms.setdefault(
                        room,
                        {
                            "link": urljoin(BASE_URL, link),
                            "lessons": [],
                            "powerPlugs": room_id in rooms_with_power,
                        },
                    )

                elif LECTURE in classes and room:
                    duration = int(cell.get("colspan", 1))
                    lesson_link = cell.find("a")
                    lesson_name = (
                        lesson_link.get_text(" ", strip=True)
                        if lesson_link
                        else "Occupata"
                    )
                    lesson = {"name": lesson_name, "from": time}
                    time += duration / 4
                    lesson["to"] = time
                    info[building_name][room]["lessons"].append(lesson)
                else:
                    time += TIME_SHIFT

    if not info.get("-"):
        info.pop("-", None)
    return clean_data(info)




if __name__ == "__main__":
    infos =  find_classrooms('MIA' , 25 , 10 , 2021)
    with open('json/infos_a.json' , 'w') as outfile:
        json.dump(infos , outfile, indent=3)
