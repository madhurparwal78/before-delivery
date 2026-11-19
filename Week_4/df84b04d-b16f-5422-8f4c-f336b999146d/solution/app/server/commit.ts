import { randomUUID } from "node:crypto";
import { depthOf, type MoveRules } from "../shared/moves.js";
import type { Bullet } from "../shared/types.js";
import { config } from "./config.js";
import { pool, tx, type Db } from "./db.js";
import { notFound, type Session } from "./http.js";
import { flushState, loadState, OutlineState } from "./outline.js";
import { collaboratorScope, ownerScope, shownFrom, type Scope } from "./scope.js";
import { todayIn } from "../shared/text.js";
import { publishPending } from "./live.js";

const today = (): string => config.outlineToday ?? todayIn(config.outlineTimeZone, new Date());

interface ShareDelta {
  bullets: string[];
  removed: string[];
  depth: number;
}

export interface ChangeRecord {
  type: "change";
  seq: number;
  bullets: Bullet[];
  removed: string[];
  shares: Record<string, ShareDelta>;
}

export interface Work {
  state: OutlineState;
  scope: Scope;
  actor: Session;
  client: Db;
  now: Date;
  /** Ids whose removal is announced even though no row changed in this commit (purged rows). */
  removed: Set<string>;
}

export async function ownerOfBullet(id: string): Promise<string> {
  const found = await pool.query<{ owner_id: string }>("SELECT owner_id FROM bullets WHERE id = $1", [id]);
  const owner = found.rows[0]?.owner_id;
  if (owner === undefined) throw notFound();
  return owner;
}

export async function ownerFor(actor: Session, ids: readonly (string | null | undefined)[]): Promise<string> {
  const first = ids.find((id): id is string => typeof id === "string");
  return first === undefined ? actor.accountId : ownerOfBullet(first);
}

async function rootsFor(client: Db | typeof pool, actor: Session, ownerId: string): Promise<string[]> {
  const found = await client.query<{ bullet_id: string }>(
    "SELECT bullet_id FROM shares WHERE owner_id = $1 AND account_id = $2 AND status = 'accepted'",
    [ownerId, actor.accountId],
  );
  return found.rows.map((row) => row.bullet_id);
}

export async function readOutline(actor: Session, ownerId: string): Promise<{ state: OutlineState; scope: Scope; seq: number }> {
  const state = await loadState(pool, ownerId, today());
  const seq = await pool.query<{ seq: number }>("SELECT seq FROM outline_seqs WHERE owner_id = $1", [ownerId]);
  if (ownerId === actor.accountId) return { state, scope: ownerScope(state), seq: seq.rows[0]?.seq ?? 0 };
  const roots = await rootsFor(pool, actor, ownerId);
  if (roots.length === 0) throw notFound();
  return { state, scope: collaboratorScope(state, roots), seq: seq.rows[0]?.seq ?? 0 };
}

function reported(state: OutlineState): { changed: Set<string>; removed: Set<string> } {
  const changed = new Set<string>();
  const removed = new Set<string>();
  const copies = new Map<string, string[]>();
  for (const row of state.rows.values()) {
    if (row.mirrorOf !== null) copies.set(row.mirrorOf, [...(copies.get(row.mirrorOf) ?? []), row.id]);
  }
  const include = (id: string): void => {
    const row = state.rows.get(id);
    if (row === undefined) return;
    if (row.trashedAt === null) changed.add(id);
    else removed.add(id);
  };
  const includeWithCopies = (id: string): void => {
    include(id);
    for (const copy of copies.get(id) ?? []) include(copy);
  };
  for (const id of state.touched) includeWithCopies(id);
  for (const container of state.reshaped) {
    if (container !== null) includeWithCopies(container);
  }
  return { changed, removed };
}

function buildRecord(
  state: OutlineState,
  seq: number,
  before: Map<string, Set<string>>,
  forced: ReadonlySet<string>,
): ChangeRecord {
  const { changed, removed } = reported(state);
  for (const id of forced) removed.add(id);
  const shares: Record<string, ShareDelta> = {};
  const wanted = new Set(changed);
  for (const [root, was] of before) {
    const now = new Set(shownFrom(state, [root]).keys());
    const entered = new Set([...now].filter((id) => !was.has(id)));
    for (const id of entered) wanted.add(id);
    shares[root] = {
      bullets: [...now].filter((id) => changed.has(id) || entered.has(id)),
      removed: [...was].filter((id) => !now.has(id) || removed.has(id)),
      depth: depthOf(state, root),
    };
  }
  const bullets = [...wanted].flatMap((id) => {
    const row = state.placement(id);
    return row === undefined ? [] : [state.canonicalBullet(row)];
  });
  return { type: "change", seq, bullets, removed: [...removed], shares };
}

/** Runs `work` on the owner's outline as one serialised commit: sequence number, change record, undo steps. */
export async function commit<T>(
  actor: Session,
  ownerId: string,
  work: (context: Work) => Promise<T> | T,
): Promise<{ result: T; seq: number }> {
  const done = await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`outline:${ownerId}`]);
    const state = await loadState(client, ownerId, today());
    let scope: Scope;
    if (ownerId === actor.accountId) scope = ownerScope(state);
    else {
      const roots = await rootsFor(client, actor, ownerId);
      if (roots.length === 0) throw notFound();
      scope = collaboratorScope(state, roots);
    }
    const shareRows = await client.query<{ bullet_id: string }>(
      "SELECT DISTINCT bullet_id FROM shares WHERE owner_id = $1 AND status = 'accepted'",
      [ownerId],
    );
    const before = new Map(shareRows.rows.map((row) => [row.bullet_id, new Set(shownFrom(state, [row.bullet_id]).keys())]));
    const clock = await client.query<{ now: Date }>("SELECT now() AS now");
    const context: Work = { state, scope, actor, client, now: clock.rows[0]?.now ?? new Date(), removed: new Set() };
    const result = await work(context);
    const dirty = state.touched.size > 0 || state.inserted.size > 0 || context.removed.size > 0;
    if (!dirty) {
      const current = await client.query<{ seq: number }>("SELECT seq FROM outline_seqs WHERE owner_id = $1", [ownerId]);
      return { result, seq: current.rows[0]?.seq ?? 0, published: false };
    }
    await flushState(client, state);
    const next = await client.query<{ seq: number }>(
      "UPDATE outline_seqs SET seq = seq + 1 WHERE owner_id = $1 RETURNING seq",
      [ownerId],
    );
    const seq = next.rows[0]?.seq ?? 0;
    const record = buildRecord(state, seq, before, context.removed);
    await client.query("INSERT INTO changes (owner_id, seq, payload) VALUES ($1, $2, $3)", [ownerId, seq, JSON.stringify(record)]);
    await client.query("DELETE FROM changes WHERE owner_id = $1 AND seq <= $2", [ownerId, seq - config.streamMaxLength]);
    return { result, seq, published: true };
  });
  if (done.published) await publishPending(ownerId);
  return { result: done.result, seq: done.seq };
}

export const newId = (): string => randomUUID();

export function moveRules(work: Work): MoveRules {
  return { tree: work.state, maxDepth: config.maxDepth, shareRoots: work.scope.shareRoots, viewTops: work.scope.shareRoots };
}
