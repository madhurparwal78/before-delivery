import {
  canClearOverride,
  reachOfChange,
  reachOfClear,
  resolveStyle,
} from '../../shared/breakpoints.js';
import { notices } from '../../shared/notices.js';
import type { PublicOp } from '../../shared/ops.js';
import { styleValueText, tokenCssValue } from '../../shared/style.js';
import {
  accepts,
  componentOfNode,
  findNode,
  isInSubtree,
  linkedInstances,
} from '../../shared/tree.js';
import { countTokenUses } from '../../shared/usage.js';
import type {
  Breakpoint,
  Field,
  NodeType,
  PlinthNode,
  Props,
  SizeUnit,
  StyleKey,
  StyleValue,
  TokenKind,
} from '../../shared/types.js';
import { scrollNodeIntoView } from './canvas.js';
import { fanShowing, pulsePips, rippleFrames } from './fan.js';
import { focusNodeRow } from './navigator.js';
import {
  canEdit,
  currentPage,
  nodeById,
  render,
  sayWithToast,
  selectedNode,
  send,
  sendLive,
  state,
  syncUrl,
} from './store.js';

function fire(body: PublicOp): void {
  void send(body).catch(() => undefined);
}

function instanceNotice(nodeId: string): void {
  const component = componentOfNode(state.doc, nodeId);
  if (!component) return;
  const count = linkedInstances(state.doc, component.id).length;
  sayWithToast(notices.sharedEdit(count, component.name));
}

export function selectNode(nodeId: string): void {
  state.selectedId = nodeId;
  sendLive({ type: 'select', nodeId });
  render();
  scrollNodeIntoView(nodeId);
}

interface Target {
  parentId: string;
  index: number;
}

/** Where the Add menu puts a new node of this type. */
export function insertTarget(type: NodeType): Target {
  const page = currentPage();
  if (!page) return { parentId: '', index: 0 };
  const selected = selectedNode();
  if (!selected) return { parentId: page.root.id, index: page.root.children.length };
  if (accepts(selected, type)) {
    return { parentId: selected.id, index: selected.children.length };
  }
  let candidate: PlinthNode | undefined = selected;
  while (candidate !== undefined) {
    const hit = findNode(state.doc, candidate.id);
    if (!hit?.parent) break;
    if (accepts(hit.parent, type)) return { parentId: hit.parent.id, index: hit.index + 1 };
    candidate = hit.parent;
  }
  return { parentId: page.root.id, index: page.root.children.length };
}

export async function insertNodeAt(
  type: NodeType,
  parentId: string,
  index: number,
  props?: Props,
): Promise<void> {
  const page = currentPage();
  if (!page || !canEdit()) return;
  const ack = await send({
    kind: 'insert_node',
    pageId: page.id,
    parentId,
    index,
    type,
    ...(props === undefined ? {} : { props }),
  });
  const nodeId = ack.created?.['nodeId'];
  if (nodeId === undefined) return;
  state.selectedId = nodeId;
  sendLive({ type: 'select', nodeId });
  render();
  const node = nodeById(nodeId);
  if (node) sayWithToast(notices.inserted(node.name));
  instanceNotice(nodeId);
  focusNodeRow(nodeId);
}

export async function insertNode(type: NodeType, props?: Props): Promise<void> {
  const target = insertTarget(type);
  await insertNodeAt(type, target.parentId, target.index, props);
}

export async function insertInstance(componentId: string): Promise<void> {
  const page = currentPage();
  if (!page || !canEdit()) return;
  const component = state.doc.components.find((item) => item.id === componentId);
  if (!component) return;
  const target = insertTarget(component.root.type);
  const ack = await send({
    kind: 'insert_instance',
    pageId: page.id,
    parentId: target.parentId,
    index: target.index,
    componentId,
  });
  const nodeId = ack.created?.['nodeId'];
  if (nodeId === undefined) return;
  state.selectedId = nodeId;
  render();
  const node = nodeById(nodeId);
  if (node) sayWithToast(notices.inserted(node.name));
  focusNodeRow(nodeId);
}

function refuse(node: PlinthNode): void {
  sayWithToast(notices.refusedMove(node.name));
}

