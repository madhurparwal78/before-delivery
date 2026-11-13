import { el, busy, announce, openDialog, Countdown, clockSkew } from "../ui.ts";
import { get, post } from "../api.ts";
import { amount, dateLabel, methodLabel } from "../format.ts";
import { state, navigate, signinLink } from "../app.ts";
import { orderPlacedBurst } from "../reel.ts";

interface ShipmentLine {
  line_id: string; title: string; quantity: number; unit_price_paise: number;
  coupon_share_paise: number; line_total_paise: number; gst_rate: number;
  taxable_value_paise: number; cgst_paise: number; sgst_paise: number; igst_paise: number;
  returnable_until: string | null; refunded_paise: number; refund_pending_paise: number;
}

interface ShopperShipment {
  shipment_id: string; order_id: string; seller_name: string; state: string;
  promise_date: string; timeline: Array<{ state: string; at: string }>;
  delivery_fee_paise: number; cod_fee_paise: number; gift_wrap_paise: number;
  invoice_status: string; lines: ShipmentLine[];
}

export async function renderOrders(): Promise<HTMLElement> {
  const main = el("main", {});
  if (!state.account || state.account.role !== "shopper") {
    void navigate(signinLink());
    main.append(el("div", { class: "panel-deep" }, el("p", { text: "sign in to see your orders." })));
    return main;
  }
  main.append(el("h1", { text: "orders" }));
  const list = el("div", { class: "card-grid", role: "list", "aria-label": "Orders" });
  const statusRegion = el("div", { class: "status", role: "status", "aria-label": "Order updates" });

  let cursor: string | null = null;
  const loadMoreBtn = el("button", { class: "btn btn-yellow", text: "Load more", hidden: "true" });
  const load = async (append: boolean) => {
    const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const res = await get<{ orders: Array<{ order_id: string; placed_at: string; payable_paise: number; shipment_count: number; shipment_states: string[] }>; next_cursor: string | null }>(`/api/orders${q}`);
    if (!append) list.textContent = "";
    for (const o of res.orders) {
      const item = el("article", { class: "product-card", role: "listitem", "aria-label": `Order ${o.order_id}` });
      const link = el("a", { href: `/orders/${o.order_id}`, text: `Order ${o.order_id}` });
      item.append(link);
      item.append(el("p", { text: `placed ${dateLabel(new Date(o.placed_at).toISOString().slice(0, 10))} · ${amount(o.payable_paise)} · ${o.shipment_count} parcels` }));
      list.append(item);
    }
    cursor = res.next_cursor;
    loadMoreBtn.hidden = res.next_cursor === null;
  };
  loadMoreBtn.addEventListener("click", () => void busy(loadMoreBtn, () => load(true)));
  await load(false);
  main.append(statusRegion, list, loadMoreBtn);
  return main;
}

export async function renderOrderDetail(orderId: string): Promise<HTMLElement> {
  const main = el("main", {});
  const order = await get<{
    order_id: string; placed_at: string; address: Record<string, string>;
    payment: { payment_id: string; method: string; status: string; expires_at: string | null; legs: Array<{ method: string; amount_paise: number; status: string }> } | null;
    shipments: ShopperShipment[]; payable_paise: number;
  }>(`/api/orders/${orderId}`);
  main.append(el("h1", { text: `order ${order.order_id}` }));
  main.append(el("p", { text: `placed ${dateLabel(new Date(order.placed_at).toISOString().slice(0, 10))} · ${amount(order.payable_paise)}` }));

  const grid = el("div", { class: "card-grid" });
  const statusRegion = el("div", { class: "status", role: "status", "aria-label": "Order updates" });

  for (const shipment of order.shipments) {
    grid.append(shipmentCard(shipment, statusRegion));
  }
  main.append(statusRegion, grid);
  return main;
}

