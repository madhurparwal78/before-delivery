// Rates (treasurer): the effective-dated commission rate table and the schedule form.
import { coopDate } from "../shared/coop-time.js";
import { parseHundredths, percent } from "../shared/money.js";
import { attempt, call, failureText, get } from "./api.js";
import { h, replace, say } from "./dom.js";
import { badge, dataTable, mono, outageFrom, pageHead, statusLine } from "./ui.js";

interface Rate {
  effective_from: string;
  rate_bp: number;
  status: "past" | "current" | "scheduled";
}

const MARK: Record<string, string> = { past: "Past", current: "Current", scheduled: "Scheduled" };

export function mountRates(root: HTMLElement): () => void {
  const status = statusLine("Rate status");
  const body = h("div", {});
  const date = h("input", { id: "rate-date", type: "text", inputmode: "numeric", placeholder: "YYYY-MM-DD", autocomplete: "off" });
  const rate = h("input", { id: "rate-percent", type: "text", inputmode: "decimal", placeholder: "25.00", autocomplete: "off" });
  const dateError = h("p", { class: "field-error", id: "rate-date-error", hidden: true });
  const rateError = h("p", { class: "field-error", id: "rate-percent-error", hidden: true });
  const submit = h("button", { type: "submit", class: "button button-primary" }, "Schedule rate");
  const form = h("form", { class: "inline-form", "aria-label": "Schedule a commission rate", novalidate: true },
    h("div", { class: "field" }, h("label", { for: "rate-date" }, "Effective from (co-op date)"), date, dateError),
    h("div", { class: "field" }, h("label", { for: "rate-percent" }, "Rate (percent)"), rate, rateError),
    h("div", { class: "field field-action" }, submit));
  replace(root, pageHead("Rates", "Commission rates by co-op date. A licence keeps the rate in force when it was confirmed."),
    body, h("h2", { class: "section-title" }, "Schedule a rate"), form, status);

  const fields: [HTMLInputElement, HTMLElement, string][] = [[date, dateError, "effective_from"], [rate, rateError, "rate_bp"]];

  async function load(): Promise<void> {
    const answer = await attempt(() => get<{ rates: Rate[] }>("/api/commission-rates"));
    outageFrom(answer);
    if (!answer?.ok || !answer.data) return;
    replace(body, dataTable("Commission rates", ["Effective from", "Rate", "Status"], answer.data.rates.map((r) =>
      [mono(coopDate(r.effective_from)), mono(`${percent(r.rate_bp)}%`),
        badge(MARK[r.status] ?? r.status, r.status === "past" ? "muted" : "neutral")]), [1]));
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      for (const [input, error] of fields) {
        error.hidden = true;
        input.removeAttribute("aria-describedby");
        input.removeAttribute("aria-invalid");
      }
      submit.disabled = true;
      const bp = parseHundredths(rate.value);
      const answer = await attempt(() => call<Rate>("POST", "/api/commission-rates",
        { effective_from: date.value.trim(), rate_bp: bp ?? rate.value }));
      submit.disabled = false;
      if (answer?.ok && answer.data) {
        say(status, `Rate of ${percent(answer.data.rate_bp)}% scheduled from ${coopDate(answer.data.effective_from)}.`);
        date.value = "";
        rate.value = "";
        await load();
        return;
      }
      const errors = answer?.error?.fields ?? {};
      let first: HTMLInputElement | null = null;
      for (const [input, error, key] of fields) {
        const message = errors[key];
        if (!message) continue;
        error.hidden = false;
        error.textContent = message;
        input.setAttribute("aria-describedby", error.id);
        input.setAttribute("aria-invalid", "true");
        first ??= input;
      }
      if (first) first.focus();
      else say(status, failureText(answer));
    })();
  });

  void load();
  return () => undefined;
}
