/**
 * The start seed: present on every boot, applied idempotently.
 */
import type { PoolClient } from "pg";
import { pool, nextId } from "./db";
import { hashPassword, sha256 } from "./auth";
import { checkAndInfer, insertEvent } from "./events";
import { config } from "./config";

interface SeedEvent {
  _id: string;
  "@timestamp": string;
  host: string;
  level: string;
  message: string;
  service?: string;
  status?: number;
  latency?: number;
}

const DEMO_PASSWORD = "spoorline-demo-1";

const WEB_EVENTS: SeedEvent[] = [
  { _id: "e-001", "@timestamp": "2026-02-28T23:46:10.000Z", host: "host-3", level: "info", service: "web", status: 200, latency: 41, message: "GET /cart served" },
  { _id: "e-002", "@timestamp": "2026-02-28T23:48:30.000Z", host: "host-7", level: "error", service: "web", status: 500, latency: 912, message: "payment gateway timeout" },
  { _id: "e-003", "@timestamp": "2026-02-28T23:50:05.000Z", host: "host-7", level: "error", service: "web", status: 503, latency: 1204, message: "gateway timeout, timeout again" },
  { _id: "e-004", "@timestamp": "2026-02-28T23:51:40.000Z", host: "host-2", level: "warn", service: "web", status: 200, latency: 388, message: "retry scheduled" },
  { _id: "e-005", "@timestamp": "2026-02-28T23:53:15.000Z", host: "host-7", level: "error", service: "web", status: 500, latency: 77, message: "disk full on node-7" },
  { _id: "e-006", "@timestamp": "2026-02-28T23:55:00.000Z", host: "host-3", level: "info", service: "web", status: 200, latency: 35, message: "GET /search served" },
  { _id: "e-007", "@timestamp": "2026-02-28T23:57:20.000Z", host: "host-2", level: "info", service: "web", status: 200, latency: 52, message: "GET /cart served" },
  { _id: "e-008", "@timestamp": "2026-02-28T23:59:45.000Z", host: "host-7", level: "error", service: "web", status: 502, latency: 640, message: "upstream reset by peer" },
];

const HARBOR_EVENTS = [
  { _id: "h-001", "@timestamp": "2026-02-28T23:40:00.000Z", host: "dock-1", level: "info", message: "refund queued" },
  { _id: "h-002", "@timestamp": "2026-02-28T23:50:00.000Z", host: "dock-1", level: "error", message: "ledger write failed" },
  { _id: "h-003", "@timestamp": "2026-02-28T23:58:00.000Z", host: "dock-2", level: "info", message: "refund sent" },
];

interface UserSeed {
  username: string;
  zone: string;
  currentSpace: string;
}

const USERS: UserSeed[] = [
  { username: "ines", zone: "UTC", currentSpace: "ops" },
  { username: "tomas", zone: "America/New_York", currentSpace: "ops" },
  { username: "ruth", zone: "UTC", currentSpace: "ops" },
  { username: "wren", zone: "UTC", currentSpace: "harbor" },
];

export async function seedStartData(): Promise<void> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const hash = await hashPassword(DEMO_PASSWORD);
    for (const u of USERS) {
      const existing = await db.query("SELECT id FROM users WHERE username = $1", [u.username]);
      if (existing.rows.length === 0) {
        const id = nextId();
        await db.query(
          "INSERT INTO users (id, username, password_hash, time_zone, current_space, created_at) VALUES ($1,$2,$3,$4,$5,now())",
          [id, u.username, hash, u.zone, u.currentSpace],
        );
      }
    }
    await seedSpace(db, "ops", "Ops", [
      { username: "ines", role: "admin" },
      { username: "tomas", role: "editor" },
      { username: "ruth", role: "viewer" },
    ]);
    await seedSpace(db, "harbor", "Harbor", [{ username: "wren", role: "admin" }]);
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    db.release();
  }
}

