import { pipState, resolveStyle, styleSource } from '../../shared/breakpoints.js';
import { bindableFieldKinds, mainPropOf } from '../../shared/ops.js';
import { STYLE_KEYS, STYLE_TOKEN_KIND, styleValueText } from '../../shared/style.js';
import { isInSubtree } from '../../shared/tree.js';
import type { Breakpoint, PlinthNode, StyleKey } from '../../shared/types.js';
import { BREAKPOINTS, breakpointLabel } from '../../shared/types.js';
import { button, el, patchChildren, setAttr, setText } from '../dom.js';
import {
  bindProp,
  clearStyleValue,
  detachInstance,
  setPropValue,
  setStyleValue,
} from './actions.js';
import { fanShowing } from './fan.js';
import { openCreateComponentDialog } from './dialogs.js';
import { activeDoc, canEdit, selectedNode, state } from './store.js';

let panel: HTMLElement | undefined;
const valueInputs = new Map<StyleKey, HTMLInputElement>();
const tokenSelects = new Map<StyleKey, HTMLSelectElement>();
const clearButtons = new Map<StyleKey, HTMLButtonElement>();
const groups = new Map<StyleKey, HTMLElement>();
const pipHolders = new Map<StyleKey, HTMLElement>();

let textInput: HTMLInputElement;
let levelSelect: HTMLSelectElement;
let linkInput: HTMLInputElement;
let altInput: HTMLInputElement;
let focalX: HTMLInputElement;
let focalY: HTMLInputElement;
let bindSelect: HTMLSelectElement;
let createComponentButton: HTMLButtonElement;
let detachButton: HTMLButtonElement;
const rows = new Map<string, HTMLElement>();

function row(label: string, control: HTMLElement, key: string): HTMLElement {
  const wrapper = el('div', { class: 'style-row' }, [el('span', { class: 'prop-label' }, [label]), control]);
  rows.set(key, wrapper);
  return wrapper;
}

function textRow(label: string, commit: (value: string) => void): HTMLInputElement {
  const input = el('input', { type: 'text', 'aria-label': label, class: 'value-input' });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      delete input.dataset['dirty'];
      commit(input.value);
    }
    if (event.key === 'Escape' && input.dataset['dirty'] === 'true') {
      event.stopPropagation();
      delete input.dataset['dirty'];
      renderStylePanel();
    }
  });
  input.addEventListener('input', () => {
    input.dataset['dirty'] = 'true';
  });
  input.addEventListener('blur', () => {
    if (input.dataset['dirty'] === 'true') {
      delete input.dataset['dirty'];
      commit(input.value);
    }
  });
  return input;
}

function nodeId(): string {
  return state.selectedId ?? '';
}

export function stylePanelElement(): HTMLElement {
  if (panel) return panel;
  const content = el('div', { class: 'style-content' });
  textInput = textRow('Text', (value) => setPropValue(nodeId(), 'text', value));
  levelSelect = el('select', { 'aria-label': 'Heading level' }, [
    el('option', { value: '1' }, ['Level 1']),
    el('option', { value: '2' }, ['Level 2']),
    el('option', { value: '3' }, ['Level 3']),
  ]);
  levelSelect.addEventListener('change', () => {
    setPropValue(nodeId(), 'level', Number(levelSelect.value));
  });
  linkInput = textRow('Link', (value) => setPropValue(nodeId(), 'href', value));
  altInput = textRow('Alt text', (value) => setPropValue(nodeId(), 'alt', value));
  focalX = focalSlider('Focal point horizontal', 'focalX');
  focalY = focalSlider('Focal point vertical', 'focalY');
  bindSelect = el('select', { 'aria-label': 'Bind to field' });
  bindSelect.addEventListener('change', () => {
    const node = selectedNode();
    if (!node) return;
    const prop = mainPropOf(node.type);
    if (prop === undefined) return;
    bindProp(node.id, prop, bindSelect.value === '' ? null : bindSelect.value);
  });
  createComponentButton = button('Create shared component', { class: 'ghost' });
  createComponentButton.addEventListener('click', () => openCreateComponentDialog());
  detachButton = button('Detach instance', { class: 'ghost' });
  detachButton.addEventListener('click', () => detachInstance(nodeId()));
  content.append(
    row('Text', textInput, 'text'),
    row('Heading level', levelSelect, 'level'),
    row('Link', linkInput, 'href'),
    row('Alt text', altInput, 'alt'),
    row('Focal point horizontal', focalX, 'focalX'),
    row('Focal point vertical', focalY, 'focalY'),
    row('Bind to field', bindSelect, 'bind'),
    createComponentButton,
    detachButton,
  );

  const styleRows = el('div', { class: 'style-rows' });
  for (const key of STYLE_KEYS) {
    const value = textRow(`${key} value`, (text) => {
      if (text.trim() === '') return;
      setStyleValue(nodeId(), key, text.trim());
    });
    const token = el('select', { 'aria-label': `${key} token` });
    token.addEventListener('change', () => {
      if (token.value === '') clearStyleValue(nodeId(), key);
      else setStyleValue(nodeId(), key, { token: token.value });
    });
    const clear = button('Clear', { 'aria-label': `Clear ${key} override`, class: 'clear-override' });
    clear.addEventListener('click', () => {
      clearStyleValue(nodeId(), key);
      value.focus();
    });
    const pips = el('span', { class: 'pips' });
    const group = el('div', { role: 'group', 'aria-label': key, 'data-property': key }, [
      el('span', { class: 'prop-label mono' }, [key]),
      value,
      token,
      clear,
      pips,
    ]);
    valueInputs.set(key, value);
    tokenSelects.set(key, token);
    clearButtons.set(key, clear);
    pipHolders.set(key, pips);
    groups.set(key, group);
    styleRows.append(group);
  }

  panel = el(
    'aside',
    {
      id: 'style-panel',
      role: 'complementary',
      'aria-label': 'Style',
      'data-motion': 'open',
      'data-progress': '1.00',
    },
    [el('div', { class: 'panel-head' }, [el('h2', {}, ['Style'])]), content, styleRows],
  );
  return panel;
}

