// The document operations engine: validation and application in one place.
import {
  BREAKPOINTS, STYLE_PROPERTIES, NODE_TYPES, TYPE_LABEL, containerAccepts, isTokenRef, isSafeHref,
  styleValueError, mainPropOf, filterRichText, slugify,
  type WorkspaceDocument, type DocumentNode, type Page, type Token, type Breakpoint, type StyleProperty, type NodeType,
} from '../shared/domain.js';
import { invalid, invalidMove, conflictError, HttpError } from './errors.js';
import { NAMED_COLORS } from '../shared/colors.js';
import { newId } from './ids.js';
import type { Operation } from './types.js';

export interface ApplyContext {
  document: WorkspaceDocument;
  /** Confirmed images of this workspace; ids in here may be referenced. */
  confirmedImages: Set<string>;
  /** All known image ids, confirmed or not. */
  knownImageIds: Set<string>;
}

export interface ApplyResult {
  created?: Record<string, string>;
  affectsPages: boolean;
}

export const LIMITS = {
  nodes: 500, pages: 20, tokens: 40, fields: 20, entries: 200,
  nameMax: 80, textMax: 2000, richMax: 2000,
} as const;

export type NodeRef = { node: DocumentNode; parent: DocumentNode | null; page: Page };

export function findPageNode(doc: WorkspaceDocument, nodeId: string): NodeRef | null {
  for (const page of doc.pages) {
    const r = findIn(page.root, null, nodeId, page);
    if (r) return r;
  }
  return null;
}

function findIn(node: DocumentNode, parent: DocumentNode | null, nodeId: string, page: Page): NodeRef | null {
  if (node.id === nodeId) return { node, parent, page };
  for (const child of node.children) {
    const r = findIn(child, node, nodeId, page);
    if (r) return r;
  }
  return null;
}

/** Find a node anywhere in the document, including inside component definitions. */
export function findAnyNode(doc: WorkspaceDocument, nodeId: string): DocumentNode | null {
  for (const page of doc.pages) {
    const n = findRaw(page.root, nodeId);
    if (n) return n;
  }
  for (const comp of doc.components) {
    const n = findRaw(comp.root, nodeId);
    if (n) return n;
  }
  return null;
}

function findRaw(node: DocumentNode, nodeId: string): DocumentNode | null {
  if (node.id === nodeId) return node;
  for (const child of node.children) {
    const r = findRaw(child, nodeId);
    if (r) return r;
  }
  return null;
}

export function componentIdOfNode(doc: WorkspaceDocument, nodeId: string): string | null {
  for (const comp of doc.components) {
    if (containsId(comp.root, nodeId)) return comp.id;
  }
  return null;
}

function containsId(node: DocumentNode, nodeId: string): boolean {
  if (node.id === nodeId) return true;
  return node.children.some((c) => containsId(c, nodeId));
}

export function countNodes(root: DocumentNode): number {
  let n = 1;
  for (const c of root.children) n += countNodes(c);
  return n;
}

export function cloneStyles(styles: DocumentNode['styles']): DocumentNode['styles'] {
  const out: DocumentNode['styles'] = {};
  for (const bp of BREAKPOINTS) {
    if (styles[bp]) out[bp] = { ...styles[bp] };
  }
  return out;
}

export function cloneTreeWithNewIds(node: DocumentNode, keepShared = true): DocumentNode {
  const copy: DocumentNode = {
    id: newId('n'), type: node.type, name: node.name, props: { ...node.props },
    styles: cloneStyles(node.styles), children: [],
  };
  if (keepShared && node.shared) copy.shared = { componentId: node.shared.componentId };
  if (node.bind) copy.bind = { ...node.bind };
  for (const c of node.children) copy.children.push(cloneTreeWithNewIds(c, keepShared));
  return copy;
}

function cloneDescendant(node: DocumentNode): DocumentNode {
  const copy: DocumentNode = {
    id: newId('n'), type: node.type, name: node.name, props: { ...node.props },
    styles: cloneStyles(node.styles), children: [],
  };
  if (node.bind) copy.bind = { ...node.bind };
  for (const c of node.children) copy.children.push(cloneDescendant(c));
  return copy;
}

function isInSubtree(node: DocumentNode, id: string): boolean {
  if (node.id === id) return true;
  return node.children.some((c) => isInSubtree(c, id));
}

export function validNameOr(v: unknown): { ok: true; value: string } | { ok: false } {
  if (typeof v !== 'string') return { ok: false };
  const s = v.trim();
  if (s.length < 1 || s.length > LIMITS.nameMax) return { ok: false };
  return { ok: true, value: s };
}

function tokenKindLookup(doc: WorkspaceDocument): (name: string) => Token['kind'] | undefined {
  return (name: string) => doc.tokens.find((t) => t.name === name)?.kind;
}

export function tokenByName(doc: WorkspaceDocument, name: string): Token | undefined {
  return doc.tokens.find((t) => t.name === name);
}

