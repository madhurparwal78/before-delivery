import { config } from './config.js';

export interface InvoiceLine {
  date: string;
  description: string;
  amountCents: number;
}

export function renderInvoiceHtml(data: {
  number: string;
  hotelName: string;
  billTo: string;
  arrival: string;
  departure: string;
  roomNumber: string;
  lines: InvoiceLine[];
  totalCents: number;
  paidCents: number;
  money: (cents: number) => string;
}): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = data.lines.map(l =>
    `<tr><td>${esc(l.date)}</td><td>${esc(l.description)}</td><td class="num">${data.money(l.amountCents)}</td></tr>`).join('\n');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Invoice ${esc(data.number)}</title>
<style>
body { font-family: sans-serif; font-size: 12px; margin: 24px; color: #111; }
.num { text-align: right; }
table { width: 100%; border-collapse: collapse; margin-top: 12px; }
td { padding: 3px 6px; }
h1 { font-size: 16px; }
.line { white-space: nowrap; }
</style></head><body>
<p class="line">Invoice ${esc(data.number)}</p>
<p class="line">${esc(data.hotelName)}</p>
<p class="line">Bill to: ${esc(data.billTo)}</p>
<p class="line">Stay: ${esc(data.arrival)} to ${esc(data.departure)}</p>
<p class="line">Room ${esc(data.roomNumber)}</p>
<table>${rows}</table>
<p class="line" style="margin-top:12px">Total: ${data.money(data.totalCents)}</p>
<p class="line">Paid: ${data.money(data.paidCents)}</p>
<p class="line">Balance: $0.00</p>
</body></html>`;
}

export async function renderPdf(html: string, timeoutMs = 5000): Promise<Buffer> {
  const form = new FormData();
  form.append('index.html', new Blob([html], { type: 'text/html' }), 'index.html');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.gotenbergUrl.replace(/\/$/, '')}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`gotenberg ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

export async function gotenbergProbe(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(`${config.gotenbergUrl.replace(/\/$/, '')}/health`, { signal: controller.signal });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}
