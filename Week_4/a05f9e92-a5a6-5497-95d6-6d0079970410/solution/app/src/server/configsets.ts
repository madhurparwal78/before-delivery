import { now } from "./clock.js";
import { lockKey, nextSequence, pad, type Tx } from "./db.js";
import type { Env } from "./env.js";
import { fail, notFound, storageUnavailable, validation } from "./errors.js";
import { getObject, isAvailable, putObject, StorageDown } from "./storage.js";
import { configDelete, configGet, configPut, type Workspace } from "./store.js";
import type { Step, WorkflowContent } from "./workflows.js";

interface SetItem {
  kind: string;
  name: string;
  deleted: boolean;
  content: unknown;
}

type Action = "create" | "update" | "unchanged" | "collision" | "delete";

interface Snapshot {
  kind: string;
  name: string;
  existed: boolean;
  content: unknown;
  promoted: unknown;
  publishedVersion: number | null;
}

export interface SetJson {
  id: number;
  number: string;
  name: string;
  state: "open" | "exported" | "committed" | "backed_out";
  items: { kind: string; name: string; deleted: boolean }[];
  key?: string;
}

function canonical(value: unknown): string {
  return JSON.stringify(value ?? null, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));
}

function jsonOf(row: Record<string, unknown>): SetJson {
  const set: SetJson = {
    id: row.id as number,
    number: row.number as string,
    name: row.name as string,
    state: row.state as SetJson["state"],
    items: (row.items as SetItem[]).map(({ kind, name, deleted }) => ({ kind, name, deleted })),
  };
  if (row.key) set.key = row.key as string;
  return set;
}

export async function listSets(env: Env): Promise<SetJson[]> {
  return (await env.tx.query("SELECT * FROM config_sets ORDER BY id")).map(jsonOf);
}

async function loadSet(tx: Tx, id: number, lock = false): Promise<Record<string, unknown>> {
  const rows = await tx.query(`SELECT * FROM config_sets WHERE id = $1 ${lock ? "FOR UPDATE" : ""}`, [id]);
  return rows[0] ?? notFound();
}

export async function createSet(env: Env, name: unknown): Promise<SetJson> {
  if (typeof name !== "string" || name.trim() === "") return validation("A set needs a name.", { name: "Name is required." });
  await lockKey(env.tx, `config-set:${env.who.actor}`);
  const open = await env.tx.query("SELECT 1 FROM config_sets WHERE owner = $1 AND state = 'open'", [env.who.actor]);
  if (open.length > 0) fail(409, "set_already_open", "You already have an open configuration set.");
  const number = `SET-${pad(await nextSequence(env.tx, "config_set"))}`;
  const rows = await env.tx.query("INSERT INTO config_sets (number, name, state, owner) VALUES ($1, $2, 'open', $3) RETURNING *", [number, name, env.who.actor]);
  return jsonOf(rows[0]!);
}

/** The item as live holds it; workflows carry their latest published steps. */
async function liveContent(tx: Tx, kind: string, name: string, workspace: Workspace = "live"): Promise<{ content: unknown; promoted: unknown; row: number } | null> {
  const found = await configGet<unknown>(kind, name, workspace, tx);
  if (!found) return null;
  if (kind !== "workflow") return { content: found.content, promoted: found.promoted, row: found.id };
  return { content: await withPublished(tx, found.id, found.content as WorkflowContent), promoted: found.promoted, row: found.id };
}

async function withPublished(tx: Tx, id: number, content: WorkflowContent): Promise<unknown> {
  const rows = await tx.query("SELECT version, steps FROM workflow_versions WHERE workflow_id = $1 AND NOT withdrawn ORDER BY version DESC LIMIT 1", [id]);
  const latest = rows[0];
  return { ...content, published: latest ? { version: latest.version as number, steps: latest.steps as Step[] } : null };
}

/** Records the latest content of a captured item in the operator's open set while they work in the test workspace. */
export async function captureChange(env: Env, kind: string, name: string): Promise<void> {
  const open = (await env.tx.query("SELECT * FROM config_sets WHERE owner = $1 AND state = 'open' FOR UPDATE", [env.who.actor]))[0];
  if (!open) return;
  const live = await liveContent(env.tx, kind, name, "test");
  const items = (open.items as SetItem[]).filter((i) => !(i.kind === kind && i.name === name));
  const previous = (open.items as SetItem[]).findIndex((i) => i.kind === kind && i.name === name);
  const entry: SetItem = { kind, name, deleted: live === null, content: live?.content ?? null };
  if (previous === -1) items.push(entry);
  else items.splice(previous, 0, entry);
  await env.tx.query("UPDATE config_sets SET items = $2 WHERE id = $1", [open.id, JSON.stringify(items)]);
}

