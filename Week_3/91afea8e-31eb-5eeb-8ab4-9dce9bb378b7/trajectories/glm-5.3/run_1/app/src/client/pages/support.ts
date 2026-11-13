import { el, busy, openDialog } from "../ui.ts";
import { get, post, ApiFailure } from "../api.ts";
import { amount, dateLabel, methodLabel } from "../format.ts";
import { state, navigate, signinLink } from "../app.ts";

interface SupportShipment {
  shipment_id: string; seller_name: string; state: string; promise_date: string;
  shopper_view: Record<string, unknown> & {
    shipment_id: string; seller_name: string; state: string; promise_date: string;
    delivery_fee_paise: number; cod_fee_paise: number; gift_wrap_paise: number;
    invoice_status: string; lines: Array<{ line_id: string; title: string; quantity: number; line_total_paise: number }>;
  };
  seller_view: Record<string, unknown> & {
    payment_status: string; label_status: string; invoice_status: string;
    ship_to: { name: string; city: string; pincode: string };
    lines: Array<{ line_id: string; title: string; quantity: number; gross_paise: number }>;
  };
}

interface SupportOrder {
  order_id: string;
  shopper: { name: string; phone_masked: string };
  payment: { legs: Array<{ method: string; amount_paise: number; refunded_paise: number; card_last4: string | null; card_network: string | null }> };
  shipments: SupportShipment[];
  returns: Array<{ return_id: string; state: string; quantity: number; refund_paise: number; decline_reason: string }>;
}

export async function renderSupport(): Promise<HTMLElement> {
  const main = el("main", {});
  if (!state.account || state.account.role !== "support") {
    void navigate(signinLink());
    main.append(el("div", { class: "panel-deep" }, el("p", { text: "sign in to the support desk." })));
    return main;
  }
  main.append(el("h1", { text: "support desk" }));
  const searchLabel = el("label", { class: "field", style: "max-width:420px" });
  searchLabel.append(el("span", { class: "label-text", text: "Order ID" }));
  const searchInput = el("input", { type: "search" });
  searchLabel.append(searchInput);
  const findBtn = el("button", { class: "btn btn-primary", text: "Find order" });
  searchLabel.append(findBtn);
  main.append(searchLabel);

  findBtn.addEventListener("click", () => {
    void busy(findBtn, async () => {
      const id = searchInput.value.trim();
      if (!id) return;
      try {
        await get(`/api/support/orders/${encodeURIComponent(id)}`);
        void navigate(`/support/orders/${encodeURIComponent(id)}`);
      } catch (err) {
        if (err instanceof ApiFailure) main.append(el("p", { class: "field-error", text: err.message }));
      }
    });
  });
  return main;
}

