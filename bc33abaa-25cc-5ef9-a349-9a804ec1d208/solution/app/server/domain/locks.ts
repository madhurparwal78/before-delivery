// Object locks and presence, held in PocketBase. The unique (scene, node) index on object_locks decides
// the single winner of simultaneous claims.
import type { Author, Lock, Presence } from "../../shared/api-types.js";
import { isoSecond } from "../../shared/format.js";
import { create, list, pbDate, quote, remove, update, type PbRecord } from "../services/pocketbase.js";
import { locked } from "../errors.js";

const LAPSE_MS = 30_000;

interface LockRecord { id: string; nodeId: string; holder: Author; expiresAt: Date }

const sameAuthor = (a: Author, b: Author) => a.kind === b.kind && a.id === b.id;

function authorFrom(record: PbRecord, prefix: "holder" | "author"): Author {
  const kind = record[`${prefix}Kind`];
  return { kind: kind === "agent" ? "agent" : "member", id: String(record[`${prefix}Id`] ?? ""), name: String(record[`${prefix}Name`] ?? "") };
}

const toLock = (r: PbRecord): LockRecord => ({ id: r.id, nodeId: String(r.node), holder: authorFrom(r, "holder"), expiresAt: pbDate(r.expiresAt) });
const lapsed = (lock: LockRecord, now = new Date()) => lock.expiresAt <= now;
const expiry = () => new Date(Date.now() + LAPSE_MS).toISOString();
const holderFields = (author: Author) => ({ holderKind: author.kind, holderId: author.id, holderName: author.name, expiresAt: expiry() });

function lockOut(lock: LockRecord): Lock {
  return { nodeId: lock.nodeId, holder: lock.holder, expiresAt: isoSecond(lock.expiresAt) };
}

export async function listLocks(scene: string): Promise<Lock[]> {
  const now = new Date();
  return (await list("object_locks", `scene=${quote(scene)}`)).map(toLock).filter((l) => !lapsed(l, now)).map(lockOut);
}

async function lockRecord(scene: string, node: string): Promise<LockRecord | null> {
  const [record] = await list("object_locks", `scene=${quote(scene)} && node=${quote(node)}`);
  return record ? toLock(record) : null;
}

/** Takes a free lock, keeps one the author already holds, or reports the other holder. */
async function claim(workspace: string, scene: string, node: string, author: Author): Promise<{ created: boolean } | { holder: Author }> {
  for (;;) {
    const created = await create("object_locks", { workspace, scene, node, ...holderFields(author) });
    if (created) return { created: true };
    const existing = await lockRecord(scene, node);
    if (!existing) continue;
    if (sameAuthor(existing.holder, author)) {
      await update("object_locks", existing.id, { expiresAt: expiry() });
      return { created: false };
    }
    if (!lapsed(existing)) return { holder: existing.holder };
    await remove("object_locks", existing.id);
  }
}

/** Claims every lock a batch needs in batch order; on the first held node, gives back what it took and refuses. */
export async function claimAll(workspace: string, scene: string, nodes: string[], author: Author): Promise<string[]> {
  const taken: string[] = [];
  for (const node of nodes) {
    const result = await claim(workspace, scene, node, author);
    if ("holder" in result) {
      await releaseAll(scene, taken, author);
      throw locked(node, result.holder);
    }
    if (result.created) taken.push(node);
  }
  return taken;
}

export async function claimOne(workspace: string, scene: string, node: string, author: Author): Promise<Lock> {
  await claimAll(workspace, scene, [node], author);
  return { nodeId: node, holder: author, expiresAt: isoSecond(new Date(Date.now() + LAPSE_MS)) };
}

export async function releaseAll(scene: string, nodes: string[], author: Author): Promise<void> {
  for (const node of nodes) await release(scene, node, author);
}

/** Releases the caller's own lock; false when the caller is not its holder. */
export async function release(scene: string, node: string, author: Author): Promise<boolean> {
  const existing = await lockRecord(scene, node);
  if (!existing || lapsed(existing) || !sameAuthor(existing.holder, author)) return false;
  await remove("object_locks", existing.id);
  return true;
}

/** Moves the lock to the caller at once, whoever held it. */
export async function takeover(workspace: string, scene: string, node: string, author: Author): Promise<{ lock: Lock; previousHolder: Author | null }> {
  for (;;) {
    const existing = await lockRecord(scene, node);
    if (existing) {
      const previousHolder = !lapsed(existing) && !sameAuthor(existing.holder, author) ? existing.holder : null;
      const moved = await update("object_locks", existing.id, holderFields(author));
      if (moved) return { lock: lockOut(toLock(moved)), previousHolder };
      continue;
    }
    const created = await create("object_locks", { workspace, scene, node, ...holderFields(author) });
    if (created) return { lock: lockOut(toLock(created)), previousHolder: null };
  }
}

/** A lock lapses 30 seconds after its holder's last operation, lock request or heartbeat. */
export async function refreshLocks(scene: string, author: Author): Promise<void> {
  const mine = await list("object_locks", `scene=${quote(scene)} && holderKind=${quote(author.kind)} && holderId=${quote(author.id)}`);
  await Promise.all(mine.map((r) => update("object_locks", r.id, { expiresAt: expiry() })));
}

/** Clears every lock and presence record of an author (offboarding, token revocation); returns the scenes touched. */
export async function clearAuthor(author: Author): Promise<string[]> {
  const scenes = new Set<string>();
  const filterLocks = `holderKind=${quote(author.kind)} && holderId=${quote(author.id)}`;
  const filterPresence = `authorKind=${quote(author.kind)} && authorId=${quote(author.id)}`;
  for (const r of await list("object_locks", filterLocks)) { scenes.add(String(r.scene)); await remove("object_locks", r.id); }
  for (const r of await list("presence", filterPresence)) { scenes.add(String(r.scene)); await remove("presence", r.id); }
  return [...scenes];
}

export async function heartbeat(workspace: string, scene: string, author: Author, selection: string | null, cursor: [number, number]): Promise<void> {
  const fields = { authorName: author.name, selection: selection ?? "", cursor, seenAt: new Date().toISOString() };
  const filter = `scene=${quote(scene)} && authorKind=${quote(author.kind)} && authorId=${quote(author.id)}`;
  for (;;) {
    const [existing] = await list("presence", filter);
    if (existing) { if (await update("presence", existing.id, fields)) return; continue; }
    if (await create("presence", { workspace, scene, authorKind: author.kind, authorId: author.id, ...fields })) return;
  }
}

export async function listPresence(scene: string): Promise<Presence[]> {
  const cutoff = Date.now() - LAPSE_MS;
  return (await list("presence", `scene=${quote(scene)}`))
    .filter((r) => pbDate(r.seenAt).getTime() > cutoff)
    .map((r) => ({ author: authorFrom(r, "author"), selection: r.selection ? String(r.selection) : null }));
}
