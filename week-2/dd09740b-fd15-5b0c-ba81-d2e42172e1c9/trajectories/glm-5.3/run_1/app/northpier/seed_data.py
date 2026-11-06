"""Seed data: accounts, cases and inquiries with fixture status tokens."""
from __future__ import annotations

import datetime as dt
from typing import Any

import psycopg
from psycopg.types.json import Json

from . import auth, rules
from .labels import Stockholm

FIXTURE_PASSWORD = "deku-demo-pw-2026"

ACCOUNTS = [
    {"name": "Sana Holm", "email": "sana@example.com", "role": "lead"},
    {"name": "Ole Berg", "email": "ole@example.com", "role": "associate"},
]

CASES = [
    {
        "slug": "maison-vey",
        "client": "Maison Vey",
        "industry": "Luxury",
        "theme": "ink",
        "position": 1,
        "cover_seed": 411802,
        "headline": "A quiet house of craft, told in digital form",
        "body": [
            "Maison Vey asked us for a site that felt like stepping inside their atelier: unhurried, exact and warm. We rebuilt their story around the objects themselves, with typography that steps back and photography that leads.",
            "Under the surface we shaped a small commerce layer that keeps the ritual of the house intact, from private viewings to the wrapping of a single order. Everything loads fast, on any line, anywhere.",
        ],
        "awards": ["Site of the Day", "Developer Award"],
        "testimonial": {
            "quote": "They treated our archive with the care of a conservator and the nerve of a startup.",
            "name": "Camille Vey",
            "role": "Creative Director",
        },
    },
    {
        "slug": "halden-labs",
        "client": "Halden Labs",
        "industry": "AI Technologies",
        "theme": "orange",
        "position": 2,
        "cover_seed": 9714,
        "headline": "Research that reads like a product",
        "body": [
            "Halden Labs builds tooling for machine-learning teams, and their own story had fallen behind their work. We gave the lab a plain-spoken identity and a site that explains hard ideas without dumbing them down.",
            "We designed around the notebook, the dataset and the run log, so the people they hire recognise themselves within seconds. The result is a site their researchers are proud to send to a peer.",
        ],
        "awards": [],
        "testimonial": {
            "quote": "The site says in one scroll what our deck struggled to say in forty slides.",
            "name": "Priya Halden",
            "role": "Co-founder",
        },
    },
    {
        "slug": "kvarn-group",
        "client": "Kvarn Group",
        "industry": "Business Solutions",
        "theme": "clay",
        "position": 3,
        "cover_seed": 220977,
        "headline": "An old mill rebranded for new machinery",
        "body": [
            "Kvarn Group has moved grain, then goods, then data for over ninety years. The new identity keeps the weight of that history and drops the dust, with a mark that turns on any scale from barge to invoice.",
            "We rolled the brand across fleet, signage and a long-overdue site, and wrote the language of the group in the same plain tone their customers already use on the phone.",
        ],
        "awards": [],
        "testimonial": {
            "quote": "Our own drivers finally recognise the company they work for.",
            "name": "Ilse Kvarn",
            "role": "Group CEO",
        },
    },
    {
        "slug": "ostra-health",
        "client": "Ostra Health",
        "industry": "Health Tech",
        "theme": "violet",
        "position": 4,
        "cover_seed": 63109,
        "headline": "Care that explains itself calmly",
        "body": [
            "Ostra Health connects patients with clinicians across the Nordics, and the product had outgrown its first-year look. We rebuilt the interface around reassurance: fewer steps, plainer words, no alarms unless something is wrong.",
            "The new design system carries the app, the marketing site and the clinician console, so the whole company now ships from one set of parts.",
        ],
        "awards": [],
        "testimonial": {
            "quote": "Support calls about the interface dropped by half in the first month.",
            "name": "Dr. Nils Aaro",
            "role": "Chief Medical Officer",
        },
    },
    {
        "slug": "lumen-bio",
        "client": "Lumen Bio",
        "industry": "Bio Tech",
        "theme": "lemon",
        "position": 5,
        "cover_seed": 158442,
        "headline": "A bright stage for dark-lab science",
        "body": [
            "Lumen Bio engineers enzymes for cleaner manufacturing, and their science deserved better than dense diagrams. We built a site that leads with outcomes: less water, less heat, less waste, each shown as one plain number.",
            "For the investor side we designed a data room that their team can update without us, with templates that keep every chart in the same voice.",
        ],
        "awards": [],
        "testimonial": {
            "quote": "Investors mention the site in the first five minutes of every meeting.",
            "name": "Sofia Lumen",
            "role": "Founder",
        },
    },
    {
        "slug": "sola-rooms",
        "client": "Sola Rooms",
        "industry": "Hospitality",
        "theme": "sand",
        "position": 6,
        "cover_seed": 83501,
        "headline": "Booking a room that feels like arriving",
        "body": [
            "Sola Rooms runs three small hotels where the welcome is the product. We made a site that behaves like their front desk: it remembers your preferences, suggests the quiet floor and never rushes the checkout.",
            "The booking flow is four screens long and has a fallback for every failure, because a lost guest at midnight is a lost guest for good.",
        ],
        "awards": [],
        "testimonial": {
            "quote": "Guests tell us the site feels like the hotel, which is the best review we have.",
            "name": "Marek Sola",
            "role": "Owner",
        },
    },
    {
        "slug": "fjell-energy",
        "client": "Fjell Energy",
        "industry": "Sustainability",
        "theme": "mist",
        "position": 7,
        "cover_seed": 40716,
        "headline": "Numbers that make the north proud",
        "body": [
            "Fjell Energy builds wind farms above the Arctic Circle, and their reporting was a spreadsheet with a logo. We turned their output into a public dashboard their municipalities can read without a translator.",
            "Alongside it we rewrote their story around the communities that host the turbines, with photography from the valleys the farms actually stand in.",
        ],
        "awards": [],
        "testimonial": {
            "quote": "The dashboard ended a decade of arguments at the council table.",
            "name": "Ingrid Fjell",
            "role": "Head of Communications",
        },
    },
    {
        "slug": "lesestund",
        "client": "Lesestund",
        "industry": "Education",
        "theme": "clay",
        "position": 8,
        "cover_seed": 529038,
        "headline": "A reading corner the whole class shares",
        "body": [
            "Lesestund is a reading programme for early schools, and teachers were printing pages to make it work. We made a light app that keeps the ritual of story time and removes everything around it.",
            "Children choose books by cover, teachers see who is halfway through what, and nothing in the interface can be tapped by accident.",
        ],
        "awards": [],
        "testimonial": {
            "quote": "Six-year-olds now argue about whose turn it is to choose the book.",
            "name": "Tor Lesund",
            "role": "Programme Lead",
        },
    },
]


