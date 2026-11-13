// Longevity plans: drafts, publishing, and the protection against saving over a newer plan.

import { randomUUID } from "node:crypto";
import type { BlendView, PlanSections, PlanView } from "../shared/api";
import { localTime, wholeSeconds } from "../shared/time";
import { blendById, currentBlend } from "./blends";
import { inTransaction, one, pool, rows, type Db } from "./db";
import { ApiError, conflict, invalid } from "./errors";
import { isRecord, text, type JsonBody } from "./fields";

const SECTION_LIMIT = 20000;
const SECTION_NAMES = ["nutrition", "movement", "sleep", "supplements"] as const;

interface PlanRow {
  id: string;
  member_id: string;
  state: "draft" | "published";
  based_on_plan_id: string | null;
  nutrition: string;
  movement: string;
  sleep: string;
  supplements: string;
  published_at: Date | null;
  published_by: string | null;
  blend_id: string | null;
  updated_at: Date;
}

function planView(row: PlanRow, blend: BlendView | null): PlanView {
  return {
    id: row.id,
    memberId: row.member_id,
    state: row.state,
    basedOnPlanId: row.based_on_plan_id,
    sections: { nutrition: row.nutrition, movement: row.movement, sleep: row.sleep, supplements: row.supplements },
    publishedAt: row.published_at ? wholeSeconds(row.published_at) : null,
    publishedBy: row.published_by,
    blend,
    updatedAt: wholeSeconds(row.updated_at),
  };
}

const recordedBlend = async (row: PlanRow): Promise<BlendView | null> => (row.blend_id ? blendById(row.blend_id) : null);

function readSections(body: JsonBody): PlanSections {
  const given = isRecord(body["sections"]) ? body["sections"] : {};
  const fields: Record<string, string> = {};
  for (const name of SECTION_NAMES) {
    if ([...text(given, name)].length > SECTION_LIMIT) fields[`sections.${name}`] = "Keep each section to 20,000 characters.";
  }
  if (Object.keys(fields).length > 0) throw invalid(fields);
  return {
    nutrition: text(given, "nutrition"),
    movement: text(given, "movement"),
    sleep: text(given, "sleep"),
    supplements: text(given, "supplements"),
  };
}

async function latestPublished(db: Db, memberId: string): Promise<PlanRow | undefined> {
  return one<PlanRow>(db, "SELECT * FROM plans WHERE member_id = $1 AND state = 'published' ORDER BY published_at DESC, seq DESC LIMIT 1", [memberId]);
}

function staleRefusal(newer: PlanRow): ApiError {
  const at = newer.published_at ? localTime(newer.published_at, "phoenix") : "";
  return new ApiError(412, "stale", `${newer.published_by ?? ""} published a newer plan at ${at} Phoenix time. Your changes are still here.`);
}

async function requireLatestBase(db: Db, memberId: string, basedOn: string | null): Promise<void> {
  const latest = await latestPublished(db, memberId);
  if (latest && latest.id !== basedOn) throw staleRefusal(latest);
}

export async function planExists(id: string, memberId: string): Promise<boolean> {
  return (await one(pool, "SELECT 1 FROM plans WHERE id = $1 AND member_id = $2", [id, memberId])) !== undefined;
}

export async function createDraft(memberId: string, body: JsonBody, now: Date): Promise<PlanView> {
  const sections = readSections(body);
  const basedOn = text(body, "basedOnPlanId") || null;
  await requireLatestBase(pool, memberId, basedOn);
  const row: PlanRow = {
    id: randomUUID(),
    member_id: memberId,
    state: "draft",
    based_on_plan_id: basedOn,
    ...sections,
    published_at: null,
    published_by: null,
    blend_id: null,
    updated_at: now,
  };
  await pool.query(
    `INSERT INTO plans (id, member_id, state, based_on_plan_id, nutrition, movement, sleep, supplements, updated_at)
     VALUES ($1, $2, 'draft', $3, $4, $5, $6, $7, $8)`,
    [row.id, memberId, basedOn, sections.nutrition, sections.movement, sections.sleep, sections.supplements, now],
  );
  return planView(row, null);
}

export async function locatePlan(id: string): Promise<PlanRow | undefined> {
  return one<PlanRow>(pool, "SELECT * FROM plans WHERE id = $1", [id]);
}

const alreadyPublished = (): ApiError => conflict("already_published", "This plan is already published.");

export async function saveDraft(plan: PlanRow, body: JsonBody, now: Date): Promise<PlanView> {
  const sections = readSections(body);
  if (plan.state === "published") throw alreadyPublished();
  await requireLatestBase(pool, plan.member_id, plan.based_on_plan_id);
  const saved = await one(pool, "UPDATE plans SET nutrition = $2, movement = $3, sleep = $4, supplements = $5, updated_at = $6 WHERE id = $1 AND state = 'draft' RETURNING id", [
    plan.id, sections.nutrition, sections.movement, sections.sleep, sections.supplements, now,
  ]);
  if (!saved) throw alreadyPublished();
  return planView({ ...plan, ...sections, updated_at: now }, null);
}

export async function publishPlan(plan: PlanRow, publishedBy: string, now: Date): Promise<PlanView> {
  if (plan.state === "published") throw alreadyPublished();
  return inTransaction(async (db) => {
    await db.query("SELECT 1 FROM members WHERE id = $1 FOR UPDATE", [plan.member_id]);
    await requireLatestBase(db, plan.member_id, plan.based_on_plan_id);
    const blend = await currentBlend(db, plan.member_id);
    const published = await one(db, "UPDATE plans SET state = 'published', published_at = $2, published_by = $3, blend_id = $4, updated_at = $2 WHERE id = $1 AND state = 'draft' RETURNING id", [
      plan.id, now, publishedBy, blend?.id ?? null,
    ]);
    if (!published) throw alreadyPublished();
    return planView({ ...plan, state: "published", published_at: now, published_by: publishedBy, blend_id: blend?.id ?? null, updated_at: now }, blend);
  });
}

export async function memberPlans(memberId: string): Promise<PlanView[]> {
  const found = await rows<PlanRow>(pool, "SELECT * FROM plans WHERE member_id = $1 ORDER BY seq DESC", [memberId]);
  return Promise.all(found.map(async (row) => planView(row, await recordedBlend(row))));
}

export async function planForStaff(plan: PlanRow): Promise<PlanView> {
  return planView(plan, await recordedBlend(plan));
}

// A member reads the latest published plan with the current blend, never a draft.
export async function planForMember(memberId: string): Promise<PlanView | null> {
  const latest = await latestPublished(pool, memberId);
  return latest ? planView(latest, await currentBlend(pool, memberId)) : null;
}
