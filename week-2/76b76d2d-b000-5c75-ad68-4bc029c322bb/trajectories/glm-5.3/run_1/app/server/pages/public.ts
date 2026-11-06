import { DateTime } from 'luxon';
import type { Locale, Fare, Tier, Cadence } from '../domain/model';
import { tierPrices } from '../domain/model';
import {
  copy, formatAmount, fareLabel, tierLabel, cadenceLabel,
} from '../domain/i18n';
import { esc, layout } from './layout';
import { query } from '../services/database';
import { dateOnly, timeOnly, torontoTz, iso } from '../time';
import { fareOrder } from '../domain/model';

export interface PageSession {
  signedIn: boolean;
  isPatron: boolean;
  accountNumber: string | null;
  name: string | null;
  email: string | null;
}

export async function screeningPage(
  locale: Locale,
  path: string,
  session: PageSession,
  screeningId: string,
): Promise<string> {
  const l = locale;
  const screening = await query<{
    id: string; season_slug: string; film_title: string; format: string;
    auditorium: string; starts_at: Date; notes: string;
  }>(
    'SELECT id, season_slug, film_title, format, auditorium, starts_at, notes FROM screenings WHERE id = $1',
    [screeningId],
  );
  const scr = screening.rows[0];
  if (!scr) return notFoundPage(locale, path, session);
  const aud = await query<{ code: string; name: string; venue: string; rows: string; seats_per_row: number; capacity: number }>(
    `SELECT a.code, a.name, v.name AS venue, a.rows, a.seats_per_row, a.capacity
     FROM auditoriums a JOIN venues v ON v.code = a.venue_code WHERE a.code = $1`,
    [scr.auditorium],
  );
  const a = aud.rows[0];
  const startsAt = DateTime.fromJSDate(scr.starts_at).setZone(torontoTz);

  const claims = await query<{ seat: string; booking_ref: string | null; hold_state: string | null; expires_at: Date | null; hold_session: string | null }>(
    `SELECT sc.seat, sc.booking_ref, h.state AS hold_state, h.expires_at, h.session_token AS hold_session
     FROM seat_claims sc LEFT JOIN holds h ON h.id = sc.hold_id
     WHERE sc.screening_id = $1`,
    [scr.id],
  );
  const seatStates = new Map<string, string>();
  for (const c of claims.rows) {
    if (c.booking_ref) seatStates.set(c.seat, 'sold');
    else if (c.hold_state === 'held' && c.expires_at && DateTime.fromJSDate(c.expires_at) > DateTime.now()) {
      seatStates.set(c.seat, 'held');
    }
  }

  const seats: string[] = [];
  for (const row of a.rows) {
    for (let n = 1; n <= a.seats_per_row; n++) {
      seats.push(`${row}${n}`);
    }
  }
  const seatRows = [...a.rows].map(row => {
    const cells = [];
    for (let n = 1; n <= a.seats_per_row; n++) {
      const seat = `${row}${n}`;
      const state = seatStates.get(seat) ?? 'available';
      cells.push(`          <div role="gridcell" class="seat seat-${state}" data-seat="${esc(seat)}" aria-label="${esc(copy.seat[l])} ${esc(seat)}" aria-selected="false" aria-disabled="${state === 'sold' || state === 'held' ? 'true' : 'false'}" tabindex="-1"></div>`);
    }
    return `        <div role="row" class="seat-row" data-row="${esc(row)}">
${cells.join('\n')}
        </div>`;
  }).join('\n');

  const remaining = Math.max(0, a.capacity - claims.rows.filter(c => c.booking_ref).length
    - claims.rows.filter(c => !c.booking_ref && c.hold_state === 'held' && c.expires_at && DateTime.fromJSDate(c.expires_at) > DateTime.now()).length);

  const main = `  <div class="screening-layout">
    <div class="film-notes-column">
      <section aria-labelledby="film-notes-heading">
        <button type="button" class="film-notes-toggle" id="film-notes-toggle" aria-expanded="true" aria-controls="film-notes-region">
          ${esc(copy.filmNotes[l])}
        </button>
        <div id="film-notes-region" role="region" aria-label="${esc(copy.filmNotes[l])}">
          <h2 id="film-notes-heading" class="serif">${esc(copy.filmNotesHeading[l])}</h2>
          <p class="film-notes-text">${scr.notes ? esc(scr.notes) : (l === 'en' ? 'No notes for this film.' : 'Aucune note pour ce film.')}</p>
        </div>
      </section>
    </div>
    <div class="seat-map-column">
      <p class="mono" id="screening-meta">${esc(dateOnly(startsAt))} ${esc(timeOnly(startsAt))} · ${esc(a.name)} (${esc(a.code)}) · ${esc(scr.format)}</p>
      <p class="mono" id="seats-remaining" data-capacity="${a.capacity}">${l === 'en' ? `${remaining} left` : `${remaining} restantes`}</p>
      <div id="seat-map" role="grid" aria-label="${esc(copy.seatMap[l])}" class="seat-map" tabindex="0" data-screening-id="${esc(scr.id)}" aria-rowcount="${a.rows.length}">
${seatRows}
      </div>
      ${session.signedIn ? `<label class="group-label"><input type="checkbox" id="group-booking" aria-label="${esc(copy.groupCheckbox[l])}"> ${esc(copy.groupCheckbox[l])}</label>` : ''}
      <button type="button" id="hold-seats" class="primary-action">${esc(copy.holdSeats[l])}</button>
      <p id="booking-status" role="status" aria-live="polite" aria-label="${esc(copy.bookingStatus[l])}" class="status-line"></p>
      <p id="booking-error" role="alert" aria-label="${esc(copy.bookingError[l])}" class="error-line"></p>
    </div>
  </div>`;

  return layout({ locale, path, signedIn: session.signedIn, isStaff: false }, {
    title: scr.film_title,
    heading: scr.film_title,
    mainContent: main,
    bodyClass: 'page-screening',
  });
}

