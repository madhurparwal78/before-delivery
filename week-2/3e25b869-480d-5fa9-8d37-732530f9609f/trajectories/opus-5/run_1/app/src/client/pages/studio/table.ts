import type { Bilingual } from '../../../shared/catalog.js';
import { bind, el, say } from '../../ui.js';

export type Column = { label: Bilingual };

export type StudioTable = {
  element: HTMLElement;
  setRows: (rows: (HTMLElement | string)[][]) => void;
  setFooter: (cells: (HTMLElement | string)[] | null) => void;
};

/** A dense ledger table that scrolls sideways inside its own labelled container. */
export function studioTable(label: () => string, columns: readonly Column[]): StudioTable {
  const head = el('tr');
  const headCells = columns.map(() => el('th', { scope: 'col' }));
  for (const cell of headCells) head.append(cell);
  const body = el('tbody');
  const foot = el('tfoot');
  const table = el('table', { class: 'studio-table' }, [el('thead', {}, [head]), body, foot]);
  const scroller = el('div', { class: 'table-scroller', tabindex: '0', role: 'group' });
  scroller.append(table);
  bind(() => {
    const name = label();
    table.setAttribute('aria-label', name);
    scroller.setAttribute('aria-label', name);
    columns.forEach((column, index) => {
      const cell = headCells[index];
      if (cell) cell.textContent = say(column.label);
    });
  });
  return {
    element: scroller,
    setRows: (rows) => {
      while (body.firstChild) body.firstChild.remove();
      for (const row of rows) {
        const tr = el('tr');
        for (const cell of row) {
          tr.append(typeof cell === 'string' ? el('td', { text: cell }) : el('td', {}, [cell]));
        }
        body.append(tr);
      }
    },
    setFooter: (cells) => {
      while (foot.firstChild) foot.firstChild.remove();
      if (!cells) return;
      const tr = el('tr');
      for (const cell of cells) {
        tr.append(typeof cell === 'string' ? el('td', { text: cell }) : el('td', {}, [cell]));
      }
      foot.append(tr);
    },
  };
}
