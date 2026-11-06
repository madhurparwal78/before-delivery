import { api, ApiCallError, errorFields } from "../api";
import { h, clear, dollars, monthName, screen as appScreen, registerRefresh, liveRegion, announce, showModal, closeModal } from "../helpers";
import { me } from "../main";
import { applyFieldErrors } from "./join";

type Revenue = { month: string; closed_at: string | null; fees_cents: number; refunds_cents: number; net_cents: number; charge_count: number };
type FiringLog = { date: string; time_zone: string; firings: { load_id: string; kiln_name: string; firing: string; unloaded_at: string; piece_count: number; value_cents: number }[] };

export function renderReports(root: HTMLElement): void {
  const status = liveRegion("Reports status");
  const timeZone = me()?.timeZone ?? "UTC";
  const monthInput = h("input", { class: "input", type: "month", "aria-label": "Month" });
  const dayInput = h("input", { class: "input", type: "date", "aria-label": "Day" });
  const figures = h("div", { class: "figure-block" });
  const closedTag = h("span", { class: "closed-tag", text: "CLOSED" });
  const closeRow = h("div", { class: "button-row" });
  const revenuePanel = h("section", { class: "panel", "aria-label": "Monthly revenue" },
    h("div", { class: "caption", text: "MONTHLY REVENUE" }),
    monthInput,
    figures,
    closedTag,
    closeRow);
  const exportButton = h("button", { class: "btn", text: "Export statement" });
  closeRow.appendChild(exportButton);

  const logBody = h("tbody");
  const logTable = h("table", { class: "table", "aria-label": "Daily firing log" },
    h("thead", null, h("tr", null,
      h("th", { class: "cell", text: "Kiln" }), h("th", { class: "cell", text: "Firing" }), h("th", { class: "cell", text: "Unloaded" }), h("th", { class: "cell", text: "Pieces" }), h("th", { class: "cell", text: "Value" }))),
    logBody);
  const logPanel = h("section", { class: "panel" }, h("div", { class: "caption", text: "DAILY FIRING LOG" }), dayInput, logTable);
  const layout = h("div", { class: "reports-split" }, revenuePanel, logPanel);
  root.appendChild(appScreen(layout, status));

  const currentMonth = (): string => (monthInput as HTMLInputElement).value || "";
  const currentDay = (): string => (dayInput as HTMLInputElement).value || "";

  async function loadRevenue(): Promise<void> {
    const month = currentMonth();
    try {
      const query = month ? `?month=${encodeURIComponent(month)}` : "";
      const revenue = await api<Revenue>(`/api/reports/revenue${query}`);
      clear(figures);
      figures.append(
        h("div", { class: "figure-row" }, h("span", { class: "muted", text: "FEES" }), h("span", { class: "fig", text: dollars(revenue.fees_cents) })),
        h("div", { class: "figure-row" }, h("span", { class: "muted", text: "REFUNDS" }), h("span", { class: "fig", text: dollars(revenue.refunds_cents) })),
        h("div", { class: "figure-row" }, h("span", { class: "muted", text: "NET" }), h("span", { class: "fig", text: dollars(revenue.net_cents) })),
        h("div", { class: "figure-row" }, h("span", { class: "muted", text: "CHARGES" }), h("span", { class: "fig", text: String(revenue.charge_count) })),
      );
      const closed = revenue.closed_at !== null;
      closedTag.style.display = closed ? "" : "none";
      clear(closeRow);
      if (!closed) {
        const closeLabel = `Close ${monthName(revenue.month, timeZone)}`;
        const closeButton = h("button", { class: "btn", text: closeLabel });
        closeButton.addEventListener("click", () => openCloseDialog(closeButton, revenue.month));
        closeRow.appendChild(closeButton);
      }
      closeRow.appendChild(exportButton);
    } catch (err) {
      if (err instanceof ApiCallError && err.kind === "api" && errorFields(err)) announce(status, "Fix the highlighted fields.");
    }
  }

  async function loadLog(): Promise<void> {
    const day = currentDay();
    try {
      const query = day ? `?date=${encodeURIComponent(day)}` : "";
      const log = await api<FiringLog>(`/api/firing-log${query}`);
      clear(logBody);
      for (const firing of log.firings) {
        logBody.appendChild(h("tr", null,
          h("td", { class: "cell", text: firing.kiln_name }),
          h("td", { class: "cell", text: firing.firing }),
          h("td", { class: "cell", text: new Date(firing.unloaded_at).toISOString() }),
          h("td", { class: "cell mono", text: String(firing.piece_count) }),
          h("td", { class: "cell mono", text: dollars(firing.value_cents) })));
      }
    } catch {
      /* refill on next change */
    }
  }

  monthInput.addEventListener("change", () => void loadRevenue());
  dayInput.addEventListener("change", () => void loadLog());

  function openCloseDialog(opener: HTMLElement, month: string): void {
    const name = monthName(month, timeZone);
    const confirm = h("button", { class: "btn primary", text: "Confirm close" });
    const cancel = h("button", { class: "btn", text: "Cancel" });
    const dialog = h("div", { class: "dialog panel", "aria-label": "Close month" },
      h("div", { class: "caption", text: `CLOSE ${name.toUpperCase()}` }),
      h("p", { text: `Close ${name}? Its statement becomes final.` }),
      confirm,
      cancel);
    confirm.addEventListener("click", () => {
      confirm.setAttribute("disabled", "true");
      announce(status, "Closing month…");
      void (async () => {
        try {
          await api(`/api/reports/months/${encodeURIComponent(month)}/close`, { method: "POST", body: {} });
          closeModal();
          announce(status, `${name} closed. Its statement is final.`);
          await loadRevenue();
        } catch (err) {
          if (err instanceof ApiCallError && err.kind === "api") announce(status, err.body.message);
          else announce(status, "No connection. Check the studio wifi and try again.");
          confirm.removeAttribute("disabled");
        }
      })();
    });
    cancel.addEventListener("click", () => closeModal());
    showModal(dialog, opener);
  }

  exportButton.addEventListener("click", () => {
    announce(status, "Preparing statement…");
    const month = currentMonth();
    const query = month ? `?month=${encodeURIComponent(month)}` : "";
    void (async () => {
      try {
        const res = await fetch(`/api/reports/statement.csv${query}`, { credentials: "same-origin" });
        if (!res.ok) {
          if (res.status >= 500) announce(status, "Something went wrong. Try again.");
          else {
            const body = (await res.json().catch(() => ({ message: "" }))) as { message?: string };
            announce(status, body.message || "Fix the highlighted fields.");
          }
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const anchor = h("a", { href: url, download: `statement-${month || "current"}.csv` }) as HTMLAnchorElement;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        announce(status, "Statement downloaded.");
      } catch {
        announce(status, "No connection. Check the studio wifi and try again.");
      }
    })();
  });

  void (async () => {
    const studio = await api<{ today: string }>("/api/studio").catch(() => null);
    if (studio) {
      (monthInput as HTMLInputElement).value = studio.today.slice(0, 7);
      (dayInput as HTMLInputElement).value = studio.today;
    }
    await Promise.all([loadRevenue(), loadLog()]);
  })();

  registerRefresh(() => {
    void loadRevenue();
    void loadLog();
  });
}