export function tokenUseCount(doc: WorkspaceDocument, name: string): number {
  let n = 0;
  const visit = (node: DocumentNode) => {
    for (const bp of BREAKPOINTS) {
      const styles = node.styles[bp];
      if (!styles) continue;
      for (const v of Object.values(styles)) {
        if (isTokenRef(v) && v.token === name) { n++; break; }
      }
    }
    for (const c of node.children) visit(c);
  };
  for (const page of doc.pages) visit(page.root);
  for (const comp of doc.components) visit(comp.root); // counted once per component, not per instance
  return n;
}

export function collectionField(doc: WorkspaceDocument, name: string): { name: string; kind: 'text' | 'rich_text' | 'image' } | undefined {
  return doc.collection.fields.find((f) => f.name === name);
}

export function defaultProps(type: NodeType): Record<string, unknown> {
  switch (type) {
    case 'heading': return { text: '', level: 1 };
    case 'text': return { text: '' };
    case 'button': return { text: '', href: '/' };
    case 'image': return { alt: '', focalX: 50, focalY: 50 };
    default: return {};
  }
}

export function countInstances(doc: WorkspaceDocument, componentId: string): number {
  let n = 0;
  for (const page of doc.pages) {
    const c = countIn(page.root, componentId);
    n += c;
  }
  return n;
}

function countIn(node: DocumentNode, componentId: string): number {
  let n = node.shared?.componentId === componentId ? 1 : 0;
  for (const c of node.children) n += countIn(c, componentId);
  return n;
}

export function pagesWithInstance(doc: WorkspaceDocument, componentId: string): string[] {
  const out: string[] = [];
  for (const page of doc.pages) if (countIn(page.root, componentId) > 0) out.push(page.id);
  return out;
}

/** Mirror component edits into every linked instance. */
function syncInstances(doc: WorkspaceDocument, componentId: string): void {
  const comp = doc.components.find((c) => c.id === componentId);
  if (!comp) return;
  for (const page of doc.pages) syncIn(page.root, comp.root);
}

function syncIn(node: DocumentNode, root: DocumentNode): void {
  if (node.shared) {
    syncInstance(node, root);
    return;
  }
  for (const c of node.children) syncIn(c, root);
}

function syncInstance(instance: DocumentNode, root: DocumentNode): void {
  instance.type = root.type;
  instance.name = root.name;
  instance.props = { ...root.props };
  instance.styles = cloneStyles(root.styles);
  const oldById = new Map(instance.children.map((c) => [c.id, c]));
  instance.children = root.children.map((c) => {
    const existing = oldById.get(c.id);
    if (existing) {
      syncInstance(existing, c);
      return existing;
    }
    return cloneDescendant(c);
  });
}

function checkImageRef(ctx: ApplyContext, imageId: string, field: string): void {
  if (!imageId) return;
  if (ctx.confirmedImages.has(imageId)) return;
  if (ctx.knownImageIds.has(imageId)) {
    throw invalid({ [field]: 'That image is not confirmed yet.' });
  }
  throw new HttpError(404, { code: 'not_found', message: 'Not found.' });
}

/** Find a node anywhere: on a page, or inside a component definition. */
export function findNodeEverywhere(doc: WorkspaceDocument, nodeId: string): DocumentNode | null {
  const ref = findPageNode(doc, nodeId);
  if (ref) return ref.node;
  return findAnyNode(doc, nodeId);
}

/** Validate and apply one operation. Throws HttpError on refusal. */
export function applyOperation(ctx: ApplyContext, op: Operation): ApplyResult {
  const doc = ctx.document;
  const kind: string = op.kind;
  switch (kind) {
    case 'insert_node': return insertNode(ctx, op);
    case 'insert_instance': return insertInstance(ctx, op);
    case 'move_node': return moveNode(ctx, op);
    case 'delete_node': return deleteNode(ctx, op);
    case 'duplicate_node': return duplicateNode(ctx, op);
    case 'rename_node': return renameNode(ctx, op);
    case 'set_prop': return setProp(ctx, op);
    case 'set_style': return setStyle(ctx, op);
    case 'clear_style': return clearStyle(ctx, op);
    case 'set_token': return setToken(ctx, op);
    case 'rename_token': return renameToken(ctx, op);
    case 'delete_token': return deleteToken(ctx, op);
    case 'create_component': return createComponent(ctx, op);
    case 'detach_instance': return detachInstance(ctx, op);
    case 'delete_component': return deleteComponent(ctx, op);
    case 'set_fields': return setFields(ctx, op);
    case 'put_entry': return putEntry(ctx, op);
    case 'move_entry': return moveEntry(ctx, op);
    case 'delete_entry': return deleteEntry(ctx, op);
    case 'bind_prop': return bindProp(ctx, op);
    case 'add_page': return addPage(ctx, op);
    case 'rename_page': return renamePage(ctx, op);
    case 'restore': throw invalid({ kind: 'restore is written only by the restore route.' });
    default: throw invalid({ kind: 'Unknown operation kind.' });
  }
}

