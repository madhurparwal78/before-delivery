import { el, busy } from "../ui.ts";
import { get, post, ApiFailure } from "../api.ts";
import { amount } from "../format.ts";
import { state, navigate, signinLink } from "../app.ts";

export async function renderAccount(): Promise<HTMLElement> {
  const main = el("main", { class: "layout-2col" });
  if (!state.account || state.account.role !== "shopper") {
    void navigate(signinLink());
    main.append(el("div", { class: "panel-deep" }, el("p", { text: "sign in to see your account." })));
    return main;
  }
  const me = await get<{ account: typeof state.account; balance_paise: number }>("/api/me");

  const left = el("div", { class: "panel-deep" });
  left.append(el("h1", { text: "account" }));
  left.append(el("p", { text: `signed in as ${me.account?.name} (${me.account?.role})` }));
  left.append(el("p", { class: "headline", style: "font-family:var(--font-head);font-weight:900;font-size:1.6rem", text: `Chauraha balance ${amount(me.balance_paise)}` }));

  // addresses
  left.append(el("h2", { text: "addresses" }));
  const addresses = await get<{ addresses: Array<{ address_id: string; label: string; name: string; line1: string; city: string; pincode: string }> }>("/api/account/addresses");
  for (const address of addresses.addresses) {
    left.append(el("p", { text: `${address.label}: ${address.name}, ${address.line1}, ${address.city} ${address.pincode}` }));
  }

  // saved cards
  left.append(el("h2", { text: "saved cards" }));
  const cards = await get<{ cards: Array<{ card_id: string; network: string; last4: string; expiry_month: number; expiry_year: number }> }>("/api/account/cards");
  if (cards.cards.length === 0) left.append(el("p", { text: "no saved cards." }));
  for (const card of cards.cards) {
    left.append(el("p", { text: `${card.network} ending ${card.last4} · ${card.expiry_month}/${card.expiry_year}` }));
  }

  const right = el("div", { class: "panel-deep" });

  // gift card redeem
  right.append(el("h2", { text: "gift cards" }));
  const giftLabel = el("label", { class: "field" });
  giftLabel.append(el("span", { class: "label-text", text: "Gift card code" }));
  const giftInput = el("input", { type: "text" });
  giftLabel.append(giftInput);
  const redeemBtn = el("button", { class: "btn btn-primary", text: "Redeem" });
  const giftStatus = el("p", { class: "field-error" });
  redeemBtn.addEventListener("click", () => {
    void busy(redeemBtn, async () => {
      giftStatus.textContent = "";
      try {
        const res = await post<{ balance_paise: number }>("/api/balance/redeem", { code: giftInput.value.trim() });
        giftStatus.textContent = `Chauraha balance ${amount(res.balance_paise)}`;
      } catch (err) {
        if (err instanceof ApiFailure) giftStatus.textContent = err.fields.code ?? err.message;
      }
    });
  });
  right.append(giftLabel, redeemBtn, giftStatus);

  // change password
  right.append(el("h2", { text: "change password" }));
  const status = el("div", { class: "status", role: "status", "aria-label": "Sign-in status" });
  const currentLabel = el("label", { class: "field" });
  currentLabel.append(el("span", { class: "label-text", text: "Current password" }));
  const currentInput = el("input", { type: "password", autocomplete: "current-password" });
  currentLabel.append(currentInput);
  const newLabel = el("label", { class: "field" });
  newLabel.append(el("span", { class: "label-text", text: "New password" }));
  const newInput = el("input", { type: "password", autocomplete: "new-password" });
  newLabel.append(newInput);
  const changeBtn = el("button", { class: "btn btn-primary", text: "Change password" });
  const changeError = el("p", { class: "field-error" });
  changeBtn.addEventListener("click", () => {
    void busy(changeBtn, async () => {
      changeError.textContent = "";
      try {
        await post("/api/account/password", { current_password: currentInput.value, new_password: newInput.value });
        status.textContent = "Password changed. Other devices are signed out.";
      } catch (err) {
        if (err instanceof ApiFailure) changeError.textContent = err.fields.current_password ?? err.message;
      }
    });
  });
  right.append(currentLabel, newLabel, changeBtn, changeError, status);

  main.append(left, right);
  return main;
}
