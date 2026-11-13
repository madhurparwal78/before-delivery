import type { LiveEvent, Valuation, ValuationStatus } from "../../shared/types.js";
import { formatDate, formatPricePerShare } from "../../shared/format.js";
import { api, ApiFailure } from "../api.js";
import { announce, applySocketState, replaceAddress, type Page, type PageContext } from "../app.js";
import { clear, el, liveButton } from "../dom.js";

const FILTERS: Array<[string, string]> = [
  ["all", "All"],
  ["current", "Current"],
  ["superseded", "Superseded"],
  ["lapsed", "Lapsed"],
];

const STATUS_WORDS: Record<ValuationStatus, string> = {
  current: "Current",
  superseded: "Superseded",
  lapsed: "Lapsed",
};

export function valuationsPage(context: PageContext): Page {
  let status = context.query.get("status") ?? "all";
  if (!FILTERS.some(([key]) => key === status)) status = "all";
  let focusNewRow: string | null = null;
  const ownRecordings = new Set<string>();
  const errors = new Map<string, HTMLElement>();

  function setError(name: string, message: string | null): void {
    const node = errors.get(name);
    if (node === undefined) return;
    node.hidden = message === null;
    node.textContent = message === null ? "" : `Error: ${message}`;
  }

  let pending: Promise<void> = Promise.resolve();

  /** Draws run one after another, so the last one holds the focus it set. */
  function queueDraw(): Promise<void> {
    pending = pending.then(draw, draw);
    return pending;
  }

  async function draw(): Promise<void> {
    const result = await api<{ valuations: Valuation[] }>("/api/valuations");
    const active = document.activeElement;
    const keepFocus = active instanceof HTMLElement ? active.getAttribute("data-effective") : null;
    clear(context.main);
    errors.clear();

    const radios = FILTERS.map(([key, label]) => {
      const radio = el("input", {
        type: "radio",
        name: "valuation-status",
        id: `status-${key}`,
        value: key,
        checked: status === key,
      }) as HTMLInputElement;
      radio.addEventListener("change", () => {
        status = key;
        replaceAddress(`/admin/valuations?status=${key}`);
        void queueDraw();
      });
      return el("div", { class: "radio" }, [radio, el("label", { for: `status-${key}` }, [label])]);
    });

    const shown = result.valuations.filter((valuation) => status === "all" || valuation.status === status);
    const rows = shown.map((valuation) =>
      el("tr", { "data-valuation": valuation.id }, [
        el("td", { tabindex: "-1", "data-effective": valuation.id }, [formatDate(valuation.effective_on)]),
        el("td", {}, [formatDate(valuation.expires_on)]),
        el("td", {}, [formatPricePerShare(valuation.fmv_per_share)]),
        el("td", {}, [valuation.firm]),
        el("td", {}, [STATUS_WORDS[valuation.status]]),
      ]),
    );

    const table = el("table", { class: "ledger-table", "aria-label": "Valuations" }, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", { scope: "col" }, ["Effective date"]),
          el("th", { scope: "col" }, ["Expiry date"]),
          el("th", { scope: "col" }, ["Fair market value"]),
          el("th", { scope: "col" }, ["Firm"]),
          el("th", { scope: "col" }, ["Status"]),
        ]),
      ]),
      el("tbody", {}, rows),
    ]);

    const makeField = (id: string, label: string, name: string): HTMLInputElement => {
      const input = el("input", { type: "text", id }) as HTMLInputElement;
      const error = el("p", { class: "field-error", hidden: true });
      errors.set(name, error);
      form.append(el("div", { class: "field" }, [el("label", { for: id }, [label]), input, error]));
      return input;
    };

    const form = el("form", { class: "column form", "aria-label": "Record valuation" }) as HTMLFormElement;
    const effective = makeField("valuation-effective", "Effective date", "effective_on");
    const expires = makeField("valuation-expires", "Expiry date", "expires_on");
    const fmv = makeField("valuation-fmv", "Fair market value per share", "fmv_per_share");
    const firm = makeField("valuation-firm", "Valuation firm", "firm");
    const record = liveButton("Record valuation", { class: "primary" });
    form.append(record);
    form.addEventListener("submit", (event) => event.preventDefault());

    record.addEventListener("click", () => {
      void (async () => {
        for (const name of errors.keys()) setError(name, null);
        try {
          const created = await api<Valuation>("/api/valuations", {
            method: "POST",
            body: {
              effective_on: effective.value,
              expires_on: expires.value,
              fmv_per_share: fmv.value,
              firm: firm.value,
            },
          });
          announce(
            `Valuation recorded: fair market value ${formatPricePerShare(created.fmv_per_share)} from ${formatDate(created.effective_on)}.`,
          );
          status = "all";
          replaceAddress("/admin/valuations?status=all");
          ownRecordings.add(created.id);
          focusNewRow = created.id;
          await queueDraw();
        } catch (failure) {
          if (!(failure instanceof ApiFailure)) throw failure;
          let focused = false;
          for (const [name, message] of Object.entries(failure.fields)) {
            setError(name, message);
            if (!focused) {
              const control =
                name === "effective_on" ? effective : name === "expires_on" ? expires : name === "firm" ? firm : fmv;
              control.focus();
              focused = true;
            }
          }
          announce(failure.message);
        }
      })();
    });

    const area =
      shown.length === 0
        ? el("p", { class: "empty-note" }, ["No valuations with this status."])
        : table;

    context.main.append(
      el("div", { class: "axis-grid" }, [
        el("p", { class: "side-note" }, ["The current valuation sets the floor for strike prices."]),
        el("div", { class: "column" }, [
          el("h1", { class: "chapter-title" }, ["Valuations"]),
          el("div", { role: "radiogroup", "aria-label": "Show valuations", class: "radio-group" }, radios),
          area,
          form,
        ]),
      ]),
    );
    applySocketState();
    const wanted = focusNewRow ?? keepFocus;
    focusNewRow = null;
    if (wanted !== null) {
      const cell = document.querySelector<HTMLElement>(`[data-effective="${wanted}"]`);
      if (cell !== null) cell.focus();
    }
  }

  return {
    render: queueDraw,
    onEvent(event: LiveEvent): void {
      if (event.type !== "valuation_changed") return;
      const id = event.data["valuation_id"];
      if (typeof id === "string" && ownRecordings.delete(id)) return;
      void queueDraw();
    },
  };
}