function resolveInsertTarget(
  doc: WorkspaceDocument, parentId: unknown, index: unknown, childType: NodeType | null,
): { parent: DocumentNode; page: Page } {
  const fields: Record<string, string> = {};
  if (typeof parentId !== 'string') throw invalidMove({ parentId: 'Parent is required.' });
  const pageRef = findPageNode(doc, parentId);
  let parent: DocumentNode | null = null;
  let page: Page | null = null;
  if (pageRef) { parent = pageRef.node; page = pageRef.page; }
  else {
    const compRoot = doc.components.find((c) => c.root.id === parentId)?.root
      ?? doc.components.map((c) => findRaw(c.root, parentId)).find(Boolean) ?? null;
    if (compRoot) parent = compRoot;
  }
  if (!parent) throw invalidMove({ parentId: 'Parent not found.' });
  if (childType !== null && !containerAccepts(parent.type, childType)) {
    throw invalidMove({ parentId: `${TYPE_LABEL[parent.type]} does not take that child.` });
  }
  if (parent.type === 'collection_list' && parent.children.length > 0) {
    throw invalidMove({ parentId: 'A collection list already holds its template.' });
  }
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > parent.children.length) {
    throw invalidMove({ index: 'Index is out of range.' });
  }
  if (!page) throw invalidMove({ parentId: 'That node is not on a page.' });
  return { parent, page };
}

function insertNode(ctx: ApplyContext, op: Operation): ApplyResult {
  const doc = ctx.document;
  const fields: Record<string, string> = {};
  const type = op.type as NodeType;
  if (typeof type !== 'string' || !NODE_TYPES.includes(type) || type === 'page') {
    throw invalid({ type: 'Unknown node type.' });
  }
  const target = resolveInsertTarget(doc, op.parentId, op.index, type);
  if (countNodes(target.page.root) + 1 > LIMITS.nodes) throw invalid({ type: 'A page holds at most 500 nodes.' });
  const props = op.props !== undefined && typeof op.props === 'object' && op.props !== null ? { ...op.props } as Record<string, unknown> : {};
  const base = defaultProps(type);
  const node: DocumentNode = { id: newId('n'), type, name: '', props: base, styles: {}, children: [] };
  for (const [k, v] of Object.entries(props)) applyProp(ctx, node, k, v, fields);
  if (op.name !== undefined) {
    const n = validNameOr(op.name);
    if (!n.ok) throw invalid({ name: 'Names are 1 to 80 characters.' });
    node.name = n.value;
  } else {
    node.name = defaultName(target.page.root, type);
  }
  if (Object.keys(fields).length) throw invalid(fields);
  if (type === 'collection_list' && node.children.length === 0) {
    node.children.push({ id: newId('n'), type: 'section', name: 'Template', props: {}, styles: {}, children: [] });
  }
  target.parent.children.splice(op.index as number, 0, node);
  return { created: { nodeId: node.id }, affectsPages: true };
}

export function defaultName(root: DocumentNode, type: NodeType): string {
  let count = 0;
  const visit = (n: DocumentNode) => {
    if (n.type === type) count++;
    for (const c of n.children) visit(c);
  };
  visit(root);
  return `${TYPE_LABEL[type]} ${count + 1}`;
}

function insertInstance(ctx: ApplyContext, op: Operation): ApplyResult {
  const doc = ctx.document;
  if (typeof op.componentId !== 'string') throw invalidMove({ componentId: 'Component is required.' });
  const comp = doc.components.find((c) => c.id === op.componentId);
  if (!comp) throw invalidMove({ componentId: 'Component not found.' });
  const target = resolveInsertTarget(doc, op.parentId, op.index, comp.root.type);
  if (countNodes(target.page.root) + countNodes(comp.root) > LIMITS.nodes) {
    throw invalid({ componentId: 'A page holds at most 500 nodes.' });
  }
  const instance: DocumentNode = {
    id: newId('n'), type: comp.root.type, name: comp.root.name, props: { ...comp.root.props },
    styles: cloneStyles(comp.root.styles), children: [], shared: { componentId: comp.id },
  };
  for (const c of comp.root.children) instance.children.push(cloneDescendant(c));
  target.parent.children.splice(op.index as number, 0, instance);
  return { created: { nodeId: instance.id }, affectsPages: true };
}

function moveNode(ctx: ApplyContext, op: Operation): ApplyResult {
  const doc = ctx.document;
  if (typeof op.nodeId !== 'string') throw invalidMove({ nodeId: 'Node is required.' });
  const ref = findPageNode(doc, op.nodeId);
  if (!ref) {
    if (componentIdOfNode(doc, op.nodeId)) throw invalidMove({ nodeId: 'That node is inside a component definition.' });
    throw invalidMove({ nodeId: 'Node not found.' });
  }
  if (!ref.parent) throw invalidMove({ nodeId: 'The page root cannot move.' });
  if (typeof op.parentId !== 'string') throw invalidMove({ parentId: 'Parent is required.' });
  const newRef = findPageNode(doc, op.parentId);
  if (!newRef) throw invalidMove({ parentId: 'Parent not found.' });
  if (!containerAccepts(newRef.node.type, ref.node.type)) {
    throw invalidMove({ parentId: `${TYPE_LABEL[newRef.node.type]} does not take that child.` });
  }
  if (newRef.node.type === 'collection_list' && newRef.node.children.length > 0 && newRef.node.children[0].id !== ref.node.id) {
    throw invalidMove({ parentId: 'A collection list already holds its template.' });
  }
  if (isInSubtree(ref.node, op.parentId)) throw invalidMove({ parentId: 'A node cannot move into its own subtree.' });
  if (newRef.page.id !== ref.page.id) throw invalidMove({ parentId: 'Nodes move only within a page.' });
  const index = op.index as number;
  if (typeof index !== 'number' || !Number.isInteger(index)) throw invalidMove({ index: 'Index is out of range.' });
  const idx = ref.parent.children.findIndex((c) => c.id === ref.node.id);
  ref.parent.children.splice(idx, 1);
  const max = newRef.node.children.length;
  if (index < 0 || index > max) {
    ref.parent.children.splice(idx, 0, ref.node);
    throw invalidMove({ index: 'Index is out of range.' });
  }
  newRef.node.children.splice(index, 0, ref.node);
  return { affectsPages: true };
}

