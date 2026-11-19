"""Every request body, with exactly the fields its API entry lists."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from .validation import Body

Role = Literal["admin", "editor", "viewer"]
SyncMode = Literal[
    "full_refresh_overwrite", "full_refresh_append", "incremental_append", "incremental_dedup"
]
Plan = Literal["starter", "team", "scale", "private"]
SchemaChangePolicy = Literal["propagate", "ignore", "pause"]


class EmptyBody(Body):
    """An endpoint that takes no body or {}."""


class LoginBody(Body):
    email: str
    password: str
    next: str | None = Field(default=None, max_length=2000)


class AcceptInviteBody(Body):
    invite_token: str
    password: str | None = None


class PreferencesBody(Body):
    sync_sounds: bool | None = None
    theme: Literal["light", "dark"] | None = None


class InviteMemberBody(Body):
    email: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=120)
    role: Role


class MemberRoleBody(Body):
    role: Role


class WorkspaceBody(Body):
    plan: Plan


class SourceConfigBody(Body):
    api_key: str | None = None
    start_date: str | None = None


class SourceBody(Body):
    name: str = Field(min_length=1, max_length=80)
    definition_id: str
    config: SourceConfigBody


class DestinationBody(Body):
    name: str = Field(min_length=1, max_length=80)
    definition_id: str


class SampleEventsBody(Body):
    stream: str
    append: int | None = Field(default=None, ge=1, le=500)
    update_ids: list[int] | None = None
    add_field: str | None = None


class StreamBody(Body):
    name: str
    selected: bool
    sync_mode: SyncMode
    cursor_field: str | None = None
    primary_key: list[str] | None = None


class ScheduleBody(Body):
    type: Literal["manual", "interval", "cron"]
    interval_minutes: int | None = Field(default=None, ge=1, le=1440)
    cron_expression: str | None = None
    time_zone: str | None = None


class ConnectionBody(Body):
    name: str = Field(min_length=1, max_length=80)
    source_id: str
    destination_id: str
    namespace_prefix: str
    streams: list[StreamBody]
    schedule: ScheduleBody
    schema_change_policy: SchemaChangePolicy


class ConnectionPatchBody(Body):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    streams: list[StreamBody] | None = None
    schedule: ScheduleBody | None = None
    schema_change_policy: SchemaChangePolicy | None = None
    status: Literal["active", "inactive"] | None = None


class PaginatorBody(Body):
    page_size: int


class ManifestStreamBody(Body):
    name: str
    path: str
    primary_key: list[str]
    record_selector: str
    paginator: PaginatorBody


class AuthBody(Body):
    type: Literal["api_key"]
    header: str


class ManifestBody(Body):
    base_url: str
    auth: AuthBody
    streams: list[ManifestStreamBody]


class BuilderProjectBody(Body):
    name: str = Field(min_length=1, max_length=80)
    manifest: ManifestBody


class BuilderTestBody(Body):
    stream: str
    api_key: str
