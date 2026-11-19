import { editedSince, ALERTS } from "../shared/copy.js";
import { decideMove } from "../shared/moves.js";
import type { Step } from "../shared/types.js";
import { config } from "./config.js";
import { moveRules, type Work } from "./commit.js";
import { conflict, notFound } from "./http.js";
import { pool } from "./db.js";
import { refusalError } from "./refusals.js";

export type StepData =
  | { kind: "text edit"; before: string; after: string; revision: number }
  | { kind: "completion"; before: boolean; after: boolean; revision: number }
  | { kind: "move" | "indent" | "outdent"; from: Place; to: Place }
  | { kind: "delete" | "new bullet" | "mirror"; ids: string[]; place: Place; removed: boolean };

interface Place {
  parentId: string | null;
  index: number;
}

export interface StepRow {
  id: number;
  kind: Step;
  bulletId: string;
  ownerId: string;
  data: StepData;
}

interface StepRecord {
  id: number;
  kind: Step;
  bullet_id: string;
  outline_owner_id: string;
  data: StepData;
}

const toStep = (record: StepRecord): StepRow => ({
  id: record.id,
  kind: record.kind,
  bulletId: record.bullet_id,
  ownerId: record.outline_owner_id,
  data: record.data,
});

export async function recordStep(work: Work, kind: Step, bulletId: string, data: StepData): Promise<void> {
  const { client, actor, state } = work;
  await client.query("DELETE FROM steps WHERE account_id = $1 AND stack = 'redo'", [actor.accountId]);
  await client.query(
    "INSERT INTO steps (account_id, outline_owner_id, stack, kind, bullet_id, data) VALUES ($1, $2, 'undo', $3, $4, $5)",
    [actor.accountId, state.ownerId, kind, bulletId, JSON.stringify(data)],
  );
  await client.query(
    `DELETE FROM steps WHERE account_id = $1 AND stack = 'undo' AND id NOT IN
       (SELECT id FROM steps WHERE account_id = $1 AND stack = 'undo' ORDER BY ord DESC LIMIT $2)`,
    [actor.accountId, config.undoDepth],
  );
}

/** Consecutive saves of one bullet by one person merge into the step already on top. */
export async function mergeTextEdit(work: Work, bulletId: string, revisionBefore: number, after: string, revisionAfter: number): Promise<boolean> {
  const top = await work.client.query<StepRecord>(
    `SELECT id, kind, bullet_id, outline_owner_id, data FROM steps
     WHERE account_id = $1 AND stack = 'undo' ORDER BY ord DESC LIMIT 1`,
    [work.actor.accountId],
  );
  const step = top.rows[0];
  if (step === undefined || step.kind !== "text edit" || step.bullet_id !== bulletId) return false;
  if (step.data.kind !== "text edit" || step.data.revision !== revisionBefore) return false;
  await work.client.query("UPDATE steps SET data = $2 WHERE id = $1", [step.id, JSON.stringify({ ...step.data, after, revision: revisionAfter })]);
  return true;
}

export async function topStep(stack: "undo" | "redo", accountId: string): Promise<StepRow | null> {
  const found = await pool.query<StepRecord>(
    `SELECT id, kind, bullet_id, outline_owner_id, data FROM steps
     WHERE account_id = $1 AND stack = $2 ORDER BY ord DESC LIMIT 1`,
    [accountId, stack],
  );
  const row = found.rows[0];
  return row === undefined ? null : toStep(row);
}

export const dropStep = (id: number) => pool.query("DELETE FROM steps WHERE id = $1", [id]);

export async function dropStepsOf(client: { query: typeof pool.query }, bulletIds: readonly string[]): Promise<void> {
  if (bulletIds.length === 0) return;
  await client.query("DELETE FROM steps WHERE bullet_id = ANY($1::text[])", [bulletIds]);
}

async function editorSince(work: Work, bulletId: string, revision: number): Promise<string | null> {
  const found = await work.client.query<{ name: string }>(
    `SELECT a.name FROM revisions r JOIN accounts a ON a.id = r.account_id
     WHERE r.bullet_id = $1 AND r.revision > $2 AND r.account_id <> $3 ORDER BY r.revision DESC LIMIT 1`,
    [bulletId, revision, work.actor.accountId],
  );
  return found.rows[0]?.name ?? null;
}

function parentGone(work: Work, place: Place): boolean {
  return place.parentId !== null && !work.scope.canSee(place.parentId);
}

async function setOriginal(work: Work, bulletId: string, change: { text?: string; completed?: boolean }, expected: number): Promise<number> {
  const placement = work.state.placement(bulletId);
  const original = placement === undefined ? undefined : work.state.originalOf(placement);
  if (original === undefined) throw notFound();
  const name = await editorSince(work, original.id, expected);
  if (name !== null) throw conflict("edited_since", editedSince(name));
  work.state.edit(original.id, work.actor.accountId, change);
  return original.revision;
}

function restoreOrTrash(work: Work, data: Extract<StepData, { ids: string[] }>, bulletId: string, restoring: boolean): StepData {
  const { state } = work;
  if (restoring) {
    if (parentGone(work, data.place)) throw conflict("origin_gone", ALERTS.originGone);
    state.restore(data.ids, data.place.parentId, data.place.index);
    return { ...data, removed: false };
  }
  const row = state.placement(bulletId);
  if (row === undefined) throw notFound();
  const place = { parentId: row.parentId, index: row.position };
  const purgeAt = new Date(work.now.getTime() + config.trashSeconds * 1000);
  return { ...data, ids: state.trash(bulletId, work.now, purgeAt), place, removed: true };
}

/** Applies a step in the given direction and returns the step's data as it should wait on the other stack. */
export async function applyStep(work: Work, step: StepRow, direction: "undo" | "redo"): Promise<StepData> {
  const { state } = work;
  const data = step.data;
  switch (data.kind) {
    case "text edit":
    case "completion": {
      const target = direction === "undo" ? "before" : "after";
      const revision = await setOriginal(
        work,
        step.bulletId,
        data.kind === "text edit" ? { text: data[target] as string } : { completed: data[target] as boolean },
        data.revision,
      );
      return { ...data, revision };
    }
    case "move":
    case "indent":
    case "outdent": {
      const place = direction === "undo" ? data.from : data.to;
      const row = state.placement(step.bulletId);
      if (row === undefined || parentGone(work, place)) throw conflict("origin_gone", ALERTS.originGone);
      const decision = decideMove(moveRules(work), step.bulletId, place);
      if (!decision.ok) throw refusalError(decision.code);
      state.place(step.bulletId, place.parentId, place.index);
      return data;
    }
    case "delete":
      return restoreOrTrash(work, data, step.bulletId, direction === "undo");
    case "new bullet":
    case "mirror":
      return restoreOrTrash(work, data, step.bulletId, direction === "redo");
  }
}

