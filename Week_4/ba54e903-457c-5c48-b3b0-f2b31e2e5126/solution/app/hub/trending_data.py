"""The trending chart: five games ranked across three weeks (plain data; community counts are read live)."""

from __future__ import annotations

GAMES: dict[str, dict] = {
    "nova-drift": {"name": "Nova Drift Arena", "categories": ["shooter", "adventure"], "community_slug": "aurora-collective",
                   "description": "Pilot a glider through neon storms in squad-based arena rounds."},
    "ronin-tactics": {"name": "Ronin Tactics", "categories": ["rpg", "fantasy"], "community_slug": "ronin-guild",
                      "description": "Turn-based duels across a floating archipelago of rival clans."},
    "echo-gardens": {"name": "Echo Gardens", "categories": ["indie", "simulation"], "community_slug": "starlight-studio",
                     "description": "Grow a garden that sings back, one patient season at a time."},
    "tidal-rally": {"name": "Tidal Rally", "categories": ["simulation"], "community_slug": "pixel-parlor",
                    "description": "Race amphibious buggies across coastlines that change with the tide."},
    "lumen-siege": {"name": "Lumen Siege", "categories": ["fantasy", "rpg"], "community_slug": "ronin-guild",
                    "description": "Hold a lantern city against the dark with a party of four."},
}

CATEGORIES = ("all", "adventure", "indie", "simulation", "rpg", "shooter", "fantasy")

# Each week lists its games in rank order as (slug, plays change %, streams change %).
RANKINGS: dict[str, list[tuple[str, int, int]]] = {
    "2026-10-19": [("nova-drift", 42, 18), ("ronin-tactics", 31, 22), ("echo-gardens", 27, 12),
                   ("tidal-rally", 19, 9), ("lumen-siege", 14, -4)],
    "2026-10-12": [("ronin-tactics", 36, 21), ("nova-drift", 28, 11), ("tidal-rally", 14, 6),
                   ("echo-gardens", -6, -2), ("lumen-siege", 9, 4)],
    "2026-10-05": [("echo-gardens", 31, 12), ("ronin-tactics", 24, 9), ("nova-drift", 19, 15),
                   ("lumen-siege", 8, -3), ("tidal-rally", 5, 2)],
}

WEEKS: list[str] = sorted(RANKINGS, reverse=True)
