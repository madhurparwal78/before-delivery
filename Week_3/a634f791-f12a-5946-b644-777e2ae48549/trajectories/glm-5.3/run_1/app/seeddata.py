"""The seed: applied once per database, on first boot, with no manual step."""

from __future__ import annotations

import datetime as dt
import hashlib
import secrets

from core import HELSINKI

SEED_PASSWORD = "deku-demo-pw-2026"


def hash_password(password: str) -> str:
    """Salted one-way hash; the clear password is never stored."""
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"),
                                 bytes.fromhex(salt), 60_000).hex()
    return f"pbkdf2_sha256${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _algo, salt, digest = stored.split("$", 2)
    except ValueError:
        return False
    if _algo != "pbkdf2_sha256":
        return False
    try:
        salt_bytes = bytes.fromhex(salt)
    except ValueError:
        return False
    candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"),
                                   salt_bytes, 60_000).hex()
    import hmac as _hmac
    return _hmac.compare_digest(candidate, digest)


PROGRAMMES = [
    ("northfall", "Northfall Reference Programme", "en"),
    ("westhall", "Westhall Reference Programme", "en"),
]

ACCOUNTS = [
    ("curator@example.com", "curator", "northfall"),
    ("steward@example.com", "steward", "northfall"),
    ("curator.westhall@example.com", "curator", "westhall"),
]

# (programme, slug, sector, customer, title, published, window, ordinal, fi)
REFERENCES = [
    ("northfall", "harbour-crane-retrofit", "ports", "Kiela Terminals",
     "Harbour crane retrofit", True, ("2026-01-01", "2027-12-31"), 1, True),
    ("northfall", "dairy-line-rebuild", "food", "Vuono Dairy",
     "Dairy line rebuild", True, ("2026-01-01", "2027-12-31"), 2, False),
    ("northfall", "paper-mill-drive-swap", "pulp", "Aspen Mills",
     "Paper mill drive swap", True, ("2026-01-01", "2027-12-31"), 3, False),
    ("northfall", "rail-depot-signalling", "rail", "Northline Rail",
     "Rail depot signalling", True, ("2025-01-01", "2026-01-31"), None, False),
    ("northfall", "quarry-conveyor-upgrade", "mining", "Stonebeck Quarry",
     "Quarry conveyor upgrade", False, None, None, False),
    ("westhall", "cold-store-automation", "cold-chain", "Pakkas Logistics",
     "Cold store automation", True, ("2026-01-01", "2027-12-31"), 1, False),
]

FIGURES = {
    "harbour-crane-retrofit": [
        ("Crane availability", "99.2 %"),
        ("Retrofit downtime", "11 days"),
        ("Energy per container move", "-18 %"),
    ],
    "dairy-line-rebuild": [
        ("Line output", "+34 %"),
        ("Changeover time", "22 min"),
        ("Unplanned stops per month", "3"),
    ],
    "paper-mill-drive-swap": [
        ("Drive energy saved", "2.1 GWh a year"),
        ("Payback", "26 months"),
        ("Drives replaced", "48"),
    ],
    "rail-depot-signalling": [
        ("Points converted", "64"),
        ("Depot throughput", "+12 %"),
        ("Commissioning nights", "9"),
    ],
    "cold-store-automation": [
        ("Pallet moves per hour", "410"),
        ("Picking errors", "-61 %"),
        ("Store temperature", "-25 °C"),
    ],
}

QUOTE = ("paper-mill-drive-swap",
         "We switched forty-eight drives during two planned shutdowns and lost no production day to it.",
         "Hanna Lehto", "Maintenance manager, Aspen Mills")

NOTES = [
    ("what-a-clearance-covers", "What a clearance covers", "2026-09-14",
     "A customer clears the story, its figures and its quote together.",
     "When a customer agrees that their story may be published, the clearance "
     "covers the story text, its result figures and its customer quote as one "
     "package. Nothing goes to the library until the whole package is agreed, "
     "and any later change to those cleared parts withdraws the story until "
     "the customer clears the new version."),
    ("why-we-number-the-library", "Why we number the library", "2026-06-02",
     "Each cleared reference takes the next number, and the numbers never skip.",
     "The reference library is numbered in display order, and the numbers run "
     "from one without a gap. When a story leaves the library the remaining "
     "numbers close up, and when a story returns it takes the next number at "
     "the end of the run. A buyer can therefore trust that the count on the "
     "index is the number of stories actually cleared for publication."),
    ("translating-the-library", "Translating the library", None,
     "Finnish versions arrive one reference at a time.",
     "The reference library is published in English and in Finnish. Finnish "
     "versions of each story arrive one reference at a time, as each "
     "translation is checked with the customer. A story that has no Finnish "
     "body yet shows its English text under a note saying the translation is "
     "still to come."),
]

ENQUIRIES = [
    ("northfall", "prospect@example.com", None, "dairy-line-rebuild",
     dt.datetime(2026, 10, 1, 9, 0, tzinfo=HELSINKI)),
    ("westhall", "cold.buyer@example.com", None, "cold-store-automation",
     dt.datetime(2026, 10, 2, 10, 0, tzinfo=HELSINKI)),
]

