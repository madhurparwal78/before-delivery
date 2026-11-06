// Schools: delivery-day notices with cutoffs in store time (DP-32, DP-33, DP-64).
import { api, ApiError, serverClock } from "../api.js";
import { h, statusRegion, focusStatus, clearChildren } from "../ui/dom.js";
import { formatDateShort, formatDateTime } from "../format.js";
import type { RenderContext } from "../router.js";

interface SchoolEntry {
  id: string;
  name: string;
  next_delivery_date: string;
  cutoff_at: string;
  upcoming_delivery_days: { date: string; cutoff_at: string }[];
}

interface RosterSummaryData {
  counts: Record<string, number>;
  students: { delivery_status: string }[];
}

interface SchoolPanel {
  school: SchoolEntry;
  section: HTMLElement;
  select: HTMLSelectElement;
  send: HTMLButtonElement;
  status: HTMLElement;
  summaryList: HTMLElement;
  countLine: HTMLElement;
}

export async function renderSchools(ctx: RenderContext): Promise<void> {
  ctx.root.appendChild(h("h1", { text: "Schools" }));
  const wrap = h("div", {});
  const panels: SchoolPanel[] = [];

  function fillOptions(panel: SchoolPanel, keepSelection: string): void {
    clearChildren(panel.select);
    panel.select.appendChild(h("option", { value: "", text: "Pick a delivery day" }));
    for (const day of panel.school.upcoming_delivery_days) {
      panel.select.appendChild(
        h("option", {
          value: day.date,
          text: `${formatDateShort(day.date)} (cutoff ${formatDateTime(day.cutoff_at)})`,
          ...(keepSelection === day.date ? { selected: true } : {}),
        })
      );
    }
  }

  async function buildPanel(school: SchoolEntry): Promise<SchoolPanel> {
    const section = h("section", { class: "school-section", "aria-label": school.name });
    section.appendChild(h("h2", { text: school.name }));
    const roster = await api<RosterSummaryData>("GET", `/api/schools/${school.id}/roster`);
    const countLine = h("p", { class: "school-count-line", text: summaryLine(roster) });
    const summaryList = h("ul", { class: "roster-summary-list", "aria-label": "Roster summary" });
    fillSummary(summaryList, roster);
    const select = h("select", { class: "input", "aria-label": "Delivery date" }) as HTMLSelectElement;
    const send = h("button", { class: "btn btn-primary", text: "Send delivery notice" }) as HTMLButtonElement;
    const status = statusRegion(`Delivery notice status ${school.id}`);
    section.append(
      countLine,
      summaryList,
      h("a", { class: "btn btn-secondary", href: `/roster?school=${encodeURIComponent(school.id)}`, text: "View roster" }),
      h("div", { class: "school-notice-form" }, select, send),
      status
    );
    const panel: SchoolPanel = {
      school,
      section,
      select,
      send,
      status,
      summaryList,
      countLine,
    };
    fillOptions(panel, school.upcoming_delivery_days[0]?.date ?? "");
    send.disabled = select.value === "";

    select.addEventListener("change", () => {
      send.disabled = panel.select.value === "";
      if (panel.select.value !== "") {
        status.textContent = "";
      }
    });

    send.addEventListener("click", async () => {
      send.disabled = true;
      status.textContent = "Sending…";
      try {
        const result = await api<{ recipient: string; delivery_date: string; student_count: number }>(
          "POST",
          `/api/schools/${school.id}/delivery-notice`,
          { delivery_date: panel.select.value }
        );
        status.textContent = `Delivery notice queued for ${result.recipient} (${result.student_count} students).`;
        // The page reloads after each notice is sent.
        await reloadAll();
        focusStatus(`Delivery notice status ${school.id}`);
      } catch (err) {
        send.disabled = false;
        if (err instanceof ApiError && err.status === 422) {
          status.textContent = "Pick one of this school's delivery days.";
        } else {
          status.textContent = "Couldn't reach Bellroll. Nothing was changed; check your connection and try again.";
        }
        focusStatus(`Delivery notice status ${school.id}`);
      }
    });
    return panel;
  }

  async function reloadAll(): Promise<void> {
    const data = await api<{ server_now: string; schools: SchoolEntry[] }>("GET", "/api/schools");
    serverClock.syncFrom(data.server_now);
    for (const panel of panels) {
      const fresh = data.schools.find((s) => s.id === panel.school.id);
      if (!fresh) continue;
      panel.school = fresh;
      const wasSelected = panel.select.value;
      const stillThere = fresh.upcoming_delivery_days.some((d) => d.date === wasSelected);
      fillOptions(panel, stillThere ? wasSelected : "");
      panel.send.disabled = stillThere && wasSelected !== "";
      if (!stillThere && wasSelected !== "") {
        panel.status.textContent = `Delivery day ${formatDateShort(wasSelected)} passed its cutoff. Pick another delivery day.`;
      }
      const roster = await api<RosterSummaryData>("GET", `/api/schools/${panel.school.id}/roster`);
      panel.countLine.textContent = summaryLine(roster);
      fillSummary(panel.summaryList, roster);
    }
  }

  async function initialLoad(): Promise<void> {
    clearChildren(wrap);
    panels.length = 0;
    const data = await api<{ server_now: string; schools: SchoolEntry[] }>("GET", "/api/schools");
    serverClock.syncFrom(data.server_now);
    for (const school of data.schools) {
      const panel = await buildPanel(school);
      panels.push(panel);
      wrap.appendChild(panel.section);
    }
  }

  function summaryLine(roster: RosterSummaryData): string {
    const delivered =
      (roster.counts.delivered ?? 0) + (roster.counts.owned ?? 0) + (roster.counts.scheduled ?? 0);
    return `${delivered} of ${roster.students.length} students have an instrument`;
  }

  function fillSummary(list: HTMLElement, roster: RosterSummaryData): void {
    clearChildren(list);
    const order = ["no_instrument", "awaiting_agreement", "scheduled", "delivered", "owned"];
    for (const name of order) {
      list.appendChild(h("li", { text: `${wordFor(name)}: ${roster.counts[name] ?? 0}` }));
    }
  }

  function wordFor(status: string): string {
    const words: Record<string, string> = {
      no_instrument: "No instrument",
      awaiting_agreement: "Awaiting agreement",
      scheduled: "Scheduled for delivery",
      delivered: "Delivered",
      owned: "Owned",
    };
    return words[status] ?? status;
  }

  // Refresh within 2 seconds after a listed day's cutoff passes on the
  // server's clock; another school's region stays untouched.
  const poll = window.setInterval(() => {
    void reloadAll().catch(() => undefined);
  }, 5000);
  const cleanup = (): void => {
    window.clearInterval(poll);
    document.removeEventListener("bellroll:navigate", cleanup);
  };
  document.addEventListener("bellroll:navigate", cleanup);

  ctx.root.append(wrap);
  await initialLoad();
}
