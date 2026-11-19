"""The desk: shared state, sessions, access rules and the helpers every window action builds on."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import secrets
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime

import asyncpg

from .clock import SettlementClock, format_instant
from .config import Settings, parse_instant
from .errors import ApiError, validation, wrong_state
from .jsontypes import JsonObject
from .providers import GridFeed, MeterHub, Press, ProviderDown, Registry, Store
from .repository import Window, apply_allocation, load_window, load_windows
from .scoring import parse_factor
from .timeutil import HOUR
from .views import TIMED_OUT, Context, window_json

SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}
FACTOR_RETRY_SECONDS = 5
MAX_REASON = 500
MAX_NOTE = 2000
MAX_WH = 1_000_000_000_000
LANDING = {"analyst": "/windows", "verifier": "/review", "lead": "/group"}


@dataclass(frozen=True, slots=True)
class User:
    id: str
    name: str
    role: str
    firm_id: str | None
    email: str

    @classmethod
    def from_row(cls, row: asyncpg.Record) -> User:
        return cls(row["id"], row["name"], row["role"], row["firm_id"], row["email"])

    def public(self) -> JsonObject:
        return {"id": self.id, "name": self.name, "role": self.role, "firm_id": self.firm_id, "email": self.email}


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    return f"{salt.hex()}${hashlib.scrypt(password.encode(), salt=salt, **SCRYPT).hex()}"


def password_matches(password: str, stored: str) -> bool:
    salt, _, digest = stored.partition("$")
    candidate = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), **SCRYPT)
    return hmac.compare_digest(candidate, bytes.fromhex(digest))


def is_whole(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def text_ok(value: object, limit: int) -> bool:
    """A string of 1 to `limit` Unicode code points that is not blank and can be stored."""
    if not isinstance(value, str) or not value.strip() or len(value) > limit or "\x00" in value:
        return False
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return True


class Desk:
    def __init__(self, settings: Settings, pool: asyncpg.Pool) -> None:
        self.settings = settings
        self.pool = pool
        self.clock = SettlementClock(settings.clock_start)
        self.registry = Registry(settings)
        self.hub = MeterHub(settings)
        self.grid = GridFeed(settings)
        self.press = Press(settings)
        self.store = Store(settings)
        self.locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._factor_attempts: dict[str, float] = {}
        self._tasks: set[asyncio.Task[None]] = set()

    def now(self) -> datetime:
        return self.clock.now()

    def server_now(self) -> str:
        return format_instant(self.now())

    def context(self) -> Context:
        return Context(self.now(), self.registry.reachable)

    # ---- sessions -------------------------------------------------------------------------------------------

    async def sign_in(self, email: object, password: object) -> tuple[User, str]:
        async with self.pool.acquire() as connection:
            row = (
                await connection.fetchrow("SELECT * FROM users WHERE email = $1", email)
                if isinstance(email, str)
                else None
            )
            if row is None or not isinstance(password, str) or not password_matches(password, row["password_hash"]):
                raise ApiError("INVALID_CREDENTIALS")
            token = secrets.token_urlsafe(32)
            await connection.execute(
                "INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)",
                hashlib.sha256(token.encode()).hexdigest(),
                row["id"],
            )
        return User.from_row(row), token

    async def sign_out(self, token: str) -> None:
        await self.pool.execute(
            "DELETE FROM sessions WHERE token_hash = $1", hashlib.sha256(token.encode()).hexdigest()
        )

    async def authenticate(self, token: str | None) -> User:
        row = (
            await self.pool.fetchrow(
                "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1",
                hashlib.sha256(token.encode()).hexdigest(),
            )
            if token
            else None
        )
        if row is None:
            raise ApiError("UNAUTHENTICATED")
        return User.from_row(row)

    # ---- access ---------------------------------------------------------------------------------------------

    @staticmethod
    def can_see(user: User, window: Window) -> bool:
        return user.role != "verifier" or window.columns["firm_id"] == user.firm_id

    async def settle_reviews(self, connection: asyncpg.Connection | asyncpg.Pool) -> None:
        """From the exact deadline instant a review reads Returned; the revision rises once however many reads race."""
        await connection.execute(
            "UPDATE windows SET state = 'Returned', returned_reason = $1, revision = revision + 1 "
            "WHERE state = 'In review' AND review_deadline <= $2",
            TIMED_OUT,
            self.now(),
        )

    async def window_for_read(self, user: User, window_id: str) -> Window:
        await self.settle_reviews(self.pool)
        async with self.pool.acquire() as connection:
            window = await load_window(connection, window_id)
        if window is None or not self.can_see(user, window):
            raise ApiError("NOT_FOUND")
        return window

    async def visible_windows(self, user: User, state: str | None = None) -> list[Window]:
        await self.settle_reviews(self.pool)
        async with self.pool.acquire() as connection:
            found = [window for window in await load_windows(connection) if self.can_see(user, window)]
        if state is not None:
            found = [window for window in found if window.state == state]
        found.sort(key=lambda window: window.id, reverse=True)
        found.sort(key=lambda window: (-int(window.columns["month"].replace("-", "")), window.columns["site_name"]))
        return found

    async def locked_window(
        self,
        connection: asyncpg.Connection,
        user: User,
        window_id: str,
        *,
        roles: tuple[str, ...],
        states: tuple[str, ...] | None = None,
    ) -> Window:
        """Inside a transaction: the window row locked, then not-found, role and state refusals in that order."""
        await self.settle_reviews(connection)
        window = await load_window(connection, window_id, lock=True)
        if window is None or not self.can_see(user, window):
            raise ApiError("NOT_FOUND")
        if user.role not in roles:
            raise ApiError("FORBIDDEN")
        if states is not None and window.state not in states:
            raise wrong_state(window.state)
        return window

    def check_revision(self, window: Window, body: JsonObject) -> None:
        revision = body.get("revision")
        if is_whole(revision) and revision != window.columns["revision"]:
            wrote_at = window.columns["last_wrote_at"] or self.now()
            name = window.columns["last_writer_name"] or "The desk"
            raise ApiError(
                "STALE_REVISION",
                f"{name} changed this window at {wrote_at:%H:%M} UTC. Your change was not saved.",
                extra={"wrote_by": name, "wrote_at": format_instant(wrote_at)},
            )

    async def bump(
        self, connection: asyncpg.Connection, window_id: str, writer: User | None, **changes: object
    ) -> None:
        """One revision raise; a person's action also names the last writer."""
        assignments = ["revision = revision + 1"]
        values: list[object] = [window_id]
        if writer is not None:
            values += [writer.name, self.now()]
            assignments += [
                f"last_writer_name = ${len(values) - 1}",
                f"last_wrote_at = ${len(values)}",
                "last_write_revision = revision + 1",
            ]
        for column, value in changes.items():
            values.append(value)
            assignments.append(f"{column} = ${len(values)}")
        await connection.execute(f"UPDATE windows SET {', '.join(assignments)} WHERE id = $1", *values)

    async def window_view(self, window_id: str) -> JsonObject:
        return window_json(await self.settled_window(window_id), self.context())

    async def settle_write(
        self, connection: asyncpg.Connection, window_id: str, writer: User | None, **changes: object
    ) -> None:
        """Raise the revision once, then recompute the allocation from the window's changed inputs."""
        await self.bump(connection, window_id, writer, **changes)
        window = await load_window(connection, window_id)
        assert window is not None
        await apply_allocation(connection, window, self.now())

    # ---- grid factors ---------------------------------------------------------------------------------------

    def schedule_factors(self, window_id: str) -> None:
        """Retry a window's missing grid factors in the background."""
        task = asyncio.create_task(self.fetch_factors_if_due(window_id))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def fetch_factors_if_due(self, window_id: str) -> bool:
        """Fetch missing grid factors, at most once every few seconds per window; whether a fetch was made."""
        if time.monotonic() - self._factor_attempts.get(window_id, -FACTOR_RETRY_SECONDS) < FACTOR_RETRY_SECONDS:
            return False
        await self.settled_window(window_id)
        return True

    async def settled_window(self, window_id: str) -> Window:
        """The window as it stands now, after fetching grid factors for any unmatched hour that has none stored."""
        self._factor_attempts[window_id] = time.monotonic()
        async with self.pool.acquire() as connection:
            window = await load_window(connection, window_id)
        assert window is not None
        missing = [
            bucket
            for bucket in window.grains(self.now()).by_grain["hour"]
            if bucket.consumed > bucket.matched and bucket.start not in window.factors
        ]
        if not missing or not await self._store_factors(window):
            return window
        async with self.pool.acquire() as connection:
            fresh = await load_window(connection, window_id)
        assert fresh is not None
        return fresh

    async def _store_factors(self, window: Window) -> bool:
        first, end = window.bounds
        try:
            runs = await self.grid.factors(window.zone, first, end)
        except ProviderDown:
            return False
        rows = []
        for run in runs:
            if not isinstance(run, dict) or not isinstance(run.get("start"), str) or not is_whole(run.get("count")):
                return False
            factor = parse_factor(str(run.get("g_per_kwh")))
            try:
                start = parse_instant(run["start"])
            except ValueError:
                return False
            if factor is None:
                return False
            for index in range(max(0, int((first - start) / HOUR)), min(run["count"], int((end - start) / HOUR))):
                rows.append((window.zone, start + HOUR * index, factor))
        await self.pool.executemany(
            "INSERT INTO grid_factors (zone, hour_utc, g_per_kwh_e4) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", rows
        )
        return bool(rows)


def field_errors(**checks: bool) -> None:
    """Raise one VALIDATION naming every field whose check failed."""
    failed = [name for name, passed in checks.items() if not passed]
    if failed:
        raise validation(*failed)
