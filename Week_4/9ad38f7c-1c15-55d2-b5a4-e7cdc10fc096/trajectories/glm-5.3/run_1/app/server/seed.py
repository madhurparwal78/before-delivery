"""Seed data: the eight scenarios and the sixteen baseline teams."""

SCENARIOS = [
    ("repossessed", 1, "Repossessed", "soc-sim", 500,
     "It's 9:14 on a Thursday at Gravelight Studios, and Marketing has just opened a press kit that wasn't meant for them. You're the SOC on shift. Triage nine alerts, separate real threats from noise, and write up what you find before the unreleased game build walks out the door.",
     "flag{nine_alerts_one_build}"),
    ("quiet-as-the-grave", 2, "Quiet As The Grave", "th-sim", 500,
     "A week after the breach, the crew that took Gravelight's game build is back, and this time it's quiet. You have a threat intel memo and a hypothesis, but no confirmed alerts. Hunt through the logs, rebuild the attack stage by stage, and prove how far they got.",
     "flag{hypothesis_held}"),
    ("deadmen-tell-no-logs", 3, "Deadmen Tell No Logs", "tabletop", 500,
     "As your team pushes toward a deadline the whole studio has been building towards, a handful of small, easily dismissed irregularities begin to surface in the background.",
     "flag{irregularities_logged}"),
    ("handbook-for-the-recently-compromised", 4, "Handbook For The Recently Compromised", "challenge", 60,
     "A Windows workstation has been flagged for suspicious activity, and its event logs are ready for review. Follow the sequence of events, identify the processes involved, and build a clear timeline of the incident.",
     "flag{timeline_rebuilt}"),
    ("the-waiting-room", 5, "The Waiting Room", "challenge", 80,
     "Maren received a supplier email about an upcoming payment run. After opening an attachment, her workstation contacted an unfamiliar service. Reconstruct the execution chain and determine what left the workstation.",
     "flag{payment_run_traced}"),
    ("day-o", 6, "Day-O", "challenge", 90,
     "Soraya opened a document review package, but the preview froze and the application stopped responding. Examine the running processes and uncover the hidden payload.",
     "flag{payload_unpacked}"),
    ("strange-and-unusual-activity", 7, "Strange & Unusual Activity", "challenge", 100,
     "A threat intelligence lead suggests a workstation is communicating with an attacker, but no security alerts have fired. You have a day of connection and DNS logs in a log search console. Identify the workstation involved and establish how much data left.",
     "flag{dns_whispers}"),
    ("dead-endpoint", 8, "Dead Endpoint", "challenge", 120,
     "Staff arrived to find their internal photo gallery unusable and its images unreadable. Reconstruct how the application was compromised and find a way to recover the affected images.",
     "flag{gallery_restored}"),
]

WEBINAR_FLAG = "flag{comfort_zone_exit}"
SEED_PASSWORD = "deku-demo-pw-2026"

