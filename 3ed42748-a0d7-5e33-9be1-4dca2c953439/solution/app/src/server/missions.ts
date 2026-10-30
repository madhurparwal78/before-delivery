// Founder missions: field validation and its reasons, the lifecycle moves, revision checks,
// versions for live edits, and scheduling in studio wall-clock time.
import type pg from "pg";
import { postMissionOnBoard, removePostedParcels } from "./board";
import { all, one, tx, type Db } from "./db";
import { ApiError, conflict, validation, type FieldReason, type Fields } from "./errors";
import type { Ctx } from "./http";
import { isObject } from "./http";
import { iso } from "./ids";
import { residentById } from "./seed";
import { resolveWallTime, studioZone } from "./studio";

export type MissionStatus = "draft" | "scheduled" | "live" | "retired";

export interface Mission {
  id: string;
  kind: "standard" | "rush";
  status: MissionStatus;
  version: number;
  revision: number;
  live_at: Date | null;
  title: string;
  resident_id: string;
  reward_stamps: number;
  rush_slots: number | null;
  offer: string[];
  thanks: string[];
}

const MISSION_SELECT = `
  SELECT m.id, m.kind, m.status, m.version, m.revision, m.live_at,
         v.title, v.resident_id, v.reward_stamps, v.rush_slots, v.offer, v.thanks
    FROM missions m JOIN mission_versions v ON v.mission_id = m.id AND v.version = m.version`;

export async function loadMission(db: Db, id: string, forUpdate = false): Promise<Mission | undefined> {
  if (forUpdate) await db.query("SELECT 1 FROM missions WHERE id = $1 FOR UPDATE", [id]);
  return one<Mission>(db, `${MISSION_SELECT} WHERE m.id = $1`, [id]);
}

export async function allMissions(db: Db): Promise<Mission[]> {
  return all<Mission>(db, `${MISSION_SELECT} ORDER BY m.created_seq`);
}

interface MissionVersion {
  title: string;
  resident_id: string;
  reward_stamps: number;
  offer: string[];
  thanks: string[];
}

export async function missionVersion(db: Db, id: string, version: number): Promise<MissionVersion> {
  return (await one<MissionVersion>(
    db,
    "SELECT title, resident_id, reward_stamps, offer, thanks FROM mission_versions WHERE mission_id = $1 AND version = $2",
    [id, version],
  ))!;
}

export function founderView(m: Mission): object {
  return {
    mission_id: m.id,
    title: m.title,
    resident_id: m.resident_id,
    reward_stamps: m.reward_stamps,
    kind: m.kind,
    rush_slots: m.rush_slots,
    dialogue: { offer: m.offer, thanks: m.thanks },
    status: m.status,
    version: m.version,
    revision: m.revision,
    live_at: m.live_at ? iso(m.live_at) : null,
  };
}

export const etag = (m: Mission): Record<string, string> => ({ ETag: `"${m.revision}"` });

/** Scheduled missions whose instant has come go live (revision + 1); rush ones post on today's board. */
export async function promoteDue(): Promise<void> {
  await tx(async (db) => {
    const due = await all<{ id: string; kind: string }>(
      db,
      "UPDATE missions SET status = 'live', revision = revision + 1 WHERE status = 'scheduled' AND live_at <= $1 RETURNING id, kind",
      [new Date()],
    );
    for (const m of due) if (m.kind === "rush") await postMissionOnBoard(db, m.id);
  });
}

// ---- fields ----

const LINE_BREAK = /[\r\n\u0085\u2028\u2029]/;
const chars = (s: string): number => [...s].length;

function titleReason(v: unknown): FieldReason | null {
  if (typeof v !== "string" || LINE_BREAK.test(v)) return "invalid";
  if (v === "") return "required";
  return chars(v) > 60 ? "too_long" : null;
}

function rewardReason(v: unknown): FieldReason | null {
  if (v === null) return "required";
  if (typeof v !== "number" || !Number.isInteger(v)) return "invalid";
  return v < 1 || v > 50 ? "out_of_range" : null;
}

function residentReason(v: unknown): FieldReason | null {
  if (typeof v !== "string") return "invalid";
  return residentById(v) ? null : "unknown_resident";
}

function slotsReason(v: unknown, kind: "standard" | "rush"): FieldReason | null {
  if (kind === "standard") return v === null ? null : "invalid";
  if (v === null) return "required";
  if (typeof v !== "number" || !Number.isInteger(v)) return "invalid";
  return v < 1 || v > 5 ? "out_of_range" : null;
}