function deleteNode(ctx: ApplyContext, op: Operation): ApplyResult {
  const doc = ctx.document;
  if (typeof op.nodeId !== 'string') throw invalid({ nodeId: 'Node is required.' });
  const ref = findPageNode(doc, op.nodeId);
  if (!ref) {
    const componentId = componentIdOfNode(doc, op.nodeId);
    if (!componentId) throw invalid({ nodeId: 'Node not found.' });
    const comp = doc.components.find((c) => c.id === componentId)!;
    if (comp.root.id === op.nodeId) throw invalid({ nodeId: 'The component root is deleted with delete_component.' });
    const parent = findComponentParent(comp.root, op.nodeId);
    if (!parent) throw invalid({ nodeId: 'Node not found.' });
    const idx = parent.children.findIndex((c) => c.id === op.nodeId);
    parent.children.splice(idx, 1);
    syncInstances(doc, componentId);
    return { affectsPages: true };
  }
  if (!ref.parent) throw invalid({ nodeId: 'The page root cannot be deleted.' });
  const idx = ref.parent.children.findIndex((n) => n.id === ref.node.id);
  ref.parent.children.splice(idx, 1);
  return { affectsPages: true };
}

function findComponentParent(root: DocumentNode, nodeId: string): DocumentNode | null {
  for (const child of root.children) {
    if (child.id === nodeId) return root;
    const p = findComponentParent(child, nodeId);
    if (p) return p;
  }
  return null;
}

function duplicateNode(ctx: ApplyContext, op: Operation): ApplyResult {
  const doc = ctx.document;
  if (typeof op.nodeId !== 'string') throw invalid({ nodeId: 'Node is required.' });
  const ref = findPageNode(doc, op.nodeId);
  if (!ref) throw invalid({ nodeId: 'Node not found.' });
  if (!ref.parent) throw invalid({ nodeId: 'The page root cannot be duplicated.' });
  if (countNodes(ref.page.root) + countNodes(ref.node) > LIMITS.nodes) {
    throw invalid({ nodeId: 'A page holds at most 500 nodes.' });
  }
  const copy = cloneTreeWithNewIds(ref.node);
  const idx = ref.parent.children.findIndex((n) => n.id === ref.node.id);
  ref.parent.children.splice(idx + 1, 0, copy);
  return { created: { nodeId: copy.id }, affectsPages: true };
}

function renameNode(ctx: ApplyContext, op: Operation): ApplyResult {
  const doc = ctx.document;
  const n = validNameOr(op.name);
  if (!n.ok) throw invalid({ name: 'Names are 1 to 80 characters.' });
  const ref = findPageNode(doc, op.nodeId as string);
  if (!ref) {
    const componentId = componentIdOfNode(doc, op.nodeId as string);
    if (!componentId) throw invalid({ nodeId: 'Node not found.' });
    const node = findAnyNode(doc, op.nodeId as string)!;
    node.name = n.value;
    const comp = doc.components.find((c) => c.id === componentId)!;
    if (node.id === comp.root.id) {
      // renaming a component root inside an instance affects all instances
      for (const page of doc.pages) {
        const visit = (nd: DocumentNode) => {
          if (nd.shared?.componentId === componentId) nd.name = n.value;
          for (const c of nd.children) visit(c);
        };
        visit(page.root);
      }
    }
    syncInstances(doc, componentId);
    return { affectsPages: true };
  }
  ref.node.name = n.value;
  const componentId = ref.node.shared?.componentId;
  if (componentId) {
    const comp = doc.components.find((c) => c.id === componentId)!;
    if (comp.root.id === ref.node.id) {
      comp.root.name = n.value;
      syncInstances(doc, componentId);
    } else {
      const parent = findComponentParent(comp.root, ref.node.id);
      if (parent) {
        const cn = findRaw(comp.root, ref.node.id)!;
        cn.name = n.value;
        syncInstances(doc, componentId);
      }
    }
  }
  return { affectsPages: true };
}

