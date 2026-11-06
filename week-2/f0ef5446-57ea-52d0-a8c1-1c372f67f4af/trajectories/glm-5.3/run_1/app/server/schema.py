"""Idempotent schema creation and corpus seeding.

Seeding runs on every start and duplicates nothing: rows are matched by slug,
by headline and date, or by title (Business rules under Seed data).
"""
from __future__ import annotations

import datetime as dt

SCHEMA = """
CREATE TABLE IF NOT EXISTS partner_applications (
    id SERIAL PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    work_email TEXT NOT NULL,
    job_title TEXT NOT NULL,
    company_name TEXT NOT NULL,
    website TEXT NOT NULL,
    company_type TEXT NOT NULL,
    employee_band TEXT NOT NULL,
    markets JSONB NOT NULL,
    customer_segment TEXT NOT NULL,
    partnership_interests JSONB NOT NULL,
    goals TEXT NOT NULL,
    consent BOOLEAN NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reviewer TEXT,
    decision_note TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    decided_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_applications_work_email_key
    ON partner_applications (work_email);
CREATE UNIQUE INDEX IF NOT EXISTS partner_applications_decision_once
    ON partner_applications (id) WHERE status <> 'pending';

CREATE TABLE IF NOT EXISTS outbound_emails (
    id SERIAL PRIMARY KEY,
    application_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    UNIQUE (application_id, kind)
);

CREATE TABLE IF NOT EXISTS sign_in_failures (
    id SERIAL PRIMARY KEY,
    email_key TEXT NOT NULL,
    failed_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sign_in_failures_key_time
    ON sign_in_failures (email_key, failed_at);

CREATE TABLE IF NOT EXISTS integrations (
    id SERIAL PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    icon_ref TEXT NOT NULL,
    published BOOLEAN NOT NULL
);

CREATE TABLE IF NOT EXISTS articles (
    id SERIAL PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    summary TEXT NOT NULL,
    author TEXT NOT NULL,
    read_time INTEGER NOT NULL,
    cover_ref TEXT NOT NULL,
    body TEXT NOT NULL,
    published_at TIMESTAMPTZ NOT NULL,
    published BOOLEAN NOT NULL
);

CREATE TABLE IF NOT EXISTS press_items (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    category TEXT NOT NULL,
    headline TEXT NOT NULL,
    link TEXT NOT NULL,
    published BOOLEAN NOT NULL,
    UNIQUE (headline, date)
);

CREATE TABLE IF NOT EXISTS jobs (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    location TEXT NOT NULL,
    is_open BOOLEAN NOT NULL,
    UNIQUE (title)
);

CREATE TABLE IF NOT EXISTS resource_cards (
    id SERIAL PRIMARY KEY,
    block TEXT NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    date DATE NOT NULL,
    summary TEXT NOT NULL,
    target_link TEXT NOT NULL,
    published BOOLEAN NOT NULL,
    UNIQUE (title)
);

CREATE TABLE IF NOT EXISTS refused_tokens (
    id SERIAL PRIMARY KEY,
    token_hash TEXT UNIQUE NOT NULL,
    refused_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    key TEXT PRIMARY KEY,
    request_hash TEXT NOT NULL,
    status INTEGER,
    error_code TEXT,
    body TEXT,
    first_used_at TIMESTAMPTZ NOT NULL,
    locked_at TIMESTAMPTZ,
    application_id INTEGER
);
CREATE INDEX IF NOT EXISTS idempotency_keys_locked
    ON idempotency_keys (locked_at);
"""


def apply_schema(conn) -> None:
    with conn.cursor() as cur:
        for statement in SCHEMA.split(";"):
            if statement.strip():
                cur.execute(statement)


def seed_corpus(conn) -> None:
    from .seed_data import (
        ARTICLES, INTEGRATIONS, JOBS, PRESS_ITEMS, RESOURCE_CARDS,
    )

    with conn.cursor() as cur:
        for slug, name, category, description, published in INTEGRATIONS:
            cur.execute(
                "INSERT INTO integrations (slug, name, description, category,"
                " icon_ref, published) VALUES (%s,%s,%s,%s,%s,%s)"
                " ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name,"
                " description=EXCLUDED.description, category=EXCLUDED.category,"
                " icon_ref=EXCLUDED.icon_ref, published=EXCLUDED.published",
                (slug, name, description, category,
                 f"/media/integrations/{slug}.svg", published),
            )
        for slug, title, category, author, read_time, published_at, published, body in ARTICLES:
            cur.execute(
                "INSERT INTO articles (slug, title, category, summary, author,"
                " read_time, cover_ref, body, published_at, published)"
                " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"
                " ON CONFLICT (slug) DO UPDATE SET title=EXCLUDED.title,"
                " category=EXCLUDED.category, summary=EXCLUDED.summary,"
                " author=EXCLUDED.author, read_time=EXCLUDED.read_time,"
                " cover_ref=EXCLUDED.cover_ref, body=EXCLUDED.body,"
                " published_at=EXCLUDED.published_at,"
                " published=EXCLUDED.published",
                (slug, title, category, _summary_for(body), author, read_time,
                 f"/media/articles/{slug}.svg", body,
                 dt.datetime.fromisoformat(published_at.replace("Z", "+00:00")),
                 published),
            )
        for date, category, headline, published in PRESS_ITEMS:
            cur.execute(
                "INSERT INTO press_items (date, category, headline, link,"
                " published) VALUES (%s,%s,%s,%s,%s)"
                " ON CONFLICT (headline, date) DO UPDATE SET"
                " category=EXCLUDED.category, link=EXCLUDED.link,"
                " published=EXCLUDED.published",
                (dt.date.fromisoformat(date), category, headline,
                 f"https://example.com/relayo/press/{headline.lower().replace(' ', '-')}", published),
            )
        for title, location, is_open in JOBS:
            cur.execute(
                "INSERT INTO jobs (title, location, is_open) VALUES (%s,%s,%s)"
                " ON CONFLICT (title) DO UPDATE SET"
                " location=EXCLUDED.location, is_open=EXCLUDED.is_open",
                (title, location, is_open),
            )
        for block, category, title, date, summary, target_link in RESOURCE_CARDS:
            cur.execute(
                "INSERT INTO resource_cards (block, category, title, date,"
                " summary, target_link, published) VALUES (%s,%s,%s,%s,%s,%s,%s)"
                " ON CONFLICT (title) DO UPDATE SET block=EXCLUDED.block,"
                " category=EXCLUDED.category, date=EXCLUDED.date,"
                " summary=EXCLUDED.summary,"
                " target_link=EXCLUDED.target_link,"
                " published=EXCLUDED.published",
                (block, category, title, dt.date.fromisoformat(date), summary,
                 target_link, True),
            )


def _summary_for(body: str) -> str:
    sentences = [part.strip() for part in body.split(". ") if part.strip()]
    return ". ".join(sentences[:2]).rstrip(".") + "."


def integration_slugs() -> list[str]:
    from .seed_data import INTEGRATIONS

    return [row[0] for row in INTEGRATIONS]


def article_slugs() -> list[str]:
    from .seed_data import ARTICLES

    return [row[0] for row in ARTICLES]
