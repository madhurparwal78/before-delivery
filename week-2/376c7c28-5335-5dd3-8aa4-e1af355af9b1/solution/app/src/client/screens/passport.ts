import { get } from '../api.ts';
import { studio, type ScreenRender } from '../app.ts';
import { el, replace } from '../dom.ts';
import { dollars, instantDateLabel, studioDateLabel } from '../format.ts';
import { onLive } from '../live.ts';
import {
  OUTCOME_LABELS,
  PIECE_STATUS_LABELS,
} from '../../shared/labels.ts';
import type { Charge, Passport } from '../types.ts';

export function chargeKindLabel(charge: Charge): string {
  if (charge.firing === 'storage') {
    return `Storage, ${studioDateLabel(charge.storage_day as string)}`;
  }
  return charge.firing === 'bisque' ? 'Bisque' : 'Glaze';
}

export function chargeStatusLabel(charge: Charge): string {
  if (charge.status === 'pending') return 'Pending billing';
  if (charge.status === 'refund_pending') return 'Refund pending';
  if (charge.status === 'refunded') return 'Refunded';
  return charge.funding === 'card' ? 'Paid by card' : 'Paid from credit';
}

function chargesTable(charges: readonly Charge[], extraHeader?: string, extraCell?: (charge: Charge) => Node | null): HTMLElement {
  const head = el('tr', {}, [
    el('th', { scope: 'col', text: 'Charge' }),
    el('th', { scope: 'col', text: 'Fee' }),
    el('th', { scope: 'col', text: 'Status' }),
    extraHeader ? el('th', { scope: 'col', text: extraHeader }) : null,
  ]);
  const columns = extraHeader ? 4 : 3;
  const body = el(
    'tbody',
    {},
    charges.length === 0
      ? [el('tr', {}, [el('td', { colspan: columns, class: 'muted', text: 'No charges yet.' })])]
      : charges.map((charge) =>
      el('tr', {}, [
        el('td', { text: chargeKindLabel(charge) }),
        el('td', { class: 'mono', text: `$${dollars(charge.fee_cents)}` }),
        el('td', { text: chargeStatusLabel(charge) }),
        extraCell ? el('td', {}, [extraCell(charge)]) : null,
      ]),
    ),
  );
  return el('table', { class: 'table', 'aria-label': 'Charges' }, [
    el('thead', {}, [head]),
    body,
  ]);
}

async function photoInto(slot: HTMLElement, piece: Passport): Promise<void> {
  if (!piece.photo_url) {
    replace(slot, [el('div', { class: 'photo-missing', text: 'No photo yet' })]);
    return;
  }
  try {
    const response = await fetch(piece.photo_url);
    if (response.status === 503) {
      replace(slot, [el('div', { class: 'photo-missing', text: 'Photo unavailable right now' })]);
      return;
    }
    if (!response.ok) {
      replace(slot, [el('div', { class: 'photo-missing', text: 'No photo yet' })]);
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    replace(slot, [
      el('img', { src: url, alt: `Intake photo of ${piece.title}`, class: 'photo' }),
    ]);
  } catch {
    replace(slot, [el('div', { class: 'photo-missing', text: 'Photo unavailable right now' })]);
  }
}

export const renderPassport: ScreenRender = ({ mount, params }) => {
  const photoSlot = el('div', { class: 'photo-slot' });
  const details = el('div', { class: 'stack' });
  mount.appendChild(
    el('div', { class: 'passport' }, [
      el('section', { class: 'panel' }, [photoSlot]),
      el('section', { class: 'panel' }, [details]),
    ]),
  );

  const draw = (piece: Passport): void => {
    const quote = piece.quote;
    replace(details, [
      el('h1', { class: 'heading', text: piece.title }),
      el('p', { class: 'label', text: PIECE_STATUS_LABELS[piece.status] }),
      el('p', { class: 'mono', text: `RAW ${piece.length_in} × ${piece.width_in} × ${piece.height_in} IN` }),
      el('p', {
        class: 'mono',
        text: `ROUNDED ${piece.rounded.length_in} × ${piece.rounded.width_in} × ${piece.rounded.height_in} IN`,
      }),
      el('p', { class: 'mono', text: `${piece.cubic_inches} CU IN` }),
      el('p', { class: 'mono', text: `BISQUE $${dollars(quote.bisque.fee_cents)}` }),
      el('p', { class: 'mono', text: `GLAZE $${dollars(quote.glaze.fee_cents)}` }),
      el('p', { class: 'muted', text: piece.clay_body }),
      piece.location
        ? el('p', { class: 'label', text: `${piece.location.kiln_name}, deck ${piece.location.deck}` })
        : null,
      piece.outcomes.bisque
        ? el('p', { class: 'label', text: `BISQUE ${OUTCOME_LABELS[piece.outcomes.bisque]}` })
        : null,
      piece.outcomes.glaze
        ? el('p', { class: 'label', text: `GLAZE ${OUTCOME_LABELS[piece.outcomes.glaze]}` })
        : null,
      chargesTable(piece.charges),
      piece.pickup_deadline
        ? el('p', {
            class: 'mono accent',
            text: `COLLECT BY ${studioDateLabel(piece.pickup_deadline)}`,
          })
        : null,
      el(
        'ol',
        { class: 'history', 'aria-label': 'Piece history', role: 'list' },
        piece.history.map((entry) =>
          el('li', {}, [
            el('span', { class: 'label', text: PIECE_STATUS_LABELS[entry.status] }),
            el('span', { class: 'muted', text: instantDateLabel(entry.at, studio()?.time_zone ?? 'UTC') }),
          ]),
        ),
      ),
    ]);
  };

  let lastPhoto: string | null = null;
  const load = async (): Promise<void> => {
    const piece = await get<Passport>(`/api/pieces/${params['id']}`).catch(() => null);
    if (!piece) return;
    draw(piece);
    if (piece.photo_url !== lastPhoto || photoSlot.childElementCount === 0) {
      lastPhoto = piece.photo_url;
      await photoInto(photoSlot, piece);
    }
  };

  void load();
  return onLive((message) => {
    if (message.kind === 'piece' || message.kind === 'charge' || message.kind === 'load') {
      void load();
    }
  });
};
