import { group, inches, pounds, squareFeet, squareMetres } from '../src/shared/units';

/** Small DOM helpers, the live regions, dialogs and the paired-unit formatting. */

type Attributes = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) node.append(child);
  return node;
}

export function svgEl(tag: string, attributes: Attributes = {}, children: readonly Node[] = []): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(name, String(value));
  }
  for (const child of children) node.append(child);
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/* ------------------------------------------------------------------ units */

/** Every length shows millimetres then inches. */
export function lengthPair(mm: number): string {
  return `${group(String(mm))} mm (${group(inches(mm))} in)`;
}

/** Every area shows square metres then square feet. */
export function areaPair(mm2: number): string {
  return `${group(squareMetres(mm2))} m² (${group(squareFeet(mm2))} ft²)`;
}

export function money(pence: number): string {
  return `£${group(pounds(pence))}`;
}

export function groupedMm(mm: number): string {
  return group(String(mm));
}

export function groupedInches(mm: number): string {
  return group(inches(mm));
}

export function instantText(instant: string | null): string {
  if (instant === null || instant === '') return '';
  return `${instant.slice(0, 10)} ${instant.slice(11, 16)}`;
}

/* ------------------------------------------------------------------ live regions */

const statusRegion = (): HTMLElement => document.getElementById('loft-status') as HTMLElement;
const alertRegion = (): HTMLElement => document.getElementById('loft-alert') as HTMLElement;

export function announce(copy: string): void {
  alertRegion().textContent = '';
  const region = statusRegion();
  region.textContent = '';
  // A fresh text node makes the polite region announce again.
  window.setTimeout(() => {
    region.textContent = copy;
  }, 0);
}

export function announceNow(copy: string): void {
  statusRegion().textContent = copy;
}

export function refuse(copy: string): void {
  statusRegion().textContent = '';
  alertRegion().textContent = copy;
}

export function clearLive(): void {
  statusRegion().textContent = '';
  alertRegion().textContent = '';
}

/* ------------------------------------------------------------------ motion */

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function durationOf(milliseconds: number): number {
  return reducedMotion() ? 0 : milliseconds;
}

/** Counts a figure to its new value, landing exactly on the server's number. */
export function countTo(
  node: HTMLElement,
  from: number,
  to: number,
  render: (value: number) => string,
  milliseconds: number,
): void {
  const duration = durationOf(milliseconds);
  if (duration === 0 || from === to) {
    node.textContent = render(to);
    return;
  }
  const started = performance.now();
  const tick = (at: number): void => {
    const through = Math.min(1, (at - started) / duration);
    const eased = 1 - (1 - through) ** 3;
    node.textContent = render(Math.round(from + (to - from) * eased));
    if (through < 1) requestAnimationFrame(tick);
    else node.textContent = render(to);
  };
  requestAnimationFrame(tick);
}

/** A ledger page's rows fade and slide in, with row 10's delay shared after it. */
export function staggerRows(rows: readonly HTMLElement[]): void {
  rows.forEach((row, index) => {
    const step = Math.min(index + 1, 10);
    row.style.setProperty('--delay', `${reducedMotion() ? 0 : step * 30}ms`);
    row.classList.add('in');
  });
}

/* ------------------------------------------------------------------ dialogs */

export interface DialogField {
  readonly name: string;
  readonly label: string;
  readonly type?: 'text' | 'password' | 'date' | 'number' | 'file' | 'instant';
  readonly value?: string;
  readonly options?: readonly { value: string; label: string }[];
  readonly accept?: string;
}

export interface DialogSpec {
  readonly title: string;
  readonly submit: string;
  readonly fields: readonly DialogField[];
  readonly onSubmit: (values: Record<string, string>, files: Record<string, File | null>) => Promise<void>;
}

let openDialog: HTMLDialogElement | null = null;

export function dialogIsOpen(): boolean {
  return openDialog !== null;
}

/**
 * Opens a dialog: focus moves to its first field, Tab wraps inside it, Escape
 * closes it without saving, and focus returns to the control that opened it.
 */
