// The style panel: style rows with sources, tokens, clear-override, pips in the Fan.
import {
  BREAKPOINTS, BP_LABEL, STYLE_PROPERTIES, resolveStyle, pipState, isTokenRef,
  cascadeNotice, reachOfChange, joinBps, displayValue,
  type DocumentNode, type Breakpoint, type StyleProperty, type Token,
} from '../shared/domain.js';
import { el } from './canvas.js';
import type { EditorState } from './state.js';

export interface PanelHandlers {
  onSetStyle(nodeId: string, bp: Breakpoint, property: StyleProperty, value: string | { token: string }): void;
  onClearStyle(nodeId: string, bp: Breakpoint, property: StyleProperty): void;
  onSetProp(nodeId: string, prop: string, value: unknown): void;
  onCreateShared(nodeId: string): void;
  onDetach(nodeId: string): void;
  onBind(nodeId: string, prop: string, field: string | null): void;
}

export function renderStylePanel(state: EditorState, handlers: PanelHandlers): void {
  const panel = document.getElementById('style-panel')!;
  panel.innerHTML = '';
  const doc = state.shownDocument();
  const node = state.selectedNodeId ? state.findNode(state.selectedNodeId) : null;
  if (!doc || !node) {
    panel.appendChild(el('p', { class: 'muted' }, 'Select a node to style it.'));
    return;
  }
  const fanOpen = isFanOpen();
  const tokensByName = new Map(doc.tokens.map((t) => [t.name, t]));

  // content props
  const content = el('div', { 'data-panel-content': 'true' });
  appendContentControls(content, state, node, handlers);
  panel.appendChild(content);

  // style property groups
  for (const property of STYLE_PROPERTIES) {
    const group = el('div', { role: 'group', 'aria-label': property, 'data-prop': property });
    const resolved = resolveStyle(node.styles, state.bp, property);
    group.setAttribute('data-source', resolved.source);
    const valueInput = el('input', { type: 'text', 'aria-label': `${property} value` }) as HTMLInputElement;
    valueInput.className = 'style-value';
    valueInput.value = inputValueOf(resolved.value, tokensByName);
    valueInput.dataset.property = property;
    const lastStored = valueInput.value;
    valueInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitStyle(handlers, state, node, property, valueInput.value);
        valueInput.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        valueInput.value = lastStored;
        valueInput.blur();
      }
      e.stopPropagation();
    });
    valueInput.addEventListener('blur', () => {
      if (valueInput.value !== lastStored) {
        commitStyle(handlers, state, node, property, valueInput.value);
      }
    });
    const tokenCombo = el('input', { type: 'text', role: 'combobox', 'aria-label': `${property} token`, 'aria-expanded': 'false', autocomplete: 'off' }) as HTMLInputElement;
    tokenCombo.className = 'token-combo';
    tokenCombo.dataset.property = property;
    tokenCombo.value = (isTokenRef(resolved.value) ? resolved.value.token : '') as string;
    tokenCombo.addEventListener('focus', () => openTokenList(state, node, property, tokenCombo, handlers));
    const label = el('label', { class: 'style-row' });
    label.appendChild(el('span', { class: 'prop-name' }, property));
    const controls = el('span', { class: 'style-controls' });
    controls.appendChild(valueInput);
    controls.appendChild(tokenCombo);
    if ((state.bp === 'tablet' || state.bp === 'phone') && resolveStyle(node.styles, state.bp, property).source === 'set') {
      const clear = el('button', { 'aria-label': `Clear ${property} override` }, 'Clear');
      clear.addEventListener('click', () => handlers.onClearStyle(node.id, state.bp, property));
      controls.appendChild(clear);
    }
    if (resolved.source === 'inherited') {
      const dot = el('span', { class: 'inherited-dot', 'aria-hidden': 'true' });
      controls.appendChild(dot);
    }
    label.appendChild(controls);
    group.appendChild(label);

    if (fanOpen) {
      const pips = el('div', { class: 'pips' });
      for (const bp of BREAKPOINTS) {
        const ps = pipState(node.styles, bp, property);
        const value = displayValue(resolveStyle(node.styles, bp, property).value, tokensByName);
        const pip = el('span', {
          'data-pip': bp, role: 'img', 'data-state': ps,
          'aria-label': ps === 'unset' ? `${BP_LABEL[bp]}: unset` : `${BP_LABEL[bp]}: ${ps}, ${value}`,
        }, ps === 'unset' ? `${BP_LABEL[bp]}: unset` : `${BP_LABEL[bp]}: ${ps}, ${value}`);
        pips.appendChild(pip);
      }
      group.appendChild(pips);
    }
    panel.appendChild(group);
  }

  // shared component controls
  if (node.shared) {
    const detach = el('button', { 'aria-label': 'Detach instance' }, 'Detach instance');
    detach.addEventListener('click', () => handlers.onDetach(node.id));
    panel.appendChild(detach);
  } else if (canBecomeComponent(node)) {
    const create = el('button', { 'aria-label': 'Create shared component' }, 'Create shared component');
    create.addEventListener('click', () => handlers.onCreateShared(node.id));
    panel.appendChild(create);
  }
}