function applyProp(ctx: ApplyContext, node: DocumentNode, prop: string, value: unknown, fields: Record<string, string>): void {
  switch (node.type) {
    case 'heading':
      if (prop === 'text') {
        if (typeof value !== 'string' || value.length > LIMITS.textMax) { fields.value = 'Text is at most 2,000 characters.'; return; }
        node.props.text = value;
        return;
      }
      if (prop === 'level') {
        if (value !== 1 && value !== 2 && value !== 3) { fields.value = 'Level is 1, 2 or 3.'; return; }
        node.props.level = value;
        return;
      }
      break;
    case 'text':
      if (prop === 'text') {
        if (typeof value !== 'string' || value.length > LIMITS.textMax) { fields.value = 'Text is at most 2,000 characters.'; return; }
        node.props.text = value;
        return;
      }
      break;
    case 'button':
      if (prop === 'text') {
        if (typeof value !== 'string' || value.length > LIMITS.textMax) { fields.value = 'Text is at most 2,000 characters.'; return; }
        node.props.text = value;
        return;
      }
      if (prop === 'href') {
        if (typeof value !== 'string' || !isSafeHref(value)) { fields.value = 'Links are http, https, mailto or /-relative.'; return; }
        node.props.href = value;
        return;
      }
      break;
    case 'image':
      if (prop === 'alt') {
        if (typeof value !== 'string' || value.trim().length < 1) { fields.value = 'Alt text is required.'; return; }
        node.props.alt = value;
        return;
      }
      if (prop === 'imageId') {
        if (typeof value !== 'string') { fields.value = 'Image is an image id.'; return; }
        checkImageRef(ctx, value, 'value');
        node.props.imageId = value;
        return;
      }
      if (prop === 'focalX' || prop === 'focalY') {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) { fields.value = 'Focal points are whole numbers 0 to 100.'; return; }
        node.props[prop] = value;
        return;
      }
      break;
    default:
      break;
  }
  fields.value = `${TYPE_LABEL[node.type]} has no ${prop}.`;
}

function setProp(ctx: ApplyContext, op: Operation): ApplyResult {
  const doc = ctx.document;
  if (typeof op.nodeId !== 'string' || typeof op.prop !== 'string') throw invalid({ nodeId: 'Node and prop are required.' });
  const node = findNodeEverywhere(doc, op.nodeId);
  if (!node) throw invalid({ nodeId: 'Node not found.' });
  const fields: Record<string, string> = {};
  applyProp(ctx, node, op.prop, op.value, fields);
  if (Object.keys(fields).length) throw invalid(fields);
  const componentId = node.shared?.componentId ?? componentIdOfNode(doc, node.id);
  if (componentId) {
    const comp = doc.components.find((c) => c.id === componentId)!;
    if (node.shared) {
      // editing the instance updates the component definition, then every instance
      const instanceRoot = findInstanceRoot(doc, node);
      const def = findMatchingDef(doc, comp.root, instanceRoot, node);
      if (def) {
        def.props = { ...node.props };
        def.name = node.name;
        def.type = node.type;
      }
      syncInstances(doc, componentId);
    } else {
      syncInstances(doc, componentId);
    }
  }
  return { affectsPages: true };
}

/** The linked-instance root that contains this node, null for nodes outside instances. */
export function findInstanceRoot(doc: WorkspaceDocument, node: DocumentNode): DocumentNode | null {
  let cur: DocumentNode | null = node;
  let guard = 0;
  while (cur && !cur.shared && guard++ < 2000) {
    const ref = findPageNode(doc, cur.id);
    cur = ref?.parent ?? null;
  }
  return cur && cur.shared ? cur : null;
}

function setStyle(ctx: ApplyContext, op: Operation): ApplyResult {
  const doc = ctx.document;
  if (typeof op.nodeId !== 'string') throw invalid({ nodeId: 'Node is required.' });
  const node = findNodeEverywhere(doc, op.nodeId);
  if (!node) throw invalid({ nodeId: 'Node not found.' });
  const bp = op.breakpoint as Breakpoint;
  if (typeof bp !== 'string' || !BREAKPOINTS.includes(bp)) throw invalid({ breakpoint: 'Unknown breakpoint.' });
  const property = op.property as StyleProperty;
  if (typeof property !== 'string' || !STYLE_PROPERTIES.includes(property)) throw invalid({ property: 'Unknown style property.' });
  const value = op.value;
  if (typeof value !== 'string' && !isTokenRef(value as never)) throw invalid({ value: 'A style value is a string or token reference.' });
  const err = styleValueError(property, value as never, tokenKindLookup(doc));
  if (err) throw invalid({ value: err });
  if (!node.styles[bp]) node.styles[bp] = {};
  node.styles[bp]![property] = value as never;
  syncComponentAfterStyleEdit(doc, node);
  return { affectsPages: true };
}

function clearStyle(ctx: ApplyContext, op: Operation): ApplyResult {
  const doc = ctx.document;
  if (typeof op.nodeId !== 'string') throw invalid({ nodeId: 'Node is required.' });
  const node = findNodeEverywhere(doc, op.nodeId);
  if (!node) throw invalid({ nodeId: 'Node not found.' });
  const bp = op.breakpoint as Breakpoint;
  if (typeof bp !== 'string' || !BREAKPOINTS.includes(bp)) throw invalid({ breakpoint: 'Unknown breakpoint.' });
  const property = op.property as StyleProperty;
  if (typeof property !== 'string' || !STYLE_PROPERTIES.includes(property)) throw invalid({ property: 'Unknown style property.' });
  if (node.styles[bp]) delete node.styles[bp]![property];
  syncComponentAfterStyleEdit(doc, node);
  return { affectsPages: true };
}

