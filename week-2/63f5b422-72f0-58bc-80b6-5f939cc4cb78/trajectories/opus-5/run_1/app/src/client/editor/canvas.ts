import { notices } from '../../shared/notices.js';
import { boundPropValue, editorFrameCss, focalPosition } from '../../shared/render.js';
import { allNodes } from '../../shared/tree.js';
import type { Breakpoint, Entry, PlinthNode } from '../../shared/types.js';
import { BREAKPOINTS, FRAME_WIDTH, breakpointLabel } from '../../shared/types.js';
import { el, patchChildren, setAttr, setText } from '../dom.js';
import { activeDoc, currentPage, state } from './store.js';

const GAP = 24;

let canvasEl: HTMLElement | undefined;
let stageEl: HTMLElement | undefined;
let styleEl: HTMLStyleElement | undefined;
const frames = new Map<Breakpoint, HTMLElement>();

const TAGS: Record<PlinthNode['type'], keyof HTMLElementTagNameMap> = {
  page: 'div',
  section: 'section',
  stack: 'div',
  heading: 'h1',
  text: 'p',
  image: 'img',
  button: 'a',
  nav: 'nav',
  collection_list: 'ul',
};

export function canvasElement(): HTMLElement {
  if (canvasEl) return canvasEl;
  styleEl = document.createElement('style');
  styleEl.id = 'canvas-styles';
  stageEl = el('div', { id: 'canvas-stage' });
  const line = el('div', { id: 'cascade-line', 'aria-hidden': 'true', hidden: true });
  for (const bp of BREAKPOINTS) {
    const frame = el('div', {
      'data-frame': bp,
      tabindex: '-1',
      role: 'group',
      'aria-label': `${breakpointLabel(bp)} ${FRAME_WIDTH[bp]} frame`,
      class: 'frame',
    });
    frame.style.width = `${FRAME_WIDTH[bp]}px`;
    frames.set(bp, frame);
    stageEl.append(frame);
  }
  canvasEl = el('div', {
    id: 'canvas',
    role: 'region',
    'aria-label': 'Canvas',
    tabindex: '0',
    'data-fan': 'closed',
    'data-fan-progress': '0.00',
  }, [styleEl, stageEl, line]);
  return canvasEl;
}

export function frameElement(bp: Breakpoint): HTMLElement {
  canvasElement();
  return frames.get(bp)!;
}

export function cascadeLine(): HTMLElement {
  return canvasElement().querySelector('#cascade-line')!;
}

