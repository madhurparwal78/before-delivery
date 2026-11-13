import { api, failureOf } from '../api.ts';
import { copy } from '../copy.ts';
import { districtCounters } from '../counters.ts';
import { el, setText } from '../dom.ts';
import type { Screen } from '../screen.ts';
import { requireUser } from '../session.ts';
import type { PackRecord } from '../types.ts';

/** One pack, from building through stored to mailed. */

export async function packPageScreen(packId: string): Promise<Screen> {
  const user = requireUser();
  const counters = districtCounters();
  const first = await api.get<{ pack: PackRecord }>(`/api/packs/${encodeURIComponent(packId)}`);

  const status = el('p', {
    class: 'status',
    attrs: { role: 'status', 'aria-label': 'Pack status', 'aria-live': 'polite' },
  });
  const outage = el('p', { class: 'banner-outage', attrs: { hidden: true } });
  const details = el('dl', { class: 'details' });
  const digestValue = el('span', { class: 'tabular' });
  const digest = el('div', {
    class: 'figure',
    attrs: { role: 'group', 'aria-label': 'Pack digest' },
    children: [el('span', { class: 'figure-label', text: 'Pack digest' }), digestValue],
  });
  const download = el('a', {
    class: 'button',
    text: 'Download pack',
    attrs: { href: `/api/packs/${encodeURIComponent(packId)}/document`, download: '' },
  });
  const withdraw = el('button', { class: 'button', text: 'Withdraw pack', attrs: { type: 'button' } });
  const actions = el('div', { class: 'actions' });

  const element = el('main', {
    class: 'page',
    children: [
      counters.element,
      el('h1', { text: `Pack ${first.pack.number}` }),
      el('section', {
        class: 'card',
        children: [outage, details, digest, actions, status],
      }),
    ],
  });

  let lastState = '';

  const paint = (pack: PackRecord): void => {
    details.textContent = '';
    for (const [term, value] of [
      ['Period', `${pack.from} to ${pack.to}`],
      ['State', pack.state],
      ['Signatory', pack.signatory],
      ['Created', pack.created_at],
    ] as [string, string][]) {
      details.appendChild(el('dt', { text: term }));
      details.appendChild(el('dd', { text: value }));
    }

    setText(digestValue, pack.sha256 === null ? '' : copy.packDigest(pack.sha256));
    digest.hidden = pack.sha256 === null;

    const stored = pack.state === 'stored' || pack.state === 'mailed';
    actions.textContent = '';
    if (stored) actions.appendChild(download);
    if (user.role === 'clerk' && pack.state !== 'mailed' && pack.state !== 'withdrawn') {
      actions.appendChild(withdraw);
    }

    if (pack.stalled_on === 'store') {
      outage.hidden = false;
      setText(outage, copy.packStalledOnStore);
      setText(status, copy.packStalledOnStore);
    } else if (pack.stalled_on === 'mail') {
      outage.hidden = false;
      setText(outage, copy.packStalledOnMail);
      setText(status, copy.packStalledOnMail);
    } else {
      outage.hidden = true;
      setText(outage, '');
      if (pack.state === 'mailed' && lastState !== 'mailed') setText(status, copy.packStoredAndMailed(pack.number));
      else if (pack.state === 'building' || pack.state === 'stored') setText(status, copy.storingAndMailing);
    }
    lastState = pack.state;
  };

  withdraw.addEventListener('click', () => {
    setText(status, copy.withdrawing);
    void (async () => {
      try {
        const reply = await api.del<{ pack: PackRecord }>(`/api/packs/${encodeURIComponent(packId)}`);
        lastState = reply.pack.state;
        paint(reply.pack);
        setText(status, copy.packWithdrawn(reply.pack.number));
      } catch (cause) {
        const failure = failureOf(cause);
        setText(status, failure?.code === 'pack_mailed' ? copy.packMailed : failure?.message ?? '');
      }
    })();
  });

  const refresh = async (): Promise<void> => {
    await counters.refresh();
    const reply = await api.get<{ pack: PackRecord }>(`/api/packs/${encodeURIComponent(packId)}`);
    paint(reply.pack);
  };

  paint(first.pack);
  return { element, refresh };
}
