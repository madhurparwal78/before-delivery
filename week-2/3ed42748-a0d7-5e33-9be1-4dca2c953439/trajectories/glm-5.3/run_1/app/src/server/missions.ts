import type { Tx } from "./db.js";
import { Errors, type FieldReason } from "./errors.js";
import { randomId } from "./config.js";
import { RESIDENTS } from "../shared/seed.js";
import { parseIsoInstant, isoFromPgDate } from "./time.js";
import { resolveLocalTime } from "./zones.js";

// Mission lifecycle moves, revision checks, field validation and studio wall-time
// resolution: each decided only here.

export type MissionStatus = "draft" | "scheduled" | "live" | "retired";
export type MissionKind = "standard" | "rush";

export type FounderMissionOut = {
  mission_id: string;
  title: string;
  resident_id: string;
  reward_stamps: number;
  kind: MissionKind;
  rush_slots: number | null;
  dialogue: { offer: string[]; thanks: string[] };
  status: MissionStatus;
  version: number;
  revision: number;
  live_at: string | null;
};

export async function studioZone(tx: Tx): Promise<string> {
  const { rows } = await tx.query<{ value: string }>(`SELECT value FROM settings WHERE key='studio_zone'`);
  return rows[0]?.value ?? "America/Vancouver";
}

export async function serializeMission(tx: Tx, row: {
  mission_id: string; title: string; resident_id: string; reward_stamps: number; kind: MissionKind;
  rush_slots: number | null; status: MissionStatus; version: number; revision: number; live_at: Date | null;
}): Promise<FounderMissionOut> {
  const { rows } = await tx.query<{ offer: unknown; thanks: unknown }>(
    `SELECT offer, thanks FROM mission_versions WHERE mission_id=$1 AND version=$2`,
    [row.mission_id, row.version],
  );
  return {
    mission_id: row.mission_id,
    title: row.title,
    resident_id: row.resident_id,
    reward_stamps: row.reward_stamps,
    kind: row.kind,
    rush_slots: row.rush_slots,
    dialogue: { offer: rows[0].offer as string[], thanks: rows[0].thanks as string[] },
    status: row.status,
    version: row.version,
    revision: row.revision,
    live_at: row.live_at ? isoFromPgDate(row.live_at) : null,
  };
}