async function seedSpace(
  db: PoolClient,
  slug: string,
  name: string,
  members: { username: string; role: string }[],
): Promise<void> {
  let spaceId: string;
  const existing = await db.query<{ id: string }>("SELECT id FROM spaces WHERE slug = $1", [slug]);
  if (existing.rows.length === 0) {
    spaceId = nextId();
    await db.query("INSERT INTO spaces (id, slug, name, seq, created_at) VALUES ($1,$2,$3,0,now())", [
      spaceId,
      slug,
      name,
    ]);
  } else {
    spaceId = existing.rows[0].id;
  }
  for (const m of members) {
    const user = await db.query<{ id: string }>("SELECT id FROM users WHERE username = $1", [m.username]);
    if (user.rows.length === 0) continue;
    const member = await db.query("SELECT 1 FROM members WHERE space_id = $1 AND user_id = $2", [
      spaceId,
      user.rows[0].id,
    ]);
    if (member.rows.length === 0) {
      await db.query("INSERT INTO members (space_id, user_id, role) VALUES ($1,$2,$3)", [
        spaceId,
        user.rows[0].id,
        m.role,
      ]);
    }
  }
  if (slug === "ops") {
    await seedOpsSpace(db, spaceId);
  } else {
    await seedHarborSpace(db, spaceId);
  }
}

async function seedOpsSpace(db: PoolClient, spaceId: string): Promise<void> {
  // pipeline web-clean
  const pipeline = await db.query<{ id: string }>(
    "SELECT id FROM pipelines WHERE space_id = $1 AND name = $2",
    [spaceId, "web-clean"],
  );
  if (pipeline.rows.length === 0) {
    await db.query("INSERT INTO pipelines (id, space_id, name, version, processors) VALUES ($1,$2,'web-clean',1,$3)", [
      nextId(),
      spaceId,
      JSON.stringify([
        { type: "redact", field: "message", pattern: "ipv4" },
        { type: "set", field: "env", value: "prod" },
      ]),
    ]);
  }
  // key edge-shipper
  const key = await db.query("SELECT 1 FROM api_keys WHERE space_id = $1 AND name = 'edge-shipper'", [spaceId]);
  if (key.rows.length === 0) {
    const keyText = "spk_5eedc0de5eedc0de5eedc0de5eedc0de";
    await db.query(
      `INSERT INTO api_keys (id, space_id, name, stream_pattern, actions, key_hash, last4, expires_at, revoked, created_at)
       VALUES ($1,$2,'edge-shipper','web*','upload',$3,$4,NULL,FALSE,now())`,
      [nextId(), spaceId, sha256(keyText), keyText.slice(-4)],
    );
  }
  // stream web
  await seedStream(db, spaceId, "web", { host: "keyword", level: "keyword", service: "keyword" }, WEB_EVENTS);
}

async function seedHarborSpace(db: PoolClient, spaceId: string): Promise<void> {
  await seedStream(db, spaceId, "pay", {}, HARBOR_EVENTS);
}

async function seedStream(
  db: PoolClient,
  spaceId: string,
  name: string,
  mappings: Record<string, string>,
  events: SeedEvent[],
): Promise<void> {
  const existing = await db.query<{ id: string }>("SELECT id FROM streams WHERE space_id = $1 AND name = $2", [
    spaceId,
    name,
  ]);
  let streamId: string;
  if (existing.rows.length === 0) {
    streamId = nextId();
    await db.query("INSERT INTO streams (id, space_id, name, created_at) VALUES ($1,$2,$3,now())", [
      streamId,
      spaceId,
      name,
    ]);
  } else {
    streamId = existing.rows[0].id;
  }
  const gens = await db.query<{ id: string }>(
    "SELECT id FROM generations WHERE stream_id = $1 ORDER BY number",
    [streamId],
  );
  let genId: string;
  if (gens.rows.length === 0) {
    genId = nextId();
    await db.query(
      "INSERT INTO generations (id, stream_id, number, phase, created_at) VALUES ($1,$2,1,'hot',now())",
      [genId, streamId],
    );
  } else {
    genId = gens.rows[gens.rows.length - 1].id;
  }
  for (const [field, type] of Object.entries(mappings)) {
    const has = await db.query("SELECT 1 FROM mappings WHERE generation_id = $1 AND field = $2", [genId, field]);
    if (has.rows.length === 0) {
      await db.query("INSERT INTO mappings (id, generation_id, field, type, explicit) VALUES ($1,$2,$3,$4,TRUE)", [
        nextId(),
        genId,
        field,
        type,
      ]);
    }
  }
  for (const e of events) {
    const has = await db.query("SELECT 1 FROM events WHERE generation_id = $1 AND event_id = $2", [genId, e._id]);
    if (has.rows.length > 0) continue;
    const { _id, "@timestamp": ts, ...fields } = e;
    await checkAndInfer(db, genId, fields as Record<string, unknown>);
    await insertEvent(db, genId, {
      id: _id,
      ts: new Date(ts),
      fields: fields as Record<string, unknown>,
      pipeline: null,
      seq: 0,
    });
  }
}
