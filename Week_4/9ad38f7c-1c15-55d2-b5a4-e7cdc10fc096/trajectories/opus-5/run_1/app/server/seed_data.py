"""The baseline every instance seeds: scenarios, teams, players and solves."""

from __future__ import annotations

from dataclasses import dataclass

EVENT_NAME = "Strange & Unusual Activity"
EVENT_START = "2026-10-22T16:00:00Z"
EVENT_END = "2026-10-26T23:59:00Z"
CALENDAR_TITLE = "Strange & Unusual Activity, a NightWard Downtime CTF"
CALENDAR_DESCRIPTION = (
    "Five days, eight scenarios, one haunted network. Join any day between "
    "Thursday 22 and Monday 26 October."
)

SEED_PASSWORD = "deku-demo-pw-2026"
WEBINAR_FLAG = "flag{comfort_zone_exit}"

KIND_LABELS = {
    "soc-sim": "SOC Sim Scenario",
    "th-sim": "Threat Hunting Sim Scenario",
    "tabletop": "Tabletop Exercise",
    "challenge": "Challenge",
}


@dataclass(frozen=True)
class Scenario:
    number: int
    slug: str
    title: str
    kind: str
    points: int
    flag: str
    description: str


SCENARIOS: tuple[Scenario, ...] = (
    Scenario(
        1,
        "repossessed",
        "Repossessed",
        "soc-sim",
        500,
        "flag{nine_alerts_one_build}",
        "It's 9:14 on a Thursday at Gravelight Studios, and Marketing has just "
        "opened a press kit that wasn't meant for them. You're the SOC on shift. "
        "Triage nine alerts, separate real threats from noise, and write up what "
        "you find before the unreleased game build walks out the door.",
    ),
    Scenario(
        2,
        "quiet-as-the-grave",
        "Quiet As The Grave",
        "th-sim",
        500,
        "flag{hypothesis_held}",
        "A week after the breach, the crew that took Gravelight's game build is "
        "back, and this time it's quiet. You have a threat intel memo and a "
        "hypothesis, but no confirmed alerts. Hunt through the logs, rebuild the "
        "attack stage by stage, and prove how far they got.",
    ),
    Scenario(
        3,
        "deadmen-tell-no-logs",
        "Deadmen Tell No Logs",
        "tabletop",
        500,
        "flag{irregularities_logged}",
        "As your team pushes toward a deadline the whole studio has been building "
        "towards, a handful of small, easily dismissed irregularities begin to "
        "surface in the background.",
    ),
    Scenario(
        4,
        "handbook-for-the-recently-compromised",
        "Handbook For The Recently Compromised",
        "challenge",
        60,
        "flag{timeline_rebuilt}",
        "A Windows workstation has been flagged for suspicious activity, and its "
        "event logs are ready for review. Follow the sequence of events, identify "
        "the processes involved, and build a clear timeline of the incident.",
    ),
    Scenario(
        5,
        "the-waiting-room",
        "The Waiting Room",
        "challenge",
        80,
        "flag{payment_run_traced}",
        "Maren received a supplier email about an upcoming payment run. After "
        "opening an attachment, her workstation contacted an unfamiliar service. "
        "Reconstruct the execution chain and determine what left the workstation.",
    ),
    Scenario(
        6,
        "day-o",
        "Day-O",
        "challenge",
        90,
        "flag{payload_unpacked}",
        "Soraya opened a document review package, but the preview froze and the "
        "application stopped responding. Examine the running processes and uncover "
        "the hidden payload.",
    ),
    Scenario(
        7,
        "strange-and-unusual-activity",
        "Strange & Unusual Activity",
        "challenge",
        100,
        "flag{dns_whispers}",
        "A threat intelligence lead suggests a workstation is communicating with "
        "an attacker, but no security alerts have fired. You have a day of "
        "connection and DNS logs in a log search console. Identify the workstation "
        "involved and establish how much data left.",
    ),
    Scenario(
        8,
        "dead-endpoint",
        "Dead Endpoint",
        "challenge",
        120,
        "flag{gallery_restored}",
        "Staff arrived to find their internal photo gallery unusable and its images "
        "unreadable. Reconstruct how the application was compromised and find a way "
        "to recover the affected images.",
    ),
)

SCENARIOS_BY_SLUG = {scenario.slug: scenario for scenario in SCENARIOS}
SCENARIO_SLUGS = tuple(scenario.slug for scenario in SCENARIOS)
CHALLENGE_TOTAL = sum(1 for scenario in SCENARIOS if scenario.kind == "challenge")


@dataclass(frozen=True)
class SeedTeam:
    name: str
    invite_code: str
    captain_email: str
    captain_name: str
    created_at: str
    solved: tuple[int, ...]
    last_solve_at: str | None


