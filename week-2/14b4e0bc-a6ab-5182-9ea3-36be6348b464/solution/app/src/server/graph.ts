import type { Tx } from "./db.ts";
import { adjacency, changedColumns, recompute, type Derived, type Edge, type TagFacts } from "./tags.ts";
import type { Tag } from "./text.ts";

/** SQL condition for a temporal row in force at seq k, or live when k is null. */
export function inForce(k: number | null, alias = ""): string {
  const p = alias ? `${alias}.` : "";
  return k === null ? `${p}to_seq is null` : `${p}from_seq <= ${k} and (${p}to_seq is null or ${p}to_seq > ${k})`;
}

export interface GraphFacts extends TagFacts {
  columns: string[];
}

function tagMap(rows: { column_id: string; tag: Tag }[]): Map<string, Set<Tag>> {
  const map = new Map<string, Set<Tag>>();
  for (const r of rows) (map.get(r.column_id) ?? map.set(r.column_id, new Set()).get(r.column_id)!).add(r.tag);
  return map;
}

export async function loadFacts(tx: Tx, k: number | null): Promise<GraphFacts> {
  const registered = k === null ? "true" : `a.registered_seq <= ${k}`;
  const columns = await tx.query(`select c.id from columns c join assets a on a.id = c.asset_id where ${registered}`);
  const edges = await tx.query(`select id, from_col as "from", to_col as "to", transform from edges where ${inForce(k)}`);
  const direct = await tx.query(`select column_id, tag from direct_tags where ${inForce(k)}`);
  const suppressed = await tx.query(`select column_id, tag from suppressions where ${inForce(k)}`);
  return {
    columns: columns.rows.map((r: { id: string }) => r.id),
    edges: edges.rows as Edge[],
    direct: tagMap(direct.rows),
    suppressed: tagMap(suppressed.rows),
  };
}

async function loadSuppressed(tx: Tx): Promise<Map<string, Set<Tag>>> {
  const { rows } = await tx.query(`select column_id, tag from suppressions where to_seq is null`);
  return tagMap(rows);
}

/** The live derived tags as last written by a graph write. */
export async function loadStoredDerived(tx: Tx): Promise<Derived> {
  const { rows } = await tx.query("select column_id, tag, sources from column_tags order by column_id, tag");
  const derived: Derived = new Map();
  for (const r of rows as { column_id: string; tag: Tag; sources: string[] }[]) {
    (derived.get(r.column_id) ?? derived.set(r.column_id, new Map()).get(r.column_id)!).set(r.tag, r.sources);
  }
  return derived;
}

async function persist(tx: Tx, after: Derived, changed: string[]): Promise<void> {
  if (!changed.length) return;
  await tx.query("delete from column_tags where column_id = any($1)", [changed]);
  const cols: string[] = [];
  const tags: string[] = [];
  const sources: string[] = [];
  for (const id of changed) {
    for (const [tag, list] of after.get(id) ?? []) {
      cols.push(id);
      tags.push(tag);
      sources.push(JSON.stringify(list));
    }
  }
  if (cols.length) {
    await tx.query(
      `insert into column_tags(column_id, tag, sources)
       select c, t, array(select json_array_elements_text(s::json)) from unnest($1::text[], $2::text[], $3::text[]) as x(c, t, s)`,
      [cols, tags, sources],
    );
  }
}

/** Seed: write the derived tags of the committed facts. */
export async function writeDerived(tx: Tx): Promise<void> {
  const facts = await loadFacts(tx, null);
  const after = recompute(facts);
  await persist(tx, after, [...after.keys()]);
}

interface GraphChange<T> {
  result: T;
  before: Derived;
  after: Derived;
  changed: string[];
}

/**
 * Every graph write (tag, bulk tag, undo, suppression, edge, asset) runs its change through here, so
 * effective tags, sources and counts are recomputed and stored in the same transaction (DP-33, DP-36).
 */
export async function graphWrite<T>(tx: Tx, change: () => Promise<T>): Promise<GraphChange<T>> {
  const before = await loadStoredDerived(tx);
  const suppressedBefore = await loadSuppressed(tx);
  const result = await change();
  const facts = await loadFacts(tx, null);
  const after = recompute(facts, adjacency(facts.edges));
  const changed = changedColumns(before, after, suppressedBefore, facts.suppressed);
  await persist(tx, after, changed);
  return { result, before, after, changed };
}