export function checkoutPage(
  locale: Locale,
  path: string,
  session: PageSession,
  holdId: string,
): string {
  const l = locale;
  const main = `  <div class="checkout-layout" data-hold-id="${esc(holdId)}">
    <div class="checkout-form">
      <p><span role="timer" aria-label="${esc(copy.holdTime[l])}" id="hold-timer" class="mono">0:00</span></p>
      <section id="fare-section" aria-label="${esc(copy.fare[l])}">
      </section>
      <div class="uplift-control">
        <label class="switch-label">
          <input type="checkbox" role="switch" id="uplift-switch" aria-label="${esc(copy.addUplift[l])}">
          <span class="switch-thumb" aria-hidden="true"></span>
          ${esc(copy.addUplift[l])}
        </label>
        <div id="uplift-options" hidden>
          <div role="radiogroup" aria-label="${esc(copy.upliftAmount[l])}" class="uplift-radios">
            <label><input type="radio" name="uplift" value="200" aria-label="${formatAmount(200, l)}"> ${formatAmount(200, l)}</label>
            <label><input type="radio" name="uplift" value="500" aria-label="${formatAmount(500, l)}"> ${formatAmount(500, l)}</label>
            <label><input type="radio" name="uplift" value="1000" aria-label="${formatAmount(1000, l)}"> ${formatAmount(1000, l)}</label>
            <label><input type="radio" name="uplift" value="other" aria-label="${esc(copy.otherAmount[l])}"> ${esc(copy.otherAmount[l])}</label>
            <label class="other-amount-label">${esc(copy.otherAmountDollars[l])}
              <input type="text" inputmode="decimal" id="uplift-other" aria-label="${esc(copy.otherAmountDollars[l])}">
            </label>
          </div>
        </div>
      </div>
      <section id="payer-section" hidden>
        <div id="payer-list"></div>
        <button type="button" id="add-payer">${esc(copy.addPayer[l])}</button>
      </section>
      ${session.signedIn ? '' : `
      <section aria-label="${esc(copy.fullName[l])}">
        <label>${esc(copy.fullName[l])} <input type="text" id="guest-name"></label>
        <label>${esc(copy.email[l])} <input type="email" id="guest-email"></label>
        <label>${esc(copy.phoneOptional[l])} <input type="tel" id="guest-phone"></label>
      </section>`}
      <label>${esc(copy.noteOptional[l])} <input type="text" id="booking-note" maxlength="200"></label>
      <label>${esc(copy.cardholderName[l])} <input type="text" id="cardholder-name"></label>
      <button type="button" id="verify-code" hidden>${esc(copy.verifyCode[l])}</button>
      <div id="stepup-dialog" role="dialog" aria-modal="true" aria-label="${esc(copy.confirmYou[l])}" hidden>
        <label>${esc(copy.verificationCode[l])} <input type="text" inputmode="numeric" id="stepup-code" maxlength="6"></label>
        <button type="button" id="stepup-verify">${esc(copy.verify[l])}</button>
        <button type="button" id="stepup-resend">${esc(copy.sendNewCode[l])}</button>
        <button type="button" id="stepup-close">${esc(copy.close[l])}</button>
      </div>
      <button type="button" id="pay-button" class="primary-action" disabled>${esc(copy.pay[l])} ${formatAmount(0, l)}</button>
      <button type="button" id="release-seats">${esc(copy.releaseSeats[l])}</button>
      <p id="checkout-status" role="status" aria-live="polite" aria-label="${esc(copy.checkoutStatus[l])}" class="status-line"></p>
      <p id="checkout-error" role="alert" aria-label="${esc(copy.checkoutError[l])}" class="error-line"></p>
    </div>
    <div class="checkout-summary">
      <table id="price-summary" class="price-table" aria-label="${esc(copy.priceSummary[l])}">
        <tbody id="price-summary-body"></tbody>
      </table>
    </div>
  </div>`;
  return layout({ locale, path, signedIn: session.signedIn, isStaff: false }, {
    title: copy.checkout[l],
    heading: copy.checkout[l],
    mainContent: main,
    bodyClass: 'page-checkout',
  });
}

