"""Every state machine's edges, decided once. Messages follow `A <noun> that is <from> cannot become <to>.`"""
from darkframe.rules.errors import ApiFault, conflict

PROJECT_EDGES = frozenset({
    ("draft", "active"), ("draft", "archived"), ("active", "paused"),
    ("paused", "active"), ("active", "complete"), ("complete", "archived"),
})
PROJECT_CLOSED_STATES = frozenset({"complete", "archived"})
PROJECT_TARGET_STATES = ("active", "paused", "complete", "archived")

SESSION_EDGES = frozenset({
    ("planned", "imaging"), ("imaging", "logged"), ("logged", "amended"), ("amended", "amended"),
    ("planned", "trashed"), ("logged", "trashed"), ("amended", "trashed"),
})
SESSION_LEDGER_STATES = frozenset({"logged", "amended"})
SESSION_FRAME_STATES = frozenset({"imaging", "logged", "amended"})

CALIBRATION_EDGES = frozenset({("building", "ready"), ("building", "retired"), ("ready", "retired")})
CALIBRATION_TARGETS = ("ready", "retired")


def refuse_edge(noun: str, edges: frozenset[tuple[str, str]], current: str, target: str,
                reported: str | None = None) -> None:
    """Raise 409 illegal_transition unless (current, target) is an edge. `reported` is the state shown to the imager."""
    if (current, target) not in edges:
        raise ApiFault(409, "illegal_transition", f"A {noun} that is {reported or current} cannot become {target}.")


def refuse_restore(current: str) -> None:
    if current != "trashed":
        raise conflict("illegal_transition", f"A session that is {current} cannot become restored.")
