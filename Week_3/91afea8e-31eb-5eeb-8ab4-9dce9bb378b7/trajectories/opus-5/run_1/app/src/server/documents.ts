/** Invoice and packing label documents: written once, read back through the app. */

import { one, query } from './db.js';
import { renderPdf, type PdfLine } from './services/pdf.js';
import { getObject, objectKeys, putObject } from './services/storage.js';
import { formatAmount } from '../shared/format.js';

type ShipmentDocumentData = {
  shipment_id: string;
  order_id: string;
  placed_on: string;
  payment_kind: 'prepaid' | 'cod';
  payment_status: string;
  delivery_fee_paise: number;
  cod_fee_paise: number;
  gift_wrap_paise: number;
  seller_legal_name: string;
  seller_name: string;
  gstin: string;
  pickup_city: string;
  pickup_state: string;
  buyer_name: string;
  line1: string;
  line2: string;
  city: string;
  pincode: string;
  buyer_phone: string;
  delivery_state: string;
  invoice_stored: boolean;
  label_stored: boolean;
};

type DocumentLine = {
  title: string;
  quantity: number;
  unit_price_paise: number;
  coupon_share_paise: number;
  line_total_paise: number;
  gst_rate: number;
  taxable_value_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
};

async function documentData(shipmentId: string): Promise<{
  shipment: ShipmentDocumentData;
  lines: DocumentLine[];
} | null> {
  const shipment = await one<ShipmentDocumentData>(
    `SELECT s.id AS shipment_id, s.order_id, to_char(o.placed_at, 'YYYY-MM-DD') AS placed_on,
            s.payment_kind, p.status AS payment_status, s.delivery_fee_paise, s.cod_fee_paise,
            s.gift_wrap_paise, se.legal_name AS seller_legal_name, se.display_name AS seller_name,
            se.gstin, se.pickup_city, se.pickup_state,
            o.address->>'name' AS buyer_name, o.address->>'line1' AS line1, o.address->>'line2' AS line2,
            o.address->>'city' AS city, o.address->>'pincode' AS pincode,
            o.address->>'phone' AS buyer_phone,
            COALESCE(pin.state, '') AS delivery_state,
            s.invoice_stored, s.label_stored
       FROM shipments s
       JOIN orders o ON o.id = s.order_id
       JOIN sellers se ON se.id = s.seller_id
       JOIN payments p ON p.order_id = o.id
       LEFT JOIN pincodes pin ON pin.pincode = o.address->>'pincode'
      WHERE s.id = $1`,
    [shipmentId],
  );
  if (shipment === null) return null;
  const lines = await query<DocumentLine>(
    `SELECT title, quantity, unit_price_paise, coupon_share_paise, line_total_paise, gst_rate,
            taxable_value_paise, cgst_paise, sgst_paise, igst_paise
       FROM shipment_lines WHERE shipment_id = $1 ORDER BY created_seq`,
    [shipmentId],
  );
  return { shipment, lines };
}

