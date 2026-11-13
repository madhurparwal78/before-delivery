import { h } from './dom.js';
import { get, patch } from './api.js';
import type { CapTable, LedgerEntry } from './api.js';
import { shell, page, replaceAddress, announce } from './app.js';
import { onEvent } from './socket.js';
import { fmtInstant } from './format.js';

const COLUMNS = [
  { key: 'holder', label: 'Holder', numeric: false },
  { key: 'issued_shares', label: 'Issued shares', numeric: true },
  { key: 'options_outstanding', label: 'Options outstanding', numeric: true },
  { key: 'fully_diluted', label: 'Fully diluted', numeric: true },
  { key: 'ownership', label: 'Ownership', numeric: true },
];

function sortRows(rows: CapTable['rows'], sortKey: string | null, dir: 'asc' | 'desc' | null): CapTable['rows'] {
  if (!sortKey || !dir) return rows;
  const sorted = [...rows].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'holder') {
      cmp = a.label.localeCompare(b.label, 'en', { sensitivity: 'base' });
    } else {
      const av = sortKey === 'ownership' ? Number(a.ownership) : (a as unknown as Record<string, number>)[sortKey]!;
      const bv = sortKey === 'ownership' ? Number(b.ownership) : (b as unknown as Record<string, number>)[sortKey]!;
      cmp = av - bv;
    }
    return dir === 'asc' ? cmp : -cmp;
  });
  return sorted;
}

