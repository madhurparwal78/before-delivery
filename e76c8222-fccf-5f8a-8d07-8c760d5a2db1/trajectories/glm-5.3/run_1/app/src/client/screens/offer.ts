import { api, isFailure } from '../lib/api.js';
import { h, clear, statusRegion } from '../lib/dom.js';
import { copy, statusLabel } from '../lib/copy.js';
import { cardDate, agencyTime, agencyStamp } from '../lib/time.js';
import type { Setting } from '../lib/types.js';

interface OfferPageData {
  offer: { status: string; expires_at: string };
  request: {
    ref: string; title: string; setting: Setting; location: string;
    start: string; end: string; org_name: string;
  };
  seat: { position: number; total: number };
  interpreter: { name: string };
}

export function renderOfferPage(token: string): HTMLElement {
  const wrap = h('div', { class: 'column' });
  const status = statusRegion('Offer status');
  let answered = false;

  const load = async () => {
    let data: OfferPageData;
    try {
      data = await api.get<OfferPageData>(`/offers/${token}`);
    } catch {
      wrap.appendChild(h('h1', {}, 'Offer'));
      wrap.appendChild(h('p', { class: 'muted' }, 'Nothing was found here.'));
      return;
    }
    clear(wrap);
    wrap.appendChild(h('h1', {}, `Offer for ${data.request.ref}`));
    const start = new Date(data.request.start);
    const end = new Date(data.request.end);
    const fields = h('dl', { class: 'kv' });
    fields.appendChild(h('dt', {}, 'Organisation'));
    fields.appendChild(h('dd', {}, data.request.org_name));
    fields.appendChild(h('dt', {}, 'Setting'));
    fields.appendChild(h('dd', {}, statusLabel(data.request.setting)));
    fields.appendChild(h('dt', {}, 'Title'));
    fields.appendChild(h('dd', {}, data.request.title));
    fields.appendChild(h('dt', {}, 'Location'));
    fields.appendChild(h('dd', {}, data.request.location));
    fields.appendChild(h('dt', {}, 'Date'));
    fields.appendChild(h('dd', { class: 'mono' }, cardDate(start)));
    fields.appendChild(h('dt', {}, 'Times'));
    fields.appendChild(h('dd', { class: 'mono' }, `${agencyTime(start)} – ${agencyTime(end)}`));
    fields.appendChild(h('dt', {}, 'Seat'));
    fields.appendChild(h('dd', { class: 'mono' }, `${data.seat.position} of ${data.seat.total}`));
    fields.appendChild(h('dt', {}, 'Expiry'));
    fields.appendChild(h('dd', { class: 'mono' }, agencyStamp(new Date(data.offer.expires_at))));
    fields.appendChild(h('dt', {}, 'Offer status'));
    fields.appendChild(h('dd', {}, statusLabel(data.offer.status)));
    wrap.appendChild(fields);

    const buttons = h('div', { class: 'btn-row' });
    const outcome = h('p', { class: 'muted' });

    if (data.offer.status !== 'active') {
      outcome.textContent = copy.offerClosedText(data.offer.status);
      wrap.appendChild(outcome);
      wrap.appendChild(status.el);
      return;
    }

    const answer = async (kind: 'accept' | 'decline') => {
      if (answered) return;
      answered = true;
      acceptBtn.setAttribute('disabled', 'true');
      declineBtn.setAttribute('disabled', 'true');
      status.set(kind === 'accept' ? copy.accept.pending : copy.decline.pending, 'pending');
      try {
        await api.post(`/offers/${token}/${kind}`, {});
        if (kind === 'accept') {
          status.set(copy.accept.success(data.request.ref), undefined);
          outcome.textContent = copy.accept.success(data.request.ref);
        } else {
          status.set(copy.decline.success, undefined);
          outcome.textContent = copy.decline.success;
        }
        clear(buttons);
        wrap.appendChild(buttons);
      } catch (err) {
        answered = false;
        acceptBtn.removeAttribute('disabled');
        declineBtn.removeAttribute('disabled');
        if (isFailure(err) && err.code === 'offer_closed') {
          const offerStatus = err.body.offer_status ?? data.offer.status;
          status.set(copy.offerClosedText(offerStatus), 'error');
        } else if (isFailure(err)) {
          status.set(err.message, 'error');
        }
      }
    };

    const acceptBtn = h('button', { class: 'primary', onclick: () => void answer('accept') }, 'Accept offer');
    const declineBtn = h('button', { onclick: () => void answer('decline') }, 'Decline offer');
    buttons.appendChild(acceptBtn);
    buttons.appendChild(declineBtn);
    wrap.appendChild(buttons);
    wrap.appendChild(outcome);
    wrap.appendChild(status.el);
  };

  void load();
  return wrap;
}
