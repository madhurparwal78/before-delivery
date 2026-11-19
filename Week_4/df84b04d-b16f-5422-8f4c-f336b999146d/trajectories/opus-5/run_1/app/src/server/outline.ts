import { fixed } from '../shared/copy.js';
import { matches, parseQuery, type Searchable } from '../shared/search.js';
import type { Bullet, OutlineView, SearchResult, Suggestion } from '../shared/types.js';
import { config } from './config.js';
import { query } from './db.js';
import { invalid, notFound } from './errors.js';
import { baseDepth, scopeForRoot, type Scope, type Viewer } from './scope.js';
import type { DisplayNode, Tree } from './tree.js';

export interface LoadedView {
  scope: Scope;
  tree: Tree;
  rootId: string | null;
  nodes: DisplayNode[];
}

/** Loads the branch a request is looking at, with the depth the viewer counts from. */
export async function loadView(viewer: Viewer, rootParam: string | null): Promise<LoadedView> {
  const { scope, tree, rootId } = await scopeForRoot(viewer, rootParam);
  const nodes = tree.walk(rootId, baseDepth(scope, tree, rootId));
  return { scope, tree, rootId, nodes };
}

function serializeRoot(view: LoadedView): Bullet | null {
  const first = view.nodes[0];
  if (view.rootId === null || first === undefined) return null;
  const atShareRoot = view.scope.shareRootId === view.rootId;
  return view.tree.serialize(first, atShareRoot ? null : first.row.parentId);
}

function serializeAncestors(view: LoadedView): Bullet[] {
  if (view.rootId === null) return [];
  const chain = view.tree.ancestors(view.rootId);
  const shareRootId = view.scope.shareRootId;
  const at = chain.findIndex((row) => row.id === shareRootId);
  const kept = shareRootId === null ? chain : at === -1 ? [] : chain.slice(at + 1);
  return kept.map((row) =>
    view.tree.serialize({
      row,
      displayParentId: row.parentId,
      depth: baseDepth(view.scope, view.tree, row.id)
    })
  );
}

async function currentSeq(ownerId: string): Promise<number> {
  const rows = await query<{ seq: string }>(`select seq from outline_sequence where owner_id = $1`, [
    ownerId
  ]);
  return rows[0] === undefined ? 0 : Number(rows[0].seq);
}

export async function readOutline(viewer: Viewer, rootParam: string | null): Promise<OutlineView> {
  const view = await loadView(viewer, rootParam);
  const rows = view.rootId === null ? view.nodes : view.nodes.slice(1);
  return {
    root: serializeRoot(view),
    ancestors: serializeAncestors(view),
    seq: await currentSeq(view.scope.ownerId),
    bullets: rows.map((node) => view.tree.serialize(node))
  };
}

/** One bullet, as the viewer sees it. */
export async function readBullet(viewer: Viewer, bulletId: string): Promise<Bullet> {
  const view = await loadView(viewer, bulletId);
  const bullet = serializeRoot(view);
  if (bullet === null) throw notFound();
  return bullet;
}

function searchableOf(tree: Tree, node: DisplayNode): Searchable | null {
  const original = tree.original(node.row);
  if (original === undefined) return null;
  return {
    text: original.text,
    tags: original.tags,
    mentions: original.mentions,
    completed: original.completed,
    date: original.date
  };
}

export async function searchOutline(
  viewer: Viewer,
  rawQuery: string,
  rootParam: string | null
): Promise<SearchResult> {
  if (rawQuery.length > config.searchMaxChars) {
    throw invalid({ q: fixed.searchTooLong(config.searchMaxChars) });
  }
  const view = await loadView(viewer, rootParam);
  const terms = parseQuery(rawQuery);
  const rows = view.rootId === null ? view.nodes : view.nodes.slice(1);
  const matchIds: string[] = [];
  const originals = new Set<string>();
  const parents = new Map<string, string | null>();
  for (const node of rows) parents.set(node.row.id, node.displayParentId);
  if (terms.length === 0) {
    return { query: rawQuery, count: 0, matches: [], context: [] };
  }
  for (const node of rows) {
    const searchable = searchableOf(view.tree, node);
    if (searchable === null) continue;
    if (!matches(terms, searchable)) continue;
    matchIds.push(node.row.id);
    originals.add((view.tree.original(node.row) ?? node.row).id);
  }
  const contextIds: string[] = [];
  const matched = new Set(matchIds);
  for (const id of matchIds) {
    let parent = parents.get(id) ?? null;
    while (parent !== null && parent !== view.rootId) {
      if (!matched.has(parent) && !contextIds.includes(parent)) contextIds.push(parent);
      parent = parents.get(parent) ?? null;
    }
  }
  return { query: rawQuery, count: originals.size, matches: matchIds, context: contextIds };
}

export async function suggest(
  viewer: Viewer,
  kind: 'tag' | 'mention',
  prefix: string,
  rootParam: string | null
): Promise<Suggestion[]> {
  const view = await loadView(viewer, rootParam);
  const rows = view.rootId === null ? view.nodes : view.nodes.slice(1);
  const wanted = prefix.replace(/^[#@]/, '').toLowerCase();
  const users = new Map<string, Set<string>>();
  for (const node of rows) {
    const original = view.tree.original(node.row);
    if (original === undefined) continue;
    const values = kind === 'tag' ? original.tags : original.mentions;
    for (const value of values) {
      if (!value.startsWith(wanted)) continue;
      const holders = users.get(value) ?? new Set<string>();
      holders.add(original.id);
      users.set(value, holders);
    }
  }
  const sigil = kind === 'tag' ? '#' : '@';
  return [...users.entries()]
    .map(([value, holders]) => ({ value: `${sigil}${value}`, count: holders.size }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
    .slice(0, 8);
}
