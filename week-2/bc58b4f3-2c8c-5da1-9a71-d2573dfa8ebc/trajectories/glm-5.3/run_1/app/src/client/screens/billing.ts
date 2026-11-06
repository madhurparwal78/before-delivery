// Billing: the queue of ready/queued/posted items and the dated rate cards.
import { api, ApiCallError, centralToInstant, el, formatDayLong, formatMoney } from "../lib";
import { formField, pollWhileConnected, statusRegion } from "../components";
import { App } from "../main";
import type { QueueItem, RateEntry } from "../types";

export function renderBilling(app: App): void {
  const main = app.main;
  const billingStatus = statusRegion("Billing status");
  const rateStatus = statusRegion("Rate status");

  const queueBody = el("tbody");
  const queueTable = el("table", { class: "paper", "aria-label": "Billing queue" },
    el("thead", {}, el("tr", {},
      el("th", { text: "Number" }), el("th", { text: "Organisation" }), el("th", { text: "Kind" }),
      el("th", { text: "Date" }), el("th", { text: "Total" }), el("th", { text: "Status" }), el("th", { text: "" }))),
    queueBody);

  const ORGS = [
    { code: "RVH", name: "Riverbend Valley Hospital" },
    { code: "CPSD", name: "Cedar Prairie School District" },
    { code: "LFC", name: "Lakeview Family Clinic" },
  ];

  const orgSelect = formField({ name: "org", label: "Organisation", options: ORGS.map((o) => ({ value: o.code, label: o.name })) });
  const rateBody = el("tbody");
  const rateTable = el("table", { class: "paper", "aria-label": "Rate card" },
    el("thead", {}, el("tr", {},
      el("th", { text: "Service line" }), el("th", { text: "Effective from" }),
      el("th", { text: "Hourly rate" }), el("th", { text: "Mileage" }))),
    rateBody);

  const serviceSelect = formField({ name: "service_line", label: "Service line", options: [{ value: "asl", label: "ASL" }, { value: "spoken", label: "Spoken" }] });
  const effective = formField({ name: "effective_from", label: "Effective from", type: "date", placeholder: "YYYY-MM-DD" });
  const rate = formField({ name: "hourly_rate_cents", label: "Hourly rate (dollars)", type: "text", placeholder: "85.75" });
  const mileage = formField({ name: "mileage_cents_per_mile", label: "Mileage (cents per mile)", type: "text", placeholder: "70" });

  const addRateForm = el("form", { "aria-label": "Add rate" },
    el("h3", { text: "Add rate" }),
    serviceSelect.row, effective.row, rate.row, mileage.row,
    rateStatus.el,
    el("button", { class: "btn btn-primary", type: "submit", text: "Add rate" }),
  );

  const loadQueue = (): void => {
    api<{ items: QueueItem[] }>("GET", "/api/billing/queue").then((res) => {
      queueBody.replaceChildren();
      for (const item of res.items) {
        const date = centralToInstant(item.start_at.slice(0, 10), 720);
        const statusCell = el("td", { "data-label": "Status" },
          el("span", { class: "status-chip", text: statusWord(item.billing.status) }),
          item.billing.invoice_id ? el("span", { class: "num", text: ` ${item.billing.invoice_id.slice(0, 8)}` }) : el("span"));
        const tr = el("tr", {},
          el("td", { "data-label": "Number" }, el("span", { class: "num", text: item.number })),
          el("td", { "data-label": "Organisation", text: orgName(item.org_code) }),
          el("td", { "data-label": "Kind", text: item.kind === "service" ? "Service" : "Late cancellation" }),
          el("td", { "data-label": "Date", text: formatDayLong(date) }),
          el("td", { "data-label": "Total" }, el("span", { class: "num", text: formatMoney(item.total_cents ?? 0) })),
          statusCell,
          el("td", { "data-label": "" },
            item.billing.status === "ready"
              ? el("button", {
                  class: "btn",
                  text: `Post invoice for ${item.number}`,
                  onclick: (e: Event) => postInvoice(item.number, e.target as HTMLButtonElement),
                })
              : el("span")),
        );
        queueBody.append(tr);
      }
    }).catch(() => {
      billingStatus.set("Billing queue not updating. Retrying…");
    });
  };

  const postInvoice = async (number: string, btn: HTMLButtonElement): Promise<void> => {
    btn.disabled = true;
    billingStatus.set("Posting…");
    try {
      const res = await api<{ billing: { status: string; invoice_id: string | null } }>("POST", `/api/assignments/${number}/invoice`, {});
      if (res.billing.status === "posted") {
        billingStatus.set(`Posted to Kill Bill as invoice ${res.billing.invoice_id}.`);
      } else {
        billingStatus.set("Queued. Kill Bill is unreachable, and this will post automatically when it returns.");
      }
      loadQueue();
    } catch (err) {
      btn.disabled = false;
      billingStatus.set(err instanceof ApiCallError && err.code === "not_billable"
        ? "This item is not ready to invoice."
        : "Couldn't reach Teamseat. Try again.");
    }
  };

  const loadRates = (): void => {
    const org = (orgSelect.input as HTMLSelectElement).value;
    api<{ entries: RateEntry[] }>("GET", `/api/rate-cards?org=${org}`).then((res) => {
      rateBody.replaceChildren();
      for (const entry of res.entries) {
        rateBody.append(el("tr", {},
          el("td", { "data-label": "Service line", text: entry.service_line === "asl" ? "ASL" : "Spoken" }),
          el("td", { "data-label": "Effective from", text: entry.effective_from }),
          el("td", { "data-label": "Hourly rate" }, el("span", { class: "num", text: formatMoney(entry.hourly_rate_cents) })),
          el("td", { "data-label": "Mileage" }, el("span", { class: "num", text: `${entry.mileage_cents_per_mile}¢/mi` })),
        ));
      }
    }).catch(() => {
      rateStatus.set("Rate card not loading. Try again.");
    });
  };

  (orgSelect.input as HTMLSelectElement).addEventListener("change", loadRates);

  addRateForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    rateStatus.set("Saving…");
    const rateDollars = Number((rate.input as HTMLInputElement).value);
    const mileageCents = Number((mileage.input as HTMLInputElement).value);
    if (!Number.isFinite(rateDollars) || !Number.isFinite(mileageCents)) {
      rateStatus.set("Enter the rate in dollars and the mileage in cents.");
      return;
    }
    try {
      const entry = await api<RateEntry>("POST", "/api/rate-cards", {
        org: (orgSelect.input as HTMLSelectElement).value,
        service_line: (serviceSelect.input as HTMLSelectElement).value,
        effective_from: (effective.input as HTMLInputElement).value,
        hourly_rate_cents: Math.round(rateDollars * 100),
        mileage_cents_per_mile: Math.round(mileageCents),
      });
      rateStatus.set(`Rate from ${formatDayLong(centralToInstant(entry.effective_from, 720))} saved.`);
      loadRates();
    } catch (err) {
      if (err instanceof ApiCallError) {
        if (err.code === "duplicate_rate") rateStatus.set("A rate already starts on that date.");
        else if (err.code === "validation") rateStatus.set("Check the highlighted fields.");
        else rateStatus.set(err.message);
      } else {
        rateStatus.set("Couldn't reach Teamseat. Try again.");
      }
    }
  });

  main.append(
    el("h1", { text: "Billing" }),
    billingStatus.el,
    el("h2", { text: "Billing queue" }),
    el("div", { class: "board-wrap" }, queueTable),
    el("h2", { text: "Rate card" }),
    orgSelect.row,
    rateTable,
    addRateForm,
  );

  const statusWord = (status: string): string =>
    status === "ready" ? "Ready" : status === "queued" ? "Queued" : "Posted";

  const orgName = (code: string): string =>
    ORGS.find((o) => o.code === code)?.name ?? code;

  void app;
  loadQueue();
  loadRates();
  pollWhileConnected(main, loadQueue);
}
