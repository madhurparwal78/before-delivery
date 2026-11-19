export interface PlacementRef {
  id: string;
  parentId: string | null;
  mirrorOf: string | null;
}

/** A tree of placements. `childrenOf` takes a container: an original's id, or null for the outline's top level. */
export interface PlacementTree {
  placement(id: string): PlacementRef | undefined;
  childrenOf(containerId: string | null): readonly string[];
}

export type MoveOp = "indent" | "outdent" | "up" | "down";
export type MoveRequest = { op: MoveOp } | { parentId: string | null; index: number };
export type MoveRefusal =
  | "share_root"
  | "no_previous_sibling"
  | "at_top"
  | "at_first"
  | "at_last"
  | "inside_itself"
  | "too_deep"
  | "index";

export interface MoveRules {
  tree: PlacementTree;
  maxDepth: number;
  /** Bullets a collaborator was invited onto: they never move. */
  shareRoots: ReadonlySet<string>;
  /** Bullets that end the view: the zoomed bullet in the UI, the shared bullets for the API. */
  viewTops: ReadonlySet<string>;
}

type MoveDecision =
  | { ok: true; parentId: string | null; index: number; expand: string | null }
  | { ok: false; code: MoveRefusal };

type PlacementDecision = { ok: true } | { ok: false; code: "inside_itself" | "too_deep" };

const refuse = (code: MoveRefusal): MoveDecision => ({ ok: false, code });

export function containerOf(tree: PlacementTree, id: string): string {
  return tree.placement(id)?.mirrorOf ?? id;
}

export function depthOf(tree: PlacementTree, id: string): number {
  let depth = 0;
  for (let cursor = tree.placement(id)?.parentId ?? null; cursor !== null; cursor = tree.placement(cursor)?.parentId ?? null) {
    depth += 1;
  }
  return depth;
}

function heightOf(tree: PlacementTree, id: string): number {
  let height = 0;
  for (const child of tree.childrenOf(containerOf(tree, id))) height = Math.max(height, 1 + heightOf(tree, child));
  return height;
}

export function countInside(tree: PlacementTree, id: string): number {
  let count = 0;
  for (const child of tree.childrenOf(id)) count += 1 + countInside(tree, child);
  return count;
}

function reaches(tree: PlacementTree, from: string, target: string, seen = new Set<string>()): boolean {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return tree.childrenOf(from).some((child) => reaches(tree, containerOf(tree, child), target, seen));
}

/** Placing under `destination` puts the subject inside itself when the destination is in the subject's display. */
function insideItself(tree: PlacementTree, subject: string, destination: string | null): boolean {
  return destination !== null && reaches(tree, containerOf(tree, subject), containerOf(tree, destination));
}

function checkPlacement(rules: MoveRules, subject: string, destination: string | null, height: number): PlacementDecision {
  if (insideItself(rules.tree, subject, destination)) return { ok: false, code: "inside_itself" };
  const depth = destination === null ? 0 : depthOf(rules.tree, destination) + 1;
  if (depth + height >= rules.maxDepth) return { ok: false, code: "too_deep" };
  return { ok: true };
}

export function decideCreate(rules: MoveRules, parentId: string | null): PlacementDecision {
  const depth = parentId === null ? 0 : depthOf(rules.tree, parentId) + 1;
  return depth >= rules.maxDepth ? { ok: false, code: "too_deep" } : { ok: true };
}

export function decideMirror(rules: MoveRules, sourceId: string, destination: string | null): PlacementDecision {
  return checkPlacement(rules, sourceId, destination, heightOf(rules.tree, sourceId));
}

function crossInto(rules: MoveRules, id: string, neighbour: string, index: "end" | "start"): MoveDecision {
  const container = containerOf(rules.tree, neighbour);
  const verdict = checkPlacement(rules, id, neighbour, heightOf(rules.tree, id));
  if (!verdict.ok) return refuse(verdict.code);
  return {
    ok: true,
    parentId: container,
    index: index === "start" ? 0 : rules.tree.childrenOf(container).length,
    expand: neighbour,
  };
}

function decideIndent(rules: MoveRules, id: string, siblings: readonly string[], position: number): MoveDecision {
  const previous = siblings[position - 1];
  return previous === undefined ? refuse("no_previous_sibling") : crossInto(rules, id, previous, "end");
}

function decideOutdent(rules: MoveRules, parentId: string | null): MoveDecision {
  if (parentId === null || rules.viewTops.has(parentId)) return refuse("at_top");
  const grandparent = rules.tree.placement(parentId)?.parentId ?? null;
  const index = rules.tree.childrenOf(grandparent).indexOf(parentId) + 1;
  return { ok: true, parentId: grandparent, index, expand: null };
}

function decideStep(rules: MoveRules, id: string, direction: 1 | -1): MoveDecision {
  const { tree } = rules;
  const parentId = tree.placement(id)?.parentId ?? null;
  const siblings = tree.childrenOf(parentId);
  const position = siblings.indexOf(id);
  const end = direction === -1 ? "at_first" : "at_last";
  const neighbour = siblings[position + direction];
  const atTop = parentId === null || rules.viewTops.has(parentId);
  if (neighbour !== undefined) {
    return { ok: true, parentId, index: direction === -1 ? position - 1 : position + 1, expand: null };
  }
  if (atTop) return refuse(end);
  const uncles = tree.childrenOf(tree.placement(parentId)?.parentId ?? null);
  const uncle = uncles[uncles.indexOf(parentId) + direction];
  return uncle === undefined ? refuse(end) : crossInto(rules, id, uncle, direction === -1 ? "end" : "start");
}

function decideExplicit(rules: MoveRules, id: string, parentId: string | null, index: number): MoveDecision {
  const { tree } = rules;
  const container = parentId === null ? null : containerOf(tree, parentId);
  const count = tree.childrenOf(container).filter((child) => child !== id).length;
  if (!Number.isInteger(index) || index < 0 || index > count) return refuse("index");
  if (rules.shareRoots.has(id)) return refuse("share_root");
  const verdict = checkPlacement(rules, id, parentId, heightOf(tree, id));
  return verdict.ok ? { ok: true, parentId: container, index, expand: null } : refuse(verdict.code);
}

/** The one place move legality is decided: keyboard, toolbar, swipe, board and API all ask this. */
export function decideMove(rules: MoveRules, id: string, request: MoveRequest): MoveDecision {
  const placement = rules.tree.placement(id);
  if (placement === undefined) return refuse("at_top");
  if ("parentId" in request) return decideExplicit(rules, id, request.parentId, request.index);
  if (rules.shareRoots.has(id)) return refuse("share_root");
  const siblings = rules.tree.childrenOf(placement.parentId);
  switch (request.op) {
    case "indent": return decideIndent(rules, id, siblings, siblings.indexOf(id));
    case "outdent": return decideOutdent(rules, placement.parentId);
    case "up": return decideStep(rules, id, -1);
    case "down": return decideStep(rules, id, 1);
  }
}