def fixture_token(reference: str) -> str:
    return "seed-" + reference.lower().replace("-", "") + "-status-link"


INQUIRY_MESSAGES = {
    "NP-H4RV2K": "We run ferries between the islands and our booking flow is from another century. We need a full redesign and a rebuild before next summer season.",
    "NP-T9WQ3M": "Our packaging has not changed since the nineties and it shows. We want a new identity that still feels like the old shop on the corner.",
    "NP-C6PZ8N": "We are opening two new clinics and need help thinking through the patient journey first, then a site and booking tools that follow.",
    "NP-M3XB7R": "Tidewell makes water sensors and our product is great but our story is invisible. We need a redesign and development help for the launch in spring.",
    "NP-Q7LD4V": "We build hand-made audio gear and the site no longer matches the product. A redesign is enough, we can handle photography ourselves.",
    "NP-W8DK5T": "We are a small bookshop going online properly for the first time. We need a brand refresh and a simple site our booksellers can update.",
    "NP-B2FJ9S": "The garage needs a site where people can book service slots. Simple enough, but it has to work on every phone our customers own.",
}

INQUIRIES: list[dict[str, Any]] = [
    {
        "reference": "NP-H4RV2K", "name": "Elin Strand", "email": "elin@example.com",
        "company": "Brightwater Ferries", "services": ["design", "development"],
        "budget": "75k_150k", "timeline": "within_3_months", "status": "new",
        "token": fixture_token("NP-H4RV2K"), "age_days": 6,
        "steps": [],
    },
    {
        "reference": "NP-T9WQ3M", "name": "Jonas Lind", "email": "jonas@example.com",
        "company": "Kelp and Co", "services": ["branding"],
        "budget": "25k_75k", "timeline": "3_to_6_months", "status": "new",
        "token": fixture_token("NP-T9WQ3M"), "age_days": 2,
        "steps": [],
    },
    {
        "reference": "NP-C6PZ8N", "name": "Aino Varga", "email": "aino@example.com",
        "company": "Northfield Clinics", "services": ["strategy", "design"],
        "budget": "over_150k", "timeline": "asap", "status": "in_review",
        "token": fixture_token("NP-C6PZ8N"), "age_days": 5,
        "steps": [("start_review", None, 4)],
    },
    {
        "reference": "NP-M3XB7R", "name": "Rafael Costa", "email": "rafael@example.com",
        "company": "Tidewell Labs", "services": ["design", "development"],
        "budget": "75k_150k", "timeline": "within_3_months", "status": "call_booked",
        "token": fixture_token("NP-M3XB7R"), "age_days": 4,
        "steps": [("start_review", None, 3), ("book_call", 1, 1)],
        "call_rule": "third_studio_day", "call_hour": 14,
    },
    {
        "reference": "NP-Q7LD4V", "name": "Mira Falk", "email": "mira@example.com",
        "company": "Larkspur Audio", "services": ["design"],
        "budget": "25k_75k", "timeline": "asap", "status": "call_booked",
        "token": fixture_token("NP-Q7LD4V"), "age_days": 9,
        "steps": [("start_review", None, 8), ("book_call", 7, 7)],
        "call_rule": "last_studio_day_before", "call_rule_days": 2, "call_hour": 10,
    },
    {
        "reference": "NP-W8DK5T", "name": "Hanna Moe", "email": "hanna@example.com",
        "company": "Quayside Books", "services": ["branding", "design"],
        "budget": "25k_75k", "timeline": "3_to_6_months", "status": "won",
        "token": fixture_token("NP-W8DK5T"), "age_days": 25,
        "steps": [
            ("start_review", None, 22),
            ("book_call", 20, 20),
            ("mark_won", None, 10),
        ],
        "call_rule": "last_studio_day_before", "call_rule_days": 14, "call_hour": 11,
    },
    {
        "reference": "NP-B2FJ9S", "name": "Lukas Weber", "email": "lukas@example.com",
        "company": "Harbor Garage", "services": ["development"],
        "budget": "under_25k", "timeline": "asap", "status": "declined",
        "token": fixture_token("NP-B2FJ9S"), "age_days": 45,
        "steps": [("decline", "budget", 40)],
    },
]


