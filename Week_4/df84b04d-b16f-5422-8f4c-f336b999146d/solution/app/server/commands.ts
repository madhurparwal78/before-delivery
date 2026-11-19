import { textTooLong, staleSave } from "../shared/copy.js";
import { containerOf, decideCreate, decideMirror, decideMove, type MoveRequest } from "../shared/moves.js";
import { characterCount, recognizeDate } from "../shared/text.js";
import type { Bullet } from "../shared/types.js";
import { moveRules, newId, type Work } from "./commit.js";
import { config } from "./config.js";
import { conflict, invalid, notFound, type JsonObject } from "./http.js";
import { mergeTextEdit, recordStep } from "./history.js";
import type { Row } from "./outline.js";
import { refusalError } from "./refusals.js";
import { bulletFor } from "./view.js";

const isIndex = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
const isId = (value: unknown): value is string | null => value === null || typeof value === "string";

function visible(work: Work, id: string): Row {
  const row = work.state.placement(id);
  if (row === undefined || !work.scope.canSee(id)) throw notFound();
  return row;
}

function textProblem(text: unknown): string | null {
  if (typeof text !== "string") return "Send text as a string.";
  return characterCount(text) > config.bulletMaxChars ? textTooLong(config.bulletMaxChars) : null;
}

function validText(text: unknown): string {
  const problem = textProblem(text);
  if (problem !== null) throw invalid({ text: problem });
  return text as string;
}

export async function createBullet(work: Work, body: JsonObject): Promise<Bullet> {
  const { parentId, afterId } = body;
  if (!isId(parentId ?? null) || !isId(afterId ?? null)) throw invalid({ parentId: "Send an id or null." });
  const parent = typeof parentId === "string" ? visible(work, parentId) : null;
  const after = typeof afterId === "string" ? visible(work, afterId) : null;
  const container = parent === null ? null : containerOf(work.state, parent.id);
  if (after !== null && after.parentId !== container) throw invalid({ afterId: "That bullet is not inside this parent." });
  const text = body.text === undefined ? "" : validText(body.text);
  const decision = decideCreate(moveRules(work), parent?.id ?? null);
  if (!decision.ok) throw refusalError(decision.code);
  const index = after === null ? 0 : work.state.childrenOf(container).indexOf(after.id) + 1;
  const row: Row = {
    id: newId(), ownerId: work.state.ownerId, parentId: container, mirrorOf: null, position: index,
    text: recognizeDate(text, work.state.today).text, completed: false, collapsed: false, revision: 1,
    trashedAt: null, purgeAt: null,
  };
  work.state.insert(row, index);
  await recordStep(work, "new bullet", row.id, { kind: "new bullet", ids: [row.id], place: { parentId: container, index }, removed: false });
  return bulletFor(work.state, work.scope, row.id);
}

async function staleRefusal(work: Work, original: Row) {
  const editor = await work.client.query<{ name: string }>(
    `SELECT a.name FROM revisions r JOIN accounts a ON a.id = r.account_id WHERE r.bullet_id = $1 AND r.revision = $2`,
    [original.id, original.revision],
  );
  const owner = await work.client.query<{ name: string }>("SELECT name FROM accounts WHERE id = $1", [work.state.ownerId]);
  const name = editor.rows[0]?.name ?? owner.rows[0]?.name ?? "";
  return conflict("stale_revision", staleSave(name), {
    current: { text: original.text, revision: original.revision },
    editor: { name },
  });
}

async function saveText(work: Work, original: Row, text: string, revision: number): Promise<void> {
  const normalized = recognizeDate(text, work.state.today).text;
  if (revision < original.revision) throw await staleRefusal(work, original);
  if (normalized === original.text) return;
  const before = original.text;
  const revisionBefore = original.revision;
  work.state.edit(original.id, work.actor.accountId, { text: normalized });
  const merged = await mergeTextEdit(work, original.id, revisionBefore, normalized, original.revision);
  if (!merged) {
    await recordStep(work, "text edit", original.id, { kind: "text edit", before, after: normalized, revision: original.revision });
  }
}

