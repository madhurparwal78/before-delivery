// Credit history: balance, held and spendable, then every movement newest first, paged.
import { api, NoResponse } from "../api.js";
import { shortStamp } from "../clubclock.js";
import { h, labelled, money, setBusy } from "../dom.js";
import { announce, main, session, useLive } from "../shell.js";
import { checkPayments } from "./member-cycle.js";

interface Movement {
  id: number;
  kind: string;
  memo: string;
  created_at: string;
  legs: { account: string; amount_cents: number }[];
}

interface Page {
  balance_cents: number;
  held_cents: number;
  spendable_cents: number;
  total_movements: number;
  next_before: string | null;
  movements: Movement[];
}

const KIND: Record<string, string> = {
  carried_forward: "Carried forward",
  top_up: "Top-up",
  pledge_charge: "Pledge charge",
  short_credit: "Short credit",
};

export async function creditScreen(): Promise<void> {
  document.title = "Credit history · Tally Split";
  useLive("Credit updates");
  void checkPayments();
  main.replaceChildren(h("p", { class: "loading" }, "Loading credit history"));
  const code = session.me!.household_code!;
  const path = (before: string | null) =>
    `/api/households/${encodeURIComponent(code)}/ledger?limit=20${before ? `&before=${encodeURIComponent(before)}` : ""}`;
  const first: Page = (await api<Page>("GET", path(null))).body;
  const account = `household:${code}`;
  const tbody = h("tbody");
  const table = h("table", { class: "table stack ledger", "aria-label": "Credit history", tabindex: -1 },
    h("thead", {}, h("tr", {}, ...["DATE", "KIND", "MEMO", "AMOUNT"].map((c) => h("th", { scope: "col" }, c)))),
    tbody);
  let next = first.next_before;
  let shown = 0;

  function append(movements: Movement[]): void {
    for (const m of movements) {
      const amount = m.legs.find((l) => l.account === account)?.amount_cents ?? 0;
      tbody.append(
        h("tr", {},
          h("td", { "data-label": "DATE" }, shortStamp(m.created_at)),
          h("td", { "data-label": "KIND" }, KIND[m.kind] ?? m.kind),
          h("td", { "data-label": "MEMO" }, m.memo),
          h("td", { "data-label": "AMOUNT", class: `num ${amount < 0 ? "debit" : "credit"}` }, `${amount < 0 ? "−" : "+"}${money(Math.abs(amount))}`)),
      );
    }
    shown += movements.length;
  }

  const more = h("button", { type: "button", class: "button quiet" }, "Show older movements");
  more.addEventListener("click", async () => {
    if (more.getAttribute("aria-disabled") === "true" || !next) return;
    setBusy(more, true, "Loading...", "Show older movements");
    try {
      const r = await api<Page>("GET", path(next));
      setBusy(more, false, "Loading...", "Show older movements");
      if (r.status !== 200) throw new NoResponse();
      append(r.body.movements);
      next = r.body.next_before;
      announce("Credit updates", `Showing ${shown} of ${r.body.total_movements} movements.`);
      if (!next) {
        more.remove();
        table.focus();
      }
    } catch (error) {
      setBusy(more, false, "Loading...", "Show older movements");
      if (!(error instanceof NoResponse)) throw error;
      announce("Credit updates", "Couldn't load older movements. Try again.");
    }
  });

  append(first.movements);
  main.replaceChildren(
    h("div", { class: "credit-page grid" },
      h("section", { class: "panel span-12" },
        h("h1", {}, "Credit history"),
        h("div", { class: "figures" },
          labelled("BALANCE", money(first.balance_cents)),
          labelled("HELD", money(first.held_cents)),
          labelled("SPENDABLE", money(first.spendable_cents), "figure strong"),
          labelled("MOVEMENTS", String(first.total_movements)))),
      h("section", { class: "panel span-12" },
        h("div", { class: "table-wrap" }, table),
        next ? h("div", { class: "more" }, more) : null,
        h("p", {}, h("a", { href: "/" }, "Back to your cycles")))),
  );
}
