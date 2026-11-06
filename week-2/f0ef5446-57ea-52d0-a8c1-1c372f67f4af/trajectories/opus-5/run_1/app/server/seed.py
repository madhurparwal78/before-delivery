"""Seeding the corpus on every start, without duplicating a row."""

from __future__ import annotations

from datetime import date, datetime

import asyncpg

from .seeddata import ARTICLES, INTEGRATIONS, JOBS, PRESS_ITEMS, RESOURCE_CARDS, article_body

MATCHING_INDEXES = (
    """
    CREATE UNIQUE INDEX IF NOT EXISTS press_items_headline_date
        ON press_items (headline, date)
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS jobs_title ON jobs (title)",
    "CREATE UNIQUE INDEX IF NOT EXISTS resource_cards_title ON resource_cards (title)",
)


def icon_ref(slug: str) -> str:
    return f"/media/integrations/{slug}.svg"


def cover_ref(slug: str) -> str:
    return f"/media/articles/{slug}.svg"


def _press_link(headline: str) -> str:
    slug = "".join(char if char.isalnum() else "-" for char in headline.lower())
    return f"https://relayo.example/newsroom/{'-'.join(part for part in slug.split('-') if part)}"


async def seed_corpus(connection: asyncpg.Connection) -> None:
    for statement in MATCHING_INDEXES:
        await connection.execute(statement)

    await connection.executemany(
        """
        INSERT INTO integrations (slug, name, description, category, icon_ref, published)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (slug) DO NOTHING
        """,
        [
            (
                item.slug,
                item.name,
                item.description,
                item.category,
                icon_ref(item.slug),
                item.published,
            )
            for item in INTEGRATIONS
        ],
    )

    await connection.executemany(
        """
        INSERT INTO articles (slug, title, category, summary, author, read_time,
                              cover_ref, body, published_at, published)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (slug) DO NOTHING
        """,
        [
            (
                item.slug,
                item.title,
                item.category,
                item.summary,
                item.author,
                item.read_time,
                cover_ref(item.slug),
                article_body(item),
                datetime.fromisoformat(item.published_at.replace("Z", "+00:00")),
                item.published,
            )
            for item in ARTICLES
        ],
    )

    await connection.executemany(
        """
        INSERT INTO press_items (date, category, headline, link, published)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (headline, date) DO NOTHING
        """,
        [
            (
                date.fromisoformat(item.date),
                item.category,
                item.headline,
                _press_link(item.headline),
                item.published,
            )
            for item in PRESS_ITEMS
        ],
    )

    await connection.executemany(
        """
        INSERT INTO jobs (title, location, is_open)
        VALUES ($1, $2, $3)
        ON CONFLICT (title) DO NOTHING
        """,
        [(item.title, item.location, item.is_open) for item in JOBS],
    )

    await connection.executemany(
        """
        INSERT INTO resource_cards (block, category, title, date, summary, target_link,
                                    published)
        VALUES ($1, $2, $3, $4, $5, $6, true)
        ON CONFLICT (title) DO NOTHING
        """,
        [
            (
                item.block,
                item.category,
                item.title,
                date.fromisoformat(item.date),
                item.summary,
                "/resources",
            )
            for item in RESOURCE_CARDS
        ],
    )
