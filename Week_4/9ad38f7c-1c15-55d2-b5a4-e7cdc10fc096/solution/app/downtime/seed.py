"""The scenario catalogue and the invented baseline the brief's Seed data section lists.

Flags are carried only as the lowercase hex SHA-256 of their text.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

SEED_PASSWORD = "deku-demo-pw-2026"


@dataclass(frozen=True, slots=True)
class Scenario:
    number: int
    slug: str
    title: str
    kind: str
    points: int
    description: str
    flag_sha256: str


KIND_LABELS = {
    "soc-sim": "SOC Sim Scenario",
    "th-sim": "Threat Hunting Sim Scenario",
    "tabletop": "Tabletop Exercise",
    "challenge": "Challenge",
}

SCENARIOS = (
    Scenario(1, "repossessed", "Repossessed", "soc-sim", 500,
             "It's 9:14 on a Thursday at Gravelight Studios, and Marketing has just opened a press kit that "
             "wasn't meant for them. You're the SOC on shift. Triage nine alerts, separate real threats from "
             "noise, and write up what you find before the unreleased game build walks out the door.",
             "e95232caeb0b46925dcf053557fa26fb7d83abbae3b9a80258cff1fc205e9572"),
    Scenario(2, "quiet-as-the-grave", "Quiet As The Grave", "th-sim", 500,
             "A week after the breach, the crew that took Gravelight's game build is back, and this time it's "
             "quiet. You have a threat intel memo and a hypothesis, but no confirmed alerts. Hunt through the "
             "logs, rebuild the attack stage by stage, and prove how far they got.",
             "d7fc4418ef210f661b4869c1c436115cff4f62e36106cfcb59c94e7d1994d3ef"),
    Scenario(3, "deadmen-tell-no-logs", "Deadmen Tell No Logs", "tabletop", 500,
             "As your team pushes toward a deadline the whole studio has been building towards, a handful of "
             "small, easily dismissed irregularities begin to surface in the background.",
             "5d22abca548ca58c1511cc2764e417486a911d14d477c198c3954fbb5be56fd0"),
    Scenario(4, "handbook-for-the-recently-compromised", "Handbook For The Recently Compromised", "challenge", 60,
             "A Windows workstation has been flagged for suspicious activity, and its event logs are ready for "
             "review. Follow the sequence of events, identify the processes involved, and build a clear "
             "timeline of the incident.",
             "ebb1c2d30a2936a0aa0dcbbcd3cd049d154063c532eb641bf5c79f46781eb09a"),
    Scenario(5, "the-waiting-room", "The Waiting Room", "challenge", 80,
             "Maren received a supplier email about an upcoming payment run. After opening an attachment, her "
             "workstation contacted an unfamiliar service. Reconstruct the execution chain and determine what "
             "left the workstation.",
             "05f569deac62df9e77e831cc07c89461f1c3a4823eed024b2125ee3094846820"),
    Scenario(6, "day-o", "Day-O", "challenge", 90,
             "Soraya opened a document review package, but the preview froze and the application stopped "
             "responding. Examine the running processes and uncover the hidden payload.",
             "776a5a6d9992c85afc83e703d11b9820a6ad3bcf31e4b03a647a47a05cb4df50"),
    Scenario(7, "strange-and-unusual-activity", "Strange & Unusual Activity", "challenge", 100,
             "A threat intelligence lead suggests a workstation is communicating with an attacker, but no "
             "security alerts have fired. You have a day of connection and DNS logs in a log search console. "
             "Identify the workstation involved and establish how much data left.",
             "b67d4206d6a0abdcfc1dcd79038d81399f08a636ff5f5169ec77a742aab4c75a"),
    Scenario(8, "dead-endpoint", "Dead Endpoint", "challenge", 120,
             "Staff arrived to find their internal photo gallery unusable and its images unreadable. "
             "Reconstruct how the application was compromised and find a way to recover the affected images.",
             "dfecb54671a9bab00850da1ec37f9aea7e5f04e3bab300d71c7c5eb4ceaeef9a"),
)
SCENARIOS_BY_SLUG = {s.slug: s for s in SCENARIOS}

WEBINAR_FLAG_SHA256 = "ac19b103631145e8f22755ccaeb8e3caa62aa3d8f781d5303ede05a82dd090e0"


def _at(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


@dataclass(frozen=True, slots=True)
class SeedTeam:
    name: str
    code: str
    captain_email: str
    captain_name: str
    created: datetime
    solved: tuple[int, ...]
    last_solve: datetime | None


SEED_TEAMS = (
    SeedTeam("Cold Ledger", "COLDLEDG", "coldledger@example.com", "Mara Quill", _at("2026-10-22T16:02:00Z"),
             (1, 2, 3, 4, 5, 6, 7, 8), _at("2026-10-23T07:30:00Z")),
    SeedTeam("Grey Static", "GREYSTAT", "sasha@example.com", "Sasha Reyes", _at("2026-10-22T16:05:00Z"),
             (1, 2, 3, 4, 5, 6, 7, 8), _at("2026-10-23T09:00:00Z")),
    SeedTeam("Quiet Hours", "QUIETHRS", "quiethours@example.com", "Noor Ashby", _at("2026-10-22T16:08:00Z"),
             (1, 2, 3, 7, 8), _at("2026-10-23T08:00:00Z")),
    SeedTeam("Bone Orchard", "BONEORCH", "boneorchard@example.com", "Ilya Brandt", _at("2026-10-22T16:11:00Z"),
             (1, 2, 5), _at("2026-10-22T21:00:00Z")),
    SeedTeam("Null Harbor", "NULLHARB", "nullharbor@example.com", "Dana Okafor", _at("2026-10-22T16:14:00Z"),
             (1, 2, 4), _at("2026-10-22T20:00:00Z")),
    SeedTeam("Pale Signal", "PALESIGN", "palesignal@example.com", "Kit Moreau", _at("2026-10-22T16:17:00Z"),
             (1, 3), _at("2026-10-22T18:00:00Z")),
    SeedTeam("Attic Lights", "ATTICLIT", "atticlights@example.com", "June Haldane", _at("2026-10-22T16:20:00Z"),
             (1, 3), _at("2026-10-22T19:00:00Z")),
    SeedTeam("Lantern Watch", "LANTERN1", "captain@example.com", "Rowan Vale", _at("2026-10-22T16:23:00Z"),
             (1, 4), _at("2026-10-22T18:00:00Z")),
    SeedTeam("Moth Light", "MOTHLITE", "mothlight@example.com", "Ezra Pike", _at("2026-10-22T16:26:00Z"),
             (2,), _at("2026-10-22T16:30:00Z")),
    SeedTeam("Crypt Keys", "CRYPTKEY", "cryptkeys@example.com", "Lena Sorel", _at("2026-10-22T16:29:00Z"),
             (2,), _at("2026-10-22T22:00:00Z")),
    SeedTeam("Static Choir", "STATICCH", "staticchoir@example.com", "Omar Fenn", _at("2026-10-22T16:32:00Z"),
             (4, 5, 6), _at("2026-10-23T01:00:00Z")),
    SeedTeam("Grave Shift", "GRAVESHF", "graveshift@example.com", "Pia Lund", _at("2026-10-22T16:35:00Z"),
             (8,), _at("2026-10-22T23:00:00Z")),
    SeedTeam("Night Ledger", "NIGHTLDG", "nightledger@example.com", "Cal Rook", _at("2026-10-22T16:38:00Z"),
             (6,), _at("2026-10-22T17:30:00Z")),
    SeedTeam("Hollow Port", "HOLLOWPT", "hollowport@example.com", "Bea Strand", _at("2026-10-22T16:41:00Z"),
             (4,), _at("2026-10-22T18:30:00Z")),
    SeedTeam("Dust Index", "DUSTINDX", "dustindex@example.com", "Ivo Lark", _at("2026-10-22T16:44:00Z"), (), None),
    SeedTeam("Last Lamp", "LASTLAMP", "lastlamp@example.com", "Rhea Doyle", _at("2026-10-22T16:47:00Z"), (), None),
)

# Extra members: (team name, email, display name, joined_at).
_EXTRA = [("Lantern Watch", "teammate@example.com", "Imani Frost", _at("2026-10-22T16:50:00Z"))]
for _team, _prefix, _label, _count in (("Grey Static", "greystatic", "Grey Static Player", 19),
                                        ("Null Harbor", "nullharbor", "Null Harbor Player", 18)):
    _created = next(t.created for t in SEED_TEAMS if t.name == _team)
    _EXTRA += [(_team, f"{_prefix}{i:02d}@example.com", f"{_label} {i:02d}", _created + timedelta(minutes=i))
               for i in range(1, _count + 1)]
SEED_MEMBERS = tuple(_EXTRA)
SOLO = ("solo@example.com", "Theo Marsh", _at("2026-10-22T16:00:00Z"))


def team_solve_times(team: SeedTeam) -> list[tuple[Scenario, datetime]]:
    """Solves one hour apart in scenario-number order, ending at the team's last solve."""
    count = len(team.solved)
    return [(SCENARIOS[number - 1], team.last_solve - timedelta(hours=count - 1 - i))
            for i, number in enumerate(team.solved)]
