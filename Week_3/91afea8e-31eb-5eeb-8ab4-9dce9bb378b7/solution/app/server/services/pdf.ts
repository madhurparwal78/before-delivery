import { rupees } from "../../shared/format.js";

/** A minimal PDF writer: Helvetica for text, a one-glyph Type 3 font with a ToUnicode map for the rupee sign. */
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 48;

interface TextItem {
  x: number;
  y: number;
  size: number;
  bold: boolean;
  text: string;
}

class Document {
  private readonly items: TextItem[] = [];
  private cursor = PAGE_HEIGHT - MARGIN;

  line(text: string, options: { size?: number; bold?: boolean; x?: number; gap?: number } = {}): this {
    const size = options.size ?? 10;
    this.items.push({ x: options.x ?? MARGIN, y: this.cursor, size, bold: options.bold ?? false, text });
    this.cursor -= size + (options.gap ?? 5);
    return this;
  }

  gap(points: number): this {
    this.cursor -= points;
    return this;
  }

  build(): Buffer {
    const content = this.items.map(renderItem).join("\n");
    const objects: string[] = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
      "<< /Type /Font /Subtype /Type3 /FontBBox [0 0 600 700] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << /rupee 8 0 R >> " +
        "/Encoding << /Type /Encoding /Differences [1 /rupee] >> /FirstChar 1 /LastChar 1 /Widths [600] /ToUnicode 9 0 R /Resources << >> >>",
      streamOf(RUPEE_GLYPH),
      streamOf(TO_UNICODE),
    ];
    let out = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((body, index) => {
      offsets.push(out.length);
      out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, "latin1");
  }
}

function streamOf(body: string): string {
  return `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
}

const RUPEE_GLYPH = "600 0 0 0 600 700 d1\n56 w 1 J 1 j\n130 650 m 290 650 l 420 650 440 470 290 430 c 130 430 l S\n110 560 m 480 560 l S\n130 650 m 480 650 l S\n150 430 m 440 40 l S";

const TO_UNICODE =
  "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def " +
  "/CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <01> <01> endcodespacerange " +
  "1 beginbfchar <01> <20B9> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end";

function escapeText(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;
    if (char === "(" || char === ")" || char === "\\") out += `\\${char}`;
    else if (code >= 32 && code < 127) out += char;
    else if (code >= 160 && code <= 255) out += `\\${code.toString(8)}`;
    else out += "?";
  }
  return out;
}

function renderItem(item: TextItem): string {
  const font = item.bold ? "F2" : "F1";
  const segments = item.text.split("₹");
  let body = "";
  segments.forEach((segment, index) => {
    if (index > 0) body += `/F3 ${item.size} Tf <01> Tj /${font} ${item.size} Tf `;
    body += `(${escapeText(segment)}) Tj `;
  });
  return `BT /${font} ${item.size} Tf ${item.x} ${item.y} Td ${body}ET`;
}

interface InvoiceLine {
  title: string;
  quantity: number;
  unitPricePaise: number;
  couponSharePaise: number;
  taxableValuePaise: number;
  gstRate: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  lineTotalPaise: number;
}

interface InvoiceData {
  shipmentId: string;
  orderId: string;
  date: string;
  seller: { name: string; gstin: string; pickupCity: string; pickupState: string };
  buyer: { name: string; line1: string; line2: string; city: string; state: string; pincode: string };
  lines: InvoiceLine[];
  deliveryFeePaise: number;
  codFeePaise: number;
  giftWrapPaise: number;
  emiDiscountPaise: number;
  totalPaise: number;
}

export function renderInvoice(data: InvoiceData): Buffer {
  const doc = new Document();
  doc.line("Tax invoice", { size: 20, bold: true, gap: 10 });
  doc.line(`Invoice number INV-${data.shipmentId}`);
  doc.line(`Order ${data.orderId}`);
  doc.line(`Invoice date ${data.date}`, { gap: 10 });
  doc.line("Sold by", { bold: true });
  doc.line(data.seller.name);
  doc.line(`GSTIN ${data.seller.gstin}`);
  doc.line(`${data.seller.pickupCity}, ${data.seller.pickupState}`, { gap: 10 });
  doc.line("Billed to", { bold: true });
  doc.line(data.buyer.name);
  doc.line(data.buyer.line1);
  if (data.buyer.line2) doc.line(data.buyer.line2);
  doc.line(`${data.buyer.city}, ${data.buyer.state} ${data.buyer.pincode}`);
  doc.line(`Place of supply ${data.buyer.state}`, { gap: 12 });
  const sameState = data.seller.pickupState === data.buyer.state;
  for (const line of data.lines) {
    doc.line(line.title, { bold: true, size: 10 });
    doc.line(`Quantity ${line.quantity} at ${rupees(line.unitPricePaise)}, coupon share ${rupees(line.couponSharePaise)}`, { x: MARGIN + 10, size: 9 });
    doc.line(`Taxable value ${rupees(line.taxableValuePaise)}`, { x: MARGIN + 10, size: 9 });
    if (sameState) {
      const half = line.gstRate / 2;
      doc.line(`CGST ${half}% ${rupees(line.cgstPaise)}, SGST ${half}% ${rupees(line.sgstPaise)}`, { x: MARGIN + 10, size: 9 });
    } else {
      doc.line(`IGST ${line.gstRate}% ${rupees(line.igstPaise)}`, { x: MARGIN + 10, size: 9 });
    }
    doc.line(`Line total ${rupees(line.lineTotalPaise)}`, { x: MARGIN + 10, size: 9, gap: 8 });
  }
  doc.gap(6);
  doc.line(`Delivery fee ${rupees(data.deliveryFeePaise)}`);
  doc.line(`Cash on delivery fee ${rupees(data.codFeePaise)}`);
  doc.line(`Gift wrap ${rupees(data.giftWrapPaise)}`);
  if (data.emiDiscountPaise > 0) doc.line(`Upfront EMI discount ${rupees(data.emiDiscountPaise)}`);
  doc.line(`Shipment total ${rupees(data.totalPaise)}`, { bold: true, size: 12 });
  return doc.build();
}

interface LabelData {
  shipmentId: string;
  shipTo: { name: string; line1: string; line2: string; city: string; pincode: string; phone: string };
  sellerName: string;
  pickupCity: string;
  lineCount: number;
  collectPaise: number | null;
}

export function renderLabel(data: LabelData): Buffer {
  const doc = new Document();
  doc.line("Packing label", { size: 20, bold: true, gap: 10 });
  doc.line(`Shipment ${data.shipmentId}`, { size: 14, bold: true, gap: 10 });
  doc.line("Ship to", { bold: true });
  doc.line(data.shipTo.name, { size: 12 });
  doc.line(data.shipTo.line1);
  if (data.shipTo.line2) doc.line(data.shipTo.line2);
  doc.line(`${data.shipTo.city} ${data.shipTo.pincode}`);
  doc.line(`Phone ${data.shipTo.phone}`, { gap: 10 });
  doc.line("From", { bold: true });
  doc.line(`${data.sellerName}, ${data.pickupCity}`, { gap: 10 });
  doc.line(`Items ${data.lineCount}`, { gap: 10 });
  doc.line(data.collectPaise === null ? "Prepaid" : `Collect ${rupees(data.collectPaise)}`, { size: 18, bold: true });
  return doc.build();
}
