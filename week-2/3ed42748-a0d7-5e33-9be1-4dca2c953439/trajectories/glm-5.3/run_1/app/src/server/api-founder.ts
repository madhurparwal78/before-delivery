import type { Tx } from "./db.js";
import { Errors } from "./errors.js";
import { randomId } from "./config.js";
import { boardDate, isValidZone } from "./zones.js";
import {
  applyMissionChange, missionIdFromTitle, resolveScheduleBody, serializeMission, studioZone,
  validateMissionFields, type MissionKind, type MissionStatus,
} from "./missions.js";

// The founder console's API: missions, revisions, studio settings and Online now.

type MissionRow = {
  mission_id: string; title: string; resident_id: string; reward_stamps: number;
  kind: MissionKind; rush_slots: number | null; status: MissionStatus;
  version: number; revision: number; live_at: Date | null;
};

async function missionRow(tx: Tx, missionId: string): Promise<MissionRow | null> {
  const { rows } = await tx.query<MissionRow>(`SELECT * FROM missions WHERE mission_id=$1`, [missionId]);
  return rows[0] ?? null;
}

export async function listMissions(tx: Tx): Promise<string> {
  const { rows } = await tx.query<MissionRow>(`SELECT * FROM missions ORDER BY mission_id ASC`);
  const out = [];
  for (const row of rows) {
    const effective = row.status === "scheduled" && row.live_at && row.live_at.getTime() <= Date.now() ? "live" : row.status;
    out.push(await serializeMission(tx, { ...row, status: effective as MissionStatus }));
  }
  return JSON.stringify({ missions: out });
}

export async function getMission(tx: Tx, missionId: string): Promise<{ body: string; revision: number }> {
  const row = await missionRow(tx, missionId);
  if (!row) throw Errors.notFound();
  const effective = row.status === "scheduled" && row.live_at && row.live_at.getTime() <= Date.now() ? "live" : row.status;
  return { body: JSON.stringify(await serializeMission(tx, { ...row, status: effective as MissionStatus })), revision: row.revision };
}

export async function createMission(tx: Tx, body: Record<string, unknown>): Promise<{ body: string; revision: number }> {
  const check = validateMissionFields(body, true, null);
  if (Object.keys(check.fields).length > 0) throw Errors.validation(check.fields);
  const m = check.mission!;
  let missionId = missionIdFromTitle(m.title!);
  const { rows: clash } = await tx.query(`SELECT 1 FROM missions WHERE mission_id=$1`, [missionId]);
  if (clash.length > 0) missionId = `${missionId}-${randomId("").slice(0, 6)}`;
  await tx.query(
    `INSERT INTO missions (mission_id, title, resident_id, reward_stamps, kind, rush_slots, status, version, revision, live_at)
     VALUES ($1,$2,$3,$4,$5,$6,'draft',1,1,NULL)`,
    [missionId, m.title!, m.resident_id!, m.reward_stamps!, m.kind!, m.rush_slots],
  );
  await tx.query(
    `INSERT INTO mission_versions (mission_id, version, title, resident_id, reward_stamps, offer, thanks)
     VALUES ($1,1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
    [missionId, m.title!, m.resident_id!, m.reward_stamps!, JSON.stringify(m.offer), JSON.stringify(m.thanks)],
  );
  const row = await missionRow(tx, missionId);
  return { body: JSON.stringify(await serializeMission(tx, row!)), revision: row!.revision };
}

export async function patchMission(tx: Tx, missionId: string, body: Record<string, unknown>): Promise<{ body: string; revision: number }> {
  const row = await missionRow(tx, missionId);
  if (!row) throw Errors.notFound();
  if (row.status === "retired") throw Errors.conflict("mission_retired", "Retired missions can't be edited.");
  const check = validateMissionFields(body, false, row.kind);
  if (Object.keys(check.fields).length > 0) throw Errors.validation(check.fields);
  const m = check.mission!;
  await applyMissionChange(tx, missionId, {
    title: m.title ?? undefined,
    resident_id: m.resident_id ?? undefined,
    reward_stamps: m.reward_stamps ?? undefined,
    rush_slots: m.rush_slots !== null && m.rush_slots !== undefined ? m.rush_slots : undefined,
  }, { offer: m.offer ?? undefined, thanks: m.thanks ?? undefined });
  const fresh = await missionRow(tx, missionId);
  return { body: JSON.stringify(await serializeMission(tx, fresh!)), revision: fresh!.revision };
}

export async function scheduleMission(tx: Tx, missionId: string, body: Record<string, unknown>): Promise<{ body: string; revision: number }> {
  const row = await missionRow(tx, missionId);
  if (!row) throw Errors.notFound();
  if (row.status !== "draft") throw Errors.conflict("illegal_transition", "That mission can't move.");
  const resolved = await resolveScheduleBody(tx, body);
  if (Object.keys(resolved.fields).length > 0) throw Errors.validation(resolved.fields);
  const instant = resolved.instant!;
  // A resolved instant at or before now takes the mission live inside this request.
  if (instant <= Date.now()) {
    await applyMissionChange(tx, missionId, { status: "live", live_at: instant }, null);
  } else {
    await applyMissionChange(tx, missionId, { status: "scheduled", live_at: instant }, null);
  }
  const fresh = await missionRow(tx, missionId);
  return { body: JSON.stringify(await serializeMission(tx, fresh!)), revision: fresh!.revision };
}

export async function unscheduleMission(tx: Tx, missionId: string): Promise<{ body: string; revision: number }> {
  const row = await missionRow(tx, missionId);
  if (!row) throw Errors.notFound();
  if (row.status !== "scheduled") throw Errors.conflict("illegal_transition", "That mission can't move.");
  await applyMissionChange(tx, missionId, { status: "draft", live_at: null }, null);
  const fresh = await missionRow(tx, missionId);
  return { body: JSON.stringify(await serializeMission(tx, fresh!)), revision: fresh!.revision };
}

export async function retireMission(tx: Tx, missionId: string): Promise<{ body: string; revision: number }> {
  const row = await missionRow(tx, missionId);
  if (!row) throw Errors.notFound();
  if (row.status !== "live") throw Errors.conflict("illegal_transition", "That mission can't move.");
  await applyMissionChange(tx, missionId, { status: "retired" }, null);
  const fresh = await missionRow(tx, missionId);
  return { body: JSON.stringify(await serializeMission(tx, fresh!)), revision: fresh!.revision };
}

export async function studioRead(tx: Tx): Promise<string> {
  const zone = await studioZone(tx);
  return JSON.stringify({ time_zone: zone, board_date: boardDate(zone) });
}

export async function studioWrite(tx: Tx, body: Record<string, unknown>): Promise<string> {
  if (!("time_zone" in body)) throw Errors.validation({ time_zone: "required" });
  const zone = body.time_zone;
  if (!isValidZone(zone)) throw Errors.validation({ time_zone: "invalid" });
  await tx.query(
    `INSERT INTO settings (key, value) VALUES ('studio_zone', $1)
     ON CONFLICT (key) DO UPDATE SET value = $1`,
    [zone as string],
  );
  return JSON.stringify({ time_zone: zone as string, board_date: boardDate(zone as string) });
}
