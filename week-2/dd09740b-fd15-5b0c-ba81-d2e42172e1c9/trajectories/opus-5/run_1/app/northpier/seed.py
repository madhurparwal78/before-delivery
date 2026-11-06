"""First-start seed: two studio accounts, eight cases and seven inquiries."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any


from .auth import hash_password
from .calendar_rules import (
    now_utc,
    stockholm_date_today,
    stockholm_wall_clock_to_utc,
    studio_day_after,
    studio_day_on_or_before,
)
from .db import LOCK_SEED, Connection, advisory_lock, json_param

FIXTURE_PASSWORD = "deku-demo-pw-2026"

STUDIO_ACCOUNTS: tuple[dict[str, str], ...] = (
    {"name": "Sana Holm", "email": "sana@example.com", "role": "lead"},
    {"name": "Ole Berg", "email": "ole@example.com", "role": "associate"},
)

CASES: tuple[dict[str, Any], ...] = (
    {
        "position": 1,
        "slug": "maison-vey",
        "client": "Maison Vey",
        "industry": "Luxury",
        "theme": "ink",
        "awards": ["Site of the Day", "Developer Award"],
        "headline": "A quiet house, rebuilt around the object.",
        "body": [
            "Maison Vey came to us with four decades of atelier work and a website that "
            "hid all of it. We rebuilt the house around the object: one garment, one "
            "frame, one slow turn of the page.",
            "The result is a catalogue that behaves like a gallery. Stock, stories and "
            "stockists all run from one editorial spine, so the atelier publishes in an "
            "afternoon what used to take a fortnight.",
        ],
        "testimonial_quote": "They gave our archive a room to breathe in, and our sales "
        "team a tool they actually enjoy.",
        "testimonial_name": "Camille Vey",
        "testimonial_role": "Creative Director, Maison Vey",
        "cover_seed": 1471,
    },
    {
        "position": 2,
        "slug": "halden-labs",
        "client": "Halden Labs",
        "industry": "AI Technologies",
        "theme": "orange",
        "awards": [],
        "headline": "Making a research lab legible to the people who fund it.",
        "body": [
            "Halden Labs builds forecasting models for grid operators. Their science was "
            "excellent and entirely invisible, so we gave each model a page, a plain "
            "sentence and a number that moves.",
            "We paired a warm orange identity with a documentation system the researchers "
            "maintain themselves. Enquiries from utilities trebled in the first quarter "
            "after launch.",
        ],
        "testimonial_quote": "Our models finally read like something you could buy, not "
        "just something you could cite.",
        "testimonial_name": "Ingrid Halden",
        "testimonial_role": "Founder, Halden Labs",
        "cover_seed": 2208,
    },
    {
        "position": 3,
        "slug": "kvarn-group",
        "client": "Kvarn Group",
        "industry": "Business Solutions",
        "theme": "clay",
        "awards": [],
        "headline": "One holding company, seven voices, finally in tune.",
        "body": [
            "Kvarn had grown by acquisition and spoke in seven accents at once. We drew a "
            "single clay-toned system flexible enough to let each company keep its "
            "character.",
            "A shared component library now carries all seven sites. New acquisitions are "
            "online in weeks, and the group reports on them as one business.",
        ],
        "testimonial_quote": "We stopped arguing about logos and started arguing about "
        "strategy, which is the right argument to have.",
        "testimonial_name": "Petter Kvarn",
        "testimonial_role": "Group Managing Director, Kvarn Group",
        "cover_seed": 3390,
    },
    {
        "position": 4,
        "slug": "ostra-health",
        "client": "Ostra Health",
        "industry": "Health Tech",
        "theme": "violet",
        "awards": [],
        "headline": "A referral path a worried person can follow.",
        "body": [
            "Ostra routes referrals between clinics across three regions. Patients "
            "experienced it as a silence. We turned the silence into a path with named "
            "steps and honest waiting times.",
            "Every screen was tested with patients over sixty-five and with nurses on "
            "shift. Missed appointments fell by a fifth in the first six months.",
        ],
        "testimonial_quote": "Our patients know where they are now. That is the whole "
        "product, and Northpier understood it immediately.",
        "testimonial_name": "Dr Aila Rosen",
        "testimonial_role": "Clinical Lead, Ostra Health",
        "cover_seed": 4512,
    },
    {
        "position": 5,
        "slug": "lumen-bio",
        "client": "Lumen Bio",
        "industry": "Bio Tech",
        "theme": "lemon",
        "awards": [],
        "headline": "Twelve years of pipeline on one honest page.",
        "body": [
            "Lumen Bio needed to raise without overpromising. We built a pipeline page "
            "that states each programme's phase, its risks and its next readout, in "
            "language a generalist investor can hold.",
            "An acid lemon palette gives the science room to be dense. The same system "
            "now carries their recruitment and their regulatory updates.",
        ],
        "testimonial_quote": "The clarity was uncomfortable at first. Then it closed our "
        "round.",
        "testimonial_name": "Nils Agder",
        "testimonial_role": "Chief Executive, Lumen Bio",
        "cover_seed": 5634,
    },
    {
        "position": 6,
        "slug": "sola-rooms",
        "client": "Sola Rooms",
        "industry": "Hospitality",
        "theme": "sand",
        "awards": [],
        "headline": "Nine rooms, one long summer afternoon.",
        "body": [
            "Sola Rooms is a nine-room house on the Gotland coast. Its old site sold beds. "
            "We built one that sells the afternoon: the light, the walk down, the bread at "
            "seven.",
            "Booking sits inside the story rather than beside it. Direct reservations now "
            "outnumber those from the aggregators by three to one.",
        ],
        "testimonial_quote": "Guests arrive already knowing how the house feels. They "
        "settle in faster.",
        "testimonial_name": "Marta Sund",
        "testimonial_role": "Owner, Sola Rooms",
        "cover_seed": 6756,
    },
    {
        "position": 7,
        "slug": "fjell-energy",
        "client": "Fjell Energy",
        "industry": "Sustainability",
        "theme": "mist",
        "awards": [],
        "headline": "Reporting that a sceptic can check.",
        "body": [
            "Fjell Energy wanted its sustainability reporting to survive scrutiny, so we "
            "designed around the footnote. Every claim on the site links to the measurement "
            "that produced it.",
            "A pale mist palette keeps the data in front. Journalists and auditors now use "
            "the public site rather than asking for spreadsheets.",
        ],
        "testimonial_quote": "We used to defend our numbers. Now we publish them and let "
        "people look.",
        "testimonial_name": "Håkon Fjell",
        "testimonial_role": "Head of Communications, Fjell Energy",
        "cover_seed": 7878,
    },
    {
        "position": 8,
        "slug": "lesestund",
        "client": "Lesestund",
        "industry": "Education",
        "theme": "clay",
        "awards": [],
        "headline": "Twenty minutes of reading, every evening, without a fight.",
        "body": [
            "Lesestund helps families read together. The old app rewarded streaks and made "
            "everyone anxious, so we rebuilt it around the evening itself: pick a book, "
            "sit down, finish a chapter.",
            "We removed every badge and every push notification. Daily sessions rose by "
            "forty per cent once the pressure came off.",
        ],
        "testimonial_quote": "They took things away until the product worked. Very few "
        "studios will do that.",
        "testimonial_name": "Siri Lund",
        "testimonial_role": "Product Director, Lesestund",
        "cover_seed": 8990,
    },
)


def _fixture_token(reference: str) -> str:
    return f"seed-{reference.replace('-', '').lower()}-status-link"


def _seed_inquiries(start: datetime, today: date) -> list[dict[str, Any]]:
    """The seven seeded inquiries, with times relative to this first start."""

    def days_before(days: int) -> datetime:
        return start - timedelta(days=days)

    def call_on(day: date, hour: int) -> datetime:
        return stockholm_wall_clock_to_utc(datetime(day.year, day.month, day.day, hour, 0))

    booked_soon = call_on(studio_day_after(today, 3), 14)
    booked_past = call_on(studio_day_on_or_before(today - timedelta(days=2)), 10)
    won_call = call_on(studio_day_on_or_before(today - timedelta(days=14)), 11)

    return [
        {
            "reference": "NP-H4RV2K",
            "name": "Elin Strand",
            "email": "elin@example.com",
            "company": "Brightwater Ferries",
            "services": ["design", "development"],
            "budget": "75k_150k",
            "timeline": "within_3_months",
            "message": "We run six passenger ferries on the Stockholm archipelago and our "
            "booking site is twenty years old. We need a new site and a timetable people "
            "can read on a phone in the rain.",
            "status": "new",
            "call_at": None,
            "decline_reason": None,
            "version": 1,
            "created_at": days_before(6),
            "updated_at": days_before(6),
            "events": [{"to_status": "new", "at": days_before(6)}],
        },
        {
            "reference": "NP-T9WQ3M",
            "name": "Jonas Lind",
            "email": "jonas@example.com",
            "company": "Kelp and Co",
            "services": ["branding"],
            "budget": "25k_75k",
            "timeline": "3_to_6_months",
            "message": "We farm and sell sugar kelp. The product is good and the brand "
            "looks like a science project. We would like an identity that belongs in a "
            "kitchen.",
            "status": "new",
            "call_at": None,
            "decline_reason": None,
            "version": 1,
            "created_at": days_before(2),
            "updated_at": days_before(2),
            "events": [{"to_status": "new", "at": days_before(2)}],
        },
        {
            "reference": "NP-C6PZ8N",
            "name": "Aino Varga",
            "email": "aino@example.com",
            "company": "Northfield Clinics",
            "services": ["strategy", "design"],
            "budget": "over_150k",
            "timeline": "asap",
            "message": "Eleven clinics, eleven websites, one very tired communications "
            "team. We need a strategy for consolidating them and a design system that can "
            "carry the lot.",
            "status": "in_review",
            "call_at": None,
            "decline_reason": None,
            "version": 2,
            "created_at": days_before(5),
            "updated_at": days_before(4),
            "events": [
                {"to_status": "new", "at": days_before(5)},
                {
                    "action": "start_review",
                    "from_status": "new",
                    "to_status": "in_review",
                    "at": days_before(4),
                },
            ],
        },
        {
            "reference": "NP-M3XB7R",
            "name": "Rafael Costa",
            "email": "rafael@example.com",
            "company": "Tidewell Labs",
            "services": ["design", "development"],
            "budget": "75k_150k",
            "timeline": "within_3_months",
            "message": "We are building tide and current forecasting for small harbours. "
            "The maths works. The interface is a spreadsheet with ambitions and we would "
            "like your help.",
            "status": "call_booked",
            "call_at": booked_soon,
            "decline_reason": None,
            "version": 3,
            "created_at": days_before(4),
            "updated_at": days_before(1),
            "events": [
                {"to_status": "new", "at": days_before(4)},
                {
                    "action": "start_review",
                    "from_status": "new",
                    "to_status": "in_review",
                    "at": days_before(3),
                },
                {
                    "action": "book_call",
                    "from_status": "in_review",
                    "to_status": "call_booked",
                    "call_at": booked_soon,
                    "at": days_before(1),
                },
            ],
        },
        {
            "reference": "NP-Q7LD4V",
            "name": "Mira Falk",
            "email": "mira@example.com",
            "company": "Larkspur Audio",
            "services": ["design"],
            "budget": "25k_75k",
            "timeline": "asap",
            "message": "We make field recorders for documentary crews. We need a site that "
            "treats the hardware properly and explains the firmware without putting anyone "
            "to sleep.",
            "status": "call_booked",
            "call_at": booked_past,
            "decline_reason": None,
            "version": 3,
            "created_at": days_before(9),
            "updated_at": days_before(7),
            "events": [
                {"to_status": "new", "at": days_before(9)},
                {
                    "action": "start_review",
                    "from_status": "new",
                    "to_status": "in_review",
                    "at": days_before(8),
                },
                {
                    "action": "book_call",
                    "from_status": "in_review",
                    "to_status": "call_booked",
                    "call_at": booked_past,
                    "at": days_before(7),
                },
            ],
        },
        {
            "reference": "NP-W8DK5T",
            "name": "Hanna Moe",
            "email": "hanna@example.com",
            "company": "Quayside Books",
            "services": ["branding", "design"],
            "budget": "25k_75k",
            "timeline": "3_to_6_months",
            "message": "Two bookshops and a small press. We would like one identity across "
            "the three and a shop that does not make our booksellers cry at Christmas.",
            "status": "won",
            "call_at": won_call,
            "decline_reason": None,
            "version": 4,
            "created_at": days_before(25),
            "updated_at": days_before(10),
            "events": [
                {"to_status": "new", "at": days_before(25)},
                {
                    "action": "start_review",
                    "from_status": "new",
                    "to_status": "in_review",
                    "at": days_before(22),
                },
                {
                    "action": "book_call",
                    "from_status": "in_review",
                    "to_status": "call_booked",
                    "call_at": won_call,
                    "at": days_before(20),
                },
                {
                    "action": "mark_won",
                    "from_status": "call_booked",
                    "to_status": "won",
                    "call_at": won_call,
                    "at": days_before(10),
                },
            ],
        },
        {
            "reference": "NP-B2FJ9S",
            "name": "Lukas Weber",
            "email": "lukas@example.com",
            "company": "Harbor Garage",
            "services": ["development"],
            "budget": "under_25k",
            "timeline": "asap",
            "message": "We restore old outboard motors and need a booking page. Nothing "
            "fancy, but it has to work on a phone with oily hands.",
            "status": "declined",
            "call_at": None,
            "decline_reason": "budget",
            "version": 2,
            "created_at": days_before(45),
            "updated_at": days_before(40),
            "events": [
                {"to_status": "new", "at": days_before(45)},
                {
                    "action": "decline",
                    "from_status": "new",
                    "to_status": "declined",
                    "decline_reason": "budget",
                    "at": days_before(40),
                },
            ],
        },
    ]


def seed(conn: Connection) -> None:
    """Seed once into an empty database. Never duplicates rows and sends no email."""
    with conn.transaction():
        advisory_lock(conn, LOCK_SEED, 0)
        already = conn.execute("SELECT count(*) AS n FROM studio_users").fetchone()
        if already["n"]:
            return

        password_hash = hash_password(FIXTURE_PASSWORD)
        users: dict[str, int] = {}
        for account in STUDIO_ACCOUNTS:
            row = conn.execute(
                """
                INSERT INTO studio_users (name, email, role, password_hash)
                VALUES (%s, %s, %s, %s) RETURNING id
                """,
                (account["name"], account["email"], account["role"], password_hash),
            ).fetchone()
            users[account["role"]] = row["id"]
        lead_id = users["lead"]

        for case in CASES:
            conn.execute(
                """
                INSERT INTO cases (slug, client, industry, theme, headline, body, awards,
                                   testimonial_quote, testimonial_name, testimonial_role,
                                   cover_seed, position)
                VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s, %s, %s, %s)
                """,
                (
                    case["slug"],
                    case["client"],
                    case["industry"],
                    case["theme"],
                    case["headline"],
                    json_param(case["body"]),
                    json_param(case["awards"]),
                    case["testimonial_quote"],
                    case["testimonial_name"],
                    case["testimonial_role"],
                    case["cover_seed"],
                    case["position"],
                ),
            )

        start = now_utc()
        for inquiry in _seed_inquiries(start, stockholm_date_today(start)):
            row = conn.execute(
                """
                INSERT INTO inquiries (reference, status_token, name, email, company, services,
                                       budget, timeline, message, status, call_at,
                                       decline_reason, version, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    inquiry["reference"],
                    _fixture_token(inquiry["reference"]),
                    inquiry["name"],
                    inquiry["email"],
                    inquiry["company"],
                    json_param(inquiry["services"]),
                    inquiry["budget"],
                    inquiry["timeline"],
                    inquiry["message"],
                    inquiry["status"],
                    inquiry["call_at"],
                    inquiry["decline_reason"],
                    inquiry["version"],
                    inquiry["created_at"],
                    inquiry["updated_at"],
                ),
            ).fetchone()
            for event in inquiry["events"]:
                action = event.get("action")
                conn.execute(
                    """
                    INSERT INTO status_events (inquiry_id, action, from_status, to_status,
                                               call_at, decline_reason, actor_id, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        row["id"],
                        action,
                        event.get("from_status"),
                        event["to_status"],
                        event.get("call_at"),
                        event.get("decline_reason"),
                        lead_id if action else None,
                        event["at"],
                    ),
                )