export function bookingPage(
  locale: Locale,
  path: string,
  session: PageSession,
  booking: Record<string, unknown> | null,
  confirmed: boolean,
  email: string,
): string {
  const l = locale;
  if (!booking) return notFoundPage(locale, path, session);
  const heading = confirmed ? copy.bookingConfirmed[l] : `${copy.booking[l]} ${esc(String(booking.ref))}`;
  const tickets = booking.tickets as { code: string; seat: string; fare: string; status: string }[];
  const split = booking.split as { name: string; seats: number; share_cents: number }[] | null;
  const rows = tickets.map(t => `        <tr><td class="mono">${esc(t.code)}</td><td class="mono">${esc(t.seat)}</td><td>${esc(fareLabel(t.fare as Fare, l))}</td><td>${esc(t.status)}</td></tr>`).join('\n');
  const splitRows = (split ?? []).map(p => `        <tr><td>${esc(p.name)}</td><td class="mono">${esc(String(p.seats))}</td><td class="mono">${formatAmount(p.share_cents, l)}</td></tr>`).join('\n');
  const main = `  <div class="booking-view" data-booking-ref="${esc(String(booking.ref))}">
    <p id="confirmation-line">${confirmed ? `${esc(copy.confirmationLine[l])} ${esc(email)}.` : ''}</p>
    <table id="tickets-table" class="data-table" aria-label="${esc(copy.tickets[l])}">
      <thead><tr><th>${esc(copy.ticketCol[l])}</th><th>${esc(copy.seatCol[l])}</th><th>${esc(copy.fare[l])}</th><th>${esc(copy.statusCol[l])}</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
    <table id="price-summary-table" class="price-table" aria-label="${esc(copy.priceSummary[l])}">
      <tbody id="price-summary-body"></tbody>
    </table>
    ${split ? `
    <table id="cost-split" class="data-table" aria-label="${esc(copy.costSplit[l])}">
      <thead><tr><th>${esc(copy.payerName[l])}</th><th>${esc(copy.seatsForPayer[l])}</th><th>${esc(copy.total[l])}</th></tr></thead>
      <tbody>
${splitRows}
      </tbody>
    </table>` : ''}
    ${booking.state === 'paid' ? `
    <button type="button" id="refund-booking" class="danger-action">${esc(copy.refundBooking[l])}</button>
    <div id="refund-dialog" role="dialog" aria-modal="true" aria-label="${esc(copy.refundBooking[l])}" hidden>
      <p>${l === 'en' ? 'This will refund the whole booking.' : 'Cela remboursera toute la réservation.'}</p>
      <button type="button" id="confirm-refund" class="danger-action">${esc(copy.confirmRefund[l])}</button>
    </div>` : ''}
    <p id="refund-status" role="status" aria-live="polite" class="status-line"></p>
    <p id="refund-error" role="alert" class="error-line"></p>
  </div>`;
  return layout({ locale, path, signedIn: session.signedIn, isStaff: false }, {
    title: heading,
    heading,
    mainContent: main,
    bodyClass: 'page-booking',
  });
}

export function notFoundPage(locale: Locale, path: string, session: PageSession): string {
  const l = locale;
  return layout({ locale, path, signedIn: session.signedIn, isStaff: false }, {
    title: l === 'en' ? 'Not found' : 'Introuvable',
    heading: l === 'en' ? 'Not found' : 'Introuvable',
    mainContent: `  <p>${l === 'en' ? "This page or record doesn't exist." : "Cette page ou cette fiche n'existe pas."}</p>`,
    bodyClass: 'page-notfound',
  });
}
