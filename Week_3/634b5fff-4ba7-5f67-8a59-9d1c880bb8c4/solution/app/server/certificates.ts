import { plateOf } from "../shared/domain.js";
import { latestArt } from "./art.js";
import { certificateHtml } from "./documents.js";
import { pool } from "./db.js";
import { renderPdf } from "./pdf.js";
import { fail } from "./http.js";
import { orderRate, requireOrder, saleParts, type OrderRow } from "./orders.js";
import { getObject, hasObject, putObject } from "./s3.js";

const certificateKey = (reference: string): string => `certificates/${reference}.pdf`;

/** Renders and stores the certificate once; later deliveries find the stored object and keep its bytes. */
export const issueCertificate = async (reference: string): Promise<void> => {
  const order = await requireOrder(pool, reference);
  if (order.certificate_state === "cancelled") return;
  const key = certificateKey(reference);
  if (!(await hasObject(key))) {
    const plate = plateOf(order.box_number);
    const html = certificateHtml({
      number: order.box_number, plate, reference, charityOre: saleParts(await orderRate(pool, order)).charityOre, art: await latestArt(plate),
    });
    await putObject(key, await renderPdf(html), "application/pdf");
  }
  await pool.query("UPDATE orders SET certificate_state = 'issued' WHERE reference = $1 AND certificate_state <> 'cancelled'", [reference]);
};

export const orderPaidPayload = async (reference: string, eventId: string): Promise<Record<string, unknown>> => {
  const order = await requireOrder(pool, reference);
  const sale = (await pool.query("SELECT * FROM split_lines WHERE reference = $1 AND kind = 'sale' ORDER BY id LIMIT 1", [reference])).rows[0] as
    { gross_ore: number; net_ore: number; vat_ore: number; charity_ore: number; maker_ore: number; rate_basis_points: number; posted_at: Date };
  return {
    eventId, reference, boxNumber: order.box_number, plate: plateOf(order.box_number), grossOre: sale.gross_ore, netOre: sale.net_ore,
    vatOre: sale.vat_ore, charityOre: sale.charity_ore, makerOre: sale.maker_ore, rateBasisPoints: sale.rate_basis_points,
    paidAt: sale.posted_at.toISOString(),
  };
};


/** The stored certificate bytes, or the refusal that says why there are none. */
export const downloadCertificate = async (order: OrderRow): Promise<Buffer> => {
  if (order.certificate_state === "cancelled") return fail("certificate_cancelled");
  if (order.certificate_state === "none") return fail("not_found");
  if (order.certificate_state === "pending") return fail("certificate_pending");
  return (await getObject(certificateKey(order.reference))) ?? fail("certificate_pending");
};
