import { formatCost } from '../../shared/cost';
import { partLabels } from '../../shared/part-label';
import type { Part } from '../../shared/types';
import { del } from '../api';
import { h, replace } from '../dom';
import type { Binding } from './commits';
import { bindControl, cell } from './fields';
import type { Editor } from './editor';

const decimals = (currency: string) => (currency === 'JPY' ? 0 : 2);

/** Price typed in major units ("18.90", or "1240" for yen) and held in minor units. */
function priceToMinor(text: string, currency: string): number | null {
  const pattern = currency === 'JPY' ? /^\d+$/ : /^\d+(\.\d{1,2})?$/;
  if (!pattern.test(text.trim())) return null;
  return currency === 'JPY' ? Number(text) : Math.round(Number(text) * 100);
}

const minorToPrice = (minor: number, currency: string) => (currency === 'JPY' ? String(minor) : (minor / 100).toFixed(decimals(currency)));

/** The part tree (Up and Down move, Right opens, Left closes, Enter selects), the selected part's fields and the unbound list. */
export class PartsPane {
  readonly element: HTMLElement;
  private readonly tree = h('ul', { role: 'tree', 'aria-label': 'Model parts', class: 'part-tree' });
  private readonly fields = h('div', { class: 'part-fields' });
  private readonly unbound = h('ul', { 'aria-label': 'Unbound parts', class: 'unbound-list' });
  private bindings: Binding[] = [];
  private readonly open = new Set<string>();
  private focused: string | null = null;

  constructor(private readonly editor: Editor) {
    this.element = h('div', { class: 'pane parts-pane' }, h('h2', {}, 'Parts'), this.tree, this.unbound, this.fields);
  }

  private parentOf(part: Part, parts: Part[]): Part | undefined {
    return parts
      .filter((p) => p.id !== part.id && part.node_path.startsWith(`${p.node_path}/`))
      .sort((a, b) => b.node_path.length - a.node_path.length)[0];
  }

  sync(): void {
    const { state } = this.editor;
    const parts = state.work.parts;
    const labels = partLabels(parts);
    const children = new Map<string | null, Part[]>();
    for (const part of parts) {
      const parent = this.parentOf(part, parts)?.id ?? null;
      children.set(parent, [...(children.get(parent) ?? []), part]);
    }
    const currency = state.work.currency;
    const stepTitle = (id: string | null) => (id ? `step ${state.stepNumber(id)}` : '');
    const item = (part: Part): HTMLElement => {
      const kids = children.get(part.id) ?? [];
      const price = part.fitted_at ? `${formatCost(part.unit_price, currency)} at ${stepTitle(part.fitted_at)}` : '';
      const li = h('li', {
        role: 'treeitem', 'aria-label': labels.get(part.id), 'aria-selected': String(state.selectedPart === part.id),
        'aria-expanded': kids.length ? String(this.open.has(part.id)) : undefined, tabindex: this.focused === part.id || (!this.focused && parts[0]?.id === part.id) ? 0 : -1,
        'aria-description': price || undefined, 'data-part-id': part.id, class: 'tree-item',
      }, h('span', { class: 'tree-label' }, part.name));
      // The price sits beside the item, not inside it: the item's accessible name is its part label alone, and aria-description carries the price.
      const wrapper = h('li', { role: 'none', class: 'tree-node' }, li, price ? h('span', { class: 'tree-price', 'aria-hidden': 'true' }, price) : null);
      if (kids.length && this.open.has(part.id)) wrapper.append(h('ul', { role: 'group' }, ...kids.map(item)));
      return wrapper;
    };
    replace(this.tree, ...(children.get(null) ?? []).map(item));
    replace(this.unbound, ...parts.filter((p) => p.unbound).map((p) => h('li', {}, p.name)));
  }

  private visible(): HTMLElement[] {
    return [...this.tree.querySelectorAll<HTMLElement>('[role=treeitem]')];
  }