function focalSlider(label: string, prop: 'focalX' | 'focalY'): HTMLInputElement {
  const slider = el('input', {
    type: 'range',
    min: '0',
    max: '100',
    step: '5',
    'aria-label': label,
    class: 'focal',
  });
  slider.addEventListener('keydown', (event) => {
    if (!event.shiftKey) return;
    const delta =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -1
          : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = Math.min(100, Math.max(0, Number(slider.value) + delta));
    slider.value = String(next);
    setPropValue(nodeId(), prop, next);
  });
  slider.addEventListener('change', () => {
    setPropValue(nodeId(), prop, Number(slider.value));
  });
  return slider;
}

function pipLabel(node: PlinthNode, bp: Breakpoint, key: StyleKey): string {
  const pip = pipState(node, bp, key);
  if (pip === 'unset') return `${breakpointLabel(bp)}: unset`;
  const value = styleValueText(resolveStyle(node, bp, key));
  return `${breakpointLabel(bp)}: ${pip}, ${value}`;
}

function updatePips(node: PlinthNode, key: StyleKey): void {
  const holder = pipHolders.get(key)!;
  if (!fanShowing()) {
    holder.replaceChildren();
    return;
  }
  patchChildren<Breakpoint>(
    holder,
    [...BREAKPOINTS],
    (bp) => bp,
    (bp) => el('span', { 'data-pip': bp, role: 'img' }),
    (element, bp) => {
      setAttr(element, 'data-state', pipState(node, bp, key));
      setAttr(element, 'aria-label', pipLabel(node, bp, key));
    },
  );
}

function showRow(key: string, visible: boolean): void {
  const element = rows.get(key);
  if (element) element.hidden = !visible;
}

export function renderStylePanel(): void {
  stylePanelElement();
  const node = selectedNode();
  const editing = canEdit();
  setAttr(panel!, 'data-motion', state.stylePanel.motion);
  setAttr(panel!, 'data-progress', state.stylePanel.progress.toFixed(2));
  if (state.stylePanel.motion === 'closed') {
    panel!.setAttribute('inert', '');
  } else {
    panel!.removeAttribute('inert');
  }
  const doc = activeDoc();
  const hasText = node !== undefined && ['heading', 'text', 'button'].includes(node.type);
  showRow('text', editing && hasText);
  showRow('level', editing && node?.type === 'heading');
  showRow('href', editing && node?.type === 'button');
  showRow('alt', editing && node?.type === 'image');
  showRow('focalX', editing && node?.type === 'image');
  showRow('focalY', editing && node?.type === 'image');
  const bindable = node !== undefined && insideTemplate(node.id);
  showRow('bind', editing && bindable);
  createComponentButton.hidden = !editing || node === undefined || node.shared !== undefined;
  detachButton.hidden = !editing || node?.shared === undefined;

  if (node !== undefined) {
    if (textInput.dataset['dirty'] !== 'true') textInput.value = String(node.props['text'] ?? '');
    levelSelect.value = String(node.props['level'] ?? 1);
    if (linkInput.dataset['dirty'] !== 'true') linkInput.value = String(node.props['href'] ?? '');
    if (altInput.dataset['dirty'] !== 'true') altInput.value = String(node.props['alt'] ?? '');
    focalX.value = String(node.props['focalX'] ?? 50);
    focalY.value = String(node.props['focalY'] ?? 50);
    const prop = mainPropOf(node.type);
    if (prop !== undefined) {
      const kinds = bindableFieldKinds(node.type, prop);
      const options = [
        { value: '', label: 'Not bound' },
        ...doc.collection.fields
          .filter((field) => kinds.includes(field.kind))
          .map((field) => ({ value: field.name, label: field.name })),
      ];
      patchChildren(
        bindSelect,
        options,
        (option) => option.value,
        () => el('option'),
        (element, option) => {
          (element as HTMLOptionElement).value = option.value;
          setText(element, option.label);
        },
      );
      bindSelect.value = node.bind?.[prop] ?? '';
    }
  }

  for (const key of STYLE_KEYS) {
    const group = groups.get(key)!;
    const valueInput = valueInputs.get(key)!;
    const token = tokenSelects.get(key)!;
    const clear = clearButtons.get(key)!;
    if (node === undefined) {
      group.hidden = true;
      continue;
    }
    group.hidden = false;
    const source = styleSource(node, state.bp, key);
    setAttr(group, 'data-source', source);
    const resolved = resolveStyle(node, state.bp, key);
    if (valueInput.dataset['dirty'] !== 'true') {
      valueInput.value = resolved === undefined ? '' : styleValueText(resolved);
    }
    valueInput.hidden = !editing;
    const kind = STYLE_TOKEN_KIND[key];
    token.hidden = kind === null || !editing;
    if (kind !== null) {
      const options = [
        { value: '', label: 'No token' },
        ...doc.tokens.filter((item) => item.kind === kind).map((item) => ({ value: item.name, label: item.name })),
      ];
      patchChildren(
        token,
        options,
        (option) => option.value,
        () => el('option'),
        (element, option) => {
          (element as HTMLOptionElement).value = option.value;
          setText(element, option.label);
        },
      );
      const own = node.styles[state.bp][key];
      token.value = own !== undefined && typeof own !== 'string' ? own.token : '';
    }
    clear.hidden = !editing || state.bp === 'desktop' || source !== 'set';
    group.classList.toggle('overridden', state.bp !== 'desktop' && source === 'set');
    updatePips(node, key);
  }
}

