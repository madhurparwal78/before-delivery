import {
  OpFailure,
  bindableFieldKinds,
  defaultNodeName,
  defaultPropsFor,
  invalid,
  invalidMove,
  mainPropOf,
  notFound,
  parsePropValue,
  propsOfType,
  type Op,
} from './ops.js';
import { filterRichText } from './richtext.js';
import { countFieldBindings, countTokenUses } from './usage.js';
import { uniqueSlug } from './slug.js';
import { findToken } from './style.js';
import { STYLE_TOKEN_KIND } from './style.js';
import {
  accepts,
  allNodes,
  cloneNode,
  countOfType,
  emptyStyles,
  findComponent,
  findNode,
  findPage,
  instanceContextOf,
  isInSubtree,
  linkedInstances,
  mirrorsOf,
  pageOf,
} from './tree.js';
import type {
  Collection,
  Entry,
  Page,
  PlinthDocument,
  PlinthNode,
  Props,
  Token,
} from './types.js';

export type IdPrefix = 'n' | 'pg' | 'cp' | 'e';

export interface ImageIndex {
  confirmed: ReadonlySet<string>;
  known: ReadonlySet<string>;
}

export interface ApplyContext {
  newId(prefix: IdPrefix): string;
  /** Present on the server, which validates image references. */
  images?: ImageIndex;
}

export interface ApplyResult {
  created?: Record<string, string>;
  inverse: Op[];
}

const MAX_NODES_PER_PAGE = 500;
const MAX_PAGES = 20;
const MAX_TOKENS = 40;
const MAX_ENTRIES = 200;

function needNode(doc: PlinthDocument, nodeId: string): PlinthNode {
  const hit = findNode(doc, nodeId);
  if (!hit) throw notFound();
  return hit.node;
}

function parentOf(doc: PlinthDocument, nodeId: string): { parent: PlinthNode; index: number } {
  const hit = findNode(doc, nodeId);
  if (!hit) throw notFound();
  if (!hit.parent) throw invalid({ nodeId: 'The page root cannot be changed that way.' });
  return { parent: hit.parent, index: hit.index };
}

function needPage(doc: PlinthDocument, pageId: string): Page {
  const page = findPage(doc, pageId);
  if (!page) throw notFound();
  return page;
}

function checkImageRef(ctx: ApplyContext, imageId: string, path: string): void {
  if (imageId === '' || ctx.images === undefined) return;
  if (!ctx.images.known.has(imageId)) throw notFound();
  if (!ctx.images.confirmed.has(imageId)) {
    throw new OpFailure(422, 'image_not_confirmed', 'That image is not confirmed yet.', {
      [path]: 'That image is not confirmed yet.',
    });
  }
}

function checkPageSize(doc: PlinthDocument, nodeId: string): void {
  const page = pageOf(doc, nodeId);
  if (page && allNodes(page.root).length > MAX_NODES_PER_PAGE) {
    throw invalid({ parentId: 'A page holds at most 500 nodes.' });
  }
}

function mirrorNodes(doc: PlinthDocument, nodeId: string): PlinthNode[] {
  return mirrorsOf(doc, nodeId).map((id) => needNode(doc, id));
}

function nodeIsInstanceRoot(node: PlinthNode): boolean {
  return node.shared !== undefined;
}

function validateMove(
  parent: PlinthNode,
  index: number,
  childType: PlinthNode['type'],
): void {
  if (!accepts(parent, childType)) throw invalidMove({ parentId: "That parent can't take it." });
  if (index > parent.children.length) throw invalidMove({ index: 'That index is out of range.' });
}

function makeNode(
  ctx: ApplyContext,
  type: PlinthNode['type'],
  name: string,
  props: Props,
): PlinthNode {
  return { id: ctx.newId('n'), type, name, props, styles: emptyStyles(), children: [] };
}

function validatedProps(
  ctx: ApplyContext,
  type: PlinthNode['type'],
  given: Props,
  name: string,
): Props {
  const props = { ...defaultPropsFor(type, name), ...given };
  for (const key of Object.keys(props)) {
    if (!propsOfType(type).includes(key)) throw invalid({ [`props.${key}`]: 'Unknown prop.' });
  }
  if (type === 'image') {
    const imageId = String(props['imageId'] ?? '');
    checkImageRef(ctx, imageId, 'props.imageId');
    if (String(props['alt'] ?? '').trim() === '') {
      throw invalid({ 'props.alt': 'Alt text is required.' });
    }
  }
  return props;
}

