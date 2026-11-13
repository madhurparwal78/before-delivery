import { Booking } from '../shared/types';
import { fmtLongDate, fmtMoney, fmtMoment } from '../shared/format';
import { msg, ui } from '../shared/strings';
import { sumLines } from '../shared/lines';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(minor: number): string {
  return fmtMoney('en', minor, 'EUR');
}

/** The printable invoice page, stored once per ledger change. */
export function invoiceHtml(booking: Booking): string {
  const lang = 'en' as const;
  const zone = booking.property.zone;
  const nightsCount = booking.rooms[0]?.nights.length ?? 0;
  let vatTotal = 0;
  let cityTotal = 0;
  for (const room of booking.rooms) {
    for (const night of room.nights) {
      for (const line of night.lines) {
        if (line.key === 'vat') vatTotal += line.minor;
        if (line.key === 'city_tax') cityTotal += line.minor;
      }
    }
  }
  const nights = Array.from({ length: nightsCount }, (_, index) => {
    const date = booking.rooms[0].nights[index].date;
    const lines = sumLines(booking.rooms.map((room) => room.nights[index].lines));
    return `<section class="night"><h3>${escapeHtml(fmtLongDate(lang, date, zone))}</h3><ul>${lines
      .map(
        (line) =>
          `<li data-minor="${line.minor}" data-currency="EUR">${escapeHtml(
            ui(lang, `ui.line.${line.key}`),
          )}: ${escapeHtml(money(line.minor))}</li>`,
      )
      .join('')}</ul></section>`;
  }).join('');
  const ledger = booking.ledger
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(ui(lang, `ui.kind.${entry.kind}`))}</td><td>${escapeHtml(
          ui(lang, `ui.account.${entry.account}`),
        )}</td><td data-minor="${entry.debit_minor}" data-currency="EUR">${escapeHtml(
          money(entry.debit_minor),
        )}</td><td data-minor="${entry.credit_minor}" data-currency="EUR">${escapeHtml(
          money(entry.credit_minor),
        )}</td><td>${escapeHtml(fmtMoment(lang, entry.at, zone))}</td></tr>`,
    )
    .join('');
  const rooms = booking.rooms
    .map(
      (room) =>
        `<li>${escapeHtml(room.room_type)} — ${escapeHtml(room.plan)} — ${escapeHtml(room.state)} — <span data-minor="${
          room.paid_minor
        }" data-currency="EUR">${escapeHtml(money(room.paid_minor))}</span></li>`,
    )
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(
    ui(lang, 'ui.booking_heading', { code: booking.code }),
  )}</title>
<style>body{font-family:Chivo,system-ui,sans-serif;color:#000;background:#fff;margin:2rem}
h1{font-weight:900;font-size:2.5rem;margin:0 0 1rem}table{border-collapse:collapse;width:100%}
td,th{text-align:start;padding:.25rem .5rem}ul{margin:.25rem 0 1rem;padding-inline-start:1.25rem}
.total{font-weight:900;font-size:2rem}</style></head>
<body>
<h1>${escapeHtml(ui(lang, 'ui.booking_heading', { code: booking.code }))}</h1>
<p>${escapeHtml(`${booking.given_name} ${booking.surname}`)}</p>
<p>${escapeHtml(booking.property.name)} — ${escapeHtml(booking.property.zone)}</p>
<p>${escapeHtml(fmtLongDate(lang, booking.in, zone))} — ${escapeHtml(fmtLongDate(lang, booking.out, zone))}</p>
<ul>${rooms}</ul>
${nights}
<p>${escapeHtml(ui(lang, 'ui.line.vat'))}: <span data-minor="${vatTotal}" data-currency="EUR">${escapeHtml(
    money(vatTotal),
  )}</span></p>
<p>${escapeHtml(ui(lang, 'ui.line.city_tax'))}: <span data-minor="${cityTotal}" data-currency="EUR">${escapeHtml(
    money(cityTotal),
  )}</span></p>
<p class="total"><span data-minor="${booking.total_minor}" data-currency="EUR">${escapeHtml(
    money(booking.total_minor),
  )}</span></p>
<table><caption>${escapeHtml(ui(lang, 'ui.ledger'))}</caption>
<thead><tr><th>${escapeHtml(ui(lang, 'ui.col.kind'))}</th><th>${escapeHtml(
    ui(lang, 'ui.col.account'),
  )}</th><th>${escapeHtml(ui(lang, 'ui.col.debit'))}</th><th>${escapeHtml(
    ui(lang, 'ui.col.credit'),
  )}</th><th>${escapeHtml(ui(lang, 'ui.col.time'))}</th></tr></thead>
<tbody>${ledger}</tbody></table>
<p>${escapeHtml(msg(lang, 'invoice.paid_by', { last4: booking.card_last4 }))}</p>
</body></html>
`;
}
