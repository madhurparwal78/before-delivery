"""Seed data (brief: Seed data): written once into an empty database, relative to that first start."""
import datetime as dt

from django.contrib.auth.hashers import make_password

from northpier import db
from northpier.studio_time import at_stockholm, is_studio_day, stockholm_date

FIXTURE_PASSWORD = "deku-demo-pw-2026"
ACCOUNTS = (("Sana Holm", "sana@example.com", "lead"), ("Ole Berg", "ole@example.com", "associate"))

CASES = (
    ("maison-vey", "Maison Vey", "Luxury", "ink", ["Site of the Day", "Developer Award"], 7311,
     "A quieter way to sell something precious.",
     ["Maison Vey makes leather goods in a workshop of eleven people, and its old shop shouted over every piece. "
      "We rebuilt the brand's voice around restraint: one object per screen, measured copy and long pauses.",
      "The new store loads in under a second on a phone, reads beautifully by keyboard and lets each piece sit "
      "in near darkness until you ask to see more."],
     "Our customers now stay with each piece. The site finally feels like the workshop.",
     "Camille Vey", "Founder"),
    ("halden-labs", "Halden Labs", "AI Technologies", "orange", [], 2804,
     "Making a research lab legible to the people it serves.",
     ["Halden Labs builds models that read clinical trial documents. Their story was buried under jargon, so "
      "we started with interviews and a vocabulary the whole company could agree on.",
      "The result is a product site and documentation hub that explains one hard idea per page, with live "
      "examples that run in the browser and nothing that waits for a sales call."],
     "Northpier found the sentence we had been trying to say for three years.",
     "Jonas Halden", "Chief Executive"),
    ("kvarn-group", "Kvarn Group", "Business Solutions", "clay", [], 5562,
     "One service catalogue instead of nine.",
     ["Kvarn Group grew by acquisition and ended up with nine websites selling overlapping services. We mapped "
      "every offer, merged the duplicates and wrote a structure customers could navigate without a salesperson.",
      "A single design system now carries the group and its regional teams, so a new office launches its pages "
      "in days rather than months."],
     "We launched three regions in the time one used to take.",
     "Annika Kvarn", "Head of Marketing"),
    ("ostra-health", "Ostra Health", "Health Tech", "violet", [], 9045,
     "Booking care should feel like care.",
     ["Ostra Health runs clinics across the archipelago. Patients booked by phone because the old flow asked "
      "twelve questions before showing a single time.",
      "We turned it around: first a time that works, then only the questions that matter for that visit. "
      "Online bookings tripled in the first quarter after launch."],
     "Our phones are quieter and our patients arrive better prepared.",
     "Dr. Elsa Ostra", "Medical Director"),
    ("lumen-bio", "Lumen Bio", "Bio Tech", "lemon", [], 1187,
     "A brand that glows without shouting.",
     ["Lumen Bio engineers enzymes that make cold-water detergents work. We built an identity from the moment a "
      "stain lifts: a single bright colour, generous space and type that never raises its voice.",
      "The identity runs from investor decks to lab coats, and the site explains the chemistry with motion that "
      "only moves when you ask it to."],
     "People finally remember who we are after one meeting.",
     "Tomas Lund", "Co-founder"),
    ("sola-rooms", "Sola Rooms", "Hospitality", "sand", [], 6630,
     "Small hotels, booked directly.",
     ["Sola Rooms runs five small hotels on the west coast and paid a fortune in agency commission. We designed a "
      "booking site warm enough to feel like arriving, and fast enough to beat the platforms.",
      "Direct bookings now make up more than half of all stays, and each house tells its own story inside one "
      "calm, shared frame."],
     "Guests write to say the site felt like the rooms. That never happened before.",
     "Ingrid Sola", "Owner"),
    ("fjell-energy", "Fjell Energy", "Sustainability", "mist", [], 4419,
     "Clear numbers for a cleaner grid.",
     ["Fjell Energy helps municipalities plan solar and storage. Their reports were thorough and unread. We "
      "turned them into a living dashboard that answers the three questions every council asks first.",
      "Planners now share a single link instead of a forty-page PDF, and decisions that took a season take a "
      "single meeting."],
     "Our reports became the thing councils bring to the meeting.",
     "Mats Fjell", "Head of Product"),
    ("lesestund", "Lesestund", "Education", "clay", [], 8273,
     "Reading time, protected.",
     ["Lesestund is a reading app for primary schools. Teachers loved it; children found it noisy. We removed the "
      "badges and streaks and designed a reading room instead: one page, one book, one quiet timer.",
      "Average reading sessions grew by nine minutes, and teachers can see progress without a single leaderboard."],
     "The children ask for reading time now. That is the whole point.",
     "Siri Lese", "Product Lead"),
)