function canBecomeComponent(node: DocumentNode): boolean {
  return node.type !== 'page';
}

function inputValueOf(value: string | { token: string } | undefined, _tokensByName: Map<string, Token>): string {
  if (value === undefined) return '';
  if (isTokenRef(value)) return value.token;
  return String(value);
}

function commitStyle(handlers: PanelHandlers, state: EditorState, node: DocumentNode, property: StyleProperty, raw: string): void {
  const trimmed = raw.trim();
  if (trimmed === '') return;
  // token names are 1-40 chars of lowercase
  if (/^[a-z0-9-]+$/.test(trimmed) && state.shownDocument()!.tokens.some((t) => t.name === trimmed)) {
    handlers.onSetStyle(node.id, state.bp, property, { token: trimmed });
  } else {
    handlers.onSetStyle(node.id, state.bp, property, trimmed);
  }
}

function openTokenList(state: EditorState, node: DocumentNode, property: StyleProperty, combo: HTMLInputElement, handlers: PanelHandlers): void {
  const doc = state.shownDocument()!;
  const kind = (property === 'color' || property === 'background-color') ? 'color' : 'size';
  const list = el('ul', { role: 'listbox', 'aria-label': `${property} token`, class: 'token-list' });
  const tokens = doc.tokens.filter((t) => t.kind === kind);
  combo.setAttribute('aria-expanded', 'true');
  tokens.forEach((t) => {
    const li = el('li', { role: 'option', 'aria-selected': 'false' }, t.name);
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      handlers.onSetStyle(node.id, state.bp, property, { token: t.name });
      closeTokenList(list, combo);
    });
    list.appendChild(li);
  });
  list.style.position = 'absolute';
  const rect = combo.getBoundingClientRect();
  list.style.left = `${rect.left}px`;
  list.style.top = `${rect.bottom}px`;
  list.style.zIndex = '1000';
  document.body.appendChild(list);
  const close = () => closeTokenList(list, combo);
  combo.addEventListener('blur', close, { once: true });
  list.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); combo.focus(); } });
  list.tabIndex = -1;
  // keyboard: arrow through
  list.addEventListener('keydown', (e) => {
    const options = [...list.querySelectorAll<HTMLElement>('[role="option"]')];
    const idx = options.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); (options[idx + 1] ?? options[0])?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (options[idx - 1] ?? options[options.length - 1])?.focus(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const name = (document.activeElement as HTMLElement).textContent ?? '';
      if (name) handlers.onSetStyle(node.id, state.bp, property, { token: name });
      close();
      combo.focus();
    }
  });
  (list.querySelector<HTMLElement>('[role="option"]'))?.focus();
}

function closeTokenList(list: HTMLElement, combo: HTMLInputElement): void {
  list.remove();
  combo.setAttribute('aria-expanded', 'false');
}

export function isFanOpen(): boolean {
  const canvas = document.getElementById('canvas');
  if (!canvas) return false;
  const fan = canvas.getAttribute('data-fan');
  return fan === 'open' || fan === 'opening';
}