function invoicePdf(data: { shipment: ShipmentDocumentData; lines: DocumentLine[] }): Buffer {
  const { shipment, lines } = data;
  const body: PdfLine[] = [
    { text: 'Tax invoice', size: 22 },
    { text: `Invoice number INV-${shipment.shipment_id}`, size: 12 },
    { text: `Order ${shipment.order_id}`, size: 12 },
    { text: `Date ${shipment.placed_on}`, size: 12, gap: 8 },
    { text: `Seller ${shipment.seller_legal_name}`, size: 12 },
    { text: `GSTIN ${shipment.gstin}`, size: 12 },
    { text: `Pickup ${shipment.pickup_city}, ${shipment.pickup_state}`, size: 12, gap: 8 },
    { text: `Buyer ${shipment.buyer_name}`, size: 12 },
    {
      text: `Delivery address ${[shipment.line1, shipment.line2].filter((part) => part !== '').join(', ')}, ${shipment.city} ${shipment.pincode}`,
      size: 12,
    },
    { text: `Place of supply ${shipment.delivery_state}`, size: 12, gap: 10 },
    { text: 'Lines', size: 14 },
  ];
  for (const line of lines) {
    body.push({ text: line.title, size: 12 });
    body.push({
      text: `Quantity ${line.quantity}   Unit price ${formatAmount(line.unit_price_paise)}   Coupon share ${formatAmount(line.coupon_share_paise)}`,
      size: 11,
    });
    body.push({
      text:
        line.igst_paise > 0
          ? `Taxable value ${formatAmount(line.taxable_value_paise)}   IGST ${line.gst_rate}% ${formatAmount(line.igst_paise)}   Line total ${formatAmount(line.line_total_paise)}`
          : `Taxable value ${formatAmount(line.taxable_value_paise)}   CGST ${line.gst_rate / 2}% ${formatAmount(line.cgst_paise)}   SGST ${line.gst_rate / 2}% ${formatAmount(line.sgst_paise)}   Line total ${formatAmount(line.line_total_paise)}`,
      size: 11,
      gap: 6,
    });
  }
  const linesTotal = lines.reduce((sum, line) => sum + line.line_total_paise, 0);
  body.push({ text: `Delivery fee ${formatAmount(shipment.delivery_fee_paise)}`, size: 12 });
  body.push({ text: `Gift wrap ${formatAmount(shipment.gift_wrap_paise)}`, size: 12 });
  body.push({ text: `Cash on delivery fee ${formatAmount(shipment.cod_fee_paise)}`, size: 12 });
  body.push({
    text: `Shipment total ${formatAmount(
      linesTotal + shipment.delivery_fee_paise + shipment.gift_wrap_paise + shipment.cod_fee_paise,
    )}`,
    size: 14,
  });
  return renderPdf(body);
}

function labelPdf(data: { shipment: ShipmentDocumentData; lines: DocumentLine[] }): Buffer {
  const { shipment, lines } = data;
  const cash =
    lines.reduce((sum, line) => sum + line.line_total_paise, 0) +
    shipment.delivery_fee_paise +
    shipment.gift_wrap_paise +
    shipment.cod_fee_paise;
  return renderPdf([
    { text: `Shipment ${shipment.shipment_id}`, size: 20 },
    { text: `Ship to ${shipment.buyer_name}`, size: 13 },
    {
      text: [shipment.line1, shipment.line2].filter((part) => part !== '').join(', '),
      size: 13,
    },
    { text: `${shipment.city} ${shipment.pincode}`, size: 13 },
    { text: `Phone ${shipment.buyer_phone}`, size: 13, gap: 8 },
    { text: `Seller ${shipment.seller_name}`, size: 13 },
    { text: `Pickup ${shipment.pickup_city}`, size: 13, gap: 8 },
    { text: `Lines ${lines.length}`, size: 13 },
    {
      text: shipment.payment_kind === 'cod' ? `Collect ${formatAmount(cash)}` : 'Prepaid',
      size: 16,
    },
  ]);
}

/** Writes a shipment's documents once, when its payment is confirmed or it is COD. */
export async function storeShipmentDocuments(shipmentId: string): Promise<void> {
  const data = await documentData(shipmentId);
  if (data === null) return;
  const { shipment } = data;
  const ready = shipment.payment_kind === 'cod' || shipment.payment_status === 'confirmed';
  if (!ready) return;
  if (!shipment.invoice_stored) {
    const stored = await putObject(
      objectKeys.invoice(shipment.order_id, shipmentId),
      invoicePdf(data),
      'application/pdf',
    );
    if (stored) {
      await query(`UPDATE shipments SET invoice_stored = true WHERE id = $1`, [shipmentId]);
    }
  }
  if (!shipment.label_stored) {
    const stored = await putObject(
      objectKeys.label(shipment.order_id, shipmentId),
      labelPdf(data),
      'application/pdf',
    );
    if (stored) {
      await query(`UPDATE shipments SET label_stored = true WHERE id = $1`, [shipmentId]);
    }
  }
}

export async function storePendingDocuments(): Promise<void> {
  const rows = await query<{ id: string }>(
    `SELECT s.id FROM shipments s
      WHERE (s.invoice_stored = false OR s.label_stored = false) AND s.state <> 'cancelled'`,
  );
  for (const row of rows) await storeShipmentDocuments(row.id);
}

export async function readInvoice(
  orderId: string,
  shipmentId: string,
): Promise<Buffer | null> {
  return getObject(objectKeys.invoice(orderId, shipmentId));
}

export async function readLabel(orderId: string, shipmentId: string): Promise<Buffer | null> {
  return getObject(objectKeys.label(orderId, shipmentId));
}
