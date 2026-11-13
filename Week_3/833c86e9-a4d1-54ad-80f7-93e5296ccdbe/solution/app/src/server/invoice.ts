import type { Booking, QuoteRoomNight } from '../shared/types'
import { t, type Lang } from '../shared/i18n'
import { longDate, money } from '../shared/format'
import { isLive } from '../shared/rules'
import { sumLines } from './pricing'

const escape = (text: string): string => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)


export function invoiceHtml(booking: Booking, lang: Lang): string {
  const live = booking.rooms.filter((room) => isLive(room.state))
  const rooms = live.length ? live : booking.rooms
  const fmt = (minor: number): string => money(minor, 'EUR', lang)
  const price = (minor: number): string => `<span class="amount" data-minor="${minor}" data-currency="EUR">${escape(fmt(minor))}</span>`
  const zone = booking.property.zone
  const lines = (nights: QuoteRoomNight[]): string =>
    nights.map((night) => `<li><strong>${escape(longDate(night.date, lang, zone))}</strong><ul>${sumLines([night]).map((line) => `<li>${escape(t(lang, `line.${line.key}`))}: ${price(line.minor)}</li>`).join('')}</ul></li>`).join('')
  const dates = rooms[0]?.nights.map((night) => night.date) ?? []
  const perNight = dates.map((date) => {
    const pieces = rooms.map((room) => room.nights.find((night) => night.date === date) as QuoteRoomNight)
    return { date, lines: sumLines(pieces) }
  })
  const vat = rooms.reduce((sum, room) => sum + room.nights.reduce((inner, night) => inner + (night.lines.find((line) => line.key === 'vat')?.minor ?? 0), 0), 0)
  const city = rooms.reduce((sum, room) => sum + room.nights.reduce((inner, night) => inner + (night.lines.find((line) => line.key === 'city_tax')?.minor ?? 0), 0), 0)
  const ledger = booking.ledger.map((entry) =>
    `<tr><td>${escape(t(lang, `kind.${entry.kind}`))}</td><td>${escape(t(lang, `account.${entry.account}`))}</td><td>${entry.debit_minor ? price(entry.debit_minor) : ''}</td><td>${entry.credit_minor ? price(entry.credit_minor) : ''}</td><td>${escape(entry.at)}</td></tr>`).join('')
  const nightsText = perNight.map((night) => `<li><strong>${escape(longDate(night.date, lang, zone))}</strong><ul>${night.lines.map((line) => `<li>${escape(t(lang, `line.${line.key}`))}: ${price(line.minor)}</li>`).join('')}</ul></li>`).join('')
  return `<!doctype html>
<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(t(lang, 'ui.invoice'))} ${escape(booking.code)}</title>
<style>body{font:15px/1.5 Chivo,system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#000}h1{font-size:36px;font-weight:900}table{width:100%;border-collapse:collapse}td,th{text-align:start;padding:.4rem .6rem .4rem 0;overflow-wrap:anywhere}.amount{font-variant-numeric:tabular-nums}.total{font-size:36px;font-weight:900}ul{padding-inline-start:1.2rem}</style></head>
<body><main>
<h1>${escape(t(lang, 'ui.booking', { code: booking.code }))}</h1>
<p>${escape(t(lang, 'ui.guestLine'))}: ${escape(booking.given_name)} ${escape(booking.surname)}</p>
<p>${escape(t(lang, 'ui.propertyLine'))}: ${escape(booking.property.name)}</p>
<p>${escape(t(lang, 'ui.zoneLine'))}: ${escape(zone)}</p>
<p>${escape(t(lang, 'ui.arrival'))}: ${escape(longDate(booking.in, lang, zone))} · ${escape(t(lang, 'ui.departure'))}: ${escape(longDate(booking.out, lang, zone))}</p>
${rooms.map((room) => `<section><h2>${escape(t(lang, 'ui.roomN', { n: room.n }))}</h2><ul>${lines(room.nights)}</ul></section>`).join('')}
<section><h2>${escape(t(lang, 'ui.priceLines'))}</h2><ul>${nightsText}</ul></section>
<p>${escape(t(lang, 'invoice.vatTotal'))}: ${price(vat)}</p>
<p>${escape(t(lang, 'invoice.cityTotal'))}: ${price(city)}</p>
<p class="total">${escape(t(lang, 'ui.total'))}: ${price(booking.total_minor)}</p>
<p>${escape(t(lang, 'invoice.paid_by', { last4: booking.card_last4 }))}</p>
<table><caption>${escape(t(lang, 'ui.ledger'))}</caption><thead><tr><th>${escape(t(lang, 'ui.colKind'))}</th><th>${escape(t(lang, 'ui.colAccount'))}</th><th>${escape(t(lang, 'ui.colDebit'))}</th><th>${escape(t(lang, 'ui.colCredit'))}</th><th>${escape(t(lang, 'ui.colTime'))}</th></tr></thead><tbody>${ledger}</tbody></table>
</main></body></html>`
}

export const storageNotice = (lang: Lang): string =>
  `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${escape(t(lang, 'ui.invoice'))}</title></head><body><p role="alert">${escape(t(lang, 'storage.doc'))}</p></body></html>`
