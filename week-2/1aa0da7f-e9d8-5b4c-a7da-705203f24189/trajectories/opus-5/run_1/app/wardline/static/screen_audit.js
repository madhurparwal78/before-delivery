/** The auditor's review: denials, break-glass use, role grants, signals and custody. */

import { get } from './api.js';
import { clear, el } from './dom.js';
import { syncRows, table } from './ui.js';
import { mountCustody } from './custody.js';

export default {
  async mount(context) {
    const host = context.page;
    const figure = el('span', { dataset: { figure: 'true' }, text: '0' });
    const denials = table('Denials', ['Seq', 'At', 'Actor', 'Session', 'Code', 'Target']);
    const breakGlass = table('Break-glass use', [
      'Seq',
      'At',
      'Actor',
      'Grant',
      'Compartment',
      'Actions',
    ]);
    const grants = table('Role grants', ['Seq', 'At', 'Actor', 'Action', 'Grant', 'Person']);
    const signals = table('Signals', ['Signal', 'Kind', 'At', 'Target']);
    const exhibitId = el('input', { type: 'text', 'aria-label': 'Exhibit id' });
    const custodyHost = el('div');
    const showCustody = el('button', {
      type: 'button',
      text: 'Show custody',
      on: {
        click: async () => {
          clear(custodyHost);
          const custody = mountCustody(custodyHost, exhibitId.value.trim(), {
            withTimeline: false,
          });
          await custody.load(false);
        },
      },
    });
    host.append(
      el('div', { class: 'linkpage' }, [
        figure,
        el('span', { dataset: { figureLabel: 'true' }, text: 'Open signals' }),
        el('h1', { text: 'Auditor review' }),
        el('a', { href: '/ledger', 'data-route': 'true', text: 'Chain Walk' }),
        denials.node,
        breakGlass.node,
        grants.node,
        signals.node,
        el('h2', { text: 'Custody lookup' }),
        el('label', { text: 'Exhibit id' }),
        exhibitId,
        showCustody,
        custodyHost,
      ])
    );

    async function readLedger() {
      const collected = [];
      let after = 0;
      for (let page = 0; page < 200; page += 1) {
        const reply = await get(`/api/ledger?after=${after}&limit=1000`, {
          background: true,
        });
        if (reply.status !== 200) break;
        if (!reply.body.entries.length) break;
        collected.push(...reply.body.entries);
        after = reply.body.entries[reply.body.entries.length - 1].seq;
        if (collected.length >= reply.body.count) break;
      }
      return collected;
    }

    async function refresh() {
      const entries = await readLedger();
      const actionCounts = new Map();
      for (const entry of entries) {
        const grantId = entry.detail && entry.detail.grant_id;
        if (!grantId) continue;
        actionCounts.set(grantId, (actionCounts.get(grantId) || 0) + 1);
      }
      syncRows(
        denials.body,
        entries.filter((entry) => entry.action === 'access.denied'),
        {
          key: (entry) => entry.seq,
          signature: (entry) => entry.digest,
          build: (entry) =>
            el('tr', {}, [
              el('td', { class: 'mono', text: String(entry.seq) }),
              el('td', { class: 'mono', text: entry.at }),
              el('td', { class: 'mono', text: entry.actor_id }),
              el('td', { class: 'mono', text: entry.session_id || '-' }),
              el('td', { class: 'mono', text: entry.detail.code || '' }),
              el('td', { class: 'mono', text: entry.target }),
            ]),
        }
      );
      syncRows(
        breakGlass.body,
        entries.filter((entry) => entry.action === 'break_glass.opened'),
        {
          key: (entry) => entry.seq,
          signature: (entry) => `${entry.digest}|${actionCounts.get(entry.target) || 0}`,
          build: (entry) =>
            el(
              'tr',
              { dataset: { actionCount: String(actionCounts.get(entry.target) || 0) } },
              [
                el('td', { class: 'mono', text: String(entry.seq) }),
                el('td', { class: 'mono', text: entry.at }),
                el('td', { class: 'mono', text: entry.actor_id }),
                el('td', { class: 'mono', text: entry.target }),
                el('td', { class: 'mono', text: entry.detail.compartment_id || '' }),
                el('td', {
                  class: 'mono',
                  text: String(actionCounts.get(entry.target) || 0),
                }),
              ]
            ),
        }
      );
      syncRows(
        grants.body,
        entries.filter((entry) => entry.action.startsWith('grant.')),
        {
          key: (entry) => entry.seq,
          signature: (entry) => entry.digest,
          build: (entry) =>
            el('tr', {}, [
              el('td', { class: 'mono', text: String(entry.seq) }),
              el('td', { class: 'mono', text: entry.at }),
              el('td', { class: 'mono', text: entry.actor_id }),
              el('td', { text: entry.action }),
              el('td', { class: 'mono', text: entry.target }),
              el('td', { class: 'mono', text: entry.detail.user_id || '' }),
            ]),
        }
      );
      const signalReply = await get('/api/signals', { background: true });
      if (signalReply.status === 200) {
        figure.textContent = String(signalReply.body.signals.length);
        syncRows(signals.body, signalReply.body.signals, {
          key: (signal) => signal.id,
          signature: (signal) => `${signal.kind}|${signal.at}`,
          build: (signal) =>
            el('tr', {}, [
              el('td', { class: 'mono', text: signal.id }),
              el('td', { text: signal.kind }),
              el('td', { class: 'mono', text: signal.at }),
              el('td', { class: 'mono', text: signal.target }),
            ]),
        });
      }
    }

    await refresh();
    return { refresh };
  },
};