page('/cap-table', undefined, async (root, ctx) => {
  const person = ctx.person;
  const isAdmin = person.role === 'founder_admin';

  const query = ctx.query;
  let sortKey: string | null = query.get('sort') || null;
  let sortDir: 'asc' | 'desc' | null = (query.get('dir') as 'asc' | 'desc' | null) || null;
  const holderParam = query.get('holder');
  // The selected holder lives outside draw(): a redraw never resets it.
  let selected = holderParam;

  // Only one draw runs at a time; the latest request replaces any pending one.
  let drawing: Promise<void> = Promise.resolve();
  function enqueueDraw(): Promise<void> {
    const next = drawing.then(() => draw());
    drawing = next.catch(() => undefined);
    return next;
  }

  async function draw(): Promise<void> {
    const cap = await get<CapTable>('/api/cap-table');
    const rows = sortRows(cap.rows, sortKey, sortDir);

    const table = h('table', { role: 'grid', 'aria-label': 'Cap table', id: 'cap-grid' }) as HTMLTableElement;
    const thead = h('thead', null);
    const headerRow = h('tr', { role: 'row' });
    for (const col of COLUMNS) {
      const th = h('th', {
        role: 'columnheader',
        tabindex: '-1',
        'aria-sort': sortKey === col.key ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none',
        'data-col': col.key,
      }, col.label);
      th.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          sortColumn(col.key);
        }
      });
      th.addEventListener('click', (ev) => {
        if (ev instanceof KeyboardEvent) return;
        sortColumn(col.key);
      });
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = h('tbody', null);
    for (const r of rows) {
      const tr = h('tr', { role: 'row', 'data-row': r.key, tabindex: '-1' });
      const cells = [
        h('td', { role: 'gridcell', tabindex: '-1', 'data-col': 'holder' }, r.label),
        h('td', { role: 'gridcell', tabindex: '-1', 'data-col': 'issued_shares', class: 'num' }, r.issued_shares.toLocaleString('en-US')),
        h('td', { role: 'gridcell', tabindex: '-1', 'data-col': 'options_outstanding', class: 'num' }, r.options_outstanding.toLocaleString('en-US')),
        h('td', { role: 'gridcell', tabindex: '-1', 'data-col': 'fully_diluted', class: 'num' }, r.fully_diluted.toLocaleString('en-US')),
        h('td', { role: 'gridcell', tabindex: '-1', 'data-col': 'ownership', class: 'num percent' }, r.ownership),
      ];
      for (const c of cells) {
        c.addEventListener('click', () => {
          focusCell(r.key, (c as HTMLElement).dataset.col!);
        });
        tr.appendChild(c);
      }
      tr.addEventListener('click', () => {
        focusCell(r.key, 'holder');
      });

      tbody.appendChild(tr);
    }
    // The Total row stays last.
    const totalRow = h('tr', { role: 'row', 'data-row': 'total', class: 'total', tabindex: '-1' },
      h('td', { role: 'gridcell', tabindex: '-1', 'data-col': 'holder' }, 'Total'),
      h('td', { role: 'gridcell', tabindex: '-1', 'data-col': 'issued_shares', class: 'num' }, ''),
      h('td', { role: 'gridcell', tabindex: '-1', 'data-col': 'options_outstanding', class: 'num' }, ''),
      h('td', { role: 'gridcell', tabindex: '-1', 'data-col': 'fully_diluted', class: 'num' }, cap.fully_diluted_total.toLocaleString('en-US')),
      h('td', { role: 'gridcell', tabindex: '-1', 'data-col': 'ownership', class: 'num percent' }, '100.00'),
    );
    tbody.appendChild(totalRow);
    table.appendChild(tbody);

    function focusCell(rowKey: string, colKey: string): void {
      const cell = table.querySelector<HTMLElement>(`tr[data-row="${rowKey}"] td[data-col="${colKey}"]`);
      if (cell) {
        setTabStop(cell);
      }
    }

    let focused: HTMLElement | null = null;

    function setTabStop(cell: HTMLElement): void {
      if (focused) focused.removeAttribute('tabindex');
      focused = cell;
      table.setAttribute('tabindex', '0');
      cell.setAttribute('tabindex', '0');
      cell.focus();
      scrollCellIntoView(cell);
    }

    function scrollCellIntoView(cell: HTMLElement): void {
      const rect = cell.getBoundingClientRect();
      const region = table.closest('.grid-scroll')?.getBoundingClientRect();
      if (region && (rect.left < region.left || rect.right > region.right)) {
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        cell.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', inline: 'center', block: 'nearest' });
      }
    }

    table.addEventListener('keydown', (ev) => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return;
      const cell = active.closest('td, th') as HTMLElement | null;
      if (!cell) return;
      const rowEl = cell.closest('tr') as HTMLElement | null;
      if (!rowEl) return;
      const colKey = cell.dataset.col!;
      const rowKey = rowEl.dataset.row!;
      const cols = COLUMNS.map((c) => c.key);
      const colIdx = cols.indexOf(colKey);

      const move = (dk: number, dr: number): void => {
        ev.preventDefault();
        const rowsEl = Array.from(table.querySelectorAll<HTMLTableRowElement>('tr'));
        const rIdx = rowsEl.indexOf(rowEl as HTMLTableRowElement);
        const nextRow = rowsEl[rIdx + dr];
        if (!nextRow) return;
        const nextCell = nextRow.querySelector<HTMLElement>(`[data-col="${cols[Math.max(0, Math.min(cols.length - 1, colIdx + dk))]}"]`);
        if (nextCell) setTabStop(nextCell);
      };

      switch (ev.key) {
        case 'ArrowRight': move(1, 0); break;
        case 'ArrowLeft': move(-1, 0); break;
        case 'ArrowDown': move(0, 1); break;
        case 'ArrowUp': move(0, -1); break;
        case 'Home': {
          ev.preventDefault();
          const first = rowEl.querySelector<HTMLElement>('[data-col]');
          if (first) setTabStop(first);
          break;
        }
        case 'End': {
          ev.preventDefault();
          const last = rowEl.querySelector<HTMLElement>(`[data-col="${cols[cols.length - 1]}"]`);
          if (last) setTabStop(last);
          break;
        }
        case 'Enter':
        case ' ': {
          if (cell instanceof HTMLTableCellElement && cell.tagName === 'TH') {
            // header sorting handled by its own listener
            break;
          }
          if (isAdmin && colKey === 'holder' && rowKey !== 'pool' && rowKey !== 'total' && rowKey !== 'others') {
            ev.preventDefault();
            if (selected === rowKey) void closeDetail();
            else void selectHolder(rowKey);
          }
          break;
        }
        case 'Escape': {
          if (isAdmin && selected) {
            ev.preventDefault();
            void closeDetail();
          }
          break;
        }
      }

      if (ev.ctrlKey && ev.key === 'Home') {
        ev.preventDefault();
        const first = table.querySelector<HTMLElement>('tbody td[data-col="holder"]');
        if (first) setTabStop(first);
      }
      if (ev.ctrlKey && ev.key === 'End') {
        ev.preventDefault();
        const last = table.querySelector<HTMLElement>('tr[data-row="total"] td[data-col="ownership"]');
        if (last) setTabStop(last);
      }
    });

    function sortColumn(colKey: string): void {
      const firstDir: 'asc' | 'desc' = colKey === 'holder' ? 'asc' : 'desc';
      if (sortKey === colKey) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortKey = colKey;
        sortDir = firstDir;
      }
      const params = new URLSearchParams();
      params.set('sort', sortKey);
      params.set('dir', sortDir!);
      if (selected) params.set('holder', selected);
      replaceAddress(`/cap-table?${params.toString()}`);
      void enqueueDraw();
    }

    // ---------- holder detail (admin) ----------

    const detail = h('section', { role: 'region', 'aria-label': 'Holder detail', id: 'holder-detail' });
    const detailWrap = h('div', { id: 'detail-wrap' }, detail);

    async function selectHolder(rowKey: string): Promise<void> {
      selected = rowKey;
      const params = new URLSearchParams();
      if (sortKey) { params.set('sort', sortKey); params.set('dir', sortDir!); }
      params.set('holder', rowKey);
      replaceAddress(`/cap-table?${params.toString()}`);
      await enqueueDraw();
      refocus(rowKey, 'holder');
    }

    async function closeDetail(): Promise<void> {
      selected = null;
      const params = new URLSearchParams();
      if (sortKey) { params.set('sort', sortKey); params.set('dir', sortDir!); }
      replaceAddress(params.toString() ? `/cap-table?${params.toString()}` : '/cap-table');
      await enqueueDraw();
    }

    /** Restores keyboard focus to a cell of the redrawn grid. */
    function refocus(rowKey: string, colKey: string): void {
      const cell = document.querySelector<HTMLElement>(`#cap-grid tr[data-row="${rowKey}"] [data-col="${colKey}"]`);
      if (cell) {
        cell.setAttribute('tabindex', '0');
        cell.focus();
      }
    }

    async function drawDetail(): Promise<void> {
      if (!selected) {
        detail.replaceChildren();
        detailWrap.style.display = 'none';
        return;
      }
      const row = cap.rows.find((r) => r.key === selected);
      if (!row) {
        detail.replaceChildren();
        detailWrap.style.display = 'none';
        return;
      }
      detailWrap.style.display = '';
      const { entries } = await get<{ entries: LedgerEntry[] }>('/api/ledger');
      const mine = entries.filter((e) => e.holder_id === selected);
      const tbl = h('table', { 'aria-label': 'Holder ledger' },
        h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Entry'), h('th', { class: 'num' }, 'Shares'), h('th', { class: 'num' }, 'Options'))),
        h('tbody', {}, ...mine.map((e) => h('tr', {},
            h('td', {}, fmtInstant(e.at)),
            h('td', {}, e.kind),
            h('td', { class: 'num' }, e.shares_delta.toLocaleString('en-US')),
            h('td', { class: 'num' }, e.options_delta.toLocaleString('en-US')),
          )),
        ),
      );
      detail.replaceChildren(h('h2', {}, row.label), tbl);
    }

    // ---------- option pool (admin) ----------

    const poolPanel = h('section', { role: 'region', 'aria-label': 'Option pool', id: 'pool-panel' });
    if (isAdmin) {
      const pool = await get<{ authorized: number; outstanding: number; exercised: number; reserved: number; available: number }>('/api/pool');
      const poolInput = h('input', { type: 'text', inputmode: 'numeric', id: 'pool-size', 'aria-label': 'Pool size' });
      const resizeBtn = h('button', { class: 'primary' }, 'Resize pool') as HTMLButtonElement;
      resizeBtn.addEventListener('click', async () => {
        const n = Number((poolInput as HTMLInputElement).value.trim());
        try {
          await patch('/api/pool', { authorized: n });
          announce(`Option pool resized to ${n} options.`, `pool-${n}`);
          await enqueueDraw();
        } catch (e) {
          const err = e as { message?: string };
          announce(err.message ?? '', 'pool-fail');
        }
      });
      poolPanel.replaceChildren(
        h('h2', {}, 'Option pool'),
        h('div', { class: 'figures' },
          h('div', { class: 'value' }, h('div', { class: 'label' }, 'Authorized'), h('div', { class: 'num' }, pool.authorized.toLocaleString('en-US'))),
          h('div', { class: 'value' }, h('div', { class: 'label' }, 'Outstanding'), h('div', { class: 'num' }, pool.outstanding.toLocaleString('en-US'))),
          h('div', { class: 'value' }, h('div', { class: 'label' }, 'Exercised'), h('div', { class: 'num' }, pool.exercised.toLocaleString('en-US'))),
          h('div', { class: 'value' }, h('div', { class: 'label' }, 'Reserved'), h('div', { class: 'num' }, pool.reserved.toLocaleString('en-US'))),
          h('div', { class: 'value' }, h('div', { class: 'label' }, 'Available'), h('div', { class: 'num' }, pool.available.toLocaleString('en-US'))),
        ),
        h('form', { class: 'narrow', onsubmit: (ev: Event) => ev.preventDefault() },
          h('label', { for: 'pool-size' }, 'Pool size'),
          poolInput,
          resizeBtn,
        ),
      );
    }

    content.replaceChildren(
      h('h1', {}, 'Cap table'),
      h('div', { class: 'grid-scroll' }, table),
      detailWrap,
      ...(isAdmin ? [poolPanel, h('p', {}, h('a', { href: '/admin/ledger', onclick: (ev: Event) => { ev.preventDefault(); void import('./app.js').then((m) => m.navigate('/admin/ledger')); } }, 'Securities ledger'))] : []),
    );

    await drawDetail();
  }

  const content = h('div', {});
  root.appendChild(shell(person, content));
  await draw();

  // Open an address with holder= shows the detail on the first render with focus on that row.
  if (holderParam) {
    const cell = document.querySelector<HTMLElement>(`tr[data-row="${holderParam}"] td[data-col="holder"]`);
    if (cell) {
      cell.setAttribute('tabindex', '0');
      cell.focus();
    }
  }

  // Live cap-table changes redraw the grid, keeping focus by row and column.
  onEvent((ev) => {
    if (ev.type === 'cap_table_changed') {
      void redrawFromOutside();
    }
  });

  async function redrawFromOutside(): Promise<void> {
    const keep = document.activeElement instanceof HTMLElement
      ? { row: (document.activeElement.closest('tr') as HTMLElement | null)?.dataset.row ?? null, col: (document.activeElement as HTMLElement).dataset.col ?? null }
      : null;
    await enqueueDraw();
    if (keep?.row && keep.col) {
      const cell = document.querySelector<HTMLElement>(`#cap-grid tr[data-row="${keep.row}"] [data-col="${keep.col}"]`);
      if (cell) {
        cell.setAttribute('tabindex', '0');
        cell.focus();
      }
    }
  }
});