function shipmentCard(shipment: ShopperShipment, statusRegion: HTMLElement): HTMLElement {
  const card = el("section", { class: "parcel-panel", "aria-label": `Shipment ${shipment.shipment_id}` });
  card.append(el("h2", { text: `Shipment ${shipment.shipment_id}` }));
  card.append(el("p", { text: `from ${shipment.seller_name} · ${shipment.state} · arrives by ${dateLabel(shipment.promise_date)}` }));

  const timelineList = el("ol", {});
  for (const t of shipment.timeline) {
    timelineList.append(el("li", { text: `${t.state} · ${new Date(t.at).toLocaleString("en-IN")}` }));
  }
  card.append(timelineList);

  for (const line of shipment.lines) {
    const lineNode = el("div", { class: "cart-line", style: "border-top:2px solid rgba(255,255,255,0.14);padding-top:10px;margin-top:10px" });
    lineNode.append(el("p", { text: `${line.title} × ${line.quantity} · ${amount(line.unit_price_paise)}` }));
    const tax = el("p", { style: "font-weight:700" });
    tax.append(document.createTextNode(`taxable ${amount(line.taxable_value_paise)}`));
    if (line.cgst_paise > 0) tax.append(document.createTextNode(` · CGST ${amount(line.cgst_paise)} · SGST ${amount(line.sgst_paise)}`));
    if (line.igst_paise > 0) tax.append(document.createTextNode(` · IGST ${amount(line.igst_paise)}`));
    lineNode.append(tax);
    if (line.refunded_paise > 0) {
      const last4 = document.body.dataset.cardLast4;
      lineNode.append(el("p", { class: "chip chip-refunded", text: `Refunded ${amount(line.refunded_paise)} to ${methodLabel(shipment.order_id ? "card" : "card", last4)}.` }));
    } else if (line.refund_pending_paise > 0) {
      lineNode.append(el("p", { class: "chip chip-pending", text: `Refund of ${amount(line.refund_pending_paise)} is on its way.` }));
    }

    if (shipment.state === "placed" || shipment.state === "packed") {
      const cancelBtn = el("button", { class: "btn btn-ghost", text: "Cancel shipment" });
      cancelBtn.addEventListener("click", () => {
        const reason = el("p", { text: "cancelling releases the stock and refunds the prepaid share." });
        const confirmBtn = el("button", { class: "btn btn-primary", text: "Yes, cancel it" });
        const dlg = el("dialog", { "aria-label": "Cancel shipment" });
        dlg.append(el("h2", { text: "Cancel shipment" }), reason, confirmBtn);
        confirmBtn.addEventListener("click", () => {
          void busy(confirmBtn, async () => {
            await post(`/api/shipments/${shipment.shipment_id}/cancel`, {});
            dlg.close();
            dlg.remove();
            void navigate(`/orders/${shipment.order_id}`, true);
          });
        });
        openDialog(dlg, cancelBtn);
      });
      lineNode.append(cancelBtn);
    }

    if (shipment.state === "delivered" && line.returnable_until) {
      const returnBtn = el("button", { class: "btn btn-ghost", text: `Return ${line.title}` });
      returnBtn.addEventListener("click", () => {
        const qtyLabel = el("label", { class: "field" });
        qtyLabel.append(el("span", { class: "label-text", text: "Quantity to return" }));
        const qtyInput = el("input", { type: "number", min: "1", max: String(line.quantity), value: "1" });
        qtyLabel.append(qtyInput);
        const reasonLabel = el("label", { class: "field" });
        reasonLabel.append(el("span", { class: "label-text", text: "Reason" }));
        const reasonInput = el("textarea", { rows: "2", maxlength: "500" });
        reasonLabel.append(reasonInput);
        const note = el("p", { class: "field-error" });
        const submitBtn = el("button", { class: "btn btn-primary", text: "Request return" });
        const dlg = el("dialog", { "aria-label": "Return item" });
        dlg.append(el("h2", { text: "Return item" }), qtyLabel, reasonLabel, note, submitBtn);
        submitBtn.addEventListener("click", () => {
          void busy(submitBtn, async () => {
            try {
              const res = await post<{ return_id: string; refund_estimate_paise: number }>("/api/returns", {
                shipment_line_id: line.line_id,
                quantity: Number(qtyInput.value),
                reason: reasonInput.value,
              });
              dlg.close();
              dlg.remove();
              announce(`Return requested. Refund on pickup: ${amount(res.refund_estimate_paise)}.`, statusRegion);
            } catch (err) {
              if (err instanceof Error) note.textContent = err.message;
            }
          });
        });
        openDialog(dlg, returnBtn);
      });
      lineNode.append(returnBtn);
    }
    card.append(lineNode);
  }

  // fees at poster volume
  const fees = el("p", { style: "font-weight:900;font-family:var(--font-head);font-size:1.3rem" });
  fees.append(document.createTextNode(`delivery ${amount(shipment.delivery_fee_paise)}`));
  if (shipment.cod_fee_paise > 0) fees.append(document.createTextNode(` · cash on delivery fee ${amount(shipment.cod_fee_paise)}`));
  if (shipment.gift_wrap_paise > 0) fees.append(document.createTextNode(` · gift wrap ${amount(shipment.gift_wrap_paise)}`));
  card.append(fees);

  // invoice
  if (shipment.invoice_status === "ready") {
    const invoiceLink = el("a", { class: "btn btn-yellow", href: `/api/shipments/${shipment.shipment_id}/invoice`, target: "_blank", text: "Download invoice" });
    card.append(invoiceLink);
  } else {
    const pending = el("p", { class: "chip chip-pending", text: "Your invoice is being prepared. Check back in a minute." });
    card.append(pending);
  }
  return card;
}

