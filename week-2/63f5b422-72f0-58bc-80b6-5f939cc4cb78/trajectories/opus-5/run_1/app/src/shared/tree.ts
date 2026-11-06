import type { NodeType, Page, PlinthDocument, PlinthNode, SharedComponent } from './types.js';

export const CONTAINER_TYPES: readonly NodeType[] = [
  'page',
  'section',
  'stack',
  'nav',
  'collection_list',
];

export function takesChildren(type: NodeType): boolean {
  return CONTAINER_TYPES.includes(type);
}

/** Whether `parent` accepts `childType` as a new child. */
export function accepts(parent: PlinthNode, childType: NodeType): boolean {
  if (!takesChildren(parent.type)) return false;
  if (parent.type === 'nav') return childType === 'button';
  if (parent.type === 'collection_list') return false;
  return true;
}

export interface NodeHit {
  node: PlinthNode;
  parent: PlinthNode | null;
  index: number;
  page: Page | null;
  component: SharedComponent | null;
}

function walk(
  node: PlinthNode,
  parent: PlinthNode | null,
  index: number,
  visit: (node: PlinthNode, parent: PlinthNode | null, index: number) => boolean,
): boolean {
  if (visit(node, parent, index)) return true;
  for (let i = 0; i < node.children.length; i += 1) {
    if (walk(node.children[i]!, node, i, visit)) return true;
  }
  return false;
}

export function findNode(doc: PlinthDocument, nodeId: string): NodeHit | undefined {
  let hit: NodeHit | undefined;
  for (const page of doc.pages) {
    walk(page.root, null, 0, (node, parent, index) => {
      if (node.id !== nodeId) return false;
      hit = { node, parent, index, page, component: null };
      return true;
    });
    if (hit) return hit;
  }
  for (const component of doc.components) {
    walk(component.root, null, 0, (node, parent, index) => {
      if (node.id !== nodeId) return false;
      hit = { node, parent, index, page: null, component };
      return true;
    });
    if (hit) return hit;
  }
  return undefined;
}

export function allNodes(root: PlinthNode): PlinthNode[] {
  const out: PlinthNode[] = [];
  walk(root, null, 0, (node) => {
    out.push(node);
    return false;
  });
  return out;
}

export function pageOf(doc: PlinthDocument, nodeId: string): Page | undefined {
  for (const page of doc.pages) {
    if (allNodes(page.root).some((n) => n.id === nodeId)) return page;
  }
  return undefined;
}

export function findPage(doc: PlinthDocument, pageId: string): Page | undefined {
  return doc.pages.find((p) => p.id === pageId);
}

export function findComponent(doc: PlinthDocument, id: string): SharedComponent | undefined {
  return doc.components.find((c) => c.id === id);
}

export function pathTo(root: PlinthNode, nodeId: string): number[] | undefined {
  if (root.id === nodeId) return [];
  for (let i = 0; i < root.children.length; i += 1) {
    const sub = pathTo(root.children[i]!, nodeId);
    if (sub) return [i, ...sub];
  }
  return undefined;
}

export function nodeAtPath(root: PlinthNode, path: readonly number[]): PlinthNode | undefined {
  let node: PlinthNode | undefined = root;
  for (const index of path) {
    node = node?.children[index];
    if (!node) return undefined;
  }
  return node;
}

export function isInSubtree(root: PlinthNode, nodeId: string): boolean {
  return pathTo(root, nodeId) !== undefined;
}

export function linkedInstances(doc: PlinthDocument, componentId: string): PlinthNode[] {
  return doc.pages
    .flatMap((page) => allNodes(page.root))
    .filter((node) => node.shared?.componentId === componentId);
}

interface InstanceContext {
  componentId: string;
  instanceRoot: PlinthNode;
  path: number[];
}

/** The instance a node belongs to, when it sits in or under a linked instance root. */
export function instanceContextOf(
  doc: PlinthDocument,
  nodeId: string,
): InstanceContext | undefined {
  for (const page of doc.pages) {
    for (const node of allNodes(page.root)) {
      if (node.shared === undefined) continue;
      const path = pathTo(node, nodeId);
      if (path) return { componentId: node.shared.componentId, instanceRoot: node, path };
    }
  }
  return undefined;
}

/**
 * The node ids that mirror `nodeId`: itself first, then the matching node in the
 * shared component and in every other linked instance.
 */
export function mirrorsOf(doc: PlinthDocument, nodeId: string): string[] {
  const context = instanceContextOf(doc, nodeId);
  if (!context) return [nodeId];
  const component = findComponent(doc, context.componentId);
  if (!component) return [nodeId];
  const ids = [nodeId];
  const inComponent = nodeAtPath(component.root, context.path);
  if (inComponent) ids.push(inComponent.id);
  for (const instance of linkedInstances(doc, context.componentId)) {
    if (instance.id === context.instanceRoot.id) continue;
    const mirror = nodeAtPath(instance, context.path);
    if (mirror) ids.push(mirror.id);
  }
  return ids;
}

export function componentOfNode(doc: PlinthDocument, nodeId: string): SharedComponent | undefined {
  const context = instanceContextOf(doc, nodeId);
  return context ? findComponent(doc, context.componentId) : undefined;
}

export function cloneNode(node: PlinthNode, newId: () => string): PlinthNode {
  const copy: PlinthNode = {
    id: newId(),
    type: node.type,
    name: node.name,
    props: { ...node.props },
    styles: {
      desktop: { ...node.styles.desktop },
      tablet: { ...node.styles.tablet },
      phone: { ...node.styles.phone },
    },
    children: node.children.map((child) => cloneNode(child, newId)),
  };
  if (node.bind) copy.bind = { ...node.bind };
  return copy;
}

export function emptyStyles(): PlinthNode['styles'] {
  return { desktop: {}, tablet: {}, phone: {} };
}

export function countOfType(page: Page, type: NodeType): number {
  return allNodes(page.root).filter((n) => n.type === type).length;
}
