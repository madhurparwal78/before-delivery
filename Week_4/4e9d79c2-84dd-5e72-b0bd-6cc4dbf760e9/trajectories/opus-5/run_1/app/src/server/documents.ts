import { moneyLabel } from '../domain/money.js';
import { seatLabels } from '../domain/seats.js';
import { formatUkDate } from '../domain/time.js';
import {
  DocumentKind,
  DOCUMENT_LABELS,
  documentObjectKey,
  documentsOfHire,
  markRendering,
  removeDocument,
  startDocument,
  storeDocument,
} from './data/documents.js';
import { HireView } from './data/hires.js';
import { passengersOf, seatPlacesOf } from './data/passengers.js';
import { renderPdf } from './providers/pdf.js';
import { getObject, putObject } from './providers/storage.js';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body { font-family: "Helvetica Neue", Arial, sans-serif; color: #1b0a22; margin: 24mm 16mm; }
  h1 { font-size: 22pt; margin: 0 0 4mm; }
  h2 { font-size: 13pt; margin: 6mm 0 2mm; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #1b0a22; padding: 2mm 3mm; text-align: left; font-size: 10pt; }
  .bar { background: #1b0a22; color: #fff; padding: 4mm; }
  .total { font-weight: bold; }
</style></head><body>${body}</body></html>`;
}

/** Customer paper holds no bought-in price, margin, operator name or unsigned note. */
function quoteHtml(hire: HireView, kind: DocumentKind, number: string | null): string {
  const rows = hire.vehicles
    .map(
      (vehicle) =>
        `<tr><td>${vehicle.seats} seats</td><td>${moneyLabel(vehicle.total)}</td><td>${moneyLabel(vehicle.deposit)}</td></tr>`,
    )
    .join('');
  const heading = `${DOCUMENT_LABELS[kind]} ${hire.reference}`;
  return page(
    heading,
    `<div class="bar"><strong>Merrowfield Coach Hire</strong><br>Coventry</div>
     <h1>${escapeHtml(heading)}</h1>
     ${number ? `<p>Number: ${escapeHtml(number)}</p>` : ''}
     <p>${escapeHtml(hire.customer.name)}</p>
     <h2>Travel</h2>
     <p>${hire.stops.map((stop) => escapeHtml(stop.text)).join(' &rarr; ')}</p>
     <p>Out: ${formatUkDate(hire.departAt.date)}, ${hire.departAt.time}${
       hire.returnAt ? `<br>Return: ${formatUkDate(hire.returnAt.date)}, ${hire.returnAt.time}` : ''
     }</p>
     <p>Party: ${hire.party.people} people</p>
     <h2>Money</h2>
     <table><thead><tr><th>Vehicle</th><th>Total</th><th>Deposit</th></tr></thead><tbody>${rows}</tbody></table>
     <p class="total">Total ${moneyLabel(hire.total)} &middot; Deposit due ${moneyLabel(hire.depositTotal)}</p>
     <p>Pay by bank transfer quoting ${escapeHtml(hire.reference)}</p>`,
  );
}

async function seatPlanHtml(hire: HireView): Promise<string> {
  const passengers = await passengersOf(hire.deskId, hire.id);
  const places = await seatPlacesOf(hire.deskId, hire.id);
  const grids = hire.vehicles
    .map((vehicle) => {
      const cells = seatLabels(vehicle.seats)
        .map((seat) => {
          const place = places.find((held) => held.vehicleId === vehicle.id && held.seat === seat);
          const passenger = passengers.find((person) => person.id === place?.passengerId);
          return `<td>${escapeHtml(seat)}<br>${passenger ? escapeHtml(passenger.name) : 'empty'}</td>`;
        })
        .join('');
      return `<h2>${vehicle.seats}-seat vehicle</h2><table><tbody><tr>${cells}</tr></tbody></table>`;
    })
    .join('');
  return page(
    `Seat plan ${hire.reference}`,
    `<h1>Seat plan ${escapeHtml(hire.reference)}</h1><p>${escapeHtml(hire.customer.name)}</p>${grids}`,
  );
}

export async function documentHtml(hire: HireView, kind: DocumentKind, number: string | null): Promise<string> {
  if (kind === 'seatPlan') return seatPlanHtml(hire);
  return quoteHtml(hire, kind, number);
}

/** `Stored` only after Gotenberg has answered and MinIO has confirmed; either outage keeps nothing. */
export async function makeDocument(
  deskId: string,
  hire: HireView,
  kind: DocumentKind,
  who: string,
): Promise<Awaited<ReturnType<typeof storeDocument>>> {
  const at = Date.now();
  const record = await startDocument(deskId, hire.id, kind, hire.customer.name, who, at);
  try {
    await markRendering(deskId, record.id, who);
    const html = await documentHtml(hire, kind, null);
    const pdf = await renderPdf(html);
    const objectKey = documentObjectKey(deskId, record.id);
    await putObject(objectKey, pdf, 'application/pdf');
    return await storeDocument(deskId, record.id, kind, objectKey, who, Date.now());
  } catch (trouble) {
    await removeDocument(deskId, record.id);
    throw trouble;
  }
}

export async function quotePdfFor(deskId: string, hire: HireView): Promise<Buffer> {
  const held = (await documentsOfHire(deskId, hire.id)).find(
    (document) => document.kind === 'quote' && document.state === 'stored' && document.objectKey,
  );
  if (held?.objectKey) {
    const stored = await getObject(held.objectKey);
    if (stored) return stored.body;
  }
  const made = await makeDocument(deskId, hire, 'quote', 'Wayticket');
  const stored = made.objectKey ? await getObject(made.objectKey) : null;
  if (!stored) throw new Error('quote PDF not stored');
  return stored.body;
}
