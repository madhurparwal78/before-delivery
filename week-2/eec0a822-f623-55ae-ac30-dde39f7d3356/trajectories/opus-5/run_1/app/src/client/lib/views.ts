import { append, el, type Child } from './dom.js';

let nameCounter = 0;

function nextId(prefix: string): string {
  nameCounter += 1;
  return `${prefix}-${nameCounter}`;
}

export interface NamedList {
  readonly section: HTMLElement;
  readonly list: HTMLElement;
  setItems(items: readonly Child[]): void;
}

export function namedList(name: string, emptyText: string, extra: Child[] = []): NamedList {
  const headingId = nextId('list');
  const heading = el('h2', { class: 'section-heading', id: headingId }, name);
  const list = el('ul', { class: 'named-list', role: 'list', 'aria-labelledby': headingId });
  const empty = el('p', { class: 'empty-line' }, emptyText);
  const section = el('section', { class: 'named-section' }, heading, list, empty, ...extra);
  const setItems = (items: readonly Child[]): void => {
    list.replaceChildren();
    append(list, items);
    empty.hidden = items.length > 0;
  };
  setItems([]);
  return { section, list, setItems };
}

export interface StripList extends NamedList {
  readonly viewport: HTMLElement;
  readonly progress: HTMLElement;
}

/** A named list laid out as one horizontal strip from 1024 px, with its hairline. */
export function stripList(name: string, emptyText: string, progressName: string): StripList {
  const headingId = nextId('list');
  const heading = el('h2', { class: 'section-heading', id: headingId }, name);
  const list = el('ul', { class: 'named-list strip-track', role: 'list', 'aria-labelledby': headingId });
  const progress = progressBar(progressName);
  const viewport = el('div', { class: 'strip-viewport', tabindex: '-1' }, list);
  const empty = el('p', { class: 'empty-line' }, emptyText);
  const section = el(
    'section',
    { class: 'named-section' },
    heading,
    el('div', { class: 'strip' }, viewport, progress),
    empty,
  );
  const setItems = (items: readonly Child[]): void => {
    list.replaceChildren();
    append(list, items);
    empty.hidden = items.length > 0;
  };
  setItems([]);
  return { section, list, setItems, viewport, progress };
}

export function listItem(...children: Child[]): HTMLElement {
  return el('li', { class: 'list-row', role: 'listitem' }, ...children);
}

export interface DataTable {
  readonly section: HTMLElement;
  readonly table: HTMLElement;
  setRows(rows: readonly (readonly Child[])[]): void;
}

export function dataTable(
  name: string,
  columns: readonly string[],
  emptyText: string,
): DataTable {
  const head = el(
    'tr',
    { role: 'row' },
    ...columns.map((column) => el('th', { role: 'columnheader', scope: 'col' }, column)),
  );
  const body = el('tbody', { role: 'rowgroup' });
  const table = el(
    'table',
    { class: 'data-table', role: 'table' },
    el('caption', { class: 'table-caption' }, name),
    el('thead', { role: 'rowgroup' }, head),
    body,
  );
  const empty = el('p', { class: 'empty-line' }, emptyText);
  const section = el('section', { class: 'named-section' }, table, empty);
  const setRows = (rows: readonly (readonly Child[])[]): void => {
    body.replaceChildren();
    for (const row of rows) {
      append(
        body,
        [
          el(
            'tr',
            { role: 'row' },
            ...row.map((cell, index) =>
              el('td', { role: 'cell', 'data-label': columns[index] }, cell),
            ),
          ),
        ],
      );
    }
    empty.hidden = rows.length > 0;
  };
  setRows([]);
  return { section, table, setRows };
}

export function progressBar(name: string): HTMLElement {
  return el('div', {
    class: 'strip-progress',
    role: 'progressbar',
    'aria-label': name,
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': 0,
  });
}

export function figure(text: string): HTMLElement {
  return el('span', { class: 'figure' }, text);
}

export function definitionList(entries: readonly (readonly [string, Child])[]): HTMLElement {
  const list = el('dl', { class: 'definitions' });
  for (const [term, value] of entries) {
    append(list, [el('dt', {}, term), el('dd', {}, value)]);
  }
  return list;
}