def _third_studio_day_after(date: dt.date) -> dt.date:
    cursor = date
    seen = 0
    while seen < 3:
        cursor += dt.timedelta(days=1)
        if rules.is_studio_day(cursor):
            seen += 1
    return cursor


def _last_studio_day_at_least_days_before(date: dt.date, days: int) -> dt.date:
    target = date - dt.timedelta(days=days)
    cursor = target
    while not rules.is_studio_day(cursor):
        cursor -= dt.timedelta(days=1)
    return cursor


def seed_call_time(now_utc: dt.datetime, spec: dict) -> tuple[dt.datetime, dt.date]:
    stockholm_now = now_utc.astimezone(Stockholm)
    today = stockholm_now.date()
    if spec["call_rule"] == "third_studio_day":
        day = _third_studio_day_after(today)
    else:
        day = _last_studio_day_at_least_days_before(today, spec["call_rule_days"])
    wall = dt.datetime.combine(day, dt.time(spec["call_hour"], 0))
    return wall.replace(tzinfo=Stockholm).astimezone(dt.timezone.utc)


def seed(conn) -> None:
    """Seed accounts, cases and inquiries exactly once into an empty database."""
    if conn.execute("SELECT 1 FROM studio_users LIMIT 1").fetchone():
        return
    now = dt.datetime.now(dt.timezone.utc)
    password_hash = auth.hash_password(FIXTURE_PASSWORD)
    for account in ACCOUNTS:
        conn.execute(
            """
            INSERT INTO studio_users (name, email, role, password_hash, created_at)
            VALUES (%(n)s, %(e)s, %(r)s, %(p)s, %(created)s)
            """,
            {
                "n": account["name"], "e": account["email"], "r": account["role"],
                "p": password_hash, "created": now,
            },
        )
    lead = conn.execute(
        "SELECT id FROM studio_users WHERE email = 'sana@example.com'"
    ).fetchone()["id"]

    for case in CASES:
        conn.execute(
            """
            INSERT INTO cases (slug, client, industry, theme, headline, body, awards,
                               testimonial_quote, testimonial_name, testimonial_role,
                               cover_seed, position)
            VALUES (%(slug)s, %(client)s, %(industry)s, %(theme)s, %(headline)s, %(body)s,
                    %(awards)s, %(tq)s, %(tn)s, %(tr)s, %(seed)s, %(position)s)
            """,
            {
                **case,
                "body": Json(case["body"]),
                "awards": Json(case["awards"]),
                "tq": case["testimonial"]["quote"],
                "tn": case["testimonial"]["name"],
                "tr": case["testimonial"]["role"],
                "seed": case["cover_seed"],
            },
        )

    for spec in INQUIRIES:
        created_at = now - dt.timedelta(days=spec["age_days"])
        call_at = seed_call_time(now, spec) if "call_rule" in spec else None
        row = conn.execute(
            """
            INSERT INTO inquiries (reference, name, email, company, services, budget, timeline,
                                   message, status, call_at, decline_reason, version, status_token,
                                   created_at, updated_at)
            VALUES (%(reference)s, %(name)s, %(email)s, %(company)s, %(services)s, %(budget)s,
                    %(timeline)s, %(message)s, %(status)s, %(call_at)s, %(reason)s, 1,
                    %(token)s, %(created)s, %(created)s)
            RETURNING id
            """,
            {
                **spec,
                "services": Json(spec["services"]),
                "message": INQUIRY_MESSAGES[spec["reference"]],
                "call_at": call_at,
                "reason": None,
                "created": created_at,
            },
        ).fetchone()
        inquiry_id = row["id"]
        conn.execute(
            """
            INSERT INTO status_events
                (inquiry_id, action, from_status, to_status, call_at, decline_reason, actor_id, created_at)
            VALUES (%(i)s, NULL, NULL, 'new', NULL, NULL, NULL, %(created)s)
            """,
            {"i": inquiry_id, "created": created_at},
        )
        version = 1
        status = "new"
        for action, reason, days_before in spec["steps"]:
            happened_at = now - dt.timedelta(days=days_before)
            from_status = status
            if action == "start_review":
                status = "in_review"
            elif action == "book_call":
                status = "call_booked"
            elif action == "mark_won":
                status = "won"
            elif action == "decline":
                status = "declined"
            version += 1
            step_call = call_at if action == "book_call" else None
            conn.execute(
                """
                INSERT INTO status_events
                    (inquiry_id, action, from_status, to_status, call_at, decline_reason, actor_id, created_at)
                VALUES (%(i)s, %(a)s, %(f)s, %(t)s, %(c)s, %(r)s, %(actor)s, %(when)s)
                """,
                {
                    "i": inquiry_id, "a": action, "f": from_status, "t": status,
                    "c": step_call, "r": reason, "actor": lead, "when": happened_at,
                },
            )
            conn.execute(
                """
                UPDATE inquiries
                   SET status = %(s)s, decline_reason = %(r)s, version = %(v)s, updated_at = %(when)s
                 WHERE id = %(i)s
                """,
                {"s": status, "r": reason, "v": version, "when": happened_at, "i": inquiry_id},
            )
