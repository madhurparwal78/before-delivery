/**
 * Lifecycle (rule J): policy, one lifecycle step, generation phases and the timeline.
 */
import type { PoolClient } from "pg";
import type { GenerationInfo, LifecyclePolicy, Phase } from "../shared/types";
import { fmtFixed } from "../shared/util";
import { formatInZone } from "../shared/tz";
import { nowMs } from "./clock";
import {
  type GenerationRow,
  type PolicyRow,
  type StreamRow,
  generationEventCount,
  getPolicy,
  listGenerations,
  readSegment,
  writeGenerationRow,
} from "./events";
import { confirmObjectSize, deleteObject, putObject, segmentKey } from "./storage";
import { nextId } from "./db";
import { sha256Buffer } from "./auth";

export const PHASES: Phase[] = ["hot", "warm", "archive", "delete"];

export function policyOf(row: PolicyRow | null): LifecyclePolicy | null {
  if (!row) return null;
  const num = (v: unknown): number | null =>
    v === null || v === undefined ? null : Number(v);
  return {
    rollover_max_age_ms: num(row.rollover_max_age_ms),
    rollover_max_events: num(row.rollover_max_events),
    warm_after_ms: num(row.warm_after_ms),
    archive_after_ms: num(row.archive_after_ms),
    delete_after_ms: num(row.delete_after_ms),
  };
}

export interface LifecycleOutcome {
  stream: string;
  rolledOver: boolean;
  generations: GenerationInfo[];
  failures: string[];
}

/** One lifecycle step for one stream (rule J). */
export async function lifecycleStep(
  db: PoolClient,
  spaceSlug: string,
  stream: StreamRow,
): Promise<LifecycleOutcome> {
  const policy = policyOf(await getPolicy(db, stream.id));
  const now = nowMs();
  const failures: string[] = [];
  let rolledOver = false;

  const gens = await listGenerations(db, stream.id);
  const write = await writeGenerationRow(db, stream.id);

  // 1. Rollover check on the write generation.
  if (policy) {
    const age = now - write.created_at.getTime();
    const events = await generationEventCount(db, write.id);
    const byAge = policy.rollover_max_age_ms !== null && age >= policy.rollover_max_age_ms;
    const byEvents = policy.rollover_max_events !== null && events >= policy.rollover_max_events;
    const isEmpty = events === 0;
    if ((byAge || byEvents) && !isEmpty) {
      await db.query("UPDATE generations SET rolled_over_at = $1 WHERE id = $2", [new Date(now), write.id]);
      const number = write.number + 1;
      await db.query(
        "INSERT INTO generations (id, stream_id, number, phase, created_at) VALUES ($1,$2,$3,'hot',$4)",
        [nextId(), stream.id, number, new Date(now)],
      );
      // Explicit mappings carry over at rollover.
      const res = await db.query<{ field: string; type: string }>(
        "SELECT field, type FROM mappings WHERE generation_id = $1 AND explicit = TRUE",
        [write.id],
      );
      const newGen = await db.query<GenerationRow>(
        "SELECT id, stream_id, number, phase, created_at, rolled_over_at FROM generations WHERE stream_id = $1 AND number = $2",
        [stream.id, number],
      );
      const newId = newGen.rows[0].id;
      for (const m of res.rows) {
        await db.query(
          "INSERT INTO mappings (id, generation_id, field, type, explicit) VALUES ($1,$2,$3,$4,TRUE) ON CONFLICT DO NOTHING",
          [nextId(), newId, m.field, m.type],
        );
      }
      rolledOver = true;
    }
  }

  // 2. Move each rolled-over generation forward, oldest first (rule J).
  const current = await listGenerations(db, stream.id);
  const sorted = [...current].sort((a, b) => a.number - b.number);
  for (const g of sorted) {
    if (g.phase === "delete") continue;
    if (g.rolled_over_at === null) continue;
    const rolledAt = g.rolled_over_at.getTime();
    const age = now - rolledAt;
    const wants: Phase[] = [];
    if (policy?.warm_after_ms !== null && policy?.warm_after_ms !== undefined) {
      if (age >= policy.warm_after_ms) wants.push("warm");
    }
    if (policy?.archive_after_ms !== null && policy?.archive_after_ms !== undefined) {
      if (age >= policy.archive_after_ms) wants.push("archive");
    }
    if (policy?.delete_after_ms !== null && policy?.delete_after_ms !== undefined) {
      if (age >= policy.delete_after_ms) wants.push("delete");
    }
    const furthest = wants[wants.length - 1];
    if (!furthest) continue;
    let phase: Phase = g.phase;
    const promotable: boolean = phase === "hot" || phase === "warm";
    if (furthest === "warm") {
      if (phase === "hot") phase = "warm";
    } else if (furthest === "archive") {
      if (promotable) {
        const ok = await archiveGeneration(db, spaceSlug, stream, g);
        if (ok) phase = "archive";
        else failures.push("archive");
      }
    } else if (furthest === "delete") {
      if (promotable) {
        const ok = await archiveGeneration(db, spaceSlug, stream, g);
        if (ok) {
          phase = "archive";
          const deleted = await deleteGeneration(db, spaceSlug, stream, g);
          if (deleted) phase = "delete";
          else failures.push("delete");
        } else {
          failures.push("archive");
        }
      } else if (phase === "archive") {
        const deleted = await deleteGeneration(db, spaceSlug, stream, g);
        if (deleted) phase = "delete";
        else failures.push("delete");
      }
    }
    if (phase !== g.phase) {
      await db.query("UPDATE generations SET phase = $1 WHERE id = $2", [phase, g.id]);
    }
  }

  const generations = await generationsInfo(db, spaceSlug, stream);
  return { stream: stream.name, rolledOver, generations, failures };
}

