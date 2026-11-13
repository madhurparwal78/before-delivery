// One promotion: read, the keyed actions on it and its evidence download.
import { type Action, authorize, promotionProject } from "../access.js";
import { sessionUser, type User } from "../auth.js";
import { pool, withTx, type Tx } from "../db.js";
import { evidenceKey } from "../domain/evidence.js";
import { approve, breakFreeze, recheck, reject, stageByName, start, type StageRow } from "../domain/promotions.js";
import { type Loaded, loadPromotions } from "../domain/records.js";
import { ApiError, invalid } from "../errors.js";
import { body, json, type Ctx, type Reply } from "../http.js";
import { keyed } from "../requestKeys.js";
import { getObject } from "../storage.js";
import { MESSAGES, isReason, isRecord } from "../validate.js";

async function loaded(id: string): Promise<Loaded> {
  return (await loadPromotions(pool, [id]))[0] as Loaded;
}

export async function readPromotion(ctx: Ctx, [id = ""]: string[]): Promise<Reply> {
  await promotionProject(pool, await sessionUser(pool, ctx), id);
  return json(200, (await loaded(id)).view);
}

interface Call { id: string; user: User; stage: StageRow; text: string; now: Date }

interface ActionSpec { action: Action; text: "comment" | "reason" | null; step: (tx: Tx, call: Call) => Promise<void> }

const ACTIONS: Record<string, ActionSpec> = {
  approve: { action: "approve", text: "comment", step: (tx, c) => approve(tx, c.id, c.user, c.text || null, c.now) },
  reject: { action: "reject", text: "reason", step: (tx, c) => reject(tx, c.id, c.user, c.text, c.now) },
  start: { action: "start", text: null, step: (tx, c) => start(tx, c.id, c.stage, c.user, c.now) },
  "retry-window": { action: "recheck", text: null, step: (tx, c) => recheck(tx, c.id, c.stage, c.user, c.now) },
  "break-freeze": { action: "break_freeze", text: "reason", step: (tx, c) => breakFreeze(tx, c.id, c.user, c.text, c.now) },
};

function readText(spec: ActionSpec, input: unknown): string {
  const record = isRecord(input) ? input : {};
  if (spec.text === "reason") {
    if (!isReason(record.reason)) throw invalid({ reason: MESSAGES.reason });
    return record.reason;
  }
  if (spec.text === "comment") {
    const comment = record.comment ?? null;
    if (comment !== null && (typeof comment !== "string" || comment.length > 500)) throw invalid({ comment: MESSAGES.comment });
    return comment ?? "";
  }
  return "";
}

export async function act(ctx: Ctx, [id = "", name = ""]: string[]): Promise<Reply> {
  const spec = ACTIONS[name] as ActionSpec;
  const user = await sessionUser(pool, ctx);
  const member = await promotionProject(pool, user, id);
  authorize(member, spec.action);
  return keyed(ctx, user, async () => {
    const text = readText(spec, body(ctx));
    const stage = (await stageByName(pool, member.id, (await loaded(id)).view.stage)) as StageRow;
    await withTx((tx) => spec.step(tx, { id, user, stage, text, now: ctx.now }));
    return json(200, (await loaded(id)).view);
  });
}

export async function downloadEvidence(ctx: Ctx, [id = ""]: string[]): Promise<Reply> {
  const member = await promotionProject(pool, await sessionUser(pool, ctx), id);
  const { rows } = await pool.query<{ number: number }>(
    "SELECT max(number)::int AS number FROM evidence_snapshots WHERE promotion_id = $1 AND stored_at IS NOT NULL", [id]);
  const number = rows[0]?.number;
  if (!number) throw new ApiError("evidence_pending", "No evidence snapshot is stored yet.");
  const bytes = await getObject(evidenceKey(member.slug, id, number), "Evidence storage is unreachable.");
  return {
    status: 200,
    bytes,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="keelson-evidence-${id}-${number}.json"`,
    },
  };
}
