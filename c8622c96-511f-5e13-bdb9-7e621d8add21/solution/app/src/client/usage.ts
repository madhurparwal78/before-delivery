// Usage (licensing manager): totals, expiries and the CSV export, all from one read.
import { dollars } from "../shared/money.js";
import { attempt, get } from "./api.js";
import { h, icon, replace } from "./dom.js";
import type { AppContext } from "./main.js";
import type { Licence } from "./types.js";
import { dataTable, emptyNote, KIND, mono, outageFrom, pageHead } from "./ui.js";

interface Usage {
  active: number;
  pending_invoice: number;
  expired: number;
  revoked: number;
  exclusive: number;
  standard: number;
  invoiced_minor: number;
  shortlist_count: number;
  next_expiry: { licence_id: string; window_end: string; window_end_display: string } | null;
  expiries: Licence[];
}

export function mountUsage(root: HTMLElement, app: AppContext): () => void {
  const totals = h("section", { class: "totals", "aria-label": "Usage totals" });
  const expiries = h("div", {});
  const exportLink = h("a", { href: "/api/usage.csv", class: "button button-primary", download: "" }, icon("download"), "Export CSV");
  replace(root, pageHead("Usage", `What ${app.user.newsroom?.name ?? "your newsroom"} holds, what it has been invoiced and what ends next. All times are co-op time.`),
    totals,
    h("div", { class: "section-row" }, h("h2", { class: "section-title" }, "Licence expiries"), exportLink),
    expiries);

  const figure = (label: string, value: string, wideCell = false): HTMLElement =>
    h("div", { class: `total${wideCell ? " total-wide" : ""}` }, h("p", { class: "total-label" }, label), h("p", { class: "total-value mono" }, value));

  async function load(): Promise<void> {
    const answer = await attempt(() => get<Usage>("/api/usage"));
    outageFrom(answer);
    if (!answer?.ok || !answer.data) return;
    const u = answer.data;
    replace(totals,
      figure("Active", String(u.active)), figure("Pending invoice", String(u.pending_invoice)),
      figure("Expired", String(u.expired)), figure("Revoked", String(u.revoked)),
      figure("Exclusive", String(u.exclusive)), figure("Standard", String(u.standard)),
      figure("Invoiced", dollars(u.invoiced_minor)), figure("Shortlisted frames", String(u.shortlist_count)),
      figure("Next expiry", u.next_expiry?.window_end_display ?? "None running", true));
    replace(expiries, u.expiries.length
      ? dataTable("Licence expiries", ["Essay", "Kind", "Window ends"],
        u.expiries.map((l) => [l.essay_title, KIND[l.kind] ?? l.kind, mono(l.window_end_display)]), [2])
      : emptyNote("No active licences are running."));
  }

  void load();
  const timer = window.setInterval(() => void load(), 10_000);
  return () => window.clearInterval(timer);
}