function headingTag(node: PlinthNode): keyof HTMLElementTagNameMap {
  const level = Math.min(3, Math.max(1, Number(node.props['level'] ?? 1)));
  return (level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3') as keyof HTMLElementTagNameMap;
}

function tagFor(node: PlinthNode): keyof HTMLElementTagNameMap {
  return node.type === 'heading' ? headingTag(node) : TAGS[node.type];
}

interface Rendered {
  node: PlinthNode;
  entry: Entry | undefined;
}

function keyOf(item: Rendered): string {
  return item.entry === undefined ? item.node.id : `${item.node.id}:${item.entry.id}`;
}

function createNodeElement(item: Rendered): HTMLElement {
  const element = document.createElement(tagFor(item.node));
  element.dataset['wantTag'] = tagFor(item.node);
  return element;
}

function updateNodeElement(element: HTMLElement, item: Rendered): HTMLElement {
  const node = item.node;
  if (element.dataset['wantTag'] !== tagFor(node)) {
    const replacement = createNodeElement(item);
    replacement.dataset['key'] = element.dataset['key'] ?? keyOf(item);
    element.replaceWith(replacement);
    element = replacement;
  }
  setAttr(element, 'data-node-id', node.id);
  setAttr(element, 'data-node-type', node.type);
  setAttr(element, 'role', 'group');
  setAttr(element, 'aria-roledescription', node.type);
  setAttr(element, 'aria-label', node.name);
  setAttr(element, 'class', `pl-node pl-${node.type} n-${node.id}`);
  if (item.entry !== undefined) setAttr(element, 'data-entry-id', item.entry.id);
  else element.removeAttribute('data-entry-id');
  setAttr(element, 'data-selected', state.selectedId === node.id ? 'true' : undefined);
  const selectedBy = [...state.remoteSelections.entries()].find(([, id]) => id === node.id);
  setAttr(element, 'data-selected-by', selectedBy ? selectedBy[0] : undefined);

  const doc = activeDoc();
  if (node.type === 'heading' || node.type === 'text' || node.type === 'button') {
    const bound = boundPropValue(node, 'text', item.entry, doc.collection.fields);
    if (node.type === 'text' && bound.field?.kind === 'rich_text') {
      if (element.innerHTML !== bound.value) element.innerHTML = bound.value;
    } else {
      setText(element, bound.value);
    }
    if (node.type === 'button') {
      setAttr(element, 'href', String(node.props['href'] ?? '/'));
    }
    return element;
  }
  if (node.type === 'image') {
    const bound = boundPropValue(node, 'imageId', item.entry, doc.collection.fields);
    const src = bound.value === '' ? '' : `/api/images/${bound.value}`;
    setAttr(element, 'src', src);
    setAttr(element, 'alt', String(node.props['alt'] ?? ''));
    element.style.objectPosition = focalPosition(node);
    return element;
  }
  if (node.type === 'collection_list') {
    renderListRows(element, node);
    return element;
  }
  renderChildren(element, node, item.entry);
  return element;
}

function renderChildren(
  element: HTMLElement,
  node: PlinthNode,
  entry: Entry | undefined,
): void {
  patchChildren<Rendered>(
    element,
    node.children.map((child) => ({ node: child, entry })),
    keyOf,
    createNodeElement,
    (child, item) => {
      updateNodeElement(child, item);
    },
  );
}

function renderListRows(element: HTMLElement, node: PlinthNode): void {
  const template = node.children[0];
  const entries = [...activeDoc().collection.entries].sort((a, b) => a.order - b.order);
  if (template === undefined || entries.length === 0) {
    const empty = el('li', { class: 'pl-empty-list', 'data-key': 'empty' }, [notices.emptyList]);
    patchChildren(
      element,
      [empty],
      () => 'empty',
      () => empty,
      () => undefined,
    );
    return;
  }
  patchChildren<Entry>(
    element,
    entries,
    (entry) => entry.id,
    () => el('li'),
    (row, entry) => {
      setAttr(row, 'data-collection-row', entry.id);
      patchChildren<Rendered>(
        row,
        [{ node: template, entry }],
        keyOf,
        createNodeElement,
        (child, item) => {
          updateNodeElement(child, item);
        },
      );
    },
  );
}

function visibleFrames(): Breakpoint[] {
  if (state.layout === 'phone') return ['phone'];
  if (state.fan.motion === 'closed') return [state.bp];
  return [...BREAKPOINTS];
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function layoutFrames(): void {
  const canvas = canvasElement();
  const stage = stageEl!;
  const shown = visibleFrames();
  const progress = state.fan.progress;
  const available = Math.max(canvas.clientWidth - 32, 320);
  const openScale = Math.min(
    1,
    available / (FRAME_WIDTH.desktop + FRAME_WIDTH.tablet + FRAME_WIDTH.phone + GAP * 2),
  );
  const soloScale = Math.min(1, available / FRAME_WIDTH[state.bp]);
  const scale = soloScale + (openScale - soloScale) * progress;
  stage.style.transform = `scale(${scale})`;
  const shares: Record<Breakpoint, number> = {
    desktop: 1,
    tablet: progress,
    phone: clamp((progress * 420 - 90) / 330),
  };
  const offsets: Record<Breakpoint, number> = {
    desktop: 0,
    tablet: FRAME_WIDTH.desktop + GAP,
    phone: FRAME_WIDTH.desktop + GAP + FRAME_WIDTH.tablet + GAP,
  };
  for (const bp of BREAKPOINTS) {
    const frame = frameElement(bp);
    const visible = shown.includes(bp);
    frame.hidden = !visible;
    if (!visible) continue;
    const slide = shown.length === 1 ? 0 : -offsets[bp] * (1 - shares[bp]);
    frame.style.transform = `translateX(${slide}px)`;
    frame.style.opacity = String(shown.length === 1 ? 1 : Math.max(shares[bp], 0.15));
  }
  const line = cascadeLine();
  line.hidden = state.fan.motion === 'closed';
}

export function renderCanvas(): void {
  const canvas = canvasElement();
  const page = currentPage();
  if (!page) return;
  styleEl!.textContent = editorFrameCss(page, activeDoc().tokens);
  setAttr(canvas, 'data-fan', state.fan.motion);
  setAttr(canvas, 'data-fan-progress', state.fan.progress.toFixed(2));
  for (const bp of BREAKPOINTS) {
    const frame = frameElement(bp);
    if (!visibleFrames().includes(bp)) continue;
    patchChildren<Rendered>(
      frame,
      [{ node: page.root, entry: undefined }],
      keyOf,
      createNodeElement,
      (element, item) => {
        updateNodeElement(element, item);
      },
    );
  }
  layoutFrames();
}

export function scrollNodeIntoView(nodeId: string): void {
  const element = frameElement(state.bp).querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
  element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

export function pageNodeIds(): string[] {
  const page = currentPage();
  return page ? allNodes(page.root).map((node) => node.id) : [];
}