export function textbox(label: string, value = '', type = 'text'): HTMLInputElement {
  return el('input', {
    class: 'textbox',
    type,
    value,
    'aria-label': label,
    autocomplete: 'off',
  }) as HTMLInputElement;
}

export function spinbutton(label: string, value: number, min: number, max: number): HTMLInputElement {
  return el('input', {
    class: 'textbox',
    type: 'number',
    value: String(value),
    min: String(min),
    max: String(max),
    step: '1',
    'aria-label': label,
  }) as HTMLInputElement;
}

export function combobox(
  label: string,
  options: readonly { readonly value: string; readonly label: string }[],
  selected?: string,
): HTMLSelectElement {
  const select = el('select', { class: 'combobox', 'aria-label': label }) as HTMLSelectElement;
  for (const option of options) {
    select.appendChild(
      el('option', { value: option.value, selected: option.value === selected }, option.label),
    );
  }
  if (selected !== undefined) select.value = selected;
  return select;
}

export interface RadioGroup {
  readonly node: HTMLElement;
  value(): string;
  onChange(listener: (value: string) => void): void;
}

export function radioGroup(
  label: string,
  options: readonly { readonly value: string; readonly label: string }[],
  selected: string,
): RadioGroup {
  const name = nextId('radio');
  const listeners: ((value: string) => void)[] = [];
  const node = el('fieldset', { class: 'radio-group', role: 'radiogroup', 'aria-label': label });
  for (const option of options) {
    const input = el('input', {
      type: 'radio',
      name,
      value: option.value,
      checked: option.value === selected,
      id: `${name}-${option.value}`,
    }) as HTMLInputElement;
    input.addEventListener('change', () => {
      if (input.checked) for (const listener of listeners) listener(option.value);
    });
    node.appendChild(
      el('label', { class: 'radio-option' }, input, el('span', {}, option.label)),
    );
  }
  return {
    node,
    value: () => (node.querySelector<HTMLInputElement>('input:checked')?.value ?? selected),
    onChange: (listener) => listeners.push(listener),
  };
}

export function button(label: string, extra: Record<string, string> = {}): HTMLButtonElement {
  return el('button', { type: 'button', class: 'button', ...extra }, label) as HTMLButtonElement;
}

export function quietButton(label: string): HTMLButtonElement {
  return el('button', { type: 'button', class: 'button-quiet' }, label) as HTMLButtonElement;
}

export function columns(left: Child[], right: Child[]): HTMLElement {
  return el(
    'div',
    { class: 'two-columns' },
    el('div', { class: 'column' }, ...left),
    el('div', { class: 'column' }, ...right),
  );
}

export function hullDrawing(name: string, lengthM: number, beamM: number): HTMLElement {
  const width = 260;
  const height = Math.max(90, Math.round((width * beamM) / lengthM) + 54);
  const waterline = height - 18;
  const hullDepth = 16;
  const deck = waterline - hullDepth;
  const bridge = deck - 10;
  const cabin = bridge - Math.max(14, Math.round((width * beamM) / lengthM / 2));
  const mast = 10;
  const shapes = [
    `M12 ${deck} L${width - 46} ${deck} Q${width - 12} ${deck + 4} ${width - 16} ${waterline} L30 ${waterline} Q12 ${waterline - 6} 12 ${deck} Z`,
    `M34 ${bridge} L${width - 60} ${bridge} L${width - 60} ${deck} L34 ${deck} Z`,
    `M52 ${bridge} L${width - 86} ${bridge} Q${width - 74} ${cabin + 6} ${width - 96} ${cabin} L66 ${cabin} Q54 ${cabin + 4} 52 ${bridge} Z`,
    `M${width - 104} ${cabin} L${width - 112} ${mast}`,
    `M${width - 112} ${mast} L${width - 60} ${bridge - 4}`,
    `M18 ${waterline + 8} L${width - 18} ${waterline + 8}`,
  ];
  const host = el('div', { class: 'hull-drawing', role: 'img', 'aria-label': `${name} hull drawing` });
  host.innerHTML =
    `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true" focusable="false">` +
    shapes.map((shape) => `<path d="${shape}" />`).join('') +
    '</svg>';
  return host;
}
