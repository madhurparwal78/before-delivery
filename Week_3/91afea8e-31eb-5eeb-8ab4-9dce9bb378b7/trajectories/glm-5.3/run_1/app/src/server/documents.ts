import { Pdf } from "./pdf.js";
import { amount, dateLabel } from "./format.js";
import type { SellerShipment, ShopperShipment } from "./views.js";
import { istDateString } from "./time.js";

export function buildInvoicePdf(view: ShopperShipment, seller: { name: string; gstin: string; pickup_city: string; pickup_state: string }, order: { order_id: string; address: { name: string; line1: string; line2: string; city: string; state: string; pincode: string } }): Buffer {
  const pdf = new Pdf();
  pdf.text(50, 60, 22, "Tax invoice", "F2");
  pdf.text(400, 60, 12, `INV-${view.shipment_id}`);
  pdf.text(50, 85, 11, `Order ${order.order_id}`);
  pdf.text(400, 85, 11, `Date ${dateLabel(istDateString())}`);
  pdf.line(50, 100, 545, 100);

  let y = 125;
  pdf.text(50, y, 12, "Seller", "F2");
  pdf.textLines(50, y + 18, 11, [seller.name, `${seller.pickup_city}, ${seller.pickup_state}`, `GSTIN ${seller.gstin}`], 14);
  pdf.text(320, y, 12, "Buyer", "F2");
  pdf.textLines(320, y + 18, 11, [order.address.name, order.address.line1, order.address.line2, `${order.address.city}, ${order.address.state} ${order.address.pincode}`, `Place of supply: ${order.address.state}`], 14);

  y = 215;
  pdf.line(50, y, 545, y);
  const headers = ["Title", "Qty", "Unit price", "Coupon", "Taxable", "CGST", "SGST", "IGST", "Line total"];
  const cols = [50, 205, 240, 295, 350, 405, 455, 490, 525];
  headers.forEach((h, i) => pdf.text(cols[i], y + 16, 9, h, "F2"));
  pdf.line(50, y + 26, 545, y + 26);
  y += 42;
  for (const line of view.lines) {
    pdf.text(cols[0], y, 10, line.title);
    pdf.text(cols[1], y, 10, String(line.quantity));
    pdf.text(cols[2], y, 10, amount(line.unit_price_paise));
    pdf.text(cols[3], y, 10, amount(line.coupon_share_paise));
    pdf.text(cols[4], y, 10, amount(line.taxable_value_paise));
    pdf.text(cols[5], y, 10, line.cgst_paise > 0 ? amount(line.cgst_paise) : "-");
    pdf.text(cols[6], y, 10, line.sgst_paise > 0 ? amount(line.sgst_paise) : "-");
    pdf.text(cols[7], y, 10, line.igst_paise > 0 ? amount(line.igst_paise) : "-");
    pdf.text(cols[8], y, 10, amount(line.line_total_paise));
    y += 26;
    pdf.text(cols[0], y - 6, 8, `${line.gst_rate}% GST`);
    y += 8;
  }
  pdf.line(50, y, 545, y);
  y += 22;
  const shipmentTotal = view.lines.reduce((a, l) => a + l.line_total_paise, 0) + view.delivery_fee_paise + view.cod_fee_paise + view.gift_wrap_paise;
  pdf.text(350, y, 11, "Delivery fee", "F2"); pdf.text(470, y, 11, amount(view.delivery_fee_paise));
  if (view.cod_fee_paise > 0) { y += 16; pdf.text(350, y, 11, "COD fee", "F2"); pdf.text(470, y, 11, amount(view.cod_fee_paise)); }
  if (view.gift_wrap_paise > 0) { y += 16; pdf.text(350, y, 11, "Gift wrap", "F2"); pdf.text(470, y, 11, amount(view.gift_wrap_paise)); }
  y += 20;
  pdf.text(350, y, 13, "Shipment total", "F2"); pdf.text(470, y, 13, amount(shipmentTotal));
  return pdf.build();
}

export function buildLabelPdf(view: SellerShipment, shipTo: { name: string; line1: string; line2: string; city: string; pincode: string; phone: string }, seller: { name: string; pickup_city: string }, collect: number | null): Buffer {
  const pdf = new Pdf();
  pdf.rect(40, 40, 515, 762);
  pdf.text(70, 90, 16, `Shipment ${view.shipment_id}`, "F2");
  pdf.text(70, 130, 12, `${view.lines.length} ${view.lines.length === 1 ? "line" : "lines"}`);
  pdf.line(70, 150, 525, 150);
  pdf.text(70, 180, 12, "Ship to", "F2");
  pdf.textLines(70, 205, 12, [shipTo.name, shipTo.line1, shipTo.line2, `${shipTo.city} ${shipTo.pincode}`, shipTo.phone], 18);
  pdf.line(70, 320, 525, 320);
  pdf.text(70, 350, 12, "From", "F2");
  pdf.textLines(70, 375, 12, [seller.name, seller.pickup_city], 18);
  pdf.line(70, 440, 525, 440);
  pdf.text(70, 480, 18, collect === null ? "Prepaid" : `Collect ${amount(collect)}`, "F2");
  return pdf.build();
}