# (name, code, captain email, display name, created_at, solved slugs, last_solve)
TEAMS = [
    ("Cold Ledger", "COLDLEDG", "coldledger@example.com", "Mara Quill",
     "2026-10-22T16:02:00Z",
     ["repossessed", "quiet-as-the-grave", "deadmen-tell-no-logs",
      "handbook-for-the-recently-compromised", "the-waiting-room", "day-o",
      "strange-and-unusual-activity", "dead-endpoint"], "2026-10-23T07:30:00Z"),
    ("Grey Static", "GREYSTAT", "greystatic@example.com", "Sasha Reyes",
     "2026-10-22T16:05:00Z",
     ["repossessed", "quiet-as-the-grave", "deadmen-tell-no-logs",
      "handbook-for-the-recently-compromised", "the-waiting-room", "day-o",
      "strange-and-unusual-activity", "dead-endpoint"], "2026-10-23T09:00:00Z"),
    ("Quiet Hours", "QUIETHRS", "quiethours@example.com", "Noor Ashby",
     "2026-10-22T16:08:00Z",
     ["repossessed", "quiet-as-the-grave", "deadmen-tell-no-logs",
      "strange-and-unusual-activity", "dead-endpoint"], "2026-10-23T08:00:00Z"),
    ("Bone Orchard", "BONEORCH", "boneorchard@example.com", "Ilya Brandt",
     "2026-10-22T16:11:00Z",
     ["repossessed", "quiet-as-the-grave", "the-waiting-room"], "2026-10-22T21:00:00Z"),
    ("Null Harbor", "NULLHARB", "nullharbor@example.com", "Dana Okafor",
     "2026-10-22T16:14:00Z",
     ["repossessed", "quiet-as-the-grave",
      "handbook-for-the-recently-compromised"], "2026-10-22T20:00:00Z"),
    ("Pale Signal", "PALESIGN", "palesignal@example.com", "Kit Moreau",
     "2026-10-22T16:17:00Z",
     ["repossessed", "deadmen-tell-no-logs"], "2026-10-22T18:00:00Z"),
    ("Attic Lights", "ATTICLIT", "atticlights@example.com", "June Haldane",
     "2026-10-22T16:20:00Z",
     ["repossessed", "deadmen-tell-no-logs"], "2026-10-22T19:00:00Z"),
    ("Lantern Watch", "LANTERN1", "captain@example.com", "Rowan Vale",
     "2026-10-22T16:23:00Z",
     ["repossessed", "handbook-for-the-recently-compromised"], "2026-10-22T18:00:00Z"),
    ("Moth Light", "MOTHLITE", "mothlight@example.com", "Ezra Pike",
     "2026-10-22T16:26:00Z", ["quiet-as-the-grave"], "2026-10-22T16:30:00Z"),
    ("Crypt Keys", "CRYPTKEY", "cryptkeys@example.com", "Lena Sorel",
     "2026-10-22T16:29:00Z", ["quiet-as-the-grave"], "2026-10-22T22:00:00Z"),
    ("Static Choir", "STATICCH", "staticchoir@example.com", "Omar Fenn",
     "2026-10-22T16:32:00Z",
     ["handbook-for-the-recently-compromised", "the-waiting-room", "day-o"],
     "2026-10-23T01:00:00Z"),
    ("Grave Shift", "GRAVESHF", "graveshift@example.com", "Pia Lund",
     "2026-10-22T16:35:00Z", ["dead-endpoint"], "2026-10-22T23:00:00Z"),
    ("Night Ledger", "NIGHTLDG", "nightledger@example.com", "Cal Rook",
     "2026-10-22T16:38:00Z", ["day-o"], "2026-10-22T17:30:00Z"),
    ("Hollow Port", "HOLLOWPT", "hollowport@example.com", "Bea Strand",
     "2026-10-22T16:41:00Z",
     ["handbook-for-the-recently-compromised"], "2026-10-22T18:30:00Z"),
    ("Dust Index", "DUSTINDX", "dustindex@example.com", "Ivo Lark",
     "2026-10-22T16:44:00Z", [], None),
    ("Last Lamp", "LASTLAMP", "lastlamp@example.com", "Rhea Doyle",
     "2026-10-22T16:47:00Z", [], None),
]

# A seeded player in no team.
SOLO_PLAYER = ("solo@example.com", "Theo Marsh")

def _minutes_after(created_at, minutes):
    import datetime
    base = datetime.datetime.strptime(created_at, "%Y-%m-%dT%H:%M:%SZ")
    return (base + datetime.timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M:%SZ")

# Extra members: (team name, email, display name, joined_at). The numbered
# players joined in number order, one minute apart, starting one minute after
# their team's creation.
EXTRA_MEMBERS = [("Lantern Watch", "teammate@example.com", "Imani Frost",
                  "2026-10-22T16:50:00Z")]
for _name, _code, _email, _display, _created, _solved, _last in TEAMS:
    if _name == "Grey Static":
        for _i in range(1, 20):
            EXTRA_MEMBERS.append((_name, "greystatic%02d@example.com" % _i,
                                 "Grey Static Player %02d" % _i,
                                 _minutes_after(_created, _i)))
    if _name == "Null Harbor":
        for _i in range(1, 19):
            EXTRA_MEMBERS.append((_name, "nullharbor%02d@example.com" % _i,
                                 "Null Harbor Player %02d" % _i,
                                 _minutes_after(_created, _i)))
