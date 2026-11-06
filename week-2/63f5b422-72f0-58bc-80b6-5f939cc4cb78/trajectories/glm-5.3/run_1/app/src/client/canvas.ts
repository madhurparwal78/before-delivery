// Canvas rendering: frames, nodes, collection rows, selection and pins.
import {
  BP_WIDTH, BP_LABEL, BREAKPOINTS, TYPE_LABEL, isTokenRef,
  type WorkspaceDocument, type DocumentNode, type Page, type Breakpoint, type StyleProperty,
} from '../shared/domain.js';
import { computedDeclarations, declarationsToCss, focalPoint, STYLE_PROPERTIES_ALL } from '../shared/style.js';
import type { EditorState } from './state.js';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | null | undefined> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = String(v);
    else e.setAttribute(k, v === true ? 'true' : String(v));
  }
  if (text !== undefined) e.textContent = text;
  return e;
}

export function frameElement(bp: Breakpoint): HTMLElement {
  const frame = el('div', { 'data-frame': bp, 'tabindex': '-1' });
  frame.style.width = `${BP_WIDTH[bp]}px`;
  frame.setAttribute('aria-label', `${BP_LABEL[bp]} ${BP_WIDTH[bp]} frame`);
  return frame;
}

interface RenderOpts {
  state: EditorState;
  doc: WorkspaceDocument;
  page: Page;
  bp: Breakpoint;
  interactive: boolean; // false in version preview
}

function nodeAriaName(node: DocumentNode): string {
  return node.name;
}

export function renderNodeInto(parent: HTMLElement, node: DocumentNode, ctx: RenderOpts, entryId?: string): void {
  const { state, doc, bp } = ctx;
  const nodeEl = el('div', {
    'data-node-id': node.id,
    'data-node-type': node.type,
    role: 'group',
    'aria-roledescription': node.type,
    'aria-label': nodeAriaName(node),
  });
  if (entryId) nodeEl.setAttribute('data-entry-id', entryId);
  if (node.bind && Object.keys(node.bind).length > 0) nodeEl.setAttribute('data-bound', 'true');
  const decs = computedDeclarations(doc, node, bp);
  nodeEl.setAttribute('style', declarationsToCss(decs));
  if (state.selectedNodeId === node.id) nodeEl.setAttribute('data-selected', 'true');
  const remote = [...state.remoteSelections.entries()].find(([userId, nodeId]) => nodeId === node.id);
  if (remote) nodeEl.setAttribute('data-selected-by', remote[0]);

  // content by type
  if (node.type === 'heading') {
    nodeEl.textContent = boundText(ctx, node, entryId);
  } else if (node.type === 'text') {
    const field = boundRichField(ctx, node);
    if (field) {
      const div = el('div', { 'data-rich': 'true' });
      div.innerHTML = entryText(ctx, entryId, node.bind!.text);
      nodeEl.appendChild(div);
    } else {
      nodeEl.textContent = boundText(ctx, node, entryId);
    }
  } else if (node.type === 'button') {
    const a = el('a', { href: '#', 'data-noref': 'true' }, boundText(ctx, node, entryId));
    nodeEl.appendChild(a);
  } else if (node.type === 'image') {
    const imageId = typeof node.props.imageId === 'string' ? node.props.imageId : '';
    const boundField = node.bind?.imageId;
    const finalId = boundField && entryId ? entryValue(ctx, entryId, boundField) : imageId;
    const img = el('img', {
      src: `/api/images/${finalId}`,
      alt: typeof node.props.alt === 'string' ? node.props.alt : '',
    });
    img.style.objectPosition = focalPoint(node);
    nodeEl.appendChild(img);
  } else if (node.type === 'collection_list') {
    renderCollectionList(nodeEl, node, ctx);
  } else {
    for (const c of node.children) renderNodeInto(nodeEl, c, ctx, entryId);
  }
  parent.appendChild(nodeEl);
}