export async function patchBullet(work: Work, id: string, body: JsonObject): Promise<Bullet> {
  const row = visible(work, id);
  const { text, revision, completed, collapsed } = body;
  const errors: Record<string, string> = {};
  if (text !== undefined) {
    const problem = textProblem(text);
    if (problem !== null) errors.text = problem;
    if (!Number.isInteger(revision)) errors.revision = "Send the revision you last saw.";
  }
  if (completed !== undefined && typeof completed !== "boolean") errors.completed = "Send true or false.";
  if (collapsed !== undefined && typeof collapsed !== "boolean") errors.collapsed = "Send true or false.";
  if (Object.keys(errors).length > 0) throw invalid(errors);
  const original = work.state.originalOf(row);
  if ((text !== undefined || completed !== undefined) && original === undefined) throw notFound();
  if (original !== undefined) {
    if (typeof text === "string") await saveText(work, original, text, revision as number);
    if (typeof completed === "boolean" && completed !== original.completed) {
      const before = original.completed;
      work.state.edit(original.id, work.actor.accountId, { completed });
      await recordStep(work, "completion", original.id, { kind: "completion", before, after: completed, revision: original.revision });
    }
  }
  if (typeof collapsed === "boolean") work.state.setCollapsed(row.id, collapsed);
  return bulletFor(work.state, work.scope, row.id);
}

export async function deleteBullet(work: Work, id: string): Promise<{ result: "trashed" | "copy_removed"; count: number }> {
  const row = visible(work, id);
  if (work.scope.shareRoots.has(id)) throw refusalError("share_root");
  const place = { parentId: row.parentId, index: row.position };
  const purgeAt = new Date(work.now.getTime() + config.trashSeconds * 1000);
  const ids = work.state.trash(id, work.now, purgeAt);
  await recordStep(work, "delete", id, { kind: "delete", ids, place, removed: true });
  return { result: row.mirrorOf === null ? "trashed" : "copy_removed", count: ids.length };
}

function moveRequest(body: JsonObject): MoveRequest {
  const { op, parentId, index } = body;
  if (op === "indent" || op === "outdent" || op === "up" || op === "down") return { op };
  if (op !== undefined) throw invalid({ op: "Choose indent, outdent, up or down." });
  if (parentId === undefined) throw invalid({ parentId: "Send an op or a destination." });
  if (!isId(parentId)) throw invalid({ parentId: "Send an id or null." });
  if (!isIndex(index)) throw invalid({ index: "Choose a place inside the list." });
  return { parentId, index };
}

export async function moveBullet(work: Work, id: string, body: JsonObject): Promise<Bullet> {
  const row = visible(work, id);
  const request = moveRequest(body);
  if ("parentId" in request && !work.scope.canPlaceAt(request.parentId)) throw notFound();
  const decision = decideMove(moveRules(work), id, request);
  if (!decision.ok) throw refusalError(decision.code);
  const from = { parentId: row.parentId, index: row.position };
  const to = { parentId: decision.parentId, index: decision.index };
  if (from.parentId === to.parentId && from.index === to.index) return bulletFor(work.state, work.scope, id);
  work.state.place(id, to.parentId, to.index);
  if (decision.expand !== null) work.state.expand(decision.expand);
  const kind = "op" in request && (request.op === "indent" || request.op === "outdent") ? request.op : "move";
  await recordStep(work, kind, id, { kind, from, to });
  return bulletFor(work.state, work.scope, id);
}

export async function mirrorBullet(work: Work, id: string, body: JsonObject): Promise<Bullet> {
  const source = visible(work, id);
  const original = work.state.originalOf(source);
  if (original === undefined) throw notFound();
  const { parentId, index } = body;
  if (parentId !== undefined && !isId(parentId)) throw invalid({ parentId: "Send an id or null." });
  if (index !== undefined && !isIndex(index)) throw invalid({ index: "Choose a place inside the list." });
  const destination = parentId === undefined ? source.parentId : parentId;
  if (parentId !== undefined && !work.scope.canPlaceAt(parentId)) throw notFound();
  const container = destination === null ? null : containerOf(work.state, destination);
  const count = work.state.childrenOf(container).length;
  const at = index === undefined ? (parentId === undefined ? source.position + 1 : count) : index;
  if (at > count) throw invalid({ index: "Choose a place inside the list." });
  if (work.scope.shareRoots.has(id)) throw refusalError("share_root");
  const decision = decideMirror(moveRules(work), id, destination);
  if (!decision.ok) throw refusalError(decision.code);
  const row: Row = {
    id: newId(), ownerId: work.state.ownerId, parentId: container, mirrorOf: original.id, position: at,
    text: "", completed: false, collapsed: false, revision: 1, trashedAt: null, purgeAt: null,
  };
  work.state.insert(row, at);
  await recordStep(work, "mirror", row.id, { kind: "mirror", ids: [row.id], place: { parentId: container, index: at }, removed: false });
  return bulletFor(work.state, work.scope, row.id);
}
