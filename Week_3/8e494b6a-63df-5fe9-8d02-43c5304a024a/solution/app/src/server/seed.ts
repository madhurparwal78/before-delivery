// Seeding: the grading seed body (strict) and the start seed applied at every boot (ensure, idempotent).
import { randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { now } from "./clock";
import { pool, tx } from "./db";
import { ApiError, errors } from "./errors";
import { hashPassword, sha256Hex } from "./auth";
import { currentSeq } from "./live";
import { rates, type RateKind } from "./rate";
import { objectSize, putObject, StorageUnavailable } from "./storage";
import { checkTypes } from "./ingest/store";
import { indexEvent, persistIndex } from "./search/index";
import { segmentLine, storedEvent, type StoredEvent } from "./search/events";
import { FIELD_TYPES, isPlainObject, type Doc, type FieldType } from "./search/fields";
import { parseIsoInstant } from "../shared/time";
import { isKnownZone } from "../shared/zone";
import { traceProblem, type SpanInput } from "./traces";
import type { Lifecycle } from "./access";

type Mode = "strict" | "ensure";
type Section = Array<Record<string, unknown>>;

export interface SeedSpec {
  users?: Section;
  spaces?: Section;
  keys?: Section;
  streams?: Section;
  pipelines?: Section;
  saved_searches?: Section;
  rules?: Section;
  maintenance?: Section;
  cases?: Section;
  traces?: Section;
  objectives?: Section;
  rates?: Partial<Record<RateKind, number>>;
}

const invalid = (section: string, sentence: string): ApiError => errors.invalid({ [section]: sentence });
const text = (item: Record<string, unknown>, key: string, section: string): string => {
  const value = item[key];
  if (typeof value !== "string" || value === "") throw invalid(section, `${key} is required.`);
  return value;
};
const isoMs = (value: unknown, section: string): number => {
  const ms = typeof value === "string" ? parseIsoInstant(value) : null;
  if (ms === null) throw invalid(section, "Times are ISO 8601 UTC with milliseconds.");
  return ms;
};

class World {
  private readonly spaces = new Map<string, number>();

  constructor(private readonly client: PoolClient, private readonly mode: Mode) {}

  async space(slug: string, section: string): Promise<number> {
    const known = this.spaces.get(slug);
    if (known !== undefined) return known;
    const { rows } = await this.client.query<{ id: number }>("SELECT id FROM spaces WHERE slug = $1", [slug]);
    if (!rows[0]) throw invalid(section, `Space ${slug} doesn't exist.`);
    this.spaces.set(slug, rows[0].id);
    return rows[0].id;
  }

  /** In strict mode a name that exists is a conflict; in ensure mode it is simply kept. */
  async exists(sql: string, values: unknown[]): Promise<boolean> {
    const { rows } = await this.client.query(sql, values);
    if (rows.length > 0 && this.mode === "strict") throw errors.nameTaken();
    return rows.length > 0;
  }

  async users(items: Section, hashes: string[]): Promise<Array<{ username: string; id: number }>> {
    const made: Array<{ username: string; id: number }> = [];
    for (const [index, item] of items.entries()) {
      const username = text(item, "username", "users").toLowerCase();
      const zone = typeof item.time_zone === "string" ? item.time_zone : "UTC";
      if (!isKnownZone(zone)) throw invalid("users", `Unknown time zone ${zone}.`);
      const found = await this.exists("SELECT id FROM users WHERE username = $1", [username]);
      const { rows } = found
        ? await this.client.query<{ id: number }>("SELECT id FROM users WHERE username = $1", [username])
        : await this.client.query<{ id: number }>("INSERT INTO users (username, password_hash, time_zone) VALUES ($1, $2, $3) RETURNING id", [username, hashes[index], zone]);
      made.push({ username, id: (rows[0] as { id: number }).id });
    }
    return made;
  }

  async spacesWithMembers(items: Section): Promise<Array<{ slug: string; id: number }>> {
    const made: Array<{ slug: string; id: number }> = [];
    for (const item of items) {
      const slug = text(item, "slug", "spaces");
      const found = await this.exists("SELECT id FROM spaces WHERE slug = $1", [slug]);
      const { rows } = found
        ? await this.client.query<{ id: number }>("SELECT id FROM spaces WHERE slug = $1", [slug])
        : await this.client.query<{ id: number }>("INSERT INTO spaces (slug, name) VALUES ($1, $2) RETURNING id", [slug, text(item, "name", "spaces")]);
      const id = (rows[0] as { id: number }).id;
      this.spaces.set(slug, id);
      for (const member of (item.members as Section | undefined) ?? []) {
        const user = await this.client.query<{ id: number }>("SELECT id FROM users WHERE username = $1", [text(member, "username", "spaces").toLowerCase()]);
        if (!user.rows[0]) throw invalid("spaces", `User ${String(member.username)} doesn't exist.`);
        await this.client.query("INSERT INTO members (space_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [id, user.rows[0].id, text(member, "role", "spaces")]);
        await this.client.query("UPDATE users SET current_space_id = $2 WHERE id = $1 AND current_space_id IS NULL", [user.rows[0].id, id]);
      }
      made.push({ slug, id });
    }
    return made;
  }

  async keys(items: Section): Promise<Array<{ name: string; id: number; key: string }>> {
    const made: Array<{ name: string; id: number; key: string }> = [];
    for (const item of items) {
      const space = await this.space(text(item, "space", "keys"), "keys");
      const key = typeof item.key === "string" ? item.key : `spk_${randomBytes(16).toString("hex")}`;
      const days = typeof item.expires_in_days === "number" ? item.expires_in_days : null;
      if (await this.exists("SELECT id FROM api_keys WHERE key_hash = $1", [sha256Hex(key)])) continue;
      const { rows } = await this.client.query<{ id: number }>(
        `INSERT INTO api_keys (space_id, name, stream_pattern, actions, created_ms, expires_ms, last4, key_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [space, text(item, "name", "keys"), text(item, "stream_pattern", "keys"), item.actions ?? [], now(), days === null ? null : now() + days * 86_400_000, key.slice(-4), sha256Hex(key)],
      );
      made.push({ name: String(item.name), id: (rows[0] as { id: number }).id, key });
    }
    return made;
  }

  async stream(item: Record<string, unknown>) {
    const space = await this.space(text(item, "space", "streams"), "streams");
    const name = text(item, "name", "streams");
    if (await this.exists("SELECT id FROM streams WHERE space_id = $1 AND name = $2", [space, name])) return null;
    const explicit = new Map<string, FieldType>();
    for (const [field, type] of Object.entries((item.mappings as Record<string, string> | undefined) ?? {})) {
      if (!FIELD_TYPES.includes(type as FieldType)) throw invalid("streams", `Unknown field type ${type}.`);
      explicit.set(field, type as FieldType);
    }
    const generations: Array<Record<string, unknown> & { number: number }> = (
      (item.generations as Section | undefined) ?? [{ number: 1, phase: "hot", created_at: new Date(now()).toISOString(), rolled_over_at: null, events: [] }]
    )
      .map((g) => ({ ...g, number: Number(g.number) }))
      .sort((a, b) => a.number - b.number);
    const write = generations[generations.length - 1];
    if (!write || write.phase !== "hot") throw invalid("streams", "The highest-numbered generation must be hot.");
    const lifecycle: Lifecycle = isPlainObject(item.lifecycle) ? (item.lifecycle as Lifecycle) : {};
    const { rows } = await this.client.query<{ id: number }>(
      "INSERT INTO streams (space_id, name, write_generation, lifecycle) VALUES ($1, $2, $3, $4) RETURNING id",
      [space, name, write.number, JSON.stringify(lifecycle)],
    );
    const streamId = (rows[0] as { id: number }).id;
    const seen = new Set<string>();
    for (const generation of generations) await this.generation(streamId, space, name, generation, explicit, seen);
    return { space: String(item.space), name, id: streamId, generations: generations.map((g) => ({ number: g.number, id: g.number, phase: String(g.phase) })) };
  }

  private async generation(streamId: number, spaceId: number, name: string, generation: Record<string, unknown>, explicit: Map<string, FieldType>, seen: Set<string>): Promise<void> {
    const number = generation.number as number;
    const phase = String(generation.phase);
    if (!["hot", "warm", "archive"].includes(phase)) throw invalid("streams", "A generation is hot, warm or archive.");
    const types = new Map(explicit);
    const events: StoredEvent[] = [];
    for (const raw of (generation.events as Section | undefined) ?? []) {
      const { _id, "@timestamp": stamp, ...fields } = raw;
      const ts = isoMs(stamp, "streams");
      const id = typeof _id === "string" && _id !== "" ? _id : randomUUID();
      if (seen.has(id)) throw errors.nameTaken();
      seen.add(id);
      const checked = checkTypes(fields as Doc, types);
      if ("error" in checked) throw invalid("streams", `Event ${id}: ${checked.error}`);
      for (const [field, type] of checked.additions) types.set(field, type);
      events.push(storedEvent({ id, generation: number, phase: phase === "hot" ? "hot" : phase === "warm" ? "warm" : "archive", ts, doc: fields as Doc, pipeline: null, ordinal: null }));
    }
    const timestamps = events.map((event) => event.ts);
    const createdMs = isoMs(generation.created_at ?? new Date(now()).toISOString(), "streams");
    const rolledMs = generation.rolled_over_at ? isoMs(generation.rolled_over_at, "streams") : null;
    let segment: { key: string; bytes: number } | null = null;
    if (phase === "archive") {
      const { rows } = await this.client.query<{ slug: string }>("SELECT slug FROM spaces WHERE id = $1", [spaceId]);
      const body = Buffer.from([...events].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1)).map((e) => `${segmentLine(e)}\n`).join(""));
      const key = `segments/${(rows[0] as { slug: string }).slug}/${name}/${number}.ndjson`;
      try {
        await putObject(key, body);
        if ((await objectSize(key)) !== body.length) throw new StorageUnavailable("size mismatch");
      } catch (error) {
        if (error instanceof StorageUnavailable) throw errors.storageUnavailable();
        throw error;
      }
      segment = { key, bytes: body.length };
    }
    await this.client.query(
      `INSERT INTO generations (stream_id, number, phase, created_ms, rolled_over_ms, min_ts, max_ts, segment_key, segment_bytes, archived_events)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [streamId, number, phase, createdMs, rolledMs, timestamps.length ? Math.min(...timestamps) : null, timestamps.length ? Math.max(...timestamps) : null,
        segment?.key ?? null, segment?.bytes ?? null, phase === "archive" ? events.length : 0],
    );
    for (const [field, type] of types) {
      await this.client.query("INSERT INTO mappings (stream_id, generation, field, type, explicit) VALUES ($1, $2, $3, $4, $5)", [streamId, number, field, type, explicit.has(field)]);
    }
    for (const [field, type] of explicit) {
      if (!types.has(field)) await this.client.query("INSERT INTO mappings (stream_id, generation, field, type, explicit) VALUES ($1, $2, $3, $4, true) ON CONFLICT DO NOTHING", [streamId, number, field, type]);
    }
    if (events.length === 0) return;
    await this.client.query("INSERT INTO event_keys (stream_id, ext_id, generation) SELECT $1, i, $2 FROM unnest($3::text[]) AS u(i)", [streamId, number, events.map((e) => e.id)]);
    if (phase === "archive") return;
    await this.client.query(
      `INSERT INTO events (stream_id, ext_id, generation, ts, doc, pipeline)
       SELECT $1, i, $2, t, d::jsonb, NULL FROM unnest($3::text[], $4::bigint[], $5::text[]) AS u(i, t, d)`,
      [streamId, number, events.map((e) => e.id), events.map((e) => e.ts), events.map((e) => JSON.stringify(e.doc))],
    );
    await persistIndex(this.client, streamId, events.map((event) => ({ id: event.id, generation: number, ts: event.ts, indexed: indexEvent(event.flat, (field) => types.get(field)) })));
  }

  async pipeline(item: Record<string, unknown>): Promise<{ name: string; id: number; version: number } | null> {
    const space = await this.space(text(item, "space", "pipelines"), "pipelines");
    const name = text(item, "name", "pipelines");
    if (await this.exists("SELECT id FROM pipelines WHERE space_id = $1 AND name = $2", [space, name])) return null;
    const { rows } = await this.client.query<{ id: number }>(
      "INSERT INTO pipelines (space_id, name, version, processors) VALUES ($1, $2, 1, $3) RETURNING id", [space, name, JSON.stringify(item.processors ?? [])],
    );
    return { name, id: (rows[0] as { id: number }).id, version: 1 };
  }

  async savedSearch(item: Record<string, unknown>): Promise<{ name: string; id: number }> {
    const space = await this.space(text(item, "space", "saved_searches"), "saved_searches");
    const { rows } = await this.client.query<{ id: number }>(
      "INSERT INTO saved_searches (space_id, name, stream, q, filters, from_ts, to_ts) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
      [space, text(item, "name", "saved_searches"), text(item, "stream", "saved_searches"), String(item.q ?? ""), JSON.stringify(item.filters ?? []), String(item.from), String(item.to)],
    );
    return { name: String(item.name), id: (rows[0] as { id: number }).id };
  }

  async rule(item: Record<string, unknown>): Promise<{ name: string; id: number }> {
    const space = await this.space(text(item, "space", "rules"), "rules");
    const name = text(item, "name", "rules");
    await this.exists("SELECT id FROM rules WHERE space_id = $1 AND name = $2", [space, name]);
    const { rows } = await this.client.query<{ id: number }>(
      `INSERT INTO rules (space_id, name, stream, filter, measure, measure_field, group_by, window_ms, comparison, threshold, frequency)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [space, name, text(item, "stream", "rules"), item.filter ? JSON.stringify(item.filter) : null, item.measure ?? "count", item.measure_field ?? null, item.group_by ?? null,
        item.window_ms, item.comparison ?? ">", item.threshold ?? 0, JSON.stringify(item.frequency ?? { kind: "change" })],
    );
    const id = (rows[0] as { id: number }).id;
    for (const group of (item.groups as Section | undefined) ?? []) {
      await this.client.query(
        "INSERT INTO rule_groups (rule_id, name, state, since_ms) VALUES ($1, $2, $3, $4)",
        [id, text(group, "group", "rules"), text(group, "state", "rules"), group.since ? isoMs(group.since, "rules") : null],
      );
      for (const step of (group.history as Section | undefined) ?? []) {
        await this.client.query(
          "INSERT INTO rule_history (rule_id, at_ms, group_name, from_state, to_state) VALUES ($1, $2, $3, $4, $5)",
          [id, isoMs(step.at, "rules"), group.group, step.from, step.to],
        );
      }
    }
    return { name, id };
  }

  async maintenance(item: Record<string, unknown>): Promise<{ name: string; id: number }> {
    const space = await this.space(text(item, "space", "maintenance"), "maintenance");
    const { rows: rule } = await this.client.query<{ id: number }>("SELECT id FROM rules WHERE space_id = $1 AND (name = $2 OR id::text = $2)", [space, String(item.rule)]);
    if (!rule[0]) throw invalid("maintenance", `Rule ${String(item.rule)} doesn't exist.`);
    const { rows } = await this.client.query<{ id: number }>(
      "INSERT INTO maintenance_windows (space_id, name, time_zone, days, start, duration_ms, rule_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
      [space, text(item, "name", "maintenance"), text(item, "time_zone", "maintenance"), item.days ?? [], text(item, "start", "maintenance"), item.duration_ms, rule[0].id],
    );
    return { name: String(item.name), id: (rows[0] as { id: number }).id };
  }

  async caseItem(item: Record<string, unknown>): Promise<{ number: number; id: number }> {
    const space = await this.space(text(item, "space", "cases"), "cases");
    const { rows: counter } = await this.client.query<{ case_seq: number }>("UPDATE spaces SET case_seq = case_seq + 1 WHERE id = $1 RETURNING case_seq", [space]);
    const number = (counter[0] as { case_seq: number }).case_seq;
    const { rows } = await this.client.query<{ id: number }>(
      "INSERT INTO cases (space_id, number, title, status, created_ms) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [space, number, text(item, "title", "cases"), item.status ?? "open", now()],
    );
    return { number, id: (rows[0] as { id: number }).id };
  }

  async trace(item: Record<string, unknown>): Promise<{ trace_id: string }> {
    const space = await this.space(text(item, "space", "traces"), "traces");
    const traceId = text(item, "trace_id", "traces");
    await this.exists("SELECT id FROM traces WHERE space_id = $1 AND trace_id = $2", [space, traceId]);
    const spans = (item.spans ?? []) as SpanInput[];
    const problem = traceProblem(spans);
    if (problem) throw errors.traceInvalid(problem);
    await this.client.query("INSERT INTO traces (space_id, trace_id, spans, created_ms) VALUES ($1, $2, $3, $4)", [space, traceId, JSON.stringify(spans), now()]);
    return { trace_id: traceId };
  }

  async objective(item: Record<string, unknown>): Promise<{ name: string; id: number }> {
    const space = await this.space(text(item, "space", "objectives"), "objectives");
    await this.exists("SELECT id FROM objectives WHERE space_id = $1 AND (service = $2 OR name = $3)", [space, text(item, "service", "objectives"), text(item, "name", "objectives")]);
    const { rows } = await this.client.query<{ id: number }>(
      "INSERT INTO objectives (space_id, service, name, stream, target, objective_window_ms, bad, counts) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
      [space, item.service, item.name, text(item, "stream", "objectives"), String(item.target), item.objective_window_ms ?? 2_592_000_000, JSON.stringify(item.bad), item.counts ? JSON.stringify(item.counts) : null],
    );
    return { name: String(item.name), id: (rows[0] as { id: number }).id };
  }
}

export async function seedWorld(spec: SeedSpec, mode: Mode, fixedHashes?: string[]) {
  const hashes = fixedHashes ?? (await Promise.all((spec.users ?? []).map((user) => hashPassword(String(user.password ?? "")))));
  const result = await tx(async (client) => {
    const world = new World(client, mode);
    const out: Record<string, unknown> = {};
    if (spec.users) out.users = await world.users(spec.users, hashes);
    if (spec.spaces) out.spaces = await world.spacesWithMembers(spec.spaces);
    if (spec.keys) out.keys = await world.keys(spec.keys);
    if (spec.streams) out.streams = await seq(spec.streams, (item) => world.stream(item));
    if (spec.pipelines) out.pipelines = await seq(spec.pipelines, (item) => world.pipeline(item));
    if (spec.saved_searches) out.saved_searches = await seq(spec.saved_searches, (item) => world.savedSearch(item));
    if (spec.rules) out.rules = await seq(spec.rules, (item) => world.rule(item));
    if (spec.maintenance) out.maintenance = await seq(spec.maintenance, (item) => world.maintenance(item));
    if (spec.cases) out.cases = await seq(spec.cases, (item) => world.caseItem(item));
    if (spec.traces) out.traces = await seq(spec.traces, (item) => world.trace(item));
    if (spec.objectives) out.objectives = await seq(spec.objectives, (item) => world.objective(item));
    return out;
  });
  if (spec.rates) for (const kind of ["upload", "login", "search", "tail"] as const) if (typeof spec.rates[kind] === "number") rates[kind] = spec.rates[kind];
  const space = (spec.spaces?.[0]?.slug ?? spec.streams?.[0]?.space ?? spec.rules?.[0]?.space) as string | undefined;
  return { ...result, seq: space ? await seqOf(space) : 0 };
}

async function seq<T>(items: Section, work: (item: Record<string, unknown>) => Promise<T | null>): Promise<T[]> {
  const done: T[] = [];
  for (const item of items) {
    const value = await work(item);
    if (value !== null) done.push(value);
  }
  return done;
}

async function seqOf(slug: string): Promise<number> {
  const { rows } = await pool.query<{ id: number }>("SELECT id FROM spaces WHERE slug = $1", [slug]);
  return rows[0] ? currentSeq(rows[0].id) : 0;
}
