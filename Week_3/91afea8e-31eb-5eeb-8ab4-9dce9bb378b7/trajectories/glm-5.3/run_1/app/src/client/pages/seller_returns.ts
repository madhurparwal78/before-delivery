import { el, busy, openDialog } from "../ui.ts";
import { get, post, ApiFailure } from "../api.ts";
import { amount } from "../format.ts";
import { state, navigate, signinLink } from "../app.ts";

interface SellerReturn {
  return_id: string; state: string; quantity: number; line_title: string | undefined;
  reason: string; decline_reason: string; refund_paise: number;
  refund_legs: Array<{ method: string; amount_paise: number; status: string }>;
}

export async function renderSellerReturns(): Promise<HTMLElement> {
  const main = el("main", {});
  if (!state.account || state.account.role !== "seller") {
    void navigate(signinLink());
    main.append(el("div", { class: "panel-deep" }, el("p", { text: "sign in to your seller console." })));
    return main;
  }
  main.append(el("h1", { text: "returns" }));
  const status = el("div", { class: "status", role: "status", "aria-label": "Save status" });
  const grid = el("div", { class: "card-grid" });
  const res = await get<{ returns: SellerReturn[] }>("/api/seller/returns");
  for (const ret of res.returns) {
    const card = el("section", { class: "parcel-panel", "aria-label": `Return ${ret.return_id}` });
    card.append(el("h2", { text: `Return ${ret.return_id}` }));
    card.append(el("p", { text: `${ret.line_title ?? "item"} × ${ret.quantity} · ${ret.state} · refund ${amount(ret.refund_paise)}` }));
    card.append(el("p", { text: `shopper's reason: ${ret.reason || "none given"}` }));
    for (const leg of ret.refund_legs) {
      card.append(el("p", { text: `refund leg ${leg.method} ${amount(leg.amount_paise)} · ${leg.status}` }));
    }
    const actions = el("div", { style: "display:flex;gap:10px;flex-wrap:wrap" });
    if (ret.state === "requested") {
      const approveBtn = el("button", { class: "btn btn-primary", text: "Approve pickup" });
      approveBtn.addEventListener("click", () => {
        void busy(approveBtn, async () => {
          try {
            await post(`/api/seller/returns/${ret.return_id}/pickup`, {});
            void navigate("/seller/returns", true);
          } catch (err) {
            if (err instanceof ApiFailure) status.textContent = err.message;
          }
        });
      });
      const declineBtn = el("button", { class: "btn btn-ghost", text: "Decline return" });
      declineBtn.addEventListener("click", () => {
        const reasonLabel = el("label", { class: "field" });
        reasonLabel.append(el("span", { class: "label-text", text: "Reason" }));
        const reasonInput = el("textarea", { rows: "3", maxlength: "500" });
        reasonLabel.append(reasonInput);
        const submitBtn = el("button", { class: "btn btn-primary", text: "Decline" });
        const dlg = el("dialog", { "aria-label": "Decline return" });
        dlg.append(el("h2", { text: "Decline return" }), reasonLabel, submitBtn);
        submitBtn.addEventListener("click", () => {
          void busy(submitBtn, async () => {
            try {
              await post(`/api/seller/returns/${ret.return_id}/decline`, { reason: reasonInput.value });
              dlg.close();
              dlg.remove();
              void navigate("/seller/returns", true);
            } catch (err) {
              if (err instanceof ApiFailure) status.textContent = err.fields.reason ?? err.message;
            }
          });
        });
        openDialog(dlg, declineBtn);
      });
      actions.append(approveBtn, declineBtn);
    }
    card.append(actions);
    grid.append(card);
  }
  main.append(status, grid);
  return main;
}
