// /reviews: submitted releases waiting for this case lead, refreshed in place.

import { api, figure, h, icon, setFigure, skeletonRows, syncRows } from '../core.js';
import { docketPanes, noRecordCopy } from '../shell.js';

const REFRESH_MS = 3000;

function renderRow(release) {
  return h('tr', {},
    h('td', {}, h('a', { href: `/releases/${release.id}`, class: 'mono row-link' }, release.id)),
    h('td', {}, release.name),
    h('td', { class: 'mono matter-cell' }, release.matter_ref));
}

export function mount(screen) {
  const panes = docketPanes(screen, 'docket');
  noRecordCopy(panes.inspector);
  panes.docket.replaceChildren(skeletonRows());

  const block = figure('Waiting', 0);
  const count = h('div', { role: 'status', 'aria-label': 'Review queue count', class: 'queue-count' });
  const rows = h('tbody');
  const table = h('table', { 'aria-label': 'Review queue', tabindex: '-1' },
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Release'), h('th', { scope: 'col' }, 'Name'), h('th', { scope: 'col' }, 'Matter'))),
    rows);
  const empty = h('div', { class: 'empty-state', hidden: true }, icon('inbox', 'empty-drawing'), h('p', {}, 'Nothing waiting for a decision.'));
  let shown = false;

  function moveFocusFromLeavingRow(before, focusedKey, releases) {
    const remaining = new Set(releases.map((release) => release.id));
    const next = before.slice(before.indexOf(focusedKey) + 1).find((key) => remaining.has(key));
    const target = next ?? releases[releases.length - 1]?.id;
    const row = [...rows.children].find((candidate) => candidate.dataset.rowKey === target);
    (row?.querySelector('a') ?? table).focus();
  }

  screen.every(REFRESH_MS, async () => {
    const answer = await api('GET', '/api/reviews', { background: true, signal: screen.signal });
    if (!answer.ok) return;
    const { releases } = answer.data;
    if (!shown) {
      shown = true;
      panes.docket.replaceChildren(block, count, table, empty);
    }
    const before = [...rows.children].map((row) => row.dataset.rowKey);
    const focusedKey = rows.contains(document.activeElement) ? document.activeElement.closest('tr').dataset.rowKey : null;
    syncRows(rows, releases, {
      key: (release) => release.id,
      signature: (release) => JSON.stringify([release.name, release.matter_ref]),
      render: renderRow,
    });
    if (focusedKey !== null && !releases.some((release) => release.id === focusedKey)) {
      moveFocusFromLeavingRow(before, focusedKey, releases);
    }
    setFigure(block, releases.length);
    const copy = `${releases.length} waiting for a decision.`;
    if (count.textContent !== copy) count.textContent = copy;
    empty.hidden = releases.length > 0;
  });
}