/** Write the segment object and confirm its size before the generation counts as archived. */
async function archiveGeneration(
  db: PoolClient,
  spaceSlug: string,
  stream: StreamRow,
  g: GenerationRow,
): Promise<boolean> {
  const res = await db.query<{ id: string; event_id: string; ts: Date; fields: Record<string, unknown>; pipeline: string | null }>(
    "SELECT id, event_id, ts, fields, pipeline FROM events WHERE generation_id = $1 ORDER BY ts ASC, event_id ASC",
    [g.id],
  );
  const lines = res.rows.map((r) =>
    JSON.stringify({ _id: r.event_id, "@timestamp": r.ts.toISOString(), fields: r.fields, _pipeline: r.pipeline }),
  );
  const bytes = Buffer.from(lines.join("\n"), "utf8");
  const key = segmentKey(spaceSlug, stream.name, g.number);
  const put = await putObject(key, bytes);
  if (!put.ok) return false;
  const confirmed = await confirmObjectSize(key, bytes.length);
  if (!confirmed) return false;
  await db.query("DELETE FROM events WHERE generation_id = $1", [g.id]);
  await db.query("DELETE FROM terms WHERE generation_id = $1", [g.id]);
  await db.query("UPDATE generations SET segment_key = $1, segment_bytes = $2 WHERE id = $3", [
    key,
    bytes.length,
    g.id,
  ]);
  return true;
}

async function deleteGeneration(
  db: PoolClient,
  spaceSlug: string,
  stream: StreamRow,
  g: GenerationRow,
): Promise<boolean> {
  const res = await db.query<{ segment_key: string | null }>("SELECT segment_key FROM generations WHERE id = $1", [
    g.id,
  ]);
  const key = res.rows[0]?.segment_key ?? segmentKey(spaceSlug, stream.name, g.number);
  await db.query("DELETE FROM events WHERE generation_id = $1", [g.id]);
  await db.query("DELETE FROM terms WHERE generation_id = $1", [g.id]);
  const ok = await deleteObject(key);
  if (!ok) return false;
  return true;
}

/** The next step of one generation for the timeline. */
function nextStepOf(
  g: GenerationRow,
  policy: LifecyclePolicy | null,
  now: number,
): { step: string; at: string } | null {
  if (g.phase === "delete") return null;
  if (g.phase === "hot") {
    if (!policy) return null;
    if (policy.rollover_max_age_ms !== null) {
      return { step: "rollover", at: iso(g.created_at.getTime() + policy.rollover_max_age_ms) };
    }
    if (policy.rollover_max_events !== null) {
      return { step: `rollover at ${policy.rollover_max_events} events`, at: iso(now) };
    }
    return null;
  }
  if (!g.rolled_over_at || !policy) return null;
  const rolledAt = g.rolled_over_at.getTime();
  if (g.phase === "warm") {
    if (policy.archive_after_ms !== null) {
      return { step: "archive", at: iso(rolledAt + policy.archive_after_ms) };
    }
    if (policy.delete_after_ms !== null) {
      return { step: "delete", at: iso(rolledAt + policy.delete_after_ms) };
    }
    return null;
  }
  if (g.phase === "archive") {
    if (policy.delete_after_ms !== null) {
      return { step: "delete", at: iso(rolledAt + policy.delete_after_ms) };
    }
    return null;
  }
  return null;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Generation info with the timeline text (rule J). */
export async function generationsInfo(
  db: PoolClient,
  spaceSlug: string,
  stream: StreamRow,
  zone = "UTC",
): Promise<GenerationInfo[]> {
  const policy = policyOf(await getPolicy(db, stream.id));
  const gens = await listGenerations(db, stream.id);
  const out: GenerationInfo[] = [];
  for (const g of gens) {
    let events: number;
    if (g.phase === "delete") {
      events = 0;
    } else if (g.phase === "archive") {
      try {
        events = (await readSegment(g, spaceSlug, stream.name)).length;
      } catch {
        events = 0;
      }
    } else {
      events = await generationEventCount(db, g.id);
    }
    const next = nextStepOf(g, policy, nowMs());
    const segRes = await db.query<{ segment_key: string | null; segment_bytes: number | null }>(
      "SELECT segment_key, segment_bytes FROM generations WHERE id = $1",
      [g.id],
    );
    const seg = segRes.rows[0];
    const timeline = timelineText(g, next, zone, events);
    out.push({
      number: g.number,
      phase: g.phase,
      created_at: g.created_at.toISOString(),
      rolled_over_at: g.rolled_over_at ? g.rolled_over_at.toISOString() : null,
      events,
      next,
      segment: seg?.segment_key ? { key: seg.segment_key, bytes: seg.segment_bytes ?? 0 } : null,
      timeline,
    });
  }
  return out;
}

function timelineText(
  g: GenerationRow,
  next: { step: string; at: string } | null,
  zone: string,
  events: number,
): string {
  if (g.phase === "delete") return `Generation ${g.number}, deleted, next: none`;
  const nextPart = next
    ? `${next.step === "rollover" ? `rollover at ${formatInZone(zone, Date.parse(next.at))}` : next.step} at ${formatInZone(
        zone,
        Date.parse(next.at),
      )}`
    : "none";
  return `Generation ${g.number}, ${g.phase}, next: ${nextPart}`;
}
