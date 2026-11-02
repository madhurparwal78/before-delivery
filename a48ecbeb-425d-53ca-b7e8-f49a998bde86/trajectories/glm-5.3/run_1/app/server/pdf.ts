/** Minimal PDF writer: letter pages, Helvetica base font, simple text layout. */

export interface OrderPdfLine {
  flavour: string;
  quantity: number;
  unit_price_cents: number;
  goods_cents: number;
  discount_cents: number;
  deposit_cents: number;
}

export interface OrderPdfTaxes {
  name: string;
  rate: string;
  cents: number;
}

export interface OrderPdfData {
  number: string;
  placed_at: Date;
  province: string;
  lines: OrderPdfLine[];
  goods_cents: number;
  discount_cents: number;
  discounted_goods_cents: number;
  shipping_cents: number;
  deposit_cents: number;
  taxes: OrderPdfTaxes[];
  total_cents: number;
  ship_to: { name: string; line1: string; line2?: string; city: string; province: string; postal_code: string };
}

export interface PackingSlipData {
  number: string;
  ship_to: { name: string; line1: string; line2?: string; city: string; province: string; postal_code: string };
  cans: { flavour: string; quantity: number }[];
}

function dollars(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

interface TextOp {
  text: string;
  x: number;
  y: number;
  bold: boolean;
  size: number;
}

function buildPdf(ops: TextOp[]): Buffer {
  const lines: string[] = [];
  let content = '';
  for (const op of ops) {
    const font = op.bold ? '/F2' : '/F1';
    content += `BT ${font} ${op.size} Tf 1 0 0 1 ${op.x} ${op.y} Tm (${escape(op.text)}) Tj ET\n`;
  }
  void lines;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

function escape(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7e]/g, ' ');
}

export async function invoicePdf(order: OrderPdfData): Promise<Buffer> {
  const ops: TextOp[] = [];
  let y = 730;
  const line = (text: string, bold = false, size = 11, x = 72): void => {
    ops.push({ text, x, y, bold, size });
    y -= size + 6;
  };
  line('Ceibo', true, 22);
  line('Organic sparkling yerba mate', false, 10);
  y -= 12;
  line('Invoice', true, 16);
  line(`Order ${order.number}`);
  y -= 12;
  line('Ship to', true, 11);
  line(order.ship_to.name);
  line(order.ship_to.line1);
  if (order.ship_to.line2) line(order.ship_to.line2);
  line(`${order.ship_to.city}, ${order.ship_to.province} ${order.ship_to.postal_code}`);
  y -= 12;
  for (const item of order.lines) {
    line(
      `${item.quantity} x ${item.flavour} @ ${dollars(item.unit_price_cents)} = ${dollars(item.goods_cents)}`,
      false,
      11
    );
  }
  y -= 6;
  line(`Subtotal ${dollars(order.goods_cents)}`);
  if (order.discount_cents > 0) {
    line(`Subscribe & save (10%) ${dollars(-order.discount_cents)}`);
  }
  line(`Deposit ${dollars(order.deposit_cents)}`);
  line(`Shipping ${order.shipping_cents === 0 ? 'Free' : dollars(order.shipping_cents)}`);
  for (const tax of order.taxes) {
    line(`${tax.name} (${tax.rate}%) ${dollars(tax.cents)}`);
  }
  y -= 6;
  line(`Total ${dollars(order.total_cents)}`, true, 13);
  return buildPdf(ops);
}

export async function packingSlipPdf(data: PackingSlipData): Promise<Buffer> {
  const ops: TextOp[] = [];
  let y = 730;
  const line = (text: string, bold = false, size = 11): void => {
    ops.push({ text, x: 72, y, bold, size });
    y -= size + 6;
  };
  line('Ceibo', true, 22);
  line('Organic sparkling yerba mate', false, 10);
  y -= 12;
  line('Packing slip', true, 16);
  line(`Order ${data.number}`);
  y -= 12;
  line('Ship to', true, 11);
  line(data.ship_to.name);
  line(data.ship_to.line1);
  if (data.ship_to.line2) line(data.ship_to.line2);
  line(`${data.ship_to.city}, ${data.ship_to.province} ${data.ship_to.postal_code}`);
  y -= 12;
  line('Cans', true, 11);
  for (const can of data.cans) {
    line(`${can.quantity} x ${can.flavour}`);
  }
  return buildPdf(ops);
}
