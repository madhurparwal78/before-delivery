import { el } from '../dom.js';
import { api } from '../api.js';
import type { CategoryEntry, Line, Totals } from '../apiTypes.js';
import { CATEGORIES } from '../../domain/types.js';

/**
 * The public shared list: read-only, no navigation, no links into the hiker's
 * other pages, and only the published share fields.
 */

interface ShareBody {
  share: {
    listName: string;
    state: string;
    hikerName: string;
    lines: Line[];
    categories: CategoryEntry[];
    totals: Totals;
  };
}

export async function renderSharePage(page: HTMLElement, token: string): Promise<void> {
  const answer = await api.get<ShareBody>(`/api/share/${token}`);
  if (!answer.ok) {
    page.append(el('h1', { text: 'Shared list' }));
    page.append(el('div', { class: 'empty-state', text: 'This shared list is no longer available.' }));
    return;
  }
  const share = answer.body.share;
  page.textContent = '';
  page.append(el('h1', { text: share.listName }));
  page.append(el('p', { text: `Shared by ${share.hikerName}` }));
  page.append(el('p', { text: share.state }));

  const table = el('table', { class: 'ledger', 'aria-label': 'Shared pack list' });
  const body = el('tbody');
  for (const category of CATEGORIES) {
    const lines = share.lines.filter((line) => line.category === category);
    if (lines.length === 0) continue;
    const subtotal = lines.reduce((sum, line) => sum + line.lineWeightGrams, 0);
    const entry = share.categories.find((candidate) => candidate.category === category);
    const label = entry?.subtotalDisplay ?? `${subtotal} g`;
    body.append(el('tr', { class: 'group-heading-row' }, [el('td', { colspan: '3' }, [el('h3', { text: `${category} ${label}` })])]));
    for (const line of lines) {
      const row = el('tr');
      row.append(el('td', { text: String(line.quantity) }));
      const nameCell = el('td', { class: 'name-cell' });
      nameCell.append(el('strong', { text: line.name }));
      if (line.carryNote !== '') nameCell.append(el('span', { class: 'carry-note', text: ` ${line.carryNote}` }));
      row.append(nameCell);
      row.append(el('td', { class: 'mono', text: line.weightDisplay }));
      body.append(row);
    }
  }
  table.append(body);
  page.append(table);

  const totals = el('div', { class: 'totals-strip', role: 'region', 'aria-label': 'Pack totals' });
  const add = (label: string, value: string): void => {
    const wrap = el('div', { class: 'total' });
    wrap.append(el('span', { class: 'label', text: label }), el('span', { class: 'value', text: value }));
    totals.append(wrap);
  };
  add('Base', share.totals.display.base);
  add('Worn', share.totals.display.worn);
  add('Consumable', share.totals.display.consumable);
  add('Skin-out', share.totals.display.skinOut);
  page.append(totals);
}
