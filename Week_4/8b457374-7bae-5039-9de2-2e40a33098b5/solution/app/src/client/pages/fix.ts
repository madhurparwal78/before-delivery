import type { FixView } from "../../shared/api.js";
import { api } from "../api.js";
import { announce, h } from "../dom.js";
import { loading, stateMark } from "../marks.js";
import { countdown, field, money, title, type Page } from "../page.js";
import { notFoundPage } from "./notfound.js";

// Fix your payment (brief: Screens and layout › Fix your payment; DP-40, DP-42). The code is the credential.

export const fixPage: Page = (main, code, onLeave) => {
  title("Fix your payment");
  main.append(loading());
  void api<FixView>("GET", `/api/fix/${code}`, { key: null }).then((found) => {
    main.replaceChildren();
    if (!found.ok) {
      notFoundPage(main, "", onLeave);
      return;
    }
    let view = found.data;
    const titleEl = h("p", { class: "fix-campaign" }, view.campaign_title);
    const amountEl = h("p", { class: "figure figure-total" }, money(view.amount));
    const markEl = h("p", { class: "held-state" }, stateMark(view.state));
    const timerEl = h("p", { class: "figure figure-countdown figure-big", role: "timer", "aria-label": "Time left to fix" });
    const setCountdown = countdown(timerEl, onLeave, () => void reload());
    const card = field("fix-card", "Card number", h("input", { type: "text", inputmode: "numeric", autocomplete: "cc-number", spellcheck: "false" }),
      "A working test card");
    const update = h("button", { type: "submit", class: "btn btn-wide" }, "Update card");
    const result = h("div", { class: "result", role: "status", "aria-live": "polite", "aria-label": "Fix result" });
    const form = h("form", { class: "stage fix-form", novalidate: true }, card.wrap, update);
    main.append(h("section", { class: "page fix-page" },
      h("h1", {}, "Fix your payment"),
      titleEl, amountEl, markEl,
      h("p", { class: "label" }, "Time left to fix"), timerEl,
      form, result));
    const paint = (next: FixView) => {
      view = next;
      amountEl.textContent = money(view.amount);
      markEl.replaceChildren(stateMark(view.state));
      setCountdown(view.fix_seconds_left ?? 0);
    };
    const reload = async () => {
      const again = await api<FixView>("GET", `/api/fix/${code}`, { key: null });
      if (again.ok) paint(again.data);
    };
    paint(view);
    const timer = setInterval(() => void reload(), 30_000);
    onLeave(() => clearInterval(timer));

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (update.disabled) return;
      card.set(null);
      update.disabled = true;
      announce(result, `Asking the payment service to hold ${money(view.amount)}.`);
      const fixed = await api<FixView>("POST", `/api/fix/${code}`, { body: { card_number: card.input.value }, key: null });
      update.disabled = false;
      if (fixed.ok) {
        paint(fixed.data);
        announce(result, `Card updated. ${money(fixed.data.amount)} is held and will be collected when the fix window closes.`);
        return;
      }
      const reason = fixed.error.error;
      if (reason === "card_declined") announce(result, "Card declined. No hold was placed. Try another card.");
      else if (reason === "fix_window_closed") announce(result, "The fix window has closed.");
      else if (reason === "payment_unavailable") announce(result, "Payment service unavailable. No hold was placed. Try again in a few minutes.");
      else if (reason === "invalid") {
        announce(result, "");
        card.set(fixed.error.fields?.card_number ?? "Use one of the test cards.");
      } else announce(result, "Something went wrong. No hold was placed. Try again.");
      card.input.focus();
    });
  });
};