/** An edit made inside a component (definition or instance) propagates everywhere. */
function syncComponentAfterStyleEdit(doc: WorkspaceDocument, node: DocumentNode): void {
  const componentId = node.shared?.componentId ?? componentIdOfNode(doc, node.id);
  if (!componentId) return;
  const comp = doc.components.find((c) => c.id === componentId);
  if (!comp) return;
  if (node.shared) {
    const instanceRoot = findInstanceRoot(doc, node);
    const defNode = findMatchingDef(doc, comp.root, instanceRoot, node);
    if (defNode) defNode.styles = cloneStyles(node.styles);
  }
  syncInstances(doc, componentId);
}

/** Match an instance node to its definition node by position within the instance tree. */
function findMatchingDef(doc: WorkspaceDocument, compRoot: DocumentNode, instanceRoot: DocumentNode | null, target: DocumentNode): DocumentNode | null {
  if (!instanceRoot) return null;
  if (target.id === instanceRoot.id) return compRoot;
  const path: number[] = [];
  let cur = target;
  let guard = 0;
  while (cur.id !== instanceRoot.id && guard++ < 1000) {
    const ref = findPageNode(doc, cur.id);
    if (!ref || !ref.parent) return null;
    path.unshift(ref.parent.children.findIndex((c) => c.id === cur.id));
    cur = ref.parent;
  }
  if (cur.id !== instanceRoot.id) return null;
  let def = compRoot;
  for (const idx of path) {
    if (idx < 0 || idx >= def.children.length) return null;
    def = def.children[idx];
  }
  return def;
}

function setToken(ctx: ApplyContext, op: Operation): ApplyResult {
  const doc = ctx.document;
  const fields: Record<string, string> = {};
  const name = typeof op.name === 'string' ? op.name : '';
  if (!/^[a-z0-9-]{1,40}$/.test(name)) fields.name = 'Token names are 1 to 40 lowercase letters, digits or hyphens.';
  const kind = op.tokenKind;
  if (kind !== 'color' && kind !== 'size') fields.kind = 'Token kinds are color or size.';
  const existing = tokenByName(doc, name);
  if (existing && existing.kind !== kind) fields.kind = `${name} already exists as a ${existing.kind} token.`;
  if (Object.keys(fields).length) throw invalid(fields);
  if (kind === 'color') {
    const v = op.value;
    if (typeof v !== 'string' || !new Set(NAMED_COLORS).has(v)) throw invalid({ value: 'Colour tokens take a CSS named colour.' });
    if (op.unit !== undefined && op.unit !== null) throw invalid({ unit: 'Colour tokens have no unit.' });
    if (existing) existing.value = v;
    else if (doc.tokens.length < LIMITS.tokens) doc.tokens.push({ name, kind: 'color', value: v });
    else throw invalid({ name: 'A workspace holds at most 40 tokens.' });
    return { affectsPages: true };
  }
  const v = op.value;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 999 || Math.round(v * 1000) / 1000 !== v) {
    throw invalid({ value: 'Size tokens take a number 0 to 999 with up to 3 decimals.' });
  }
  const unit = op.unit;
  if (unit !== 'px' && unit !== 'rem') throw invalid({ unit: 'Size token units are px or rem.' });
  if (existing) { existing.value = v; existing.unit = unit; }
  else if (doc.tokens.length < LIMITS.tokens) doc.tokens.push({ name, kind: 'size', value: v, unit });
  else throw invalid({ name: 'A workspace holds at most 40 tokens.' });
  return { affectsPages: true };
}

function renameToken(ctx: ApplyContext, op: Operation): ApplyResult {
  const doc = ctx.document;
  if (typeof op.name !== 'string' || typeof op.newName !== 'string') throw invalid({ name: 'Token names are required.' });
  const t = tokenByName(doc, op.name);
  if (!t) throw invalid({ name: 'Token not found.' });
  if (!/^[a-z0-9-]{1,40}$/.test(op.newName)) throw invalid({ newName: 'Token names are 1 to 40 lowercase letters, digits or hyphens.' });
  if (op.newName !== op.name && tokenByName(doc, op.newName)) throw invalid({ newName: `${op.newName} already exists.` });
  if (op.newName !== op.name) {
    t.name = op.newName;
    rewriteTokenRefs(doc, op.name, op.newName);
  }
  return { affectsPages: true };
}

export function rewriteTokenRefs(doc: WorkspaceDocument, from: string, to: string): void {
  const visit = (node: DocumentNode) => {
    for (const bp of BREAKPOINTS) {
      const styles = node.styles[bp];
      if (!styles) continue;
      for (const [k, v] of Object.entries(styles)) {
        if (isTokenRef(v as never) && (v as { token: string }).token === from) {
          styles[k] = { token: to };
        }
      }
    }
    for (const c of node.children) visit(c);
  };
  for (const page of doc.pages) visit(page.root);
  for (const comp of doc.components) visit(comp.root);
}

function deleteToken(ctx: ApplyContext, op: Operation): ApplyResult {
  const doc = ctx.document;
  if (typeof op.name !== 'string') throw invalid({ name: 'Token name is required.' });
  const t = tokenByName(doc, op.name);
  if (!t) throw invalid({ name: 'Token not found.' });
  const uses = tokenUseCount(doc, op.name);
  if (uses > 0) throw conflictError('token_in_use', `Can't delete ${op.name}: it is used ${uses} times.`);
  doc.tokens = doc.tokens.filter((x) => x.name !== op.name);
  return { affectsPages: true };
}