export function showDialog(spec: DialogSpec, opener: HTMLElement | null): void {
  const node = el('dialog', { 'aria-label': spec.title });
  node.append(el('h2', { text: spec.title }));
  const form = el('form', { method: 'dialog' });

  for (const field of spec.fields) {
    const id = `dlg-${field.name}`;
    const wrap = el('p', { class: 'field' }, [el('label', { for: id, text: field.label })]);
    if (field.options) {
      const select = el('select', { id, name: field.name });
      for (const option of field.options) {
        select.append(el('option', { value: option.value, text: option.label, selected: option.value === field.value }));
      }
      wrap.append(select);
    } else {
      wrap.append(
        el('input', {
          id,
          name: field.name,
          type: field.type === 'instant' ? 'text' : (field.type ?? 'text'),
          value: field.value ?? '',
          accept: field.accept ?? null,
          'aria-describedby': `${id}-error`,
        }),
      );
    }
    wrap.append(el('span', { class: 'fielderror', id: `${id}-error` }));
    form.append(wrap);
  }

  const submit = el('button', { class: 'action', type: 'submit', text: spec.submit });
  const cancel = el('button', { type: 'button', text: 'Cancel' });
  form.append(el('div', { class: 'dialog-actions' }, [submit, cancel]));
  node.append(form);
  document.body.append(node);
  openDialog = node;

  const close = (): void => {
    node.close();
    node.remove();
    openDialog = null;
    opener?.focus();
  };

  cancel.addEventListener('click', close);
  node.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });

  node.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusable = [...node.querySelectorAll<HTMLElement>('input, select, button')].filter(
      (item) => !item.hasAttribute('disabled'),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const values: Record<string, string> = {};
    const files: Record<string, File | null> = {};
    for (const field of spec.fields) {
      const control = node.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${field.name}"]`);
      if (control === null) continue;
      if (control instanceof HTMLInputElement && control.type === 'file') {
        files[field.name] = control.files?.[0] ?? null;
        continue;
      }
      values[field.name] = control.value;
    }
    for (const field of spec.fields) {
      const error = node.querySelector(`#dlg-${field.name}-error`);
      if (error) error.textContent = '';
    }
    void spec.onSubmit(values, files).then(
      () => close(),
      (cause: unknown) => {
        showFieldErrors(node, cause);
      },
    );
  });

  node.showModal();
  const firstField = node.querySelector<HTMLElement>('input, select');
  firstField?.focus();
}

/** Field errors appear under their field and are linked to it. */
export function showFieldErrors(scope: ParentNode, cause: unknown): void {
  const fields = (cause as { fields?: Record<string, string> }).fields ?? {};
  const message = (cause as { message?: string }).message ?? '';
  let placed = false;
  for (const [member, copy] of Object.entries(fields)) {
    // An inch or millimetre error both belong under Measured length.
    const target =
      member === 'value_in' || member === 'value_mm'
        ? (scope.querySelector('#dlg-value_mm-error') ?? scope.querySelector('#dlg-value-error'))
        : member === 'amount_pence'
          ? scope.querySelector('#dlg-amount-error')
          : scope.querySelector(`#dlg-${member}-error`);
    if (target) {
      target.textContent = copy;
      placed = true;
    }
  }
  if (!placed && message !== '') refuse(message);
}

/* ------------------------------------------------------------------ layout */

export type Layout = 'desktop' | 'tablet' | 'phone';

export function layoutOf(width: number): Layout {
  if (width >= 1024) return 'desktop';
  if (width >= 600) return 'tablet';
  return 'phone';
}

export function currentLayout(): Layout {
  return layoutOf(window.innerWidth);
}

const layoutListeners = new Set<(layout: Layout) => void>();
let lastLayout: Layout | null = null;

export function onLayoutChange(listener: (layout: Layout) => void): () => void {
  layoutListeners.add(listener);
  return () => layoutListeners.delete(listener);
}

window.addEventListener('resize', () => {
  const layout = currentLayout();
  if (layout === lastLayout) return;
  lastLayout = layout;
  for (const listener of layoutListeners) listener(layout);
});

lastLayout = currentLayout();

/* ------------------------------------------------------------------ tables */

export interface Column<Row> {
  readonly header: string;
  readonly cell: (row: Row) => Node | string;
}

export function table<Row>(
  label: string,
  columns: readonly Column<Row>[],
  rows: readonly Row[],
): HTMLTableElement {
  const head = el('thead', {}, [
    el(
      'tr',
      {},
      columns.map((column) => el('th', { scope: 'col', text: column.header })),
    ),
  ]);
  const bodyRows = rows.map((row) =>
    el(
      'tr',
      {},
      columns.map((column) => {
        const cell = el('td', { 'data-label': column.header });
        cell.append(column.cell(row));
        return cell;
      }),
    ),
  );
  const node = el('table', { 'aria-label': label }, [head, el('tbody', {}, bodyRows)]);
  staggerRows(bodyRows);
  return node;
}

export function chip(label: string, flag = false): HTMLElement {
  return el('span', { class: flag ? 'chip flag' : 'chip', text: label });
}

export function poster(figure: string, basis?: string): HTMLElement {
  const node = el('p', { class: 'poster' }, [document.createTextNode(figure)]);
  if (basis !== undefined) node.append(el('small', { text: basis }));
  return node;
}