INQUIRIES = (
    ("NP-H4RV2K", "Elin Strand", "elin@example.com", "Brightwater Ferries", ["design", "development"], "75k_150k",
     "within_3_months", "We run six passenger ferries and our timetable site is impossible to use on a phone. "
     "We need a calm, fast site with live departures.", [("submit", 6)]),
    ("NP-T9WQ3M", "Jonas Lind", "jonas@example.com", "Kelp and Co", ["branding"], "25k_75k", "3_to_6_months",
     "We farm seaweed and sell it to restaurants. Our brand still looks like a student project and we want "
     "something we can grow into.", [("submit", 2)]),
    ("NP-C6PZ8N", "Aino Varga", "aino@example.com", "Northfield Clinics", ["strategy", "design"], "over_150k", "asap",
     "Four clinics, three booking systems and one frustrated patient base. We need a strategy and a design "
     "for one front door.", [("submit", 5), ("start_review", 4)]),
    ("NP-M3XB7R", "Rafael Costa", "rafael@example.com", "Tidewell Labs", ["design", "development"], "75k_150k",
     "within_3_months", "Tidewell Labs makes tidal sensors. We need a product site and a customer dashboard "
     "that engineers will actually enjoy.", [("submit", 4), ("start_review", 3), ("book_call", 1)]),
    ("NP-Q7LD4V", "Mira Falk", "mira@example.com", "Larkspur Audio", ["design"], "25k_75k", "asap",
     "We build small studio monitors by hand. Our new range launches soon and the site needs to sound as good "
     "as the speakers.", [("submit", 9), ("start_review", 8), ("book_call", 7)]),
    ("NP-W8DK5T", "Hanna Moe", "hanna@example.com", "Quayside Books", ["branding", "design"], "25k_75k",
     "3_to_6_months", "An independent bookshop by the harbour that wants a new identity and a site for events "
     "and orders.", [("submit", 25), ("start_review", 22), ("book_call", 20), ("mark_won", 10)]),
    ("NP-B2FJ9S", "Lukas Weber", "lukas@example.com", "Harbor Garage", ["development"], "under_25k", "asap",
     "We repair boat engines and want customers to book a service slot online instead of calling.",
     [("submit", 45), ("decline", 40)]),
)
STEP_STATUS = {"submit": "new", "start_review": "in_review", "book_call": "call_booked", "mark_won": "won",
               "decline": "declined"}


def _studio_day_after(today: dt.date, count: int) -> dt.date:
    day, seen = today, 0
    while seen < count:
        day += dt.timedelta(days=1)
        seen += is_studio_day(day)
    return day


def _last_studio_day_before(today: dt.date, days: int) -> dt.date:
    day = today - dt.timedelta(days=days)
    while not is_studio_day(day):
        day -= dt.timedelta(days=1)
    return day


def _call_times(now: dt.datetime) -> dict[str, dt.datetime]:
    today = stockholm_date(now)
    return {"NP-M3XB7R": at_stockholm(_studio_day_after(today, 3), 14),
            "NP-Q7LD4V": at_stockholm(_last_studio_day_before(today, 2), 10),
            "NP-W8DK5T": at_stockholm(_last_studio_day_before(today, 14), 11)}


def seed(tx: db.Tx) -> None:
    """Insert whatever seed rows are missing; a restart finds them all and writes nothing. Sends no email."""
    now = tx.clock()
    for name, email, role in ACCOUNTS:
        if tx.value("SELECT count(*) FROM studio_users WHERE email = :email", email=email) == 0:
            tx.run("INSERT INTO studio_users (name, email, role, password_hash, created_at) "
                   "VALUES (:name, :email, :role, :hash, :now)", name=name, email=email, role=role,
                   hash=make_password(FIXTURE_PASSWORD), now=now)
    for position, (slug, client, industry, theme, awards, cover_seed, headline, body, quote, person, role) in \
            enumerate(CASES, start=1):
        tx.run("INSERT INTO cases (slug, client, industry, theme, headline, body, awards, testimonial_quote, "
               "testimonial_name, testimonial_role, cover_seed, position) VALUES (:slug, :client, :industry, "
               ":theme, :headline, :body, :awards, :quote, :person, :role, :cover_seed, "
               ":position) ON CONFLICT (slug) DO NOTHING", slug=slug, client=client, industry=industry, theme=theme,
               headline=headline, body=list(body), awards=list(awards), quote=quote, person=person,
               role=role, cover_seed=cover_seed, position=position)
    lead_id = tx.value("SELECT id FROM studio_users WHERE email = 'sana@example.com'")
    calls = _call_times(now)
    for reference, name, email, company, services, budget, timeline, message, steps in INQUIRIES:
        call_at = calls.get(reference)
        final = STEP_STATUS[steps[-1][0]]
        last_change = now - dt.timedelta(days=steps[-1][1])
        reason = "budget" if final == "declined" else None
        inserted = tx.value(
            "INSERT INTO inquiries (reference, status_token, name, email, company, services, budget, timeline, "
            "message, status, call_at, decline_reason, version, created_at, updated_at) VALUES (:reference, :token, "
            ":name, :email, :company, :services, :budget, :timeline, :message, :status, :call_at, :reason, :version, "
            ":created, :updated) ON CONFLICT (reference) DO NOTHING RETURNING id",
            reference=reference, token=f"seed-{reference.lower().replace('-', '')}-status-link", name=name,
            email=email, company=company, services=services, budget=budget, timeline=timeline, message=message,
            status=final, call_at=call_at, reason=reason, version=len(steps),
            created=now - dt.timedelta(days=steps[0][1]), updated=last_change)
        if inserted is None:
            continue
        previous = None
        for action, days_before in steps:
            status = STEP_STATUS[action]
            tx.run("INSERT INTO status_events (inquiry_id, action, from_status, to_status, call_at, decline_reason, "
                   "actor_id, created_at) VALUES (:id, :action, :from_status, :to_status, :call_at, :reason, :actor, "
                   ":at)", id=inserted, action=None if action == "submit" else action, from_status=previous,
                   to_status=status, call_at=call_at if action == "book_call" else None,
                   reason=reason if action == "decline" else None,
                   actor=None if action == "submit" else lead_id, at=now - dt.timedelta(days=days_before))
            previous = status