export async function exportSet(env: Env, id: number): Promise<SetJson> {
  const row = await loadSet(env.tx, id, true);
  if (!isAvailable()) return storageUnavailable();
  if (row.state !== "open" && row.state !== "exported") fail(409, "not_open", "Only an open set can be exported.");
  const key = `config-sets/${row.number as string}.json`;
  const document = { format: "switchyard-config-set", version: 1, number: row.number, name: row.name, exported_at: new Date(now()).toISOString(), items: row.items };
  try {
    await putObject(key, JSON.stringify(document), "application/json");
  } catch (error) {
    if (error instanceof StorageDown) return storageUnavailable();
    throw error;
  }
  const updated = await env.tx.query("UPDATE config_sets SET state = 'exported', key = $2 WHERE id = $1 RETURNING *", [id, key]);
  return jsonOf(updated[0]!);
}

export async function uploadSet(env: Env, data: Buffer): Promise<SetJson> {
  if (!isAvailable()) return storageUnavailable();
  let document: { format?: string; version?: number; name?: string; items?: SetItem[] };
  try {
    document = JSON.parse(data.toString("utf8"));
  } catch {
    return validation("The file is not valid JSON.");
  }
  if (document.format !== "switchyard-config-set" || document.version !== 1 || !Array.isArray(document.items)) return validation('The file is not a "switchyard-config-set" version 1 document.');
  const number = `SET-${pad(await nextSequence(env.tx, "config_set"))}`;
  const key = `config-sets/${number}.json`;
  try {
    await putObject(key, JSON.stringify({ ...document, number }), "application/json");
  } catch (error) {
    if (error instanceof StorageDown) return storageUnavailable();
    throw error;
  }
  const rows = await env.tx.query("INSERT INTO config_sets (number, name, state, owner, items, key) VALUES ($1, $2, 'exported', $3, $4, $5) RETURNING *", [number, document.name ?? number, env.who.actor, JSON.stringify(document.items), key]);
  return jsonOf(rows[0]!);
}

async function classify(tx: Tx, item: SetItem): Promise<Action> {
  const live = await liveContent(tx, item.kind, item.name);
  if (item.deleted) return live ? "delete" : "unchanged";
  if (!live) return "create";
  if (canonical(live.content) === canonical(item.content)) return "unchanged";
  return live.promoted !== null && canonical(live.promoted) === canonical(live.content) ? "update" : "collision";
}

export async function previewSet(env: Env, id: number): Promise<{ items: { kind: string; name: string; action: Action }[] }> {
  const row = await loadSet(env.tx, id);
  if (row.state === "open") fail(409, "not_exported", "Export the set before previewing it.");
  if (!isAvailable()) return storageUnavailable();
  let document: { items: SetItem[] };
  try {
    document = JSON.parse((await getObject(row.key as string)).toString("utf8"));
  } catch (error) {
    if (error instanceof StorageDown) return storageUnavailable();
    throw error;
  }
  return { items: await Promise.all(document.items.map(async (i) => ({ kind: i.kind, name: i.name, action: await classify(env.tx, i) }))) };
}

async function apply(tx: Tx, item: SetItem, snapshot: Snapshot): Promise<void> {
  if (item.deleted) {
    await configDelete(tx, "live", item.kind, item.name);
    return;
  }
  if (item.kind !== "workflow") {
    await configPut(tx, "live", item.kind, item.name, item.content, item.content);
    return;
  }
  const { published, ...content } = item.content as WorkflowContent & { published: { version: number; steps: Step[] } | null };
  const id = await configPut(tx, "live", "workflow", item.name, content, item.content);
  await tx.query("UPDATE config_items SET promoted = $2 WHERE id = $1", [id, JSON.stringify(item.content)]);
  if (!published) return;
  const latest = (await tx.query("SELECT steps FROM workflow_versions WHERE workflow_id = $1 AND NOT withdrawn ORDER BY version DESC LIMIT 1", [id]))[0];
  if (latest && canonical(latest.steps) === canonical(published.steps)) return;
  const next = (await tx.query("SELECT coalesce(max(version), 0) + 1 AS next FROM workflow_versions WHERE workflow_id = $1", [id]))[0]!.next as number;
  await tx.query("INSERT INTO workflow_versions (workflow_id, version, steps) VALUES ($1, $2, $3)", [id, next, JSON.stringify(published.steps)]);
  snapshot.publishedVersion = next;
}

