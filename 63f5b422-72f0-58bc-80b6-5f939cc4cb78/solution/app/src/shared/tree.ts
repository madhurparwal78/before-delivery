import type { Component, DocNode, NodeType, Page, WorkspaceDoc } from "./types.js";

export const TYPE_LABEL: Record<NodeType, string> = {
  page: "Page",
  section: "Section",
  stack: "Stack",
  heading: "Heading",
  text: "Text",
  image: "Image",
  button: "Button",
  nav: "Nav",
  collection_list: "Collection list",
};

/** The types the Add menu offers, in menu order. */
export const INSERTABLE: readonly NodeType[] = ["section", "stack", "heading", "text", "image", "button", "nav", "collection_list"];

const CONTAINERS: ReadonlySet<NodeType> = new Set(["page", "section", "stack", "nav", "collection_list"]);

export function takesChildren(type: NodeType): boolean {
  return CONTAINERS.has(type);
}

/** Whether a node of `parent` type may receive a new child of `child` type (insert or move). */
export function canReceive(parent: NodeType, child: NodeType): boolean {
  if (child === "page") return false;
  if (parent === "nav") return child === "button";
  if (parent === "collection_list") return false;
  return CONTAINERS.has(parent);
}

export function walk(node: DocNode, visit: (node: DocNode, parent: DocNode | null) => void, parent: DocNode | null = null): void {
  visit(node, parent);
  for (const child of node.children) walk(child, visit, node);
}

export function subtreeIds(node: DocNode): string[] {
  const ids: string[] = [];
  walk(node, (n) => ids.push(n.id));
  return ids;
}

export function countNodes(node: DocNode): number {
  let n = 0;
  walk(node, () => (n += 1));
  return n;
}

type Owner = { kind: "page"; page: Page } | { kind: "component"; component: Component };

export interface Located {
  node: DocNode;
  parent: DocNode | null;
  index: number;
  owner: Owner;
  /** Ancestors from the owner's root down to the parent. */
  ancestors: DocNode[];
}

function search(root: DocNode, id: string, owner: Owner): Located | null {
  const stack: DocNode[] = [];
  const visit = (node: DocNode, parent: DocNode | null, index: number): Located | null => {
    if (node.id === id) return { node, parent, index, owner, ancestors: [...stack] };
    stack.push(node);
    for (let i = 0; i < node.children.length; i += 1) {
      const found = visit(node.children[i], node, i);
      if (found) return found;
    }
    stack.pop();
    return null;
  };
  return visit(root, null, 0);
}

/** Find a node anywhere in the document: on a page or inside a shared component. */
export function locate(doc: Pick<WorkspaceDoc, "pages" | "components">, id: string): Located | null {
  for (const page of doc.pages) {
    const found = search(page.root, id, { kind: "page", page });
    if (found) return found;
  }
  for (const component of doc.components) {
    const found = search(component.root, id, { kind: "component", component });
    if (found) return found;
  }
  return null;
}

export function locateOnPage(doc: Pick<WorkspaceDoc, "pages">, id: string): (Located & { owner: { kind: "page"; page: Page } }) | null {
  for (const page of doc.pages) {
    const found = search(page.root, id, { kind: "page", page });
    if (found) return found as Located & { owner: { kind: "page"; page: Page } };
  }
  return null;
}

/** The linked instance root a node belongs to (itself or an ancestor), if any. */
export function instanceRoot(found: Located): DocNode | null {
  if (found.node.shared) return found.node;
  for (let i = found.ancestors.length - 1; i >= 0; i -= 1) if (found.ancestors[i].shared) return found.ancestors[i];
  return null;
}

/** The collection list whose template contains this node (the template itself included). */
export function enclosingList(found: Located): DocNode | null {
  for (let i = found.ancestors.length - 1; i >= 0; i -= 1) if (found.ancestors[i].type === "collection_list") return found.ancestors[i];
  return null;
}

export function containsInstance(node: DocNode): boolean {
  let found = false;
  walk(node, (n) => (found ||= !!n.shared));
  return found;
}

export function pathFrom(root: DocNode, target: DocNode): number[] | null {
  if (root === target) return [];
  for (let i = 0; i < root.children.length; i += 1) {
    const rest = pathFrom(root.children[i], target);
    if (rest) return [i, ...rest];
  }
  return null;
}