export function missionIdFromTitle(title: string): string {
  let id = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  if (!/^[a-z0-9]/.test(id)) id = `m-${id}`;
  return id || `mission-${randomId("").slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// Mission field validation: one reason per field, first that applies.

export function validateMissionFields(
  body: Record<string, unknown>,
  isCreate: boolean,
  storedKind: MissionKind | null,
): { fields: Record<string, FieldReason>; mission: MissionInput | null } {
  const fields: Record<string, FieldReason> = {};
  const keys = isCreate
    ? ["title", "resident_id", "reward_stamps", "kind", "rush_slots", "dialogue"]
    : Object.keys(body).filter((k) => k !== "kind");
  const get = (k: string) => (isCreate ? body[k] : body[k]);

  const title = get("title");
  if (isCreate || "title" in body) {
    if (title === undefined || title === null || title === "") fields.title = "required";
    else if (typeof title !== "string" || /[\r\n\u2028\u2029]/.test(title)) fields.title = "invalid";
    else if (title.length > 60) fields.title = "too_long";
  }
  const reward = get("reward_stamps");
  if (isCreate || "reward_stamps" in body) {
    if (reward === undefined || reward === null) fields.reward_stamps = "required";
    else if (typeof reward !== "number" || !Number.isInteger(reward)) fields.reward_stamps = "invalid";
    else if (reward < 1 || reward > 50) fields.reward_stamps = "out_of_range";
  }
  const resident = get("resident_id");
  if (isCreate || "resident_id" in body) {
    if (resident === undefined) fields.resident_id = "required";
    else if (typeof resident !== "string") fields.resident_id = "invalid";
    else if (!RESIDENTS.some((r) => r.resident_id === resident)) fields.resident_id = "unknown_resident";
  }
  let kind: MissionKind | null = storedKind;
  if (isCreate) {
    const k = body.kind;
    if (k === undefined || k === null) fields.kind = "required";
    else if (k !== "standard" && k !== "rush") fields.kind = "invalid";
    else kind = k;
  } else if ("kind" in body) {
    fields.kind = "fixed_after_create";
  }
  const slots = get("rush_slots");
  if (isCreate || "rush_slots" in body) {
    const effectiveKind = isCreate ? (body.kind === "rush" ? "rush" : body.kind === "standard" ? "standard" : null) : storedKind;
    if (effectiveKind === "rush") {
      if (slots === undefined || slots === null) fields.rush_slots = "required";
      else if (typeof slots !== "number" || !Number.isInteger(slots)) fields.rush_slots = "invalid";
      else if (slots < 1 || slots > 5) fields.rush_slots = "out_of_range";
    } else if (effectiveKind === "standard") {
      if (slots !== null && slots !== undefined) fields.rush_slots = "invalid";
    } else if (slots === undefined || slots === null) {
      fields.rush_slots = "required";
    }
  }
  const dialogue = get("dialogue");
  let offer: string[] | null = null;
  let thanks: string[] | null = null;
  if (isCreate || "dialogue" in body) {
    if (dialogue === undefined || dialogue === null) fields.dialogue = "required";
    else if (typeof dialogue !== "object" || Array.isArray(dialogue)) fields.dialogue = "invalid";
    else {
      offer = validateLines((dialogue as Record<string, unknown>).offer, 1, 6, "dialogue.offer", fields);
      thanks = validateLines((dialogue as Record<string, unknown>).thanks, 1, 3, "dialogue.thanks", fields);
    }
  }
  void keys;
  if (Object.keys(fields).length > 0) return { fields, mission: null };
  return {
    fields: {},
    mission: {
      title: typeof title === "string" ? title : null,
      resident_id: typeof resident === "string" ? resident : null,
      reward_stamps: typeof reward === "number" ? reward : null,
      kind,
      rush_slots: typeof slots === "number" ? slots : null,
      offer,
      thanks,
    },
  };
}

export type MissionInput = {
  title: string | null;
  resident_id: string | null;
  reward_stamps: number | null;
  kind: MissionKind | null;
  rush_slots: number | null;
  offer: string[] | null;
  thanks: string[] | null;
};

function validateLines(value: unknown, min: number, max: number, path: string, fields: Record<string, FieldReason>): string[] | null {
  if (value === undefined || value === null) {
    fields[path] = "required";
    return null;
  }
  if (!Array.isArray(value) || value.some((l) => typeof l !== "string" || /[\r\n\u2028\u2029]/.test(l))) {
    fields[path] = "invalid";
    return null;
  }
  if (value.length < min || value.length > max) {
    fields[path] = "out_of_range";
    return null;
  }
  if (value.some((l) => l.length === 0)) {
    fields[path] = "required";
    return null;
  }
  if (value.some((l) => l.length > 200)) {
    fields[path] = "too_long";
    return null;
  }
  return value as string[];
}

// ---------------------------------------------------------------------------
// Lifecycle

export const LEGAL_MOVES: Record<string, MissionStatus[]> = {
  "draft>scheduled": ["draft"],
  "draft>live": ["draft"],
  "scheduled>draft": ["scheduled"],
  "scheduled>live": ["scheduled"],
  "live>retired": ["live"],
};

/** Resolves a schedule body to an instant. Returns fields for each fault, in check order. */
export async function resolveScheduleBody(
  tx: Tx,
  body: Record<string, unknown>,
): Promise<{ fields: Record<string, FieldReason>; instant: number | null }> {
  const hasLiveAt = "live_at" in body;
  const hasLocal = "live_at_local" in body;
  if (hasLiveAt && hasLocal) return { fields: { live_at_local: "invalid" }, instant: null };
  if (!hasLiveAt && !hasLocal) return { fields: { live_at: "required" }, instant: null };
  const now = Date.now();
  if (hasLiveAt) {
    const v = body.live_at;
    if (v === "now") return { fields: {}, instant: now };
    const instant = typeof v === "string" ? parseIsoInstant(v) : null;
    if (instant === null) return { fields: { live_at: "invalid" }, instant: null };
    return windowCheck(instant, now, "live_at");
  }
  const v = body.live_at_local;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) {
    return { fields: { live_at_local: "invalid" }, instant: null };
  }
  const zone = await studioZone(tx);
  const instant = resolveLocalTime(zone, v);
  if (instant === null) return { fields: { live_at_local: "nonexistent_time" }, instant: null };
  return windowCheck(instant, now, "live_at_local");
}

function windowCheck(instant: number, now: number, key: "live_at" | "live_at_local"): { fields: Record<string, FieldReason>; instant: number | null } {
  if (instant < now - 60_000) return { fields: { [key]: "in_past" }, instant: null };
  if (instant > now + 366 * 86_400_000) return { fields: { [key]: "out_of_range" }, instant: null };
  return { fields: {}, instant };
}

/** The single place mission rows change state, bumping the revision and, on live edits, the version. */
export type MissionChange = {
  title?: string;
  resident_id?: string;
  reward_stamps?: number;
  rush_slots?: number | null;
  status?: MissionStatus;
  live_at?: number | null;
  version?: number;
  revision?: number;
};

export async function applyMissionChange(
  tx: Tx,
  missionId: string,
  changes: MissionChange,
  newDialogue: { offer?: string[]; thanks?: string[] } | null,
): Promise<void> {
  const { rows } = await tx.query<{
    title: string; resident_id: string; reward_stamps: number; kind: MissionKind; rush_slots: number | null;
    status: MissionStatus; version: number; revision: number; live_at: Date | null;
  }>(`SELECT * FROM missions WHERE mission_id = $1 FOR UPDATE`, [missionId]);
  const m = rows[0];
  const liveEdit = (changes.status === undefined || changes.status === m.status) && m.status === "live";
  const nextVersion = liveEdit ? m.version + 1 : m.version;
  const nextRevision = m.revision + 1;

  await tx.query(
    `UPDATE missions SET title=$2, resident_id=$3, reward_stamps=$4, rush_slots=$5, status=$6, live_at=$7, version=$8, revision=$9
     WHERE mission_id=$1`,
    [
      missionId,
      changes.title ?? m.title,
      changes.resident_id ?? m.resident_id,
      changes.reward_stamps ?? m.reward_stamps,
      changes.rush_slots !== undefined ? changes.rush_slots : m.rush_slots,
      changes.status ?? m.status,
      changes.live_at !== undefined ? (changes.live_at === null ? null : new Date(changes.live_at)) : m.live_at,
      nextVersion,
      nextRevision,
    ],
  );

  if (newDialogue || liveEdit) {
    const { rows: vrows } = await tx.query<{ offer: unknown; thanks: unknown }>(
      `SELECT offer, thanks FROM mission_versions WHERE mission_id=$1 AND version=$2`, [missionId, m.version],
    );
    const offer = newDialogue?.offer ?? (vrows[0].offer as string[]);
    const thanks = newDialogue?.thanks ?? (vrows[0].thanks as string[]);
    const { rows: cur } = await tx.query(`SELECT title, resident_id, reward_stamps FROM missions WHERE mission_id=$1`, [missionId]);
    await tx.query(
      `INSERT INTO mission_versions (mission_id, version, title, resident_id, reward_stamps, offer, thanks)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)
       ON CONFLICT (mission_id, version) DO UPDATE SET title=$3, resident_id=$4, reward_stamps=$5, offer=$6, thanks=$7`,
      [missionId, nextVersion, cur[0].title, cur[0].resident_id, cur[0].reward_stamps, JSON.stringify(offer), JSON.stringify(thanks)],
    );
  }
}

/** Automatic scheduled → live, reported within one second. */
export async function promoteDueMissions(db: { tx: (fn: (tx: Tx) => Promise<void>) => Promise<void> }): Promise<void> {
  await db.tx(async (tx) => {
    const { rows } = await tx.query<{ mission_id: string }>(
      `SELECT mission_id FROM missions WHERE status='scheduled' AND live_at <= now() FOR UPDATE`,
    );
    for (const row of rows) {
      await applyMissionChange(tx, row.mission_id, { status: "live" }, null);
    }
  });
}

export { Errors };