function linesReason(v: unknown, most: number): FieldReason | null {
  if (!Array.isArray(v) || v.some((line) => typeof line !== "string" || LINE_BREAK.test(line))) return "invalid";
  if (v.length < 1 || v.length > most) return "out_of_range";
  if (v.some((line: string) => line === "")) return "required";
  return v.some((line: string) => chars(line) > 200) ? "too_long" : null;
}

function dialogueReasons(v: unknown, fields: Fields): void {
  if (!isObject(v)) {
    fields.dialogue = "invalid";
    return;
  }
  for (const [key, most] of [
    ["offer", 6],
    ["thanks", 3],
  ] as const) {
    const reason = key in v ? linesReason(v[key], most) : "required";
    if (reason) fields[`dialogue.${key}`] = reason;
  }
}

export const MISSION_SPEC = {
  title: true,
  resident_id: true,
  reward_stamps: true,
  kind: true,
  rush_slots: true,
  dialogue: { offer: true, thanks: true },
} as const;

/** Each faulty field gets exactly one reason. On create every key is required. */
export function missionFieldReasons(body: Record<string, unknown>, storedKind?: "standard" | "rush"): Fields {
  const fields: Fields = {};
  const creating = storedKind === undefined;
  const check = (key: string, reason: () => FieldReason | null): void => {
    if (!(key in body)) {
      if (creating) fields[key] = "required";
      return;
    }
    const r = reason();
    if (r) fields[key] = r;
  };
  check("title", () => titleReason(body.title));
  check("resident_id", () => residentReason(body.resident_id));
  check("reward_stamps", () => rewardReason(body.reward_stamps));
  check("kind", () =>
    creating ? (body.kind === "standard" || body.kind === "rush" ? null : "invalid") : "fixed_after_create",
  );
  const kind = storedKind ?? (body.kind === "standard" || body.kind === "rush" ? body.kind : undefined);
  check("rush_slots", () => (kind ? slotsReason(body.rush_slots, kind) : null));
  if ("dialogue" in body) dialogueReasons(body.dialogue, fields);
  else if (creating) fields.dialogue = "required";
  return fields;
}

function slugFrom(title: string): string {
  const slug = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56)
    .replace(/-+$/, "");
  return slug || "mission";
}

export async function createMission(db: pg.PoolClient, body: Record<string, unknown>): Promise<Mission> {
  const base = slugFrom(body.title as string);
  let id = base;
  for (let n = 2; ; n++) {
    const made = await db.query(
      "INSERT INTO missions (id, kind, status, version, revision) VALUES ($1, $2, 'draft', 1, 1) ON CONFLICT (id) DO NOTHING",
      [id, body.kind],
    );
    if (made.rowCount === 1) break;
    id = `${base}-${n}`;
  }
  const dialogue = body.dialogue as { offer: string[]; thanks: string[] };
  await db.query(
    `INSERT INTO mission_versions (mission_id, version, title, resident_id, reward_stamps, rush_slots, offer, thanks)
     VALUES ($1, 1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      body.title,
      body.resident_id,
      body.reward_stamps,
      body.rush_slots,
      JSON.stringify(dialogue.offer),
      JSON.stringify(dialogue.thanks),
    ],
  );
  return (await loadMission(db, id))!;
}

// ---- revisions and moves ----

/** Step 6 for founder mission changes: the mission exists; its row stays locked until the change ends. */
export async function missionForChange(db: pg.PoolClient, id: string): Promise<Mission> {
  const m = await loadMission(db, id, true);
  if (!m) throw new ApiError(404, "not_found");
  return m;
}

/** Step 8: If-Match must name the current revision. */
export function checkRevision(ctx: Ctx, m: Mission): void {
  const given = ctx.req.headers["if-match"];
  if (given === undefined) throw new ApiError(428, "precondition_required");
  if (given.trim() !== `"${m.revision}"`) throw new ApiError(412, "stale_revision", undefined, etag(m));
}

export async function editMission(db: pg.PoolClient, m: Mission, body: Record<string, unknown>): Promise<Mission> {
  const next = {
    title: "title" in body ? (body.title as string) : m.title,
    resident_id: "resident_id" in body ? (body.resident_id as string) : m.resident_id,
    reward_stamps: "reward_stamps" in body ? (body.reward_stamps as number) : m.reward_stamps,
    rush_slots: "rush_slots" in body ? (body.rush_slots as number | null) : m.rush_slots,
    offer: "dialogue" in body ? (body.dialogue as { offer: string[] }).offer : m.offer,
    thanks: "dialogue" in body ? (body.dialogue as { thanks: string[] }).thanks : m.thanks,
  };
  const values = [
    next.title,
    next.resident_id,
    next.reward_stamps,
    next.rush_slots,
    JSON.stringify(next.offer),
    JSON.stringify(next.thanks),
  ];
  if (m.status === "live") {
    await db.query(
      `INSERT INTO mission_versions (mission_id, version, title, resident_id, reward_stamps, rush_slots, offer, thanks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [m.id, m.version + 1, ...values],
    );
    await db.query("UPDATE missions SET version = version + 1, revision = revision + 1 WHERE id = $1", [m.id]);
  } else {
    await db.query(
      `UPDATE mission_versions SET title = $3, resident_id = $4, reward_stamps = $5, rush_slots = $6, offer = $7, thanks = $8
        WHERE mission_id = $1 AND version = $2`,
      [m.id, m.version, ...values],
    );
    await db.query("UPDATE missions SET revision = revision + 1 WHERE id = $1", [m.id]);
  }
  return (await loadMission(db, m.id))!;
}