export function moveAllowed(nodeId: string, parentId: string, index: number): boolean {
  const node = nodeById(nodeId);
  const parent = nodeById(parentId);
  if (!node || !parent) return false;
  if (!accepts(parent, node.type)) return false;
  if (findNode(state.doc, parentId) === undefined) return false;
  if (nodeId === parentId) return false;
  if (findNode(state.doc, nodeId)?.parent === null) return false;
  if (isInSubtree(node, parentId)) return false;
  const here = findNode(state.doc, nodeId)!;
  const siblings = here.parent?.id === parentId ? parent.children.length - 1 : parent.children.length;
  return index >= 0 && index <= siblings;
}

export function moveNodeTo(nodeId: string, parentId: string, index: number): void {
  const node = nodeById(nodeId);
  if (!node || !canEdit()) return;
  if (!moveAllowed(nodeId, parentId, index)) {
    refuse(node);
    return;
  }
  fire({ kind: 'move_node', nodeId, parentId, index });
  const parent = nodeById(parentId);
  const position = (parent?.children.findIndex((child) => child.id === nodeId) ?? 0) + 1;
  sayWithToast(
    notices.moved(node.name, position, parent?.children.length ?? 1, parent?.name ?? ''),
  );
  instanceNotice(nodeId);
  focusNodeRow(nodeId);
}

export type MoveDirection = 'up' | 'down' | 'indent' | 'outdent';

export function moveByKeyboard(nodeId: string, direction: MoveDirection): void {
  const node = nodeById(nodeId);
  if (!node || !canEdit()) return;
  const hit = findNode(state.doc, nodeId);
  if (!hit || !hit.parent) {
    refuse(node);
    return;
  }
  const parent = hit.parent;
  if (direction === 'up' || direction === 'down') {
    const index = direction === 'up' ? hit.index - 1 : hit.index + 1;
    if (index < 0 || index > parent.children.length - 1) {
      refuse(node);
      return;
    }
    moveNodeTo(nodeId, parent.id, index);
    return;
  }
  if (direction === 'indent') {
    const previous = parent.children[hit.index - 1];
    if (!previous || !accepts(previous, node.type)) {
      refuse(node);
      return;
    }
    moveNodeTo(nodeId, previous.id, previous.children.length);
    return;
  }
  const grandparent = findNode(state.doc, parent.id)?.parent;
  if (!grandparent) {
    refuse(node);
    return;
  }
  const parentIndex = grandparent.children.findIndex((child) => child.id === parent.id);
  moveNodeTo(nodeId, grandparent.id, parentIndex + 1);
}

export function deleteNode(nodeId: string): void {
  const node = nodeById(nodeId);
  if (!node || !canEdit()) return;
  const hit = findNode(state.doc, nodeId);
  if (!hit || !hit.parent) return;
  const parentId = hit.parent.id;
  const index = hit.index;
  fire({ kind: 'delete_node', nodeId });
  sayWithToast(notices.deleted(node.name));
  const parent = nodeById(parentId);
  const successor = parent?.children[index] ?? parent?.children[index - 1];
  state.selectedId = successor?.id ?? parentId;
  render();
  focusNodeRow(state.selectedId);
}

export async function duplicateNode(nodeId: string): Promise<void> {
  if (!canEdit()) return;
  const ack = await send({ kind: 'duplicate_node', nodeId });
  const copyId = ack.created?.['nodeId'];
  if (copyId === undefined) return;
  state.selectedId = copyId;
  render();
  instanceNotice(copyId);
  focusNodeRow(copyId);
}

export async function renameNode(nodeId: string, name: string): Promise<void> {
  if (!canEdit()) return;
  await send({ kind: 'rename_node', nodeId, name });
  instanceNotice(nodeId);
}

export function setStyleValue(nodeId: string, property: StyleKey, value: StyleValue): void {
  const node = nodeById(nodeId);
  if (!node || !canEdit()) return;
  const bp = state.bp;
  fire({ kind: 'set_style', nodeId, breakpoint: bp, property, value });
  const updated = nodeById(nodeId);
  if (!updated) return;
  const groups = reachOfChange(updated, bp, property);
  if (fanShowing()) {
    rippleFrames(groups.inherited);
    pulsePips(groups.kept, property);
    sayWithToast(notices.cascade(property, bp, groups.inherited, groups.kept));
  }
  instanceNotice(nodeId);
}

