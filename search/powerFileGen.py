import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

URL = "https://onlineservices.polimi.it/spazi/spazi/controller/RicercaAula.do?spazi___model___formbean___RicercaAvanzataAuleVO___postBack=true&spazi___model___formbean___RicercaAvanzataAuleVO___formMode=FILTER&spazi___model___formbean___RicercaAvanzataAuleVO___sede=tutte&spazi___model___formbean___RicercaAvanzataAuleVO___sigla=&spazi___model___formbean___RicercaAvanzataAuleVO___categoriaScelta=tutte&spazi___model___formbean___RicercaAvanzataAuleVO___tipologiaScelta=tutte&spazi___model___formbean___RicercaAvanzataAuleVO___iddipScelto=tutti&spazi___model___formbean___RicercaAvanzataAuleVO___soloPreseElettriche=S&spazi___model___formbean___RicercaAvanzataAuleVO___soloPreseElettriche_default=N&spazi___model___formbean___RicercaAvanzataAuleVO___soloPreseDiRete_default=N&evn_ricerca_avanzata=Ricerca aula"

"""
Since having to call poli for each room every time to check if there are power outlets takes a lot of time
the idea is to create this little script that does it once and generates a json file
that can be opened and checked by the bot in constant time. Of course this won't be updated live but
we don't add and remove power outlets to rooms every day, so launching this script every now and then is more than fine.
"""

OUTPUT_PATH = Path(__file__).resolve().parents[1] / "json" / "roomsWithPower.json"


def generate_power_rooms() -> list[int]:
    response = requests.get(URL, timeout=30)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "lxml")
    table_container = soup.find("tbody", {"class": "TableDati-tbody"})
    if table_container is None:
        raise RuntimeError("PoliMi power-room table not found")

    room_ids = []
    for row in table_container.find_all("tr"):
        cells = row.find_all("td")
        if len(cells) < 3 or cells[2].find("a") is None:
            continue
        match = re.search(r"idaula=(\d+)(?:&|$)", cells[2].find("a").get("href", ""))
        if match:
            room_ids.append(int(match.group(1)))
    return room_ids


def main() -> None:
    with OUTPUT_PATH.open("w", encoding="utf-8") as output_file:
        json.dump(generate_power_rooms(), output_file, indent=3)
        output_file.write("\n")


if __name__ == "__main__":
    main()
