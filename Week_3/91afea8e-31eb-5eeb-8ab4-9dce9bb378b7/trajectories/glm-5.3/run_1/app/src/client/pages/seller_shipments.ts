import { el, busy } from "../ui.ts";
import { get, post, ApiFailure } from "../api.ts";
import { amount, dateLabel } from "../format.ts";
import { state, navigate, signinLink } from "../app.ts";

interface SellerShipment {
  shipment_id: string; order_id: string; state: string; promise_date: string;
  ship_to: { name: string; city: string; pincode: string };
  payment_kind: string; payment_status: string; invoice_status: string; label_status: string;
  lines: Array<{ line_id: string; listing_id: string; title: string; quantity: number; unit_price_paise: number; gross_paise: number }>;
}

export async function renderSellerShipments(): Promise<HTMLElement> {
  const main = el("main", {});
  if (!state.account || state.account.role !== "seller") {
    void navigate(signinLink());
    main.append(el("div", { class: "panel-deep" }, el("p", { text: "sign in to your seller console." })));
    return main;
  }
  main.append(el("h1", { text: "shipments" }));
  const status = el("div", { class: "status", role: "status", "aria-label": "Save status" });
  const grid = el("div", { class: "card-grid" });
  const res = await get<{ shipments: SellerShipment[]; next_cursor: string | null }>("/api/seller/shipments?limit=24");

  const chip = (kind: string, label: string, ready: boolean) => {
    const c = el("span", { class: `chip ${ready ? "chip-paid" : "chip-pending"}`, text: label });
    void kind;
    return c;
  };

  for (const shipment of res.shipments) {
    const card = el("section", { class: "parcel-panel", "aria-label": `Shipment ${shipment.shipment_id}` });
    card.append(el("h2", { text: `Shipment ${shipment.shipment_id}` }));
    card.append(el("p", { text: `order ${shipment.order_id} · ${shipment.state} · arrives by ${dateLabel(shipment.promise_date)}` }));
    card.append(el("p", { text: `to ${shipment.ship_to.name}, ${shipment.ship_to.city} ${shipment.ship_to.pincode}` }));

    const chips = el("p", {});
    chips.append(chip("payment", shipment.payment_status === "paid" ? "paid" : "payment pending", shipment.payment_status === "paid"));
    chips.append(document.createTextNode(" "));
    if (shipment.payment_status === "partially_refunded") chips.append(chip("refund", "partly refunded", true));
    if (shipment.payment_status === "refunded") chips.append(chip("refund", "refunded", true));
    chips.append(document.createTextNode(" "));
    chips.append(chip("invoice", shipment.invoice_status === "ready" ? "invoice ready" : "invoice pending", shipment.invoice_status === "ready"));
    chips.append(document.createTextNode(" "));
    chips.append(chip("label", shipment.label_status === "ready" ? "label ready" : "label pending", shipment.label_status === "ready"));
    card.append(chips);

    if (shipment.payment_status === "pending" && shipment.payment_kind !== "cod") {
      card.append(el("p", { class: "field-error", text: "Payment isn't confirmed yet." }));
    }

    for (const line of shipment.lines) {
      card.append(el("p", { text: `${line.title} × ${line.quantity} · gross ${amount(line.gross_paise)}` }));
    }

    const actions = el("div", { style: "display:flex;gap:10px;flex-wrap:wrap" });
    const packBtn = el("button", { class: "btn btn-primary", text: "Mark packed" });
    packBtn.addEventListener("click", () => {
      void busy(packBtn, async () => {
        try {
          await post(`/api/seller/shipments/${shipment.shipment_id}/pack`, {});
          void navigate("/seller/shipments", true);
        } catch (err) {
          if (err instanceof ApiFailure) status.textContent = err.message;
        }
      });
    });
    const shipBtn = el("button", { class: "btn btn-primary", text: "Mark shipped", disabled: shipment.label_status !== "ready" ? "true" : undefined });
    shipBtn.addEventListener("click", () => {
      void busy(shipBtn, async () => {
        try {
          await post(`/api/seller/shipments/${shipment.shipment_id}/ship`, {});
          void navigate("/seller/shipments", true);
        } catch (err) {
          if (err instanceof ApiFailure) status.textContent = err.message;
        }
      });
    });
    const deliverBtn = el("button", { class: "btn btn-primary", text: "Mark delivered" });
    deliverBtn.addEventListener("click", () => {
      void busy(deliverBtn, async () => {
        try {
          await post(`/api/seller/shipments/${shipment.shipment_id}/deliver`, {});
          void navigate("/seller/shipments", true);
        } catch (err) {
          if (err instanceof ApiFailure) status.textContent = err.message;
        }
      });
    });
    const labelLink = el("a", { class: "btn btn-yellow", href: `/api/seller/shipments/${shipment.shipment_id}/label`, target: "_blank", text: "Print label" });
    const invoiceLink = el("a", { class: "btn btn-ghost", href: `/api/shipments/${shipment.shipment_id}/invoice`, target: "_blank", text: "Invoice" });
    actions.append(packBtn, shipBtn, deliverBtn, labelLink, invoiceLink);
    card.append(actions);
    grid.append(card);
  }
  main.append(status, grid);
  return main;
}