export async function renderSupportOrder(orderId: string): Promise<HTMLElement> {
  const main = el("main", {});
  const order = await get<SupportOrder>(`/api/support/orders/${orderId}`);
  main.append(el("h1", { text: `order ${order.order_id}` }));

  // shopper and seller views side by side on desktop, tabs on smaller screens
  const views = el("div", { class: "layout-2col", role: "tablist" });
  const shopperPanel = el("section", { class: "parcel-panel", role: "tabpanel", "aria-label": "Shopper view" });
  const sellerPanel = el("section", { class: "parcel-panel", role: "tabpanel", "aria-label": "Seller view" });
  shopperPanel.append(el("h2", { text: "shopper view" }));
  sellerPanel.append(el("h2", { text: "seller view" }));

  shopperPanel.append(el("p", { text: `${order.shopper.name} · ${order.shopper.phone_masked}` }));
  for (const leg of order.payment.legs) {
    const label = leg.method === "card" && leg.card_last4
      ? `card ending ${leg.card_last4} (${leg.card_network ?? ""})`
      : methodLabel(leg.method);
    shopperPanel.append(el("p", { text: `paid ${amount(leg.amount_paise)} by ${label}` }));
  }
  for (const shipment of order.shipments) {
    shopperPanel.append(el("h3", { text: `Shipment ${shipment.shipment_id}` }));
    shopperPanel.append(el("p", { text: `${shipment.seller_name} · ${shipment.state} · arrives by ${dateLabel(shipment.promise_date)}` }));
    for (const line of shipment.shopper_view.lines) {
      shopperPanel.append(el("p", { text: `${line.title} × ${line.quantity} · ${amount(line.line_total_paise)}` }));
    }
    const status = el("p", {});
    if (shipment.shopper_view.invoice_status === "ready") {
      const invoiceLink = el("a", { class: "btn btn-ghost", href: `/api/shipments/${shipment.shipment_id}/invoice`, target: "_blank", text: "Download invoice" });
      status.append(invoiceLink);
    } else {
      status.append(el("span", { class: "chip chip-pending", text: "Your invoice is being prepared. Check back in a minute." }));
    }
    shopperPanel.append(status);
  }

  for (const shipment of order.shipments) {
    sellerPanel.append(el("h3", { text: `Shipment ${shipment.shipment_id}` }));
    sellerPanel.append(el("p", { text: `to ${shipment.seller_view.ship_to.name}, ${shipment.seller_view.ship_to.city} ${shipment.seller_view.ship_to.pincode}` }));
    sellerPanel.append(el("p", { text: `payment ${shipment.seller_view.payment_status} · label ${shipment.seller_view.label_status} · invoice ${shipment.seller_view.invoice_status}` }));
    for (const line of shipment.seller_view.lines) {
      sellerPanel.append(el("p", { text: `${line.title} × ${line.quantity} · gross ${amount(line.gross_paise)}` }));
      const refundBtn = el("button", { class: "btn btn-yellow", text: `Refund ${line.title}` });
      refundBtn.addEventListener("click", () => {
        const qtyLabel = el("label", { class: "field" });
        qtyLabel.append(el("span", { class: "label-text", text: "Quantity" }));
        const qtyInput = el("input", { type: "number", min: "1", max: String(line.quantity), value: "1" });
        qtyLabel.append(qtyInput);
        const reasonLabel = el("label", { class: "field" });
        reasonLabel.append(el("span", { class: "label-text", text: "Reason" }));
        const reasonInput = el("textarea", { rows: "3", maxlength: "500" });
        reasonLabel.append(reasonInput);
        const note = el("p", { class: "field-error" });
        const submitBtn = el("button", { class: "btn btn-primary", text: "Refund" });
        const dlg = el("dialog", { "aria-label": "Refund line" });
        dlg.append(el("h2", { text: "Refund line" }), qtyLabel, reasonLabel, note, submitBtn);
        submitBtn.addEventListener("click", () => {
          void busy(submitBtn, async () => {
            try {
              await post(`/api/support/shipment-lines/${line.line_id}/refunds`, {
                quantity: Number(qtyInput.value),
                reason: reasonInput.value,
              });
              dlg.close();
              dlg.remove();
              void navigate(`/support/orders/${orderId}`, true);
            } catch (err) {
              if (err instanceof ApiFailure) note.textContent = err.fields.quantity ?? err.message;
            }
          });
        });
        openDialog(dlg, refundBtn);
      });
      sellerPanel.append(refundBtn);
    }
  }

  views.append(shopperPanel, sellerPanel);
  main.append(views);

  // returns with reopen
  main.append(el("h2", { text: "returns" }));
  for (const ret of order.returns) {
    const card = el("div", { class: "parcel-panel" });
    card.append(el("p", { text: `${ret.return_id} · ${ret.state} × ${ret.quantity} · ${amount(ret.refund_paise)}${ret.decline_reason ? ` · declined: ${ret.decline_reason}` : ""}` }));
    if (ret.state === "declined") {
      const reopenBtn = el("button", { class: "btn btn-yellow", text: "Reopen return" });
      reopenBtn.addEventListener("click", () => {
        void busy(reopenBtn, async () => {
          try {
            await post(`/api/support/returns/${ret.return_id}/reopen`, { note: "reopened after talking to the shopper" });
            void navigate(`/support/orders/${orderId}`, true);
          } catch (err) {
            if (err instanceof ApiFailure) main.append(el("p", { class: "field-error", text: err.message }));
          }
        });
      });
      card.append(reopenBtn);
    }
    main.append(card);
  }
  return main;
}