function orderEntries(collection: Collection): void {
  collection.entries.forEach((entry, i) => {
    entry.order = i;
  });
}

function entryValues(
  doc: PlinthDocument,
  ctx: ApplyContext,
  values: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(values)) {
    const field = doc.collection.fields.find((f) => f.name === key);
    if (!field) throw invalid({ [`values.${key}`]: 'Unknown field.' });
    if (field.kind === 'image') {
      checkImageRef(ctx, raw, `values.${key}`);
      out[key] = raw;
      continue;
    }
    if (field.kind === 'rich_text') {
      const filtered = filterRichText(raw);
      if (filtered.length > 2000) {
        throw invalid({ [`values.${key}`]: 'Use 2,000 characters or fewer.' });
      }
      out[key] = filtered;
      continue;
    }
    if (raw.length > 2000) throw invalid({ [`values.${key}`]: 'Use 2,000 characters or fewer.' });
    out[key] = raw;
  }
  return out;
}

function insertAt(parent: PlinthNode, index: number, node: PlinthNode): void {
  parent.children.splice(index, 0, node);
}

function detachNode(doc: PlinthDocument, nodeId: string): { parent: PlinthNode; index: number } {
  const { parent, index } = parentOf(doc, nodeId);
  parent.children.splice(index, 1);
  return { parent, index };
}

function sameInstance(doc: PlinthDocument, nodeId: string, parentId: string): boolean {
  const a = instanceContextOf(doc, nodeId);
  const b = instanceContextOf(doc, parentId);
  return a !== undefined && b !== undefined && a.instanceRoot.id === b.instanceRoot.id;
}

function tokenOf(doc: PlinthDocument, name: string): Token | undefined {
  return findToken(doc.tokens, name);
}

function rewriteTokenName(doc: PlinthDocument, from: string, to: string): void {
  for (const node of [
    ...doc.pages.flatMap((page) => allNodes(page.root)),
    ...doc.components.flatMap((component) => allNodes(component.root)),
  ]) {
    for (const bp of ['desktop', 'tablet', 'phone'] as const) {
      for (const [key, value] of Object.entries(node.styles[bp])) {
        if (value !== undefined && typeof value !== 'string' && value.token === from) {
          node.styles[bp][key as keyof typeof node.styles.desktop] = { token: to };
        }
      }
    }
  }
}