export async function renderPlaced(orderId: string): Promise<HTMLElement> {
  const main = el("main", {});
  const order = await get<{
    order_id: string; payment: { payment_id: string; method: string; status: string; expires_at: string | null; legs: Array<{ method: string; amount_paise: number; status: string }> } | null;
    shipments: ShopperShipment[]; payable_paise: number;
  }>(`/api/orders/${orderId}`);

  const waiting = order.payment?.status === "awaiting_customer";
  const heading = el("h1", { tabindex: "0" });
  heading.textContent = waiting ? "waiting for your payment." : "order placed.";
  main.append(heading);

  const sub = el("p", { class: "headline", style: "font-size:1.4rem" });
  if (!waiting) {
    sub.textContent = order.shipments.length === 1 ? "1 parcel on the way." : `${order.shipments.length} parcels on the way.`;
    main.append(sub);
    orderPlacedBurst(heading);
  }

  if (waiting) {
    const timerWrap = el("p", {});
    const timerEl = el("span", { role: "timer", "aria-label": "UPI request expires in", class: "chip chip-pending" });
    timerWrap.append(timerEl);
    main.append(timerWrap);
    if (order.payment?.expires_at) {
      new Countdown(timerEl, new Date(order.payment.expires_at).getTime(), clockSkew(null));
    }
    const poll = async () => {
      for (;;) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const payment = await get<{ status: string }>(`/api/payments/${order.payment?.payment_id}`);
          if (payment.status === "confirmed") {
            heading.textContent = "order placed.";
            sub.textContent = order.shipments.length === 1 ? "1 parcel on the way." : `${order.shipments.length} parcels on the way.`;
            timerWrap.remove();
            orderPlacedBurst(heading);
            heading.focus();
            return;
          }
          if (payment.status === "expired" || payment.status === "failed") {
            heading.textContent = "payment didn't go through. nothing was charged.";
            timerWrap.remove();
            heading.focus();
            return;
          }
        } catch { /* keep waiting until the next check */ }
      }
    };
    void poll();
  }

  const grid = el("div", { class: "card-grid" });
  for (const shipment of order.shipments) {
    const card = el("section", { class: "parcel-panel", "aria-label": `Shipment ${shipment.shipment_id}` });
    card.append(el("h2", { text: `Shipment ${shipment.shipment_id}` }));
    card.append(el("p", { text: `${shipment.seller_name} · ${shipment.state} · arrives by ${dateLabel(shipment.promise_date)}` }));
    grid.append(card);
  }
  main.append(grid);

  const viewOrder = el("a", { class: "btn btn-primary", href: `/orders/${orderId}`, text: "View order" });
  main.append(viewOrder);
  return main;
}
