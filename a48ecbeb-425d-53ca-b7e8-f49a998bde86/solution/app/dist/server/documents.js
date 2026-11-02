import { FLAVOUR_NAMES, longDate, money, PROVINCE_NAMES, rateText, torontoDay } from "../shared/format.js";
import { putObject } from "./files.js";
import { rateLabel } from "./domain/money.js";
import { PDF_MARGIN as L, PDF_RIGHT as R, renderPdf } from "./pdf.js";
// Invoice and packing-slip PDFs. They carry the order's own ship-to address and figures only:
// no card data, provider ids, keys or tokens.
const cell = (text, x, size = 10, bold = false) => ({ kind: "text", text, x, size, bold });
const right = (text, edge, size = 10, bold = false) => ({ kind: "text", text, x: 0, right: edge, size, bold });
const row = (...cells) => ({ kind: "row", cells });
const gap = (height) => ({ kind: "gap", height });
function addressBlock(to) {
    return [
        row(cell(to.name, L, 11, true)),
        row(cell(to.line1, L, 11)),
        ...(to.line2 ? [row(cell(to.line2, L, 11))] : []),
        row(cell(`${to.city} ${to.province}  ${to.postal_code}`, L, 11)),
    ];
}
function heading(title, number, placed) {
    return [
        row(cell("CEIBO", L, 22, true), right("Ceibo Shop & Cellar", R, 10)),
        row(cell(title, L, 14, true), right(`Order ${number}`, R, 12, true)),
        row(cell(`Placed ${longDate(torontoDay(placed))}`, L, 10)),
        { kind: "rule" },
    ];
}
function invoicePdf(full) {
    const { order } = full;
    const subscribed = order.discount_cents > 0;
    const blocks = [
        ...heading("Invoice", order.number, order.placed_at),
        row(cell("Ship to", L, 9, true)),
        ...addressBlock(order.ship_to),
        gap(10),
        row(cell("Cans", L, 9, true), right("Qty", 340, 9, true), right("Each", 420, 9, true), right("Amount", R, 9, true)),
        { kind: "rule" },
        ...full.lines.map((l) => row(cell(FLAVOUR_NAMES[l.flavour] ?? l.flavour, L, 11), right(String(l.quantity), 340, 11), right(money(l.unit_price_cents), 420, 11), right(money(l.goods_cents), R, 11))),
        { kind: "rule" },
        row(cell("Subtotal", 300, 11), right(money(order.goods_cents), R, 11)),
        ...(subscribed ? [row(cell("Subscribe & save (10%)", 300, 11), right(money(-order.discount_cents), R, 11))] : []),
        row(cell("Deposit", 300, 11), right(money(order.deposit_cents), R, 11)),
        row(cell("Shipping", 300, 11), right(order.shipping_cents === 0 ? "Free" : money(order.shipping_cents), R, 11)),
        ...full.taxes.map((t) => row(cell(`${t.name} (${rateText(rateLabel(t.rate_milli))}%)`, 300, 11), right(money(t.cents), R, 11))),
        { kind: "rule" },
        row(cell("Total (CAD)", 300, 13, true), right(money(order.total_cents), R, 13, true)),
        gap(18),
        row(cell(`Shipping to ${PROVINCE_NAMES[order.province] ?? order.province}. Can deposits are never taxed.`, L, 9)),
        row(cell("Thank you for choosing Ceibo organic sparkling yerba mate.", L, 9)),
    ];
    return renderPdf(`Invoice ${order.number}`, blocks);
}
function packingSlipPdf(full) {
    const { order } = full;
    const cans = full.lines.reduce((a, l) => a + l.quantity, 0);
    const blocks = [
        ...heading("Packing slip", order.number, order.placed_at),
        row(cell("Ship to", L, 9, true)),
        ...addressBlock(order.ship_to),
        gap(14),
        row(cell("Flavour", L, 9, true), right("Cans", R, 9, true)),
        { kind: "rule" },
        ...full.lines.map((l) => row(cell(FLAVOUR_NAMES[l.flavour] ?? l.flavour, L, 13), right(String(l.quantity), R, 13, true))),
        { kind: "rule" },
        row(cell("Cans in this box", L, 12, true), right(String(cans), R, 12, true)),
        gap(18),
        row(cell("[  ] Picked      [  ] Packed      [  ] Shipped", L, 11)),
    ];
    return renderPdf(`Packing slip ${order.number}`, blocks);
}
export const invoiceKey = (number) => `orders/${number}/invoice.pdf`;
export const slipKey = (number) => `orders/${number}/packing-slip.pdf`;
/** Writes both PDFs to the file store (once each). */
export async function storeDocuments(full) {
    await putObject(invoiceKey(full.order.number), invoicePdf(full), "application/pdf");
    await putObject(slipKey(full.order.number), packingSlipPdf(full), "application/pdf");
}