function createComponent(ctx: ApplyContext, op: Operation): ApplyResult {
  const doc = ctx.document;
  const n = validNameOr(op.name);
  if (!n.ok) throw invalid({ name: 'Names are 1 to 80 characters.' });
  if (typeof op.nodeId !== 'string') throw invalid({ nodeId: 'Node is required.' });
  const ref = findPageNode(doc, op.nodeId);
  if (!ref) throw invalid({ nodeId: 'Node not found.' });
  if (!ref.parent) throw invalid({ nodeId: 'The page root cannot become a component.' });
  const componentId = newId('cp');
  const rootCopy = cloneTreeWithNewIds(ref.node, false);
  doc.components.push({ id: componentId, name: n.value, root: rootCopy });
  ref.node.shared = { componentId };
  return { created: { componentId }, affectsPages: true };
}

function detachInstance(ctx: ApplyContext, op: Operation): ApplyResult {
  const doc = ctx.document;
  if (typeof op.nodeId !== 'string') throw invalid({ nodeId: 'Node is required.' });
  const ref = findPageNode(doc, op.nodeId);
  if (!ref) throw invalid({ nodeId: 'Node not found.' });
  if (!ref.node.shared) throw invalid({ nodeId: 'That node is not a linked instance.' });
  delete ref.node.shared;
  return { affectsPages: true };
}

function deleteComponent(ctx: ApplyContext, op: Operation): ApplyResult {
  const doc = ctx.document;
  if (typeof op.componentId !== 'string') throw invalid({ componentId: 'Component is required.' });
  const comp = doc.components.find((c) => c.id === op.componentId);
  if (!comp) throw invalid({ componentId: 'Component not found.' });
  const count = countInstances(doc, comp.id);
  if (count > 0) throw conflictError('component_in_use', `Can't delete ${comp.name}: ${count} instances still link to it.`);
  doc.components = doc.components.filter((c) => c.id !== comp.id);
  return { affectsPages: false };
}

function setFields(ctx: ApplyContext, op: Operation): ApplyResult {
  const doc = ctx.document;
  if (!Array.isArray(op.fields)) throw invalid({ fields: 'Fields must be a list.' });
  if (op.fields.length > LIMITS.fields) throw invalid({ fields: 'A collection holds at most 20 fields.' });
  const fields: Record<string, string> = {};
  const seen = new Set<string>();
  const out: { name: string; kind: 'text' | 'rich_text' | 'image' }[] = [];
  op.fields.forEach((f, i) => {
    if (typeof f !== 'object' || f === null) { fields[`fields.${i}`] = 'A field is an object.'; return; }
    const name = validNameOr((f as { name?: unknown }).name);
    if (!name.ok) { fields[`fields.${i}.name`] = 'Field names are 1 to 80 characters.'; return; }
    const kind = (f as { kind?: unknown }).kind;
    if (kind !== 'text' && kind !== 'rich_text' && kind !== 'image') { fields[`fields.${i}.kind`] = 'Field kinds are text, rich_text or image.'; return; }
    if (seen.has(name.value)) { fields[`fields.${i}.name`] = 'Field names are unique.'; return; }
    seen.add(name.value);
    out.push({ name: name.value, kind });
  });
  if (Object.keys(fields).length) throw invalid(fields);
  for (const f of doc.collection.fields) {
    if (!out.some((x) => x.name === f.name)) {
      const uses = countFieldBinds(doc, f.name);
      if (uses > 0) throw conflictError('field_in_use', `Can't remove ${f.name}: it is bound ${uses} times.`);
    }
  }
  doc.collection.fields = out;
  return { affectsPages: true };
}

export function countFieldBinds(doc: WorkspaceDocument, fieldName: string): number {
  let n = 0;
  const visit = (node: DocumentNode) => {
    for (const v of Object.values(node.bind ?? {})) if (v === fieldName) n++;
    for (const c of node.children) visit(c);
  };
  for (const page of doc.pages) visit(page.root);
  return n;
}

function putEntry(ctx: ApplyContext, op: Operation): ApplyResult {
  const doc = ctx.document;
  const values = op.values;
  if (typeof values !== 'object' || values === null || Array.isArray(values)) throw invalid({ values: 'Values must be an object.' });
  const fields: Record<string, string> = {};
  const clean: Record<string, string> = {};
  for (const f of doc.collection.fields) {
    const v = (values as Record<string, unknown>)[f.name];
    if (v === undefined || v === null) continue;
    if (f.kind === 'rich_text') {
      if (typeof v !== 'string') { fields[f.name] = 'Rich text is a string.'; continue; }
      const filtered = filterRichText(v);
      if (filtered.length > LIMITS.richMax) { fields[f.name] = 'Rich text is at most 2,000 characters.'; continue; }
      clean[f.name] = filtered;
    } else if (f.kind === 'text') {
      if (typeof v !== 'string') { fields[f.name] = 'Text is a string.'; continue; }
      if (v.length > LIMITS.textMax) { fields[f.name] = 'Text is at most 2,000 characters.'; continue; }
      clean[f.name] = v;
    } else {
      if (typeof v !== 'string') { fields[f.name] = 'Image is an image id.'; continue; }
      checkImageRef(ctx, v, f.name);
      clean[f.name] = v;
    }
  }
  for (const key of Object.keys(values as Record<string, unknown>)) {
    if (!doc.collection.fields.some((f) => f.name === key)) fields[key] = `${key} is not a field.`;
  }
  if (Object.keys(fields).length) throw invalid(fields);
  if (op.entryId === undefined || op.entryId === null) {
    if (doc.collection.entries.length >= LIMITS.entries) throw invalid({ entryId: 'A collection holds at most 200 entries.' });
    const entry = { id: newId('e'), order: doc.collection.entries.length, values: clean };
    doc.collection.entries.push(entry);
    return { created: { entryId: entry.id }, affectsPages: true };
  }
  const entry = doc.collection.entries.find((e) => e.id === op.entryId);
  if (!entry) throw invalid({ entryId: 'Entry not found.' });
  entry.values = clean;
  return { affectsPages: true };
}