  bindTree(): void {
    this.tree.addEventListener('focusin', (event) => {
      const id = (event.target as HTMLElement).dataset.partId;
      if (id) this.focused = id;
    });
    this.tree.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const row = target.closest<HTMLElement>('.tree-price')?.previousElementSibling as HTMLElement | null | undefined;
      const id = (row ?? target.closest<HTMLElement>('[role=treeitem]'))?.dataset.partId;
      if (id) this.focusItem(id);
    });
    this.tree.addEventListener('keydown', (event) => {
      const current = (event.target as HTMLElement).closest<HTMLElement>('[role=treeitem]');
      if (!current) return;
      const id = current.dataset.partId!;
      const items = this.visible();
      const at = items.indexOf(current);
      const hasKids = current.hasAttribute('aria-expanded');
      if (event.key === 'ArrowDown') items[Math.min(items.length - 1, at + 1)]?.focus();
      else if (event.key === 'ArrowUp') items[Math.max(0, at - 1)]?.focus();
      else if (event.key === 'ArrowRight') {
        if (hasKids && !this.open.has(id)) this.toggle(id, true);
        else items[at + 1]?.focus();
      } else if (event.key === 'ArrowLeft') this.toggle(id, false);
      else if (event.key === 'Enter') this.editor.selectPart(id);
      else return;
      event.preventDefault();
    });
  }

  private focusItem(id: string): void {
    this.focused = id;
    this.tree.querySelector<HTMLElement>(`[data-part-id="${id}"]`)?.focus();
  }

  private toggle(id: string, open: boolean): void {
    if (open) this.open.add(id);
    else this.open.delete(id);
    this.sync();
    this.focusItem(id);
  }

  syncFields(): void {
    const { state, committer } = this.editor;
    for (const b of this.bindings) committer.unregister(b.path);
    this.bindings = [];
    const part = state.selectedPart ? state.part(state.selectedPart) : undefined;
    if (!part) return replace(this.fields, h('p', { class: 'hint' }, 'Select a part to edit it.'));
    const currency = state.work.currency;
    const base = `part/${part.id}`;
    const spec = { state, committer };
    const label = () => `Edit part ${state.part(part.id)?.name ?? part.name}`;
    const plain = (v: unknown) => String(v ?? '');
    const name = h('input', { type: 'text', autocomplete: 'off' });
    const axis = h('select', {}, ...['x', 'y', 'z'].map((a) => h('option', { value: a }, a.toUpperCase())));
    const distance = h('input', { type: 'number', step: 'any' });
    const quantity = h('input', { type: 'number', min: 1, max: 999, step: 1 });
    const price = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off' });
    const fitted = h('select', {}, h('option', { value: '' }, 'Not fitted new'), ...state.work.steps.map((s) => h('option', { value: s.id }, `Step ${s.number}`)));
    for (const [control, text] of [[name, 'Part name'], [axis, 'Apart axis'], [distance, 'Apart distance in millimetres'], [quantity, 'Quantity'], [price, 'Unit price'], [fitted, 'Fitted at step']] as const)
      control.setAttribute('aria-label', text);
    const numberOr = (v: string) => (v.trim() === '' || Number.isNaN(Number(v)) ? null : Number(v));
    this.bindings = [
      bindControl({ ...spec, path: `${base}/name`, label: 'Part name', control: name, toText: plain, fromText: (v) => v, undoLabel: label }),
      bindControl({ ...spec, path: `${base}/axis`, label: 'Apart axis', control: axis, toText: plain, fromText: (v) => v, undoLabel: label }),
      bindControl({ ...spec, path: `${base}/apart_mm`, label: 'Apart distance in millimetres', control: distance, toText: plain, fromText: numberOr, undoLabel: label }),
      bindControl({ ...spec, path: `${base}/quantity`, label: 'Quantity', control: quantity, toText: plain, fromText: numberOr, undoLabel: label }),
      bindControl<number>({ ...spec, path: `${base}/unit_price`, label: 'Unit price', control: price, toText: (v) => minorToPrice(v, currency), fromText: (v) => priceToMinor(v, currency), undoLabel: label }),
      bindControl<string | null>({ ...spec, path: `${base}/fitted_at`, label: 'Fitted at step', control: fitted, toText: (v) => v ?? '', fromText: (v) => v || null, undoLabel: label }),
    ];
    for (const b of this.bindings) b.show(state.read(b.path));
    const remove = h('button', { type: 'button', class: 'button quiet' }, 'Remove part');
    remove.addEventListener('click', async () => {
      await del(`/api/guides/${this.editor.guideId}/parts/${part.id}`);
      state.selectedPart = null;
      await this.editor.reloadWorking();
    });
    const nodes = this.editor.nodePaths;
    const bind = part.unbound
      ? cell('part-bind', 'Bind to node', Object.assign(h('select', { 'aria-label': 'Bind to node' }, h('option', { value: '' }, 'Choose a node'), ...nodes.map((n) => h('option', { value: n }, n))), {}))
      : null;
    if (bind) {
      const select = bind.querySelector('select')!;
      select.addEventListener('change', () => select.value && void committer.commit(`${base}/node_path`, select.value, { undoLabel: label() }).then(() => this.editor.reloadWorking()));
    }
    replace(this.fields, h('h3', {}, part.name),
      h('div', { class: 'form' },
        cell('part-name', 'Part name', name), cell('part-axis', 'Apart axis', axis), cell('part-distance', 'Apart distance in millimetres', distance),
        cell('part-quantity', 'Quantity', quantity), cell('part-price', 'Unit price', price), cell('part-fitted', 'Fitted at step', fitted), bind),
      remove);
  }
}