function renderCollectionList(listEl: HTMLElement, node: DocumentNode, ctx: RenderOpts): void {
  const { doc } = ctx;
  const entries = [...doc.collection.entries].sort((a, b) => a.order - b.order);
  if (entries.length === 0) {
    listEl.appendChild(el('div', { 'data-empty-list': 'true' }, 'Nothing here yet.'));
    return;
  }
  const template = node.children[0];
  for (const entry of entries) {
    const row = el('div', { 'data-collection-row': entry.id });
    if (template) renderNodeInto(row, template, ctx, entry.id);
    listEl.appendChild(row);
  }
}

function boundText(ctx: RenderOpts, node: DocumentNode, entryId?: string): string {
  const bound = node.bind?.text;
  if (!bound) return typeof node.props.text === 'string' ? node.props.text : '';
  if (!entryId) return typeof node.props.text === 'string' ? node.props.text : '';
  return entryValue(ctx, entryId, bound);
}

function boundRichField(ctx: RenderOpts, node: DocumentNode): string | null {
  const bound = node.bind?.text;
  if (!bound) return null;
  const field = ctx.doc.collection.fields.find((f) => f.name === bound);
  return field?.kind === 'rich_text' ? bound : null;
}

function entryValue(ctx: RenderOpts, entryId: string, field: string): string {
  const entry = ctx.doc.collection.entries.find((e) => e.id === entryId);
  return entry?.values[field] ?? '';
}

function entryText(ctx: RenderOpts, entryId: string | undefined, field: string): string {
  if (!entryId) return '';
  return entryValue(ctx, entryId, field);
}

export function renderCanvas(state: EditorState): void {
  const canvas = document.getElementById('canvas')!;
  const doc = state.shownDocument();
  const page = state.page();
  canvas.innerHTML = '';
  if (!doc || !page) return;
  const fanOpen = canvas.getAttribute('data-fan') === 'open' || canvas.getAttribute('data-fan') === 'opening';
  const frames: Breakpoint[] = fanOpen ? ['desktop', 'tablet', 'phone'] : [state.bp];
  for (const bp of frames) {
    const frame = frameElement(bp);
    const ctx: RenderOpts = { state, doc, page, bp, interactive: !state.readonly };
    // render the page root's children directly into the frame
    const rootEl = el('div', {
      'data-node-id': page.root.id, 'data-node-type': 'page', role: 'group',
      'aria-roledescription': 'page', 'aria-label': page.root.name,
    });
    if (state.selectedNodeId === page.root.id) rootEl.setAttribute('data-selected', 'true');
    const decs = computedDeclarations(doc, page.root, bp);
    rootEl.setAttribute('style', declarationsToCss(decs) + ';min-height:100%');
    frame.appendChild(rootEl);
    for (const c of page.root.children) renderNodeInto(rootEl, c, ctx);
    canvas.appendChild(frame);
  }
  if (fanOpen) applyFanLayout(canvas);
}

export function applyFanLayout(canvas: HTMLElement): void {
  const frames = [...canvas.querySelectorAll<HTMLElement>('[data-frame]')];
  if (frames.length !== 3) return;
  const canvasWidth = canvas.clientWidth;
  const gap = 24;
  const totalWidth = BP_WIDTH.desktop + BP_WIDTH.tablet + BP_WIDTH.phone + gap * 2;
  const scale = Math.min(1, (canvasWidth - 32) / totalWidth);
  const progress = parseFloat(canvas.getAttribute('data-fan-progress') ?? '1');
  frames.forEach((frame, i) => {
    frame.style.transform = `scale(${scale * (0.5 + 0.5 * progress)})`;
    frame.style.transformOrigin = 'top left';
    frame.style.flex = `0 0 auto`;
    frame.style.marginRight = i < 2 ? `${gap}px` : '';
    frame.dataset.scale = String(scale);
  });
}

export function applySingleFrameLayout(canvas: HTMLElement): void {
  const frames = [...canvas.querySelectorAll<HTMLElement>('[data-frame]')];
  const canvasWidth = canvas.clientWidth;
  for (const frame of frames) {
    const bp = frame.getAttribute('data-frame') as Breakpoint;
    const scale = Math.min(1, (canvasWidth - 32) / BP_WIDTH[bp]);
    frame.style.transform = scale < 1 ? `scale(${scale})` : '';
    frame.style.transformOrigin = 'top left';
    frame.style.marginRight = '';
  }
}