const DAY_MS = 86_400_000;
const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-](\d{2}):(\d{2}))$/;

function parseInstant(text: string): number | null {
  const m = ISO_INSTANT.exec(text);
  if (!m) return null;
  const [, y, mo, d, h, mi, s = "0", frac = "0", zone, oh = "0", om = "0"] = m;
  const fields = [+y!, +mo!, +d!, +h!, +mi!, +s];
  const local = Date.UTC(fields[0]!, fields[1]! - 1, fields[2]!, fields[3]!, fields[4]!, fields[5]!);
  const check = new Date(local);
  if (
    check.getUTCMonth() !== fields[1]! - 1 ||
    check.getUTCDate() !== fields[2] ||
    fields[3]! > 23 ||
    fields[4]! > 59 ||
    fields[5]! > 59 ||
    +oh > 23 ||
    +om > 59
  )
    return null;
  const offset = zone === "Z" ? 0 : (zone!.startsWith("-") ? -1 : 1) * (+oh * 60 + +om) * 60_000;
  return local - offset + Math.floor(Number(`0.${frac}`) * 1000);
}

/** Resolves the schedule body to one instant, or the field reasons that refuse it. */
export async function scheduleInstant(db: Db, body: Record<string, unknown>): Promise<number> {
  const now = Date.now();
  let key: "live_at" | "live_at_local";
  let at: number;
  if ("live_at" in body && "live_at_local" in body) throw validation({ live_at_local: "invalid" });
  if ("live_at_local" in body) {
    key = "live_at_local";
    if (typeof body.live_at_local !== "string") throw validation({ live_at_local: "invalid" });
    const resolved = resolveWallTime(body.live_at_local, await studioZone(db));
    if (!resolved.ok) throw validation({ live_at_local: resolved.reason });
    at = resolved.at;
  } else if ("live_at" in body) {
    key = "live_at";
    if (body.live_at === "now") return now;
    const parsed = typeof body.live_at === "string" ? parseInstant(body.live_at) : null;
    if (parsed === null) throw validation({ live_at: "invalid" });
    at = parsed;
  } else {
    throw validation({ live_at: "required" });
  }
  if (at < now - 60_000) throw validation({ [key]: "in_past" });
  if (at > now + 366 * DAY_MS) throw validation({ [key]: "out_of_range" });
  return at;
}

export async function scheduleMission(db: pg.PoolClient, m: Mission, at: number): Promise<Mission> {
  const live = at <= Date.now();
  await db.query("UPDATE missions SET status = $2, live_at = $3, revision = revision + 1 WHERE id = $1", [
    m.id,
    live ? "live" : "scheduled",
    new Date(at),
  ]);
  if (live && m.kind === "rush") await postMissionOnBoard(db, m.id);
  return (await loadMission(db, m.id))!;
}

export function requireMove(m: Mission, from: MissionStatus): void {
  if (m.status !== from) throw conflict("illegal_transition");
}

export async function unscheduleMission(db: pg.PoolClient, m: Mission): Promise<Mission> {
  await db.query("UPDATE missions SET status = 'draft', live_at = NULL, revision = revision + 1 WHERE id = $1", [m.id]);
  return (await loadMission(db, m.id))!;
}

export async function retireMission(db: pg.PoolClient, m: Mission): Promise<Mission> {
  await db.query("UPDATE missions SET status = 'retired', revision = revision + 1 WHERE id = $1", [m.id]);
  await removePostedParcels(db, m.id);
  return (await loadMission(db, m.id))!;
}