let motionFrame = 0;
let motionTimer = 0;
let motionDirection = 0;
let motionAnchorTime = 0;
let motionAnchorProgress = 0;

function paintPanelMotion(): void {
  setAttr(panel!, 'data-motion', state.stylePanel.motion);
  setAttr(panel!, 'data-progress', state.stylePanel.progress.toFixed(2));
  panel!.style.setProperty('--progress', String(state.stylePanel.progress));
  if (state.stylePanel.motion === 'closed') panel!.setAttribute('inert', '');
  else panel!.removeAttribute('inert');
  const toggle = document.getElementById('style-panel-button');
  toggle?.setAttribute('aria-expanded', state.stylePanel.motion === 'closed' ? 'false' : 'true');
}

function settlePanel(): void {
  const opening = motionDirection > 0;
  state.stylePanel.progress = opening ? 1 : 0;
  state.stylePanel.motion = opening ? 'open' : 'closed';
  if (motionFrame !== 0) window.cancelAnimationFrame(motionFrame);
  if (motionTimer !== 0) window.clearTimeout(motionTimer);
  motionFrame = 0;
  motionTimer = 0;
  motionDirection = 0;
  paintPanelMotion();
}

function panelStep(now: number): void {
  const next = motionAnchorProgress + (motionDirection * (now - motionAnchorTime)) / 200;
  state.stylePanel.progress = Math.min(1, Math.max(0, next));
  if (
    (motionDirection > 0 && state.stylePanel.progress >= 1) ||
    (motionDirection < 0 && state.stylePanel.progress <= 0)
  ) {
    settlePanel();
    return;
  }
  state.stylePanel.motion = motionDirection > 0 ? 'opening' : 'closing';
  paintPanelMotion();
  motionFrame = window.requestAnimationFrame(panelStep);
}

/** The style panel slides over 200 ms and reverses from its current progress. */
export function toggleStylePanel(): void {
  stylePanelElement();
  const opening = state.stylePanel.motion === 'closed' || state.stylePanel.motion === 'closing';
  motionDirection = opening ? 1 : -1;
  state.stylePanel.motion = opening ? 'opening' : 'closing';
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    settlePanel();
    return;
  }
  paintPanelMotion();
  motionAnchorProgress = state.stylePanel.progress;
  motionAnchorTime = performance.now();
  const remaining = (opening ? 1 - motionAnchorProgress : motionAnchorProgress) * 200;
  if (motionTimer !== 0) window.clearTimeout(motionTimer);
  motionTimer = window.setTimeout(settlePanel, remaining);
  if (motionFrame === 0) motionFrame = window.requestAnimationFrame(panelStep);
}

function insideTemplate(id: string): boolean {
  const doc = activeDoc();
  const lists = doc.pages.flatMap((page) => collectLists(page.root));
  return lists.some((list) => list.id !== id && isInSubtree(list, id));
}

function collectLists(node: PlinthNode): PlinthNode[] {
  const out: PlinthNode[] = node.type === 'collection_list' ? [node] : [];
  for (const child of node.children) out.push(...collectLists(child));
  return out;
}