/** Applies one operation to the document in place and returns how to reverse it. */
export function applyOp(doc: PlinthDocument, op: Op, ctx: ApplyContext): ApplyResult {
  switch (op.kind) {
    case 'insert_node': {
      const page = needPage(doc, op.pageId);
      const parent = needNode(doc, op.parentId);
      validateMove(parent, op.index, op.type);
      const name = op.name ?? defaultNodeName(op.type, countOfType(page, op.type));
      const props = validatedProps(ctx, op.type, op.props ?? {}, name);
      let createdId = '';
      for (const mirror of mirrorNodes(doc, op.parentId)) {
        const node = makeNode(ctx, op.type, name, { ...props });
        if (op.type === 'collection_list') {
          node.children.push(makeNode(ctx, 'stack', 'Template', {}));
        }
        insertAt(mirror, Math.min(op.index, mirror.children.length), node);
        if (createdId === '') createdId = node.id;
      }
      checkPageSize(doc, createdId);
      return { created: { nodeId: createdId }, inverse: [{ kind: 'delete_node', nodeId: createdId }] };
    }
    case 'insert_instance': {
      needPage(doc, op.pageId);
      const component = findComponent(doc, op.componentId);
      if (!component) throw notFound();
      const parent = needNode(doc, op.parentId);
      validateMove(parent, op.index, component.root.type);
      const node = cloneNode(component.root, () => ctx.newId('n'));
      node.shared = { componentId: component.id };
      insertAt(parent, op.index, node);
      checkPageSize(doc, node.id);
      return { created: { nodeId: node.id }, inverse: [{ kind: 'delete_node', nodeId: node.id }] };
    }
    case 'move_node': {
      const node = needNode(doc, op.nodeId);
      const here = findNode(doc, op.nodeId)!;
      if (!here.parent) throw invalidMove({ parentId: 'The page root cannot be moved.' });
      const newParent = needNode(doc, op.parentId);
      if (isInSubtree(node, op.parentId)) {
        throw invalidMove({ parentId: "A node can't move into itself." });
      }
      validateMove(newParent, op.index, node.type);
      const oldParentId = here.parent.id;
      const oldIndex = here.index;
      const propagate = !nodeIsInstanceRoot(node) && sameInstance(doc, op.nodeId, op.parentId);
      if (propagate) {
        const nodes = mirrorsOf(doc, op.nodeId);
        const parents = mirrorsOf(doc, op.parentId);
        for (let i = 0; i < nodes.length; i += 1) {
          const target = needNode(doc, nodes[i]!);
          const parentNode = needNode(doc, parents[i] ?? parents[0]!);
          detachNode(doc, target.id);
          insertAt(parentNode, Math.min(op.index, parentNode.children.length), target);
        }
      } else {
        detachNode(doc, op.nodeId);
        insertAt(newParent, Math.min(op.index, newParent.children.length), node);
      }
      checkPageSize(doc, op.nodeId);
      return {
        inverse: [
          { kind: 'move_node', nodeId: op.nodeId, parentId: oldParentId, index: oldIndex },
        ],
      };
    }
    case 'delete_node': {
      const node = needNode(doc, op.nodeId);
      const hit = findNode(doc, op.nodeId)!;
      if (!hit.parent) throw invalid({ nodeId: 'The page root cannot be deleted.' });
      const inverse: Op[] = [];
      const targets = nodeIsInstanceRoot(node) ? [op.nodeId] : mirrorsOf(doc, op.nodeId);
      for (const id of targets) {
        const target = findNode(doc, id);
        if (!target || !target.parent) continue;
        const snapshot = JSON.parse(JSON.stringify(target.node)) as PlinthNode;
        inverse.push({
          kind: 'restore_subtree',
          parentId: target.parent.id,
          index: target.index,
          node: snapshot,
        });
        target.parent.children.splice(target.index, 1);
      }
      return { inverse };
    }
    case 'restore_subtree': {
      needNode(doc, op.parentId);
      const mirrors = mirrorsOf(doc, op.parentId);
      let first = '';
      for (const [i, parentId] of mirrors.entries()) {
        const mirrorParent = needNode(doc, parentId);
        const node =
          i === 0
            ? (JSON.parse(JSON.stringify(op.node)) as PlinthNode)
            : cloneNode(op.node, () => ctx.newId('n'));
        insertAt(mirrorParent, Math.min(op.index, mirrorParent.children.length), node);
        if (first === '') first = node.id;
      }
      return { inverse: [{ kind: 'delete_node', nodeId: first }] };
    }
    case 'duplicate_node': {
      const node = needNode(doc, op.nodeId);
      const hit = findNode(doc, op.nodeId)!;
      if (!hit.parent) throw invalid({ nodeId: 'The page root cannot be duplicated.' });
      let createdId = '';
      const targets = nodeIsInstanceRoot(node) ? [op.nodeId] : mirrorsOf(doc, op.nodeId);
      for (const id of targets) {
        const target = findNode(doc, id);
        if (!target || !target.parent) continue;
        const copy = cloneNode(target.node, () => ctx.newId('n'));
        if (target.node.shared) copy.shared = { ...target.node.shared };
        insertAt(target.parent, target.index + 1, copy);
        if (createdId === '') createdId = copy.id;
      }
      checkPageSize(doc, createdId);
      return {
        created: { nodeId: createdId },
        inverse: [{ kind: 'delete_node', nodeId: createdId }],
      };
    }
    case 'rename_node': {
      const node = needNode(doc, op.nodeId);
      const before = node.name;
      for (const mirror of mirrorNodes(doc, op.nodeId)) mirror.name = op.name;
      return { inverse: [{ kind: 'rename_node', nodeId: op.nodeId, name: before }] };
    }
    case 'set_prop': {
      const node = needNode(doc, op.nodeId);
      const value = parsePropValue(node.type, op.prop, op.value);
      if (op.prop === 'imageId') checkImageRef(ctx, String(value), 'value');
      const before = node.props[op.prop];
      for (const mirror of mirrorNodes(doc, op.nodeId)) mirror.props[op.prop] = value;
      return {
        inverse: [
          {
            kind: 'set_prop',
            nodeId: op.nodeId,
            prop: op.prop,
            value: before ?? defaultPropsFor(node.type, node.name)[op.prop] ?? '',
          },
        ],
      };
    }
    case 'set_style': {
      const node = needNode(doc, op.nodeId);
      if (typeof op.value !== 'string') {
        const token = tokenOf(doc, op.value.token);
        if (!token || token.kind !== STYLE_TOKEN_KIND[op.property]) {
          throw invalid({ value: 'That token does not fit this property.' });
        }
      }
      const before = node.styles[op.breakpoint][op.property];
      for (const mirror of mirrorNodes(doc, op.nodeId)) {
        mirror.styles[op.breakpoint][op.property] = op.value;
      }
      return {
        inverse: [
          before === undefined
            ? { kind: 'clear_style', nodeId: op.nodeId, breakpoint: op.breakpoint, property: op.property }
            : {
                kind: 'set_style',
                nodeId: op.nodeId,
                breakpoint: op.breakpoint,
                property: op.property,
                value: before,
              },
        ],
      };
    }
    case 'clear_style': {
      const node = needNode(doc, op.nodeId);
      const before = node.styles[op.breakpoint][op.property];
      for (const mirror of mirrorNodes(doc, op.nodeId)) {
        delete mirror.styles[op.breakpoint][op.property];
      }
      return {
        inverse: [
          before === undefined
            ? { kind: 'clear_style', nodeId: op.nodeId, breakpoint: op.breakpoint, property: op.property }
            : {
                kind: 'set_style',
                nodeId: op.nodeId,
                breakpoint: op.breakpoint,
                property: op.property,
                value: before,
              },
        ],
      };
    }
    case 'set_token': {
      const existing = tokenOf(doc, op.name);
      const token: Token =
        op.tokenKind === 'size' || (op.tokenKind === undefined && typeof op.value === 'number')
          ? { name: op.name, kind: 'size', value: op.value, unit: op.unit ?? 'px' }
          : { name: op.name, kind: 'color', value: op.value };
      if (existing) {
        const before: Token = { ...existing };
        Object.assign(existing, token);
        if (token.kind === 'color') delete existing.unit;
        return {
          inverse: [
            before.kind === 'size'
              ? {
                  kind: 'set_token',
                  name: before.name,
                  tokenKind: 'size',
                  value: before.value,
                  unit: before.unit ?? 'px',
                }
              : { kind: 'set_token', name: before.name, tokenKind: 'color', value: before.value },
          ],
        };
      }
      if (doc.tokens.length >= MAX_TOKENS) {
        throw invalid({ name: 'A workspace holds at most 40 tokens.' });
      }
      doc.tokens.push(token);
      return { inverse: [{ kind: 'delete_token', name: op.name }] };
    }
    case 'rename_token': {
      const token = tokenOf(doc, op.name);
      if (!token) throw notFound();
      if (tokenOf(doc, op.newName)) throw invalid({ newName: 'That token name is taken.' });
      token.name = op.newName;
      rewriteTokenName(doc, op.name, op.newName);
      return { inverse: [{ kind: 'rename_token', name: op.newName, newName: op.name }] };
    }
    case 'delete_token': {
      const token = tokenOf(doc, op.name);
      if (!token) throw notFound();
      const uses = countTokenUses(doc, op.name);
      if (uses > 0) {
        throw new OpFailure(
          409,
          'token_in_use',
          `Can't delete ${op.name}: it is used ${uses} times.`,
        );
      }
      doc.tokens = doc.tokens.filter((t) => t.name !== op.name);
      return {
        inverse: [
          token.kind === 'size'
            ? {
                kind: 'set_token',
                name: token.name,
                tokenKind: 'size',
                value: token.value,
                unit: token.unit ?? 'px',
              }
            : { kind: 'set_token', name: token.name, tokenKind: 'color', value: token.value },
        ],
      };
    }
    case 'create_component': {
      const node = needNode(doc, op.nodeId);
      const hit = findNode(doc, op.nodeId)!;
      if (!hit.parent) throw invalid({ nodeId: 'A page root cannot become a component.' });
      if (node.shared) throw invalid({ nodeId: 'That node is already a linked instance.' });
      if (instanceContextOf(doc, op.nodeId)) {
        throw invalid({ nodeId: 'That node is already inside a linked instance.' });
      }
      const component = {
        id: ctx.newId('cp'),
        name: op.name,
        root: cloneNode(node, () => ctx.newId('n')),
      };
      doc.components.push(component);
      node.shared = { componentId: component.id };
      return {
        created: { componentId: component.id },
        inverse: [
          { kind: 'detach_instance', nodeId: op.nodeId },
          { kind: 'remove_component', componentId: component.id },
        ],
      };
    }
    case 'detach_instance': {
      const node = needNode(doc, op.nodeId);
      if (!node.shared) throw invalid({ nodeId: 'That node is not a linked instance.' });
      const componentId = node.shared.componentId;
      delete node.shared;
      return { inverse: [{ kind: 'attach_instance', nodeId: op.nodeId, componentId }] };
    }
    case 'attach_instance': {
      const node = needNode(doc, op.nodeId);
      node.shared = { componentId: op.componentId };
      return { inverse: [{ kind: 'detach_instance', nodeId: op.nodeId }] };
    }
    case 'delete_component': {
      const component = findComponent(doc, op.componentId);
      if (!component) throw notFound();
      const instances = linkedInstances(doc, op.componentId);
      if (instances.length > 0) {
        throw new OpFailure(
          409,
          'component_in_use',
          `Can't delete ${component.name}: ${instances.length} instances still link to it.`,
        );
      }
      doc.components = doc.components.filter((c) => c.id !== op.componentId);
      return { inverse: [{ kind: 'restore_component', component }] };
    }
    case 'remove_component': {
      const component = findComponent(doc, op.componentId);
      if (!component) throw notFound();
      doc.components = doc.components.filter((c) => c.id !== op.componentId);
      return { inverse: [{ kind: 'restore_component', component }] };
    }
    case 'restore_component': {
      doc.components.push(JSON.parse(JSON.stringify(op.component)) as typeof op.component);
      return { inverse: [{ kind: 'remove_component', componentId: op.component.id }] };
    }
    case 'set_fields': {
      const before = JSON.parse(JSON.stringify(doc.collection)) as Collection;
      const kept = new Set(op.fields.map((f) => f.name));
      for (const field of doc.collection.fields) {
        if (kept.has(field.name)) continue;
        const bound = countFieldBindings(doc, field.name);
        if (bound > 0) {
          throw new OpFailure(
            409,
            'field_in_use',
            `Can't remove ${field.name}: it is bound ${bound} times.`,
          );
        }
      }
      doc.collection.fields = op.fields.map((f) => ({ ...f }));
      for (const entry of doc.collection.entries) {
        for (const key of Object.keys(entry.values)) {
          if (!kept.has(key)) delete entry.values[key];
        }
      }
      return { inverse: [{ kind: 'restore_collection', collection: before }] };
    }
    case 'restore_collection': {
      const before = JSON.parse(JSON.stringify(doc.collection)) as Collection;
      doc.collection = JSON.parse(JSON.stringify(op.collection)) as Collection;
      return { inverse: [{ kind: 'restore_collection', collection: before }] };
    }
    case 'put_entry': {
      const values = entryValues(doc, ctx, op.values);
      if (op.entryId !== undefined) {
        const entry = doc.collection.entries.find((e) => e.id === op.entryId);
        if (!entry) throw notFound();
        const before = { ...entry.values };
        entry.values = { ...entry.values, ...values };
        return { inverse: [{ kind: 'put_entry', entryId: entry.id, values: before }] };
      }
      if (doc.collection.entries.length >= MAX_ENTRIES) {
        throw invalid({ values: 'A collection holds at most 200 entries.' });
      }
      const entry: Entry = {
        id: ctx.newId('e'),
        order: doc.collection.entries.length,
        values,
      };
      doc.collection.entries.push(entry);
      return {
        created: { entryId: entry.id },
        inverse: [{ kind: 'delete_entry', entryId: entry.id }],
      };
    }
    case 'move_entry': {
      const entries = doc.collection.entries;
      const from = entries.findIndex((e) => e.id === op.entryId);
      if (from === -1) throw notFound();
      if (op.index >= entries.length) throw invalid({ index: 'That index is out of range.' });
      const [entry] = entries.splice(from, 1);
      entries.splice(op.index, 0, entry!);
      orderEntries(doc.collection);
      return { inverse: [{ kind: 'move_entry', entryId: op.entryId, index: from }] };
    }
    case 'delete_entry': {
      const entries = doc.collection.entries;
      const at = entries.findIndex((e) => e.id === op.entryId);
      if (at === -1) throw notFound();
      const [entry] = entries.splice(at, 1);
      orderEntries(doc.collection);
      return { inverse: [{ kind: 'restore_entry', entry: entry!, index: at }] };
    }
    case 'restore_entry': {
      doc.collection.entries.splice(op.index, 0, JSON.parse(JSON.stringify(op.entry)) as Entry);
      orderEntries(doc.collection);
      return { inverse: [{ kind: 'delete_entry', entryId: op.entry.id }] };
    }
    case 'bind_prop': {
      const node = needNode(doc, op.nodeId);
      if (op.prop !== mainPropOf(node.type)) {
        throw invalid({ prop: 'Only a node s main prop can be bound.' });
      }
      if (!insideCollectionList(doc, op.nodeId)) {
        throw invalid({ nodeId: 'Only nodes inside a collection list template can be bound.' });
      }
      const before = node.bind?.[op.prop] ?? null;
      if (op.field !== null) {
        const field = doc.collection.fields.find((f) => f.name === op.field);
        if (!field) throw invalid({ field: 'Unknown field.' });
        if (!bindableFieldKinds(node.type, op.prop).includes(field.kind)) {
          throw invalid({ field: 'That field kind does not fit this prop.' });
        }
      }
      for (const mirror of mirrorNodes(doc, op.nodeId)) {
        if (op.field === null) {
          if (mirror.bind) {
            delete mirror.bind[op.prop];
            if (Object.keys(mirror.bind).length === 0) delete mirror.bind;
          }
        } else {
          mirror.bind = { ...(mirror.bind ?? {}), [op.prop]: op.field };
        }
      }
      return { inverse: [{ kind: 'bind_prop', nodeId: op.nodeId, prop: op.prop, field: before }] };
    }
    case 'add_page': {
      if (doc.pages.length >= MAX_PAGES) {
        throw invalid({ name: 'A workspace holds at most 20 pages.' });
      }
      const pageId = ctx.newId('pg');
      const root: PlinthNode = {
        id: ctx.newId('n'),
        type: 'page',
        name: op.name,
        props: {},
        styles: emptyStyles(),
        children: [],
      };
      const page: Page = {
        id: pageId,
        name: op.name,
        slug: uniquePageSlug(doc, op.name),
        order: doc.pages.length,
        root,
      };
      doc.pages.push(page);
      return {
        created: { pageId, nodeId: root.id },
        inverse: [{ kind: 'remove_page', pageId }],
      };
    }
    case 'remove_page': {
      const index = doc.pages.findIndex((p) => p.id === op.pageId);
      if (index === -1) throw notFound();
      const [page] = doc.pages.splice(index, 1);
      doc.pages.forEach((p, i) => {
        p.order = i;
      });
      return { inverse: [{ kind: 'restore_page', page: page!, index }] };
    }
    case 'restore_page': {
      doc.pages.splice(op.index, 0, JSON.parse(JSON.stringify(op.page)) as Page);
      doc.pages.forEach((p, i) => {
        p.order = i;
      });
      return { inverse: [{ kind: 'remove_page', pageId: op.page.id }] };
    }
    case 'rename_page': {
      const page = needPage(doc, op.pageId);
      const before = page.name;
      page.name = op.name;
      page.root.name = op.name;
      return { inverse: [{ kind: 'rename_page', pageId: op.pageId, name: before }] };
    }
    case 'restore_doc': {
      const before = documentSnapshot(doc);
      const next = JSON.parse(JSON.stringify(op.document)) as PlinthDocument;
      doc.name = next.name;
      doc.slug = next.slug;
      doc.tokens = next.tokens;
      doc.pages = next.pages;
      doc.components = next.components;
      doc.collection = next.collection;
      return { inverse: [{ kind: 'restore_doc', document: before }] };
    }
    case 'undo':
    case 'redo':
    case 'restore':
      throw invalid({ kind: 'That operation is handled by the server.' });
  }
}

function documentSnapshot(doc: PlinthDocument): Omit<PlinthDocument, 'seq'> {
  const { seq, ...rest } = doc;
  void seq;
  return JSON.parse(JSON.stringify(rest)) as Omit<PlinthDocument, 'seq'>;
}

function insideCollectionList(doc: PlinthDocument, nodeId: string): boolean {
  const lists = [
    ...doc.pages.flatMap((page) => allNodes(page.root)),
    ...doc.components.flatMap((component) => allNodes(component.root)),
  ].filter((node) => node.type === 'collection_list');
  return lists.some((list) => list.id !== nodeId && isInSubtree(list, nodeId));
}

function uniquePageSlug(doc: PlinthDocument, name: string): string {
  return uniqueSlug(name, doc.pages.map((p) => p.slug));
}

export function applyOps(doc: PlinthDocument, ops: readonly Op[], ctx: ApplyContext): Op[] {
  const inverse: Op[] = [];
  for (const op of ops) {
    const result = applyOp(doc, op, ctx);
    inverse.unshift(...result.inverse);
  }
  return inverse;
}
