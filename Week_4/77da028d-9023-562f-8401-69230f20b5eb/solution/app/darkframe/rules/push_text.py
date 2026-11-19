"""Push titles and messages, decided once."""
from datetime import date

from darkframe.rules.rounding import share_grid_text

REMINDER_TITLE = "Darkframe: new-moon weekend"
GO_MINUTES = 60


def verdict_title(verdict: str, observing: date) -> str:
    return f"Darkframe: {verdict} for {observing.isoformat()}"


def site_phrase(label: str, latitude: float, longitude: float) -> str:
    return f"{label} near {share_grid_text(latitude)}, {share_grid_text(longitude)}"


def verdict_message(verdict: str, label: str, latitude: float, longitude: float, best: dict | None,
                    window: dict | None) -> str:
    where = site_phrase(label, latitude, longitude)
    if verdict == "go":
        return (f"{where}: {best['target_name']} in {best['filter']}, clear window "
                f"{window['start'][11:16]}-{window['end'][11:16]}, {best['usable_minutes']} usable minutes.")
    return f"{where}: no clear window of {GO_MINUTES} minutes."


def reminder_message(new_moon_local_date: str, weekend_saturday: str, label: str) -> str:
    return f"New Moon {new_moon_local_date}. Dark weekend from {label} starts Saturday {weekend_saturday}."