export function nodeAt(root: DocNode, path: readonly number[]): DocNode | null {
  let node: DocNode | undefined = root;
  for (const i of path) {
    node = node?.children[i];
    if (!node) return null;
  }
  return node ?? null;
}

type MoveProblem = "parentId" | "index";

/** The move rules (Business rules: Moves). Null when the move is allowed. */
export function moveProblem(doc: WorkspaceDoc, nodeId: string, parentId: string, index: number): MoveProblem | null {
  const moving = locateOnPage(doc, nodeId);
  const target = locateOnPage(doc, parentId);
  if (!moving || !target || !moving.parent) return "parentId";
  if (target.owner.page.id !== moving.owner.page.id) return "parentId";
  if (!canReceive(target.node.type, moving.node.type)) return "parentId";
  if (subtreeIds(moving.node).includes(parentId)) return "parentId";
  if (crossesInstance(moving, target)) return "parentId";
  const siblings = target.node.children.filter((c) => c.id !== nodeId).length;
  if (!Number.isInteger(index) || index < 0 || index > siblings) return "index";
  return null;
}

/** A node may move inside its own linked instance or outside instances, never across the boundary. */
function crossesInstance(moving: Located, target: Located): boolean {
  const from = moving.node.shared ? instanceRootOfParent(moving) : instanceRoot(moving);
  const to = instanceRoot(target);
  return (from?.id ?? null) !== (to?.id ?? null);
}

function instanceRootOfParent(found: Located): DocNode | null {
  for (let i = found.ancestors.length - 1; i >= 0; i -= 1) if (found.ancestors[i].shared) return found.ancestors[i];
  return null;
}

export type KeyMove = "up" | "down" | "indent" | "outdent";

/** Where an Alt+Arrow key moves a node, or null when the move is refused. */
export function keyboardMove(doc: WorkspaceDoc, nodeId: string, move: KeyMove): { parentId: string; index: number } | null {
  const found = locateOnPage(doc, nodeId);
  if (!found || !found.parent) return null;
  const { parent, index } = found;
  let slot: { parentId: string; index: number } | null = null;
  if (move === "up" && index > 0) slot = { parentId: parent.id, index: index - 1 };
  if (move === "down" && index < parent.children.length - 1) slot = { parentId: parent.id, index: index + 1 };
  if (move === "indent" && index > 0) {
    const previous = parent.children[index - 1];
    slot = { parentId: previous.id, index: previous.children.length };
  }
  if (move === "outdent" && found.ancestors.length >= 2) {
    const grand = found.ancestors[found.ancestors.length - 2];
    slot = { parentId: grand.id, index: grand.children.indexOf(parent) + 1 };
  }
  if (!slot || moveProblem(doc, nodeId, slot.parentId, slot.index)) return null;
  return slot;
}

/** Where the Add menu puts a new node (Interactions: Add menu). */
export function insertSlot(doc: WorkspaceDoc, page: Page, selectedId: string | null, type: NodeType): { parentId: string; index: number } | null {
  const selected = selectedId ? locateOnPage(doc, selectedId) : null;
  if (!selected || selected.owner.page.id !== page.id) {
    return canReceive("page", type) ? { parentId: page.root.id, index: page.root.children.length } : null;
  }
  if (canReceive(selected.node.type, type)) return { parentId: selected.node.id, index: selected.node.children.length };
  const chain = [...selected.ancestors, selected.node];
  for (let i = chain.length - 1; i >= 1; i -= 1) {
    const parent = chain[i - 1];
    if (canReceive(parent.type, type)) return { parentId: parent.id, index: parent.children.indexOf(chain[i]) + 1 };
  }
  return null;
}

/** The type label and a number counting that type on the page, for example `Heading 2`. */
export function defaultName(root: DocNode, type: NodeType): string {
  let count = 0;
  walk(root, (n) => (count += n.type === type ? 1 : 0));
  return `${TYPE_LABEL[type]} ${count + 1}`;
}

/** Every page node in tree order (the order canvas Up/Down walks). */
export function treeOrder(root: DocNode): DocNode[] {
  const out: DocNode[] = [];
  walk(root, (n) => out.push(n));
  return out;
}
