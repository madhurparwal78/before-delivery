import { api, failureOf } from '../api.ts';
import { copy } from '../copy.ts';
import { districtCounters } from '../counters.ts';
import { el, renderWhenChanged, setText } from '../dom.ts';
import { navigate } from '../navigation.ts';
import type { Screen } from '../screen.ts';
import { dataRow, dataTable } from '../table.ts';
import type { ChannelRecord, PackRecord, TotalsChannel } from '../types.ts';

/** The regulator reviewer's read-only page: channel totals and mailed packs. */

export async function reviewScreen(): Promise<Screen> {
  const query = new URLSearchParams(window.location.search);
  const fromValue = query.get('from') ?? '';
  const toValue = query.get('to') ?? '';

  const counters = districtCounters();
  const status = el('p', {
    class: 'status',
    attrs: { role: 'status', 'aria-label': 'Review status', 'aria-live': 'polite' },
  });

  const from = el('input', {
    class: 'input',
    attrs: { type: 'text', id: 'review-from', 'aria-label': 'From', placeholder: 'YYYY-MM-DD', autocomplete: 'off' },
  });
  const to = el('input', {
    class: 'input',
    attrs: { type: 'text', id: 'review-to', 'aria-label': 'To', placeholder: 'YYYY-MM-DD', autocomplete: 'off' },
  });
  from.value = fromValue;
  to.value = toValue;
  const fromError = el('p', { class: 'field-error' });
  const toError = el('p', { class: 'field-error' });
  const showTotals = el('button', { class: 'button', text: 'Show totals', attrs: { type: 'button' } });

  const form = el('form', {
    class: 'card form form-inline',
    attrs: { 'aria-label': 'Review period', novalidate: true },
    children: [
      el('label', { class: 'label', text: 'From', attrs: { for: 'review-from' } }),
      from,
      fromError,
      el('label', { class: 'label', text: 'To', attrs: { for: 'review-to' } }),
      to,
      toError,
      showTotals,
    ],
  });

  const totals = dataTable('Channel totals', [
    'Channel',
    'Window',
    'Cap volume (ML)',
    'Committed (ML)',
    'Delivered (ML)',
    'Remaining (ML)',
  ]);
  const packs = el('ul', { class: 'plain-list', attrs: { role: 'list', 'aria-label': 'Mailed packs' } });

  const element = el('main', {
    class: 'page review-page',
    children: [
      counters.element,
      el('h1', { text: 'Review' }),
      form,
      el('div', {
        class: 'review-grid',
        children: [
          el('section', { class: 'card', children: [el('h2', { text: 'Channel totals' }), totals.element] }),
          el('section', { class: 'card', children: [el('h2', { text: 'Mailed packs' }), packs, status] }),
        ],
      }),
    ],
  });

  const channels = await api.get<{ channels: ChannelRecord[] }>('/api/channels');
  const channelNames = new Map(channels.channels.map((channel) => [channel.id, channel.name]));
  let seenPacks = new Set<string>();
  let first = true;

  const totalsPath = (): string => {
    const parameters = new URLSearchParams();
    if (fromValue !== '' && toValue !== '') {
      parameters.set('from', fromValue);
      parameters.set('to', toValue);
    }
    const suffix = parameters.toString();
    return suffix === '' ? '/api/totals' : `/api/totals?${suffix}`;
  };

  showTotals.addEventListener('click', () => {
    setText(fromError, '');
    setText(toError, '');
    void (async () => {
      const parameters = new URLSearchParams({ from: from.value.trim(), to: to.value.trim() });
      try {
        await api.get(`/api/totals?${parameters.toString()}`);
        navigate(`/review?${parameters.toString()}`);
      } catch (cause) {
        const failure = failureOf(cause);
        if (failure?.status !== 422) return;
        setText(fromError, failure.errors?.from ?? '');
        setText(toError, failure.errors?.to ?? '');
      }
    })();
  });

  const refresh = async (): Promise<void> => {
    await counters.refresh();
    const [totalsReply, packReply] = await Promise.all([
      api.get<{ channels: TotalsChannel[] }>(totalsPath()),
      api.get<{ packs: PackRecord[] }>('/api/packs'),
    ]);

    const totalsSignature = JSON.stringify(totalsReply.channels);
    renderWhenChanged(totals.body, totalsSignature, () => {
      for (const channel of totalsReply.channels) {
        for (const window of channel.windows) {
          totals.body.appendChild(
            dataRow([
              { label: 'Channel', content: channelNames.get(channel.channel_id) ?? channel.channel_id },
              { label: 'Window', content: window.label },
              { label: 'Cap volume (ML)', content: el('span', { class: 'tabular', text: window.cap_volume_ml }) },
              { label: 'Committed (ML)', content: el('span', { class: 'tabular', text: window.committed_ml }) },
              { label: 'Delivered (ML)', content: el('span', { class: 'tabular', text: window.delivered_ml }) },
              { label: 'Remaining (ML)', content: el('span', { class: 'tabular', text: window.remaining_ml }) },
            ]),
          );
        }
      }
    });

    const mailed = packReply.packs.filter((pack) => pack.state === 'mailed');
    renderWhenChanged(packs, mailed.map((pack) => pack.number).join(','), () => {
      for (const pack of mailed) {
        packs.appendChild(
          el('li', {
            children: [
              el('a', {
                text: `Download ${pack.number}`,
                attrs: { href: `/api/packs/${pack.number}/document`, download: '' },
              }),
              el('span', { text: ` ${pack.from} to ${pack.to}` }),
            ],
          }),
        );
      }
    });

    const next = new Set(mailed.map((pack) => pack.number));
    if (!first) {
      for (const number of next) {
        if (!seenPacks.has(number)) setText(status, copy.packReceived(number));
      }
    }
    seenPacks = next;
    first = false;
  };

  await refresh();
  return { element, refresh };
}
