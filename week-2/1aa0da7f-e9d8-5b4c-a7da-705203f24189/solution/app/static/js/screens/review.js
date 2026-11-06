// /ledger/review: denials, break-glass use, role grants and signals from the ledger, and the custody lookup.

import { api, field, figure, h, ruledTable, setFigure, skeletonRows, syncRows } from '../core.js';
import { custodyTable } from './custody.js';

const LIVE_MS = 4000;
const PAGE_SIZE = 1000;
const GRANT_ACTIONS = new Set(['grant.issued', 'grant.edited', 'grant.revoked', 'grant.lapsed']);

const mono = (text) => h('span', { class: 'mono' }, text ?? 'none');
const seqOf = (entry) => String(entry.seq);
const time = (at) => h('time', {}, `${at.slice(0, 10)} ${at.slice(11, 19)}`);

// Every row stays on the sheet: an auditor never has to guess that a record sits behind a scroll.
function section(title, table) {
  return h('section', { class: 'review-section' }, h('h2', {}, title, h('span', { class: 'review-count' })),
    h('div', { class: 'review-scroll', role: 'group', 'aria-label': `${title} rows`, tabindex: '0' }, table,
      h('p', { class: 'review-none' }, 'Nothing recorded.')));
}

export async function mount(screen, main) {
  const signalsFigure = figure('Open signals', 0);
  const denials = ruledTable('Denials', ['Seq', 'Time', 'Actor', 'Session', 'Code', 'Target']);
  const breakGlass = ruledTable('Break-glass use', ['Grant', 'Compartment', 'Opened', 'Actor', 'Session', 'State', 'Actions', 'Reason']);
  const roleGrants = ruledTable('Role grants', ['Seq', 'Time', 'Actor', 'Session', 'Action', 'Grant', 'Compartment', 'Person']);
  const signals = ruledTable('Signals', ['Signal', 'Kind', 'Time', 'Target']);

  const exhibitId = h('input', { type: 'text', class: 'identifier', autocomplete: 'off', spellcheck: 'false' });
  const custodySlot = h('div', { class: 'review-custody' });
  let lookup = null;
  const lookupForm = h('form', {
    class: 'custody-lookup',
    novalidate: true,
    onsubmit: (event) => {
      event.preventDefault();
      lookup?.stop();
      lookup = custodyTable(screen, encodeURIComponent(exhibitId.value.trim()));
      custodySlot.replaceChildren(lookup.element);
    },
  }, field('Exhibit id', exhibitId), h('button', { type: 'submit', class: 'btn' }, 'Show custody'));

  // The tables arrive together in the skeleton's place, the last thing on the page, so loading moves nothing.
  const loading = skeletonRows(4);
  const tables = h('div', { class: 'review-tables', hidden: true },
    section('Denials', denials.table),
    section('Break-glass use', breakGlass.table),
    section('Role grants', roleGrants.table),
    section('Signals', signals.table));

  main.className = 'page page-review';
  main.replaceChildren(
    h('div', { class: 'review-head' }, signalsFigure, h('div', { class: 'review-lookup' }, h('h1', {}, 'Auditor review'), lookupForm)),
    custodySlot,
    loading,
    tables,
  );

  const seen = { denials: [], opened: new Map(), ended: new Set(), actions: new Map(), grants: [] };
  let after = 0;
  let first = true;

  function tally(entry) {
    if (entry.action === 'access.denied') seen.denials.push(entry);
    else if (entry.action === 'break_glass.opened') seen.opened.set(entry.target, entry);
    else if (entry.action === 'break_glass.ended') seen.ended.add(entry.target);
    else if (GRANT_ACTIONS.has(entry.action)) seen.grants.push(entry);
    const grantId = entry.detail?.grant_id;
    if (grantId) seen.actions.set(grantId, (seen.actions.get(grantId) ?? 0) + 1);
  }

  function paint(signalRows) {
    setFigure(signalsFigure, signalRows.length);
    syncRows(denials.body, [...seen.denials].reverse(), {
      key: seqOf,
      signature: seqOf,
      render: (entry) => denials.row(
        mono(seqOf(entry)), time(entry.at), mono(entry.actor_id), mono(entry.session_id), mono(entry.detail.code), { wide: mono(entry.target) },
      ),
    });
    const uses = [...seen.opened.values()].reverse().map((entry) => ({
      entry, count: seen.actions.get(entry.target) ?? 0, state: seen.ended.has(entry.target) ? 'ended' : 'active',
    }));
    syncRows(breakGlass.body, uses, {
      key: (use) => use.entry.target,
      signature: (use) => `${use.count} ${use.state}`,
      render: ({ entry, count, state }) => {
        const row = breakGlass.row(
          mono(entry.target), mono(entry.detail.compartment_id), time(entry.at), mono(entry.actor_id), mono(entry.session_id),
          h('span', { class: 'state-word' }, state), mono(String(count)), { wide: h('span', { class: 'review-reason' }, entry.detail.reason) },
        );
        row.setAttribute('data-action-count', String(count));
        return row;
      },
    });
    syncRows(roleGrants.body, [...seen.grants].reverse(), {
      key: seqOf,
      signature: seqOf,
      render: (entry) => roleGrants.row(
        mono(seqOf(entry)), time(entry.at), mono(entry.actor_id), mono(entry.session_id),
        mono(entry.action), mono(entry.target), mono(entry.detail.compartment_id), mono(entry.detail.user_id),
      ),
    });
    syncRows(signals.body, [...signalRows].reverse(), {
      key: (signal) => signal.id,
      signature: (signal) => signal.id,
      render: (signal) => signals.row(mono(signal.id), mono(signal.kind), time(signal.at), { wide: mono(signal.target) }),
    });
    for (const { table, body } of [denials, breakGlass, roleGrants, signals]) {
      table.closest('.review-section').querySelector('.review-count').textContent = `${body.children.length} rows`;
    }
  }

  async function refresh() {
    const background = !first;
    for (;;) {
      const answer = await api('GET', `/api/ledger?after=${after}&limit=${PAGE_SIZE}`, { background, signal: screen.signal });
      if (!answer.ok) return;
      answer.data.entries.forEach(tally);
      after = answer.data.entries.at(-1)?.seq ?? after;
      if (answer.data.entries.length < PAGE_SIZE) break;
    }
    const signalAnswer = await api('GET', '/api/signals', { background, signal: screen.signal });
    if (!signalAnswer.ok || screen.stopped) return;
    first = false;
    loading.remove();
    tables.hidden = false;
    paint(signalAnswer.data.signals);
  }

  screen.onCleanup(() => lookup?.stop());
  screen.every(LIVE_MS, refresh);
}