function moveEntry(ctx: ApplyContext, op: Operation): ApplyResult {
  const doc = ctx.document;
  const sorted = [...doc.collection.entries].sort((a, b) => a.order - b.order);
  const from = sorted.findIndex((e) => e.id === op.entryId);
  if (from === -1) throw invalid({ entryId: 'Entry not found.' });
  const index = op.index as number;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= sorted.length) {
    throw invalid({ index: 'Index is out of range.' });
  }
  const [entry] = sorted.splice(from, 1);
  sorted.splice(index, 0, entry);
  sorted.forEach((e, i) => { e.order = i; });
  return { affectsPages: true };
}

function deleteEntry(ctx: ApplyContext, op: Operation): ApplyResult {
  const doc = ctx.document;
  const idx = doc.collection.entries.findIndex((e) => e.id === op.entryId);
  if (idx === -1) throw invalid({ entryId: 'Entry not found.' });
  doc.collection.entries.splice(idx, 1);
  [...doc.collection.entries].sort((a, b) => a.order - b.order).forEach((e, i) => { e.order = i; });
  return { affectsPages: true };
}

function bindProp(ctx: ApplyContext, op: Operation): ApplyResult {
  const doc = ctx.document;
  if (typeof op.nodeId !== 'string') throw invalid({ nodeId: 'Node is required.' });
  const ref = findPageNode(doc, op.nodeId);
  if (!ref) throw invalid({ nodeId: 'Node not found.' });
  const main = mainPropOf(ref.node.type);
  if (main === null || op.prop !== main) throw invalid({ prop: `${main ? `Only ${main} can be bound` : 'This node has no bindable prop'}.` });
  if (op.field === null || op.field === undefined) {
    if (ref.node.bind) delete ref.node.bind[op.prop];
    return { affectsPages: true };
  }
  const field = doc.collection.fields.find((f) => f.name === op.field);
  if (!field) throw invalid({ field: 'Field not found.' });
  if (ref.node.type === 'image') {
    if (field.kind !== 'image') throw invalid({ field: 'Images bind to image fields.' });
  } else if (ref.node.type === 'text') {
    if (field.kind !== 'text' && field.kind !== 'rich_text') throw invalid({ field: 'Text binds to text or rich-text fields.' });
  } else {
    if (field.kind !== 'text') throw invalid({ field: 'Headings and buttons bind to text fields.' });
  }
  let cur: DocumentNode | null = ref.parent;
  while (cur) {
    if (cur.type === 'collection_list') break;
    const up = findPageNode(doc, cur.id);
    cur = up?.parent ?? null;
  }
  if (!cur || cur.type !== 'collection_list') throw invalid({ nodeId: 'Bindings live inside a collection list template.' });
  ref.node.bind = { ...(ref.node.bind ?? {}), [op.prop]: op.field as string };
  return { affectsPages: true };
}

function addPage(ctx: ApplyContext, op: Operation): ApplyResult {
  const doc = ctx.document;
  const n = validNameOr(op.name);
  if (!n.ok) throw invalid({ name: 'Names are 1 to 80 characters.' });
  if (doc.pages.length >= LIMITS.pages) throw invalid({ name: 'A workspace holds at most 20 pages.' });
  const pageId = newId('pg');
  const nodeId = newId('n');
  let slug = slugify(n.value);
  let suffix = 2;
  while (doc.pages.some((p) => p.slug === slug)) slug = `${slugify(n.value)}-${suffix++}`;
  doc.pages.push({
    id: pageId, name: n.value, slug, order: doc.pages.length,
    root: { id: nodeId, type: 'page', name: n.value, props: {}, styles: {}, children: [] },
  });
  return { created: { pageId, nodeId }, affectsPages: false };
}

function renamePage(ctx: ApplyContext, op: Operation): ApplyResult {
  const doc = ctx.document;
  const n = validNameOr(op.name);
  if (!n.ok) throw invalid({ name: 'Names are 1 to 80 characters.' });
  const page = doc.pages.find((p) => p.id === op.pageId);
  if (!page) throw invalid({ pageId: 'Page not found.' });
  page.name = n.value;
  page.root.name = n.value;
  return { affectsPages: true };
}
