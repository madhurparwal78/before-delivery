import { one, query, transaction } from "../db.js";
import { todayInIndia } from "../domain/promise.js";
import { objectExists, putObject } from "./s3.js";
import { ProviderUnavailable } from "./provider.js";
import { renderInvoice, renderLabel } from "./pdf.js";

interface ShipmentFacts {
  id: string;
  order_id: string;
  state: string;
  gift_wrap_paise: number;
  delivery_fee_paise: number;
  cod_fee_paise: number;
  emi_discount_paise: number;
  balance_share_paise: number;
  invoice_stored: boolean;
  label_stored: boolean;
  placed_at: number;
  address: { name: string; line1: string; line2: string; city: string; state: string; pincode: string; phone: string };
  payment_method: string | null;
  payment_status: string;
  seller_name: string;
  gstin: string;
  pickup_city: string;
  pickup_state: string;
}

export const invoiceKey = (orderId: string, shipmentId: string): string => `invoices/${orderId}/${shipmentId}.pdf`;
export const labelKey = (orderId: string, shipmentId: string): string => `labels/${orderId}/${shipmentId}.pdf`;

async function store(key: string, make: () => Buffer): Promise<void> {
  if (!(await objectExists(key))) await putObject(key, make(), "application/pdf");
}

/** Invoice and label are written once, after payment is confirmed or as cash on delivery; the ready flag follows the write. */
async function storeDocuments(shipmentId: string): Promise<void> {
  const facts = await one<ShipmentFacts & Record<string, unknown>>(
    `SELECT s.id, s.order_id, s.state, s.gift_wrap_paise, s.delivery_fee_paise, s.cod_fee_paise, s.emi_discount_paise, s.balance_share_paise,
            s.invoice_stored, s.label_stored, o.placed_at, o.address, p.method AS payment_method, p.status AS payment_status,
            sel.name AS seller_name, sel.gstin, sel.pickup_city, sel.pickup_state
       FROM shipments s JOIN orders o ON o.id = s.order_id JOIN payments p ON p.id = o.payment_id JOIN sellers sel ON sel.id = s.seller_id
      WHERE s.id = $1`,
    [shipmentId],
  );
  if (!facts || facts.state === "cancelled" || facts.payment_status !== "confirmed" || (facts.invoice_stored && facts.label_stored)) return;
  const lines = await query<{
    title: string; quantity: number; unit_price_paise: number; coupon_share_paise: number; taxable_value_paise: number;
    gst_rate: number; cgst_paise: number; sgst_paise: number; igst_paise: number; line_total_paise: number;
  }>("SELECT * FROM shipment_lines WHERE shipment_id = $1 ORDER BY seq", [shipmentId]);
  const total =
    lines.reduce((sum, line) => sum + line.line_total_paise, 0) + facts.gift_wrap_paise + facts.delivery_fee_paise + facts.cod_fee_paise - facts.emi_discount_paise;
  if (!facts.invoice_stored) {
    await store(invoiceKey(facts.order_id, facts.id), () =>
      renderInvoice({
        shipmentId: facts.id,
        orderId: facts.order_id,
        date: todayInIndia(facts.placed_at),
        seller: { name: facts.seller_name, gstin: facts.gstin, pickupCity: facts.pickup_city, pickupState: facts.pickup_state },
        buyer: facts.address,
        lines: lines.map((line) => ({
          title: line.title, quantity: line.quantity, unitPricePaise: line.unit_price_paise, couponSharePaise: line.coupon_share_paise,
          taxableValuePaise: line.taxable_value_paise, gstRate: line.gst_rate, cgstPaise: line.cgst_paise, sgstPaise: line.sgst_paise,
          igstPaise: line.igst_paise, lineTotalPaise: line.line_total_paise,
        })),
        deliveryFeePaise: facts.delivery_fee_paise,
        codFeePaise: facts.cod_fee_paise,
        giftWrapPaise: facts.gift_wrap_paise,
        emiDiscountPaise: facts.emi_discount_paise,
        totalPaise: total,
      }),
    );
    await query("UPDATE shipments SET invoice_stored = true WHERE id = $1", [shipmentId]);
  }
  if (!facts.label_stored) {
    await store(labelKey(facts.order_id, facts.id), () =>
      renderLabel({
        shipmentId: facts.id,
        shipTo: facts.address,
        sellerName: facts.seller_name,
        pickupCity: facts.pickup_city,
        lineCount: lines.length,
        collectPaise: facts.payment_method === "cod" ? total - facts.balance_share_paise : null,
      }),
    );
    await query("UPDATE shipments SET label_stored = true WHERE id = $1", [shipmentId]);
  }
}

/** Tries once now; a failure leaves the document pending for the background pass. */
export async function tryStoreDocuments(shipmentId: string): Promise<void> {
  try {
    await storeDocuments(shipmentId);
  } catch (error) {
    if (!(error instanceof ProviderUnavailable)) throw error;
  }
}

export async function storePendingDocuments(): Promise<void> {
  const pending = await query<{ id: string }>(
    "SELECT id FROM shipments WHERE state <> 'cancelled' AND (NOT invoice_stored OR NOT label_stored) ORDER BY seq LIMIT 50",
  );
  for (const { id } of pending) {
    await transaction(async (client) => {
      const lock = await client.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) AS got", [`doc:${id}`]);
      if (!(lock.rows[0] as { got: boolean }).got) return;
      await tryStoreDocuments(id);
    });
  }
}
