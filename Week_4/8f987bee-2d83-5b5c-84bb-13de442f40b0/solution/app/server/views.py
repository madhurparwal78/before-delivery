"""Response models: the shape of every JSON answer."""

from typing import Any

from pydantic import BaseModel


class Health(BaseModel):
    status: str


class Preferences(BaseModel):
    sync_sounds: bool
    theme: str


class User(BaseModel):
    id: str
    email: str
    name: str
    role: str
    workspace_id: str
    preferences: Preferences


class SignedIn(BaseModel):
    token: str
    user: User
    redirect_to: str


class Accepted(BaseModel):
    token: str
    user: User


class Me(BaseModel):
    user: User


class PreferencesOut(BaseModel):
    preferences: Preferences


class Member(BaseModel):
    id: str
    email: str
    name: str
    role: str


class Members(BaseModel):
    members: list[Member]


class MemberOut(BaseModel):
    member: Member


class Invite(BaseModel):
    id: str
    email: str
    name: str
    role: str
    expires_at: str


class InviteCreated(BaseModel):
    invite: Invite
    invite_token: str


class Workspace(BaseModel):
    id: str
    name: str
    plan: str
    min_interval_minutes: int


class WorkspaceOut(BaseModel):
    workspace: Workspace


class Stats(BaseModel):
    records_synced: int
    latency_seconds: float | None
    freshness_seconds: float | None


class Definition(BaseModel):
    id: str
    name: str
    slug: str
    type: str
    category: str
    availability: list[str]
    runnable: bool
    custom: bool
    version: int


class Definitions(BaseModel):
    definitions: list[Definition]


class DefinitionOut(BaseModel):
    definition: Definition


class Source(BaseModel):
    id: str
    name: str
    definition_id: str
    created_at: str
    config: dict[str, Any]


class Sources(BaseModel):
    sources: list[Source]


class SourceOut(BaseModel):
    source: Source


class Check(BaseModel):
    status: str
    message: str | None = None


class CatalogStream(BaseModel):
    name: str
    fields: list[str]
    primary_key: list[str]
    cursor_field: str | None
    supported_sync_modes: list[str]


class Catalog(BaseModel):
    streams: list[CatalogStream]


class SampleEvent(BaseModel):
    stream: str
    appended: int
    updated: int
    fields: list[str]


class Destination(BaseModel):
    id: str
    name: str
    definition_id: str
    created_at: str


class Destinations(BaseModel):
    destinations: list[Destination]


class DestinationOut(BaseModel):
    destination: Destination


class Table(BaseModel):
    name: str
    row_count: int


class Tables(BaseModel):
    tables: list[Table]


class Records(BaseModel):
    records: list[dict[str, Any]]
    next_cursor: str | None
    prev_cursor: str | None
    has_more: bool
    total_count: int


class Connection(BaseModel):
    id: str
    workspace_id: str
    name: str
    source_id: str
    destination_id: str
    namespace_prefix: str
    streams: list[dict[str, Any]]
    schedule: dict[str, Any]
    schema_change_policy: str
    status: str
    version: int
    created_at: str
    next_run_at: str | None
    last_job_status: str | None


class Connections(BaseModel):
    connections: list[Connection]


class ConnectionOut(BaseModel):
    connection: Connection


class StreamState(BaseModel):
    name: str
    cursor_field: str | None
    cursor_value: str | None


class State(BaseModel):
    streams: list[StreamState]


class Attempt(BaseModel):
    number: int
    status: str
    failure_reason: str | None


class StreamCount(BaseModel):
    stream: str
    records_committed: int


class Job(BaseModel):
    id: str
    connection_id: str
    connection_version: int
    definition_version: int
    status: str
    attempts: list[Attempt]
    records_committed: int
    per_stream: list[StreamCount]
    failure_reason: str | None
    trigger_request_id: str
    created_at: str
    started_at: str | None
    ended_at: str | None


class JobOut(BaseModel):
    job: Job


class Jobs(BaseModel):
    jobs: list[Job]
    next_cursor: str | None
    has_more: bool


class LogLine(BaseModel):
    at: str
    level: str
    message: str


class Logs(BaseModel):
    lines: list[LogLine]


class Project(BaseModel):
    id: str
    name: str
    manifest: dict[str, Any]
    tested_streams: list[str]
    definition_id: str | None


class Projects(BaseModel):
    projects: list[Project]


class ProjectOut(BaseModel):
    project: Project


class TestRead(BaseModel):
    records: list[dict[str, Any]]
    pages_read: int
    detected_schema: dict[str, str]


class AuditEvent(BaseModel):
    seq: int
    action: str
    target_id: str
    actor_email: str
    at: str
    prev_hash: str
    hash: str


class AuditEvents(BaseModel):
    events: list[AuditEvent]


class AuditEventOut(BaseModel):
    event: AuditEvent