export function clearStyleValue(nodeId: string, property: StyleKey): void {
  const node = nodeById(nodeId);
  if (!node || !canEdit()) return;
  const bp = state.bp;
  if (!canClearOverride(node, bp, property)) return;
  fire({ kind: 'clear_style', nodeId, breakpoint: bp, property });
  const updated = nodeById(nodeId);
  if (!updated) return;
  const frames = reachOfClear(updated, bp, property);
  if (fanShowing()) rippleFrames(frames);
  sayWithToast(
    notices.overrideCleared(property, bp, styleValueText(resolveStyle(updated, bp, property))),
  );
  instanceNotice(nodeId);
}

export function setPropValue(nodeId: string, prop: string, value: string | number): void {
  if (!canEdit()) return;
  fire({ kind: 'set_prop', nodeId, prop, value });
  instanceNotice(nodeId);
}

export function bindProp(nodeId: string, prop: string, field: string | null): void {
  if (!canEdit()) return;
  fire({ kind: 'bind_prop', nodeId, prop, field });
  instanceNotice(nodeId);
}

export function setToken(
  name: string,
  tokenKind: TokenKind,
  value: string | number,
  unit?: SizeUnit,
): void {
  if (!canEdit()) return;
  fire(
    tokenKind === 'size'
      ? { kind: 'set_token', name, tokenKind, value, unit: unit ?? 'px' }
      : { kind: 'set_token', name, tokenKind, value },
  );
  const token = state.doc.tokens.find((item) => item.name === name);
  if (!token) return;
  sayWithToast(notices.token(name, tokenCssValue(token), countTokenUses(state.doc, name)));
}

export function renameToken(name: string, newName: string): void {
  if (!canEdit()) return;
  fire({ kind: 'rename_token', name, newName });
}

export function deleteToken(name: string): void {
  if (!canEdit()) return;
  const uses = countTokenUses(state.doc, name);
  if (uses > 0) {
    sayWithToast(notices.tokenInUse(name, uses));
    return;
  }
  fire({ kind: 'delete_token', name });
}

export async function createComponent(nodeId: string, name: string): Promise<void> {
  if (!canEdit()) return;
  await send({ kind: 'create_component', nodeId, name });
  instanceNotice(nodeId);
  render();
}

export function detachInstance(nodeId: string): void {
  if (!canEdit()) return;
  fire({ kind: 'detach_instance', nodeId });
  render();
}

export function setFields(fields: Field[]): void {
  if (!canEdit()) return;
  fire({ kind: 'set_fields', fields });
}

export async function putEntry(
  entryId: string | undefined,
  values: Record<string, string>,
): Promise<void> {
  if (!canEdit()) return;
  await send(entryId === undefined ? { kind: 'put_entry', values } : { kind: 'put_entry', entryId, values });
}

export function moveEntry(entryId: string, index: number): void {
  if (!canEdit()) return;
  fire({ kind: 'move_entry', entryId, index });
}

export function deleteEntry(entryId: string): void {
  if (!canEdit()) return;
  fire({ kind: 'delete_entry', entryId });
}

export async function addPage(): Promise<void> {
  if (!canEdit()) return;
  const count = state.doc.pages.length + 1;
  const ack = await send({ kind: 'add_page', name: `Page ${count}` });
  const pageId = ack.created?.['pageId'];
  if (pageId === undefined) return;
  state.pageId = pageId;
  state.selectedId = ack.created?.['nodeId'] ?? null;
  render();
}

export async function undo(): Promise<void> {
  if (!canEdit()) return;
  await send({ kind: 'undo' }).catch(() => undefined);
  render();
}

export async function redo(): Promise<void> {
  if (!canEdit()) return;
  await send({ kind: 'redo' }).catch(() => undefined);
  render();
}

export function chooseBreakpoint(bp: Breakpoint): void {
  state.bp = bp;
  syncUrl();
  render();
}