BODIES = {
    "harbour-crane-retrofit": {
        "summary": (
            "Kiela Terminals kept four ship-to-shore cranes in service while we "
            "retrofitted their drives, control cabinets and safety systems in "
            "staged night shutdowns across a single winter."),
        "challenge": (
            "The terminal could not lose a crane to an unplanned stop during "
            "peak season. Every drive cabinet was original, spare parts were "
            "increasingly hard to source, and the control system could no "
            "longer be serviced under a maintenance contract. The quay had to "
            "keep its full arrival schedule while the work went on around it."),
        "work": (
            "We staged the retrofit one crane at a time, in negotiated night "
            "windows, so the terminal always had three cranes answering. Each "
            "crane received new drives, a rebuilt cabinet layout, a modern "
            "safety controller and a condition-monitoring set feeding the "
            "terminal's own desk. Commissioning on each crane closed with a "
            "full load test before the next crane began."),
    },
    "dairy-line-rebuild": {
        "summary": (
            "Vuono Dairy rebuilt its filling line with us over two summer "
            "weeks, replacing the filling machines and tying the line into a "
            "new clean-in-place sequence."),
        "challenge": (
            "The old line had grown by accretion over fifteen years: three "
            "generations of filling machines, a changeover procedure that took "
            "an hour, and a clean-in-place cycle whose timings nobody could "
            "defend. The dairy needed more output without a longer production "
            "day, and the food-safety authority needed the whole sequence "
            "documented before the season started."),
        "work": (
            "We replaced the filling section with two servo machines, rewired "
            "the line controls into one standard cabinet set and rebuilt the "
            "clean-in-place sequence around instrumented proof of every "
            "cycle. Operators were trained during the changeover drills "
            "themselves, so the first production week after the rebuild was "
            "also the first week at the new output."),
    },
    "paper-mill-drive-swap": {
        "summary": (
            "Aspen Mills changed forty-eight paper-machine drives with us "
            "during two planned shutdowns, without losing a single production "
            "day to the swap."),
        "challenge": (
            "The machine's drives were a patchwork of four generations, with "
            "energy performance far below the mill's stated target. The mill "
            "runs a fixed shutdown calendar, so the swap had to fit inside two "
            "existing windows and leave the machine ready to start on the "
            "Monday morning after each one."),
        "work": (
            "We mapped every drive and its spare-parts future, built the new "
            "cabinets off site and rehearsed each shutdown on the floor plan. "
            "During the windows themselves the old drives came out and the "
            "new ones went in bay by bay, with the machine restarted and "
            "tuned before the window closed. The payback was measured against "
            "the meter, not the brochure."),
    },
    "rail-depot-signalling": {
        "summary": (
            "Northline Rail converted sixty-four depot points to a modern "
            "interlocking with us over nine commissioning nights."),
        "challenge": (
            "The depot's signalling was life-expired, and the authority's "
            "inspectorate required the conversion before the next timetable "
            "change. All of it had to happen while the depot kept receiving "
            "overnight trains, which left only the small hours to work in."),
        "work": (
            "We converted the points in nine staged nights, each ending with "
            "the depot handed back in a safe state. Every point was brought "
            "onto the new interlocking, tested under simulated traffic and "
            "then proven under the real night's arrivals before the next "
            "night's batch began."),
    },
    "quarry-conveyor-upgrade": {
        "summary": (
            "Stonebeck Quarry is planning a rebuild of its main overland "
            "conveyor, and this draft gathers the story while the work is "
            "still in progress."),
        "challenge": (
            "The quarry's main conveyor loses too much of its nominal rate to "
            "slippage, and its drives sit at the far end of a supply chain "
            "that has already once left the line stopped for a fortnight. The "
            "rebuild has to raise the rate without extending the conveyor's "
            "footprint."),
        "work": (
            "The planned work replaces the drive station, re-tensions the belt "
            "and adds condition monitoring along the line. This draft is not "
            "yet cleared for publication, and its figures will be added when "
            "the commissioning results are in."),
    },
    "cold-store-automation": {
        "summary": (
            "Pakkas Logistics automated its deep-frozen store with us, "
            "lifting pallet moves to 410 an hour while cutting picking errors "
            "by more than half."),
        "challenge": (
            "The store ran at -25 degrees with manual forklift traffic, and "
            "the errors were traced to people, rightly, working too fast in "
            "protective clothing. The chain needed more throughput in the "
            "same cold box, not a bigger one."),
        "work": (
            "We installed an automated crane and shuttle system with goods-"
            "to-person picking at the ante-room, so nobody works inside the "
            "cold box any more. The store's temperature profile was re-"
            "instrumented end to end, and the picking stations were arranged "
            "to keep the new rate honest."),
    },
}

FI_TITLE = "Satamanosturin modernisointi"
FI_BODY = (
    "Kiela Terminals piti neljä laivasta rantaan -nosturia käytössä, kun "
    "uusimme niiden ajot, ohjauskaapit ja turvajärjestelmät vaiheittain "
    "yön seisokkien aikana yhden talven sisällä. Terminaali piti jokaisen "
    "saapumisvuoron aikataulussa, ja jokainen nosturi palasi käyttöön "
    "kunnossa, ennen kuin seuraavan vuoro alkoi.\n\n"
    "Modernisointi kattoi ajot, kaapit, turvaohjaimen ja kunnonvalvonnan. "
    "Jokainen nosturi testattiin täydellä kuormalla ennen kuin työ siirtyi "
    "seuraavaan. Energiankulutus per siirretty kontti laski kahdeksantoista "
    "prosenttia, ja retrofitin aiheuttama seisokki jäi yhteentoista "
    "päivään suunnitellun aikataulun sisällä."
)