SEED_TEAMS: tuple[SeedTeam, ...] = (
    SeedTeam(
        "Cold Ledger",
        "COLDLEDG",
        "coldledger@example.com",
        "Mara Quill",
        "2026-10-22T16:02:00Z",
        (1, 2, 3, 4, 5, 6, 7, 8),
        "2026-10-23T07:30:00Z",
    ),
    SeedTeam(
        "Grey Static",
        "GREYSTAT",
        "sasha@example.com",
        "Sasha Reyes",
        "2026-10-22T16:05:00Z",
        (1, 2, 3, 4, 5, 6, 7, 8),
        "2026-10-23T09:00:00Z",
    ),
    SeedTeam(
        "Quiet Hours",
        "QUIETHRS",
        "quiethours@example.com",
        "Noor Ashby",
        "2026-10-22T16:08:00Z",
        (1, 2, 3, 7, 8),
        "2026-10-23T08:00:00Z",
    ),
    SeedTeam(
        "Bone Orchard",
        "BONEORCH",
        "boneorchard@example.com",
        "Ilya Brandt",
        "2026-10-22T16:11:00Z",
        (1, 2, 5),
        "2026-10-22T21:00:00Z",
    ),
    SeedTeam(
        "Null Harbor",
        "NULLHARB",
        "nullharbor@example.com",
        "Dana Okafor",
        "2026-10-22T16:14:00Z",
        (1, 2, 4),
        "2026-10-22T20:00:00Z",
    ),
    SeedTeam(
        "Pale Signal",
        "PALESIGN",
        "palesignal@example.com",
        "Kit Moreau",
        "2026-10-22T16:17:00Z",
        (1, 3),
        "2026-10-22T18:00:00Z",
    ),
    SeedTeam(
        "Attic Lights",
        "ATTICLIT",
        "atticlights@example.com",
        "June Haldane",
        "2026-10-22T16:20:00Z",
        (1, 3),
        "2026-10-22T19:00:00Z",
    ),
    SeedTeam(
        "Lantern Watch",
        "LANTERN1",
        "captain@example.com",
        "Rowan Vale",
        "2026-10-22T16:23:00Z",
        (1, 4),
        "2026-10-22T18:00:00Z",
    ),
    SeedTeam(
        "Moth Light",
        "MOTHLITE",
        "mothlight@example.com",
        "Ezra Pike",
        "2026-10-22T16:26:00Z",
        (2,),
        "2026-10-22T16:30:00Z",
    ),
    SeedTeam(
        "Crypt Keys",
        "CRYPTKEY",
        "cryptkeys@example.com",
        "Lena Sorel",
        "2026-10-22T16:29:00Z",
        (2,),
        "2026-10-22T22:00:00Z",
    ),
    SeedTeam(
        "Static Choir",
        "STATICCH",
        "staticchoir@example.com",
        "Omar Fenn",
        "2026-10-22T16:32:00Z",
        (4, 5, 6),
        "2026-10-23T01:00:00Z",
    ),
    SeedTeam(
        "Grave Shift",
        "GRAVESHF",
        "graveshift@example.com",
        "Pia Lund",
        "2026-10-22T16:35:00Z",
        (8,),
        "2026-10-22T23:00:00Z",
    ),
    SeedTeam(
        "Night Ledger",
        "NIGHTLDG",
        "nightledger@example.com",
        "Cal Rook",
        "2026-10-22T16:38:00Z",
        (6,),
        "2026-10-22T17:30:00Z",
    ),
    SeedTeam(
        "Hollow Port",
        "HOLLOWPT",
        "hollowport@example.com",
        "Bea Strand",
        "2026-10-22T16:41:00Z",
        (4,),
        "2026-10-22T18:30:00Z",
    ),
    SeedTeam(
        "Dust Index",
        "DUSTINDX",
        "dustindex@example.com",
        "Ivo Lark",
        "2026-10-22T16:44:00Z",
        (),
        None,
    ),
    SeedTeam(
        "Last Lamp",
        "LASTLAMP",
        "lastlamp@example.com",
        "Rhea Doyle",
        "2026-10-22T16:47:00Z",
        (),
        None,
    ),
)


@dataclass(frozen=True)
class SeedMember:
    email: str
    display_name: str
    team_name: str | None
    joined_at: str | None


def _extra_members() -> tuple[SeedMember, ...]:
    members: list[SeedMember] = [
        SeedMember(
            "teammate@example.com",
            "Imani Frost",
            "Lantern Watch",
            "2026-10-22T16:50:00Z",
        )
    ]
    for prefix, team, count, label, created_minute in (
        ("greystatic", "Grey Static", 19, "Grey Static Player", 5),
        ("nullharbor", "Null Harbor", 18, "Null Harbor Player", 14),
    ):
        for number in range(1, count + 1):
            minute = created_minute + number
            hour = 16 + minute // 60
            members.append(
                SeedMember(
                    f"{prefix}{number:02d}@example.com",
                    f"{label} {number:02d}",
                    team,
                    f"2026-10-22T{hour:02d}:{minute % 60:02d}:00Z",
                )
            )
    members.append(SeedMember("solo@example.com", "Theo Marsh", None, None))
    return tuple(members)


SEED_EXTRA_MEMBERS = _extra_members()
