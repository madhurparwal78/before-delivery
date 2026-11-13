import { formatMoney } from './format.js';
import type { FunderRow, MilestoneRow } from './commission-service.js';
import { INSTALLATION_LABELS } from './domain/seed.js';

const STYLE = `
  <style>
    body { font-family: Arial, Helvetica, sans-serif; color: #101828; margin: 40px; }
    h1 { font-size: 20px; }
    table { border-collapse: collapse; margin: 16px 0; }
    td, th { border: 1px solid #98a2b3; padding: 6px 12px; text-align: left; }
    th { background: #f2f4f7; }
    .total { font-weight: bold; }
  </style>`;

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function contractHtml(input: {
  title: string;
  clientName: string;
  clientEmail: string;
  venueName: string;
  installationType: string;
  heldDate: string | null;
  quoteLines: Array<{ label: string; amountCents: number }>;
  totalCents: number;
  milestones: MilestoneRow[];
  funders: FunderRow[];
  signatureName: string;
  signedAt: Date;
}): string {
  const lines = input.quoteLines
    .map((l) => `<tr><td>${esc(l.label)}</td><td>${formatMoney(l.amountCents)}</td></tr>`)
    .join('');
  const schedule = input.milestones
    .map((m) => `<tr><td>${esc(m.label)}</td><td>${formatMoney(m.amount_cents)}</td></tr>`)
    .join('');
  const funders = input.funders
    .map((f) => `<tr><td>${esc(f.name ?? f.kind)}</td><td>${(f.bp / 100).toFixed(2)}%</td></tr>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8">${STYLE}</head><body>
    <h1>Commission agreement — ${esc(input.title)}</h1>
    <p>Spindrift Rooms and ${esc(input.clientName)} (${esc(input.clientEmail)})</p>
    <p>Installation: ${esc(INSTALLATION_LABELS[input.installationType as 'camera-reactive-wall' | 'portrait-kiosk' | 'projection-room'] ?? input.installationType)}</p>
    <p>Venue: ${esc(input.venueName)}</p>
    <p>Install day: ${input.heldDate ?? 'to be held'}</p>
    <h2>Quote</h2>
    <table>${lines}<tr class="total"><td>Total</td><td>${formatMoney(input.totalCents)}</td></tr></table>
    <h2>Payment schedule</h2>
    <table>${schedule}</table>
    <h2>Funders</h2>
    <table>${funders}</table>
    <h2>Signature</h2>
    <p>${esc(input.signatureName)} — ${input.signedAt.toISOString()}</p>
  </body></html>`;
}

export function invoiceHtml(input: {
  title: string;
  label: string;
  payerName: string;
  invoiceNumber: string;
  workCents: number;
  taxCents: number;
  totalCents: number;
  dueBy: string;
}): string {
  return `<!doctype html><html><head><meta charset="utf-8">${STYLE}</head><body>
    <h1>Invoice — ${esc(input.title)} — ${esc(input.label)}</h1>
    <p>Payer: ${esc(input.payerName)}</p>
    <p>Kill Bill invoice: ${esc(input.invoiceNumber)}</p>
    <table>
      <tr><td>Work</td><td>${formatMoney(input.workCents)}</td></tr>
      <tr><td>Sales tax</td><td>${formatMoney(input.taxCents)}</td></tr>
      <tr class="total"><td>Total</td><td>${formatMoney(input.totalCents)}</td></tr>
    </table>
    <p>Due by: ${esc(input.dueBy)}</p>
  </body></html>`;
}