export async function commitSet(env: Env, id: number, choices: Record<string, string>): Promise<{ set: SetJson; applied: number }> {
  const row = await loadSet(env.tx, id, true);
  if (row.state !== "exported") fail(409, "not_exported", "Export the set before committing it.");
  const items = (row.items as SetItem[]).slice().sort((a, b) => (a.kind === "workflow" ? 0 : 1) - (b.kind === "workflow" ? 0 : 1));
  const plan: Array<{ item: SetItem; action: Action }> = [];
  for (const item of row.items as SetItem[]) {
    const action = await classify(env.tx, item);
    if (action === "collision" && choices[`${item.kind}:${item.name}`] !== "take_set" && choices[`${item.kind}:${item.name}`] !== "keep_live") fail(422, "choice_required", `Choose Take set or Keep live for ${item.name}.`);
    plan.push({ item, action });
  }
  const snapshots: Snapshot[] = [];
  let applied = 0;
  for (const item of items) {
    const entry = plan.find((p) => p.item === undefined ? false : p.item.kind === item.kind && p.item.name === item.name)!;
    const take = entry.action === "create" || entry.action === "update" || entry.action === "delete" || (entry.action === "collision" && choices[`${item.kind}:${item.name}`] === "take_set");
    if (!take) {
      if (entry.action === "unchanged" && !item.deleted) await markPromoted(env.tx, item);
      continue;
    }
    const live = await liveContent(env.tx, item.kind, item.name);
    const snapshot: Snapshot = { kind: item.kind, name: item.name, existed: live !== null, content: live?.content ?? null, promoted: live?.promoted ?? null, publishedVersion: null };
    await apply(env.tx, item, snapshot);
    snapshots.push(snapshot);
    applied++;
  }
  const seq = await nextSequence(env.tx, "config_commit");
  const updated = await env.tx.query("UPDATE config_sets SET state = 'committed', snapshots = $2, committed_seq = $3 WHERE id = $1 RETURNING *", [id, JSON.stringify(snapshots), seq]);
  return { set: jsonOf(updated[0]!), applied };
}

async function markPromoted(tx: Tx, item: SetItem): Promise<void> {
  const live = await liveContent(tx, item.kind, item.name);
  if (live) await tx.query("UPDATE config_items SET promoted = $2 WHERE id = $1", [live.row, JSON.stringify(live.content)]);
}

export async function backoutSet(env: Env, id: number): Promise<SetJson> {
  const row = await loadSet(env.tx, id, true);
  if (row.state !== "committed") fail(409, "not_committed", "Only a committed set can be backed out.");
  const touched = new Set((row.snapshots as Snapshot[]).map((s) => `${s.kind}:${s.name}`));
  const later = await env.tx.query("SELECT items FROM config_sets WHERE state = 'committed' AND committed_seq > $1 ORDER BY committed_seq", [row.committed_seq]);
  for (const snapshot of row.snapshots as Snapshot[]) {
    if (later.some((l) => (l.items as SetItem[]).some((i) => `${i.kind}:${i.name}` === `${snapshot.kind}:${snapshot.name}`) && touched.has(`${snapshot.kind}:${snapshot.name}`))) {
      fail(409, "later_set", `A later set changed ${snapshot.name}; back that out first.`);
    }
  }
  for (const snapshot of [...(row.snapshots as Snapshot[])].reverse()) {
    if (!snapshot.existed) {
      const found = await configGet<unknown>(snapshot.kind, snapshot.name, "live", env.tx);
      if (found && snapshot.kind === "workflow") await env.tx.query("UPDATE workflow_versions SET withdrawn = true WHERE workflow_id = $1", [found.id]);
      await configDelete(env.tx, "live", snapshot.kind, snapshot.name);
      continue;
    }
    const restored = snapshot.kind === "workflow" ? (({ published, ...rest }) => (void published, rest))(snapshot.content as WorkflowContent & { published: unknown }) : snapshot.content;
    const id2 = await configPut(env.tx, "live", snapshot.kind, snapshot.name, restored);
    await env.tx.query("UPDATE config_items SET promoted = $2 WHERE id = $1", [id2, snapshot.promoted === null ? null : JSON.stringify(snapshot.promoted)]);
    if (snapshot.publishedVersion !== null) await env.tx.query("UPDATE workflow_versions SET withdrawn = true WHERE workflow_id = $1 AND version = $2", [id2, snapshot.publishedVersion]);
  }
  const updated = await env.tx.query("UPDATE config_sets SET state = 'backed_out' WHERE id = $1 RETURNING *", [id]);
  return jsonOf(updated[0]!);
}
