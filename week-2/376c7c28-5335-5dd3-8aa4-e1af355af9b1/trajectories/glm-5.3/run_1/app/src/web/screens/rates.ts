import { api, ApiCallError, errorFields } from "../api";
import { h, clear, liveRegion, announce, screen as appScreen, registerRefresh } from "../helpers";
import { applyFieldErrors } from "./join";

type Schedule = {
  id: string;
  effective_from: string;
  member_bisque_cents: number;
  member_glaze_cents: number;
  dropoff_bisque_cents: number;
  dropoff_glaze_cents: number;
};

export function renderRates(root: HTMLElement): void {
  const status = liveRegion("Rates status");
  const tbody = h("tbody");
  const table = h("table", { class: "table", "aria-label": "Rate schedules" },
    h("thead", null, h("tr", null,
      h("th", { class: "cell", text: "Effective from" }),
      h("th", { class: "cell", text: "Member bisque ¢" }),
      h("th", { class: "cell", text: "Member glaze ¢" }),
      h("th", { class: "cell", text: "Drop-off bisque ¢" }),
      h("th", { class: "cell", text: "Drop-off glaze ¢" }))),
    tbody);

  const effective = h("input", { class: "input", type: "date", id: "rates-from", "data-field": "effective_from" });
  const memberBisque = h("input", { class: "input small", type: "number", id: "rates-mb", "data-field": "member_bisque_cents", step: "1" });
  const memberGlaze = h("input", { class: "input small", type: "number", id: "rates-mg", "data-field": "member_glaze_cents", step: "1" });
  const dropBisque = h("input", { class: "input small", type: "number", id: "rates-db", "data-field": "dropoff_bisque_cents", step: "1" });
  const dropGlaze = h("input", { class: "input small", type: "number", id: "rates-dg", "data-field": "dropoff_glaze_cents", step: "1" });
  const submit = h("button", { class: "btn primary", text: "Schedule rates", type: "submit" });

  const form = h("form", { class: "panel" },
    h("div", { class: "caption", text: "SCHEDULE RATES" }),
    fieldBlock("Effective from", effective, "rates-from"),
    fieldBlock("Member bisque (¢/cu in)", memberBisque, "rates-mb"),
    fieldBlock("Member glaze (¢/cu in)", memberGlaze, "rates-mg"),
    fieldBlock("Drop-off bisque (¢/cu in)", dropBisque, "rates-db"),
    fieldBlock("Drop-off glaze (¢/cu in)", dropGlaze, "rates-dg"),
    submit,
    status);

  const layout = h("div", { class: "split-8-4" }, h("section", { class: "panel" }, h("div", { class: "caption", text: "RATE SCHEDULES" }), table), form);
  root.appendChild(appScreen(layout));
  void load();

  async function load(): Promise<void> {
    try {
      const schedules = await api<Schedule[]>("/api/rate-schedules");
      clear(tbody);
      for (const s of schedules) {
        tbody.appendChild(h("tr", null,
          h("td", { class: "cell", text: s.effective_from }),
          h("td", { class: "cell mono", text: String(s.member_bisque_cents) }),
          h("td", { class: "cell mono", text: String(s.member_glaze_cents) }),
          h("td", { class: "cell mono", text: String(s.dropoff_bisque_cents) }),
          h("td", { class: "cell mono", text: String(s.dropoff_glaze_cents) })));
      }
    } catch {
      /* refill on next change */
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void schedule();
  });

  async function schedule(): Promise<void> {
    submit.setAttribute("disabled", "true");
    announce(status, "Scheduling…");
    try {
      const body = {
        effective_from: (effective as HTMLInputElement).value,
        member_bisque_cents: Number((memberBisque as HTMLInputElement).value),
        member_glaze_cents: Number((memberGlaze as HTMLInputElement).value),
        dropoff_bisque_cents: Number((dropBisque as HTMLInputElement).value),
        dropoff_glaze_cents: Number((dropGlaze as HTMLInputElement).value),
      };
      const created = await api<Schedule>("/api/rate-schedules", { method: "POST", body });
      announce(status, `Rates scheduled from ${created.effective_from}.`);
      await load();
    } catch (err) {
      const fields = errorFields(err);
      if (fields) {
        applyFieldErrors(form, fields);
        announce(status, "Fix the highlighted fields.");
      } else if (err instanceof ApiCallError && err.kind === "api") {
        announce(status, err.body.message);
      } else {
        announce(status, "No connection. Check the studio wifi and try again.");
      }
    } finally {
      submit.removeAttribute("disabled");
    }
  }

  registerRefresh(() => void load());
}

function fieldBlock(label: string, input: HTMLElement, id: string): HTMLElement {
  return h("div", { class: "field" }, h("label", { for: id, text: label }), input, h("div", { class: "field-error", "data-for": id }));
}
