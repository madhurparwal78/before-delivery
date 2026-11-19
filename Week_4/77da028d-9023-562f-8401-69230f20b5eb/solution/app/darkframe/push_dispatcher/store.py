"""Schema `push_dispatcher`: pushes and reminder settings. It also reads and marks the sky engine's verdict outbox,
the one place a service touches another's table."""
from datetime import date, datetime
from typing import Any

import asyncpg

from darkframe.common.ids import new_id, seed_id
from darkframe.rules.timestamps import utc_text

SCHEMA = """
CREATE SCHEMA IF NOT EXISTS push_dispatcher;
CREATE TABLE IF NOT EXISTS push_dispatcher.pushes (
  seq bigserial PRIMARY KEY, id text NOT NULL UNIQUE, imager_id text NOT NULL, kind text NOT NULL,
  observing_date date NOT NULL, title text NOT NULL, message text NOT NULL, topic text NOT NULL,
  status text NOT NULL DEFAULT 'queued', attempts integer NOT NULL DEFAULT 0, last_attempt_at timestamptz,
  sent_at timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT now(), outbox_id bigint UNIQUE,
  remind_utc timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (imager_id, remind_utc));
CREATE INDEX IF NOT EXISTS pushes_imager ON push_dispatcher.pushes (imager_id);
CREATE TABLE IF NOT EXISTS push_dispatcher.reminders (
  imager_id text PRIMARY KEY, enabled boolean NOT NULL, local_time text NOT NULL, enabled_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS push_dispatcher.meta (name text PRIMARY KEY);
"""
DEFAULT_REMINDER_TIME = "18:00"


async def migrate(connection: asyncpg.Connection) -> None:
    await connection.execute(SCHEMA)
    if await connection.fetchval("SELECT 1 FROM push_dispatcher.meta WHERE name = 'seed'"):
        return
    for person, enabled in (("ines", True), ("tomasz", False)):
        await connection.execute("INSERT INTO push_dispatcher.reminders VALUES ($1, $2, $3, now()) ON CONFLICT DO NOTHING",
                                 seed_id(f"imager:{person}"), enabled, DEFAULT_REMINDER_TIME)
    await connection.execute("INSERT INTO push_dispatcher.meta VALUES ('seed')")


def push_body(row: asyncpg.Record) -> dict[str, Any]:
    return {"id": row["id"], "kind": row["kind"], "date": row["observing_date"].isoformat(), "title": row["title"],
            "message": row["message"], "status": row["status"], "attempts": row["attempts"],
            "last_attempt_at": utc_text(row["last_attempt_at"]) if row["last_attempt_at"] else None, "sent_at": utc_text(row["sent_at"]) if row["sent_at"] else None}


async def take_outbox(connection: asyncpg.Connection) -> None:
    """Take each unclaimed outbox row once and queue one push for it."""
    await connection.execute(
        "WITH taken AS (UPDATE sky_engine.verdict_outbox SET taken_at = now() WHERE id IN ("
        "SELECT id FROM sky_engine.verdict_outbox WHERE taken_at IS NULL ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 50) "
        "RETURNING *) INSERT INTO push_dispatcher.pushes (id, imager_id, kind, observing_date, title, message, topic, outbox_id) "
        "SELECT replace(gen_random_uuid()::text, '-', ''), imager_id, 'verdict', observing_date, title, message, topic, id "
        "FROM taken")


async def queue_reminder(connection: asyncpg.Connection, imager: str, remind_utc: datetime, observing: date, title: str,
                         message: str, topic: str) -> None:
    await connection.execute(
        "INSERT INTO push_dispatcher.pushes (id, imager_id, kind, observing_date, title, message, topic, remind_utc) "
        "VALUES ($1, $2, 'reminder', $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING",
        new_id(), imager, observing, title, message, topic, remind_utc)


async def due_pushes(connection: asyncpg.Connection) -> list[asyncpg.Record]:
    return await connection.fetch(
        "SELECT * FROM push_dispatcher.pushes WHERE status <> 'sent' AND next_attempt_at <= now() ORDER BY seq LIMIT 20")


async def record_attempt(connection: asyncpg.Connection, push_id: str, delivered: bool, retry_seconds: int) -> None:
    await connection.execute(
        "UPDATE push_dispatcher.pushes SET attempts = attempts + 1, last_attempt_at = now(), "
        "status = CASE WHEN $2 THEN 'sent' ELSE 'unsent' END, sent_at = CASE WHEN $2 THEN now() ELSE sent_at END, "
        "next_attempt_at = now() + make_interval(secs => $3) WHERE id = $1", push_id, delivered, retry_seconds)


async def list_pushes(connection: asyncpg.Connection, imager: str) -> list[asyncpg.Record]:
    return await connection.fetch("SELECT * FROM push_dispatcher.pushes WHERE imager_id = $1 ORDER BY seq DESC", imager)


async def fetch_reminder(connection: asyncpg.Connection, imager: str) -> asyncpg.Record | None:
    return await connection.fetchrow("SELECT * FROM push_dispatcher.reminders WHERE imager_id = $1", imager)


async def save_reminder(connection: asyncpg.Connection, imager: str, enabled: bool, local_time: str) -> None:
    await connection.execute(
        "INSERT INTO push_dispatcher.reminders VALUES ($1, $2, $3, now()) ON CONFLICT (imager_id) DO UPDATE SET "
        "enabled = EXCLUDED.enabled, local_time = EXCLUDED.local_time, "
        "enabled_at = CASE WHEN EXCLUDED.enabled AND NOT push_dispatcher.reminders.enabled THEN now() "
        "ELSE push_dispatcher.reminders.enabled_at END", imager, enabled, local_time)


async def enabled_reminders(connection: asyncpg.Connection) -> list[asyncpg.Record]:
    return await connection.fetch("SELECT * FROM push_dispatcher.reminders WHERE enabled")
