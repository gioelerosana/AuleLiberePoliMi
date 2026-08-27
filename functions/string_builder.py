"""
String builder for formatting classroom search results.
"""
import html

from telegram.constants import MessageLimit

MAX_MESSAGE_LENGTH = MessageLimit.MAX_TEXT_LENGTH


def room_builder_str(available_rooms, until):
    """
    Parse the list of available classrooms into multiple strings
    to not exceed Telegram's message length limit.
    """
    messages = []
    current = ""

    for building, rooms in available_rooms.items():
        header = f"\n<b>{html.escape(str(building))}</b>\n"
        for index, room in enumerate(rooms):
            emoji = "🔌" if room["powerPlugs"] else ""
            line = ' <a href="{}">{}</a> ({} {}) {}\n'.format(
                html.escape(str(room["link"]), quote=True),
                html.escape(str(room["name"])),
                html.escape(str(until)),
                room["until"],
                emoji,
            )
            prefix = header if index == 0 else ""
            addition = prefix + line
            if current and len(current) + len(addition) > MAX_MESSAGE_LENGTH:
                messages.append(current)
                current = header + line
            else:
                current += addition

    if current:
        messages.append(current)
    return messages