function appendContentControls(container: HTMLElement, state: EditorState, node: DocumentNode, handlers: PanelHandlers): void {
  const readOnly = state.readonly || !state.canEdit;
  const add = (labelText: string, control: HTMLElement) => {
    const label = el('label', { class: 'style-row' });
    label.appendChild(el('span', { class: 'prop-name' }, labelText));
    const wrap = el('span', { class: 'style-controls' });
    wrap.appendChild(control);
    label.appendChild(wrap);
    container.appendChild(label);
  };
  const textish = node.type === 'heading' || node.type === 'text' || node.type === 'button';
  if (textish) {
    const text = el('input', { type: 'text', 'aria-label': 'Text' }) as HTMLInputElement;
    text.value = typeof node.props.text === 'string' ? node.props.text : '';
    if (readOnly) text.readOnly = true;
    text.addEventListener('change', () => handlers.onSetProp(node.id, 'text', text.value));
    add('Text', text);
  }
  if (node.type === 'heading') {
    const level = el('select', { 'aria-label': 'Heading level' }) as HTMLSelectElement;
    for (const [labelText, value] of [['Level 1', 1], ['Level 2', 2], ['Level 3', 3]] as const) {
      const opt = el('option', { value: String(value) }, labelText) as HTMLOptionElement;
      if (node.props.level === value) opt.selected = true;
      level.appendChild(opt);
    }
    if (readOnly) level.disabled = true;
    level.addEventListener('change', () => handlers.onSetProp(node.id, 'level', Number(level.value)));
    add('Heading level', level);
  }
  if (node.type === 'button') {
    const href = el('input', { type: 'text', 'aria-label': 'Link' }) as HTMLInputElement;
    href.value = typeof node.props.href === 'string' ? node.props.href : '';
    if (readOnly) href.readOnly = true;
    href.addEventListener('change', () => handlers.onSetProp(node.id, 'href', href.value));
    add('Link', href);
  }
  if (node.type === 'image') {
    const alt = el('input', { type: 'text', 'aria-label': 'Alt text' }) as HTMLInputElement;
    alt.value = typeof node.props.alt === 'string' ? node.props.alt : '';
    if (readOnly) alt.readOnly = true;
    alt.addEventListener('change', () => handlers.onSetProp(node.id, 'alt', alt.value));
    add('Alt text', alt);
    const fx = el('input', { type: 'range', min: '0', max: '100', step: '5', 'aria-label': 'Focal point horizontal' }) as HTMLInputElement;
    fx.value = String(typeof node.props.focalX === 'number' ? node.props.focalX : 50);
    if (readOnly) fx.disabled = true;
    fx.addEventListener('change', () => handlers.onSetProp(node.id, 'focalX', Number(fx.value)));
    fx.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const step = e.shiftKey ? 1 : 5;
        const cur = Number(fx.value);
        const next = e.key === 'ArrowRight' ? Math.min(100, cur + step) : Math.max(0, cur - step);
        fx.value = String(next);
        handlers.onSetProp(node.id, 'focalX', next);
        e.preventDefault();
      } else if (e.key === 'Home') { fx.value = '0'; handlers.onSetProp(node.id, 'focalX', 0); e.preventDefault(); }
      else if (e.key === 'End') { fx.value = '100'; handlers.onSetProp(node.id, 'focalX', 100); e.preventDefault(); }
    });
    add('Focal point horizontal', fx);
    const fy = el('input', { type: 'range', min: '0', max: '100', step: '5', 'aria-label': 'Focal point vertical' }) as HTMLInputElement;
    fy.value = String(typeof node.props.focalY === 'number' ? node.props.focalY : 50);
    if (readOnly) fy.disabled = true;
    fy.addEventListener('change', () => handlers.onSetProp(node.id, 'focalY', Number(fy.value)));
    fy.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const step = e.shiftKey ? 1 : 5;
        const cur = Number(fy.value);
        const next = e.key === 'ArrowDown' ? Math.min(100, cur + step) : Math.max(0, cur - step);
        fy.value = String(next);
        handlers.onSetProp(node.id, 'focalY', next);
        e.preventDefault();
      } else if (e.key === 'Home') { fy.value = '0'; handlers.onSetProp(node.id, 'focalY', 0); e.preventDefault(); }
      else if (e.key === 'End') { fy.value = '100'; handlers.onSetProp(node.id, 'focalY', 100); e.preventDefault(); }
    });
    add('Focal point vertical', fy);
  }
  // Bind to field, only inside a collection list template
  if (insideCollectionTemplate(state, node)) {
    const combo = el('select', { 'aria-label': 'Bind to field' }) as HTMLSelectElement;
    const doc = state.shownDocument()!;
    const none = el('option', { value: '' }, 'Not bound') as HTMLOptionElement;
    combo.appendChild(none);
    const main = node.type === 'image' ? 'imageId' : 'text';
    for (const field of doc.collection.fields) {
      const accepted = node.type === 'image' ? field.kind === 'image'
        : node.type === 'text' ? field.kind === 'text' || field.kind === 'rich_text'
        : field.kind === 'text';
      if (!accepted) continue;
      const opt = el('option', { value: field.name }, field.name) as HTMLOptionElement;
      if (node.bind?.[main] === field.name) opt.selected = true;
      combo.appendChild(opt);
    }
    if (readOnly) combo.disabled = true;
    combo.addEventListener('change', () => handlers.onBind(node.id, main, combo.value === '' ? null : combo.value));
    add('Bind to field', combo);
  }
}

function insideCollectionTemplate(state: EditorState, node: DocumentNode): boolean {
  const doc = state.shownDocument();
  const page = state.page();
  if (!doc || !page) return false;
  const walk = (n: DocumentNode, inside: boolean): boolean => {
    if (n.id === node.id) return inside;
    const nextInside = inside || n.type === 'collection_list';
    return n.children.some((c) => walk(c, nextInside));
  };
  return walk(page.root, false);
}
