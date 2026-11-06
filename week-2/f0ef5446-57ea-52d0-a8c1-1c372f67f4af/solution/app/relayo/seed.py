"""Idempotent seeding of the public corpus; rows are matched by slug, headline and date, or title."""

from __future__ import annotations

from . import db
from .seed_data import ARTICLES, AUTHORS, INTEGRATIONS, JOBS, PRESS_ITEMS, RESOURCE_CARDS

SEED_LOCK = 4_173_001


def seed_corpus(conn: db.Connection) -> None:
    for slug, name, category, published, description in INTEGRATIONS:
        conn.run("INSERT INTO integrations (slug, name, description, category, icon_ref, published) "
                 "VALUES (:slug, :name, :description, :category, :icon_ref, :published) ON CONFLICT (slug) DO NOTHING",
                 slug=slug, name=name, description=description, category=category,
                 icon_ref=f"/media/integrations/{slug}.svg", published=published)
    for slug, title, category, author, minutes, published_at, published, summary, body in ARTICLES:
        conn.run("INSERT INTO articles (slug, title, category, summary, author, read_time, cover_ref, body, "
                 "published_at, published) VALUES (:slug, :title, :category, :summary, :author, :minutes, "
                 ":cover_ref, :body, CAST(:published_at AS timestamptz), :published) ON CONFLICT (slug) DO NOTHING",
                 slug=slug, title=title, category=category, summary=summary, author=AUTHORS[author],
                 minutes=minutes, cover_ref=f"/media/articles/{slug}.svg", body="\n\n".join(body),
                 published_at=published_at, published=published)
    for day, category, headline, published in PRESS_ITEMS:
        link = "https://relayo.example/press/" + "-".join(headline.lower().replace(",", "").split()[:8])
        conn.run("INSERT INTO press_items (date, category, headline, link, published) "
                 "VALUES (CAST(:day AS date), :category, :headline, :link, :published) "
                 "ON CONFLICT (headline, date) DO NOTHING",
                 day=day, category=category, headline=headline, link=link, published=published)
    for title, location, is_open in JOBS:
        conn.run("INSERT INTO jobs (title, location, is_open) VALUES (:title, :location, :is_open) "
                 "ON CONFLICT (title) DO NOTHING", title=title, location=location, is_open=is_open)
    for block, category, title, day, summary, slug in RESOURCE_CARDS:
        conn.run("INSERT INTO resource_cards (block, category, title, date, summary, target_link, published) "
                 "VALUES (:block, :category, :title, CAST(:day AS date), :summary, :link, true) "
                 "ON CONFLICT (title) DO NOTHING", block=block, category=category, title=title, day=day,
                 summary=summary, link=f"https://relayo.example/resources/{slug}")


def prepare_database() -> None:
    """Schema and corpus in one transaction, serialised across every instance sharing the database."""
    with db.transaction() as conn:
        conn.run("SELECT pg_advisory_xact_lock(:lock)", lock=SEED_LOCK)
        db.create_schema(conn)
        seed_corpus(conn)
