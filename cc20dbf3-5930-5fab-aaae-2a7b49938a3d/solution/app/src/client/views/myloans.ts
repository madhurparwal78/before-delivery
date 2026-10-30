import type { Hold, HoldPage, Loan, LoanPage } from "../../shared/api.js";
import { formatDay } from "../../shared/calendar.js";
import { HOLD_STATUS_WORD } from "../../shared/copy.js";
import { ApiFailure, get, messageOf, post } from "../api.js";
import { emptyState, h, loadingLine, markArrived, statusRegion } from "../dom.js";
import { localTime } from "../session.js";
import { holdChip, loanChip } from "../status.js";
import { plainButton, setPending } from "./forms.js";

const REFRESH_MS = 15_000;

interface Listed {
  id: string;
}

/** A list that grows in place: rows keyed by id, updated in place, inserted in sorted order, never twice. */
class RowList<T extends Listed> {
  readonly records = new Map<string, T>();
  readonly rows = new Map<string, HTMLLIElement>();
  cursor: string | null = null;
  pagesRead = 0;

  constructor(
    readonly list: HTMLUListElement,
    private readonly sortKey: (record: T) => string,
    private readonly render: (record: T, row: HTMLLIElement) => void,
  ) {}

  private before(a: T, b: T): boolean {
    const ka = this.sortKey(a);
    const kb = this.sortKey(b);
    return ka === kb ? a.id > b.id : ka > kb;
  }

  /** Updates a known row in place, or inserts a new one at its sorted position. Returns new rows. */
  merge(records: readonly T[], atEnd: boolean): HTMLLIElement[] {
    const added: HTMLLIElement[] = [];
    for (const record of records) {
      const known = this.rows.get(record.id);
      this.records.set(record.id, record);
      if (known) {
        this.render(record, known);
        continue;
      }
      const row = h("li", { class: "row", tabindex: "-1", "data-id": record.id });
      this.render(record, row);
      this.rows.set(record.id, row);
      added.push(row);
      const anchor = atEnd
        ? undefined
        : [...this.list.querySelectorAll<HTMLLIElement>(":scope > li")].find((el) => {
            const other = this.records.get(el.dataset.id ?? "");
            return other !== undefined && other.id !== record.id && this.before(record, other);
          });
      if (anchor) this.list.insertBefore(row, anchor);
      else this.list.append(row);
    }
    return added;
  }
}

export function myLoansView(root: HTMLElement): () => void {
  let active = true;
  const status = statusRegion("My loans status");
  const holdsList = h("ul", { class: "rows" });
  const loansList = h("ul", { class: "rows" });
  const holdsEmpty = h("div");
  const loansEmpty = h("div");
  const moreHolds = plainButton("Show more holds", { class: "button show-more", hidden: true });
  const moreLoans = plainButton("Show more loans", { class: "button show-more", hidden: true });

  const holds: RowList<Hold> = new RowList(holdsList, (hold) => hold.created_at, renderHold);
  const loans: RowList<Loan> = new RowList(loansList, (loan) => loan.checked_out_at, renderLoan);

  function renderHold(hold: Hold, row: HTMLLIElement): void {
    const name = `${hold.item.name}, unit ${hold.unit.label}`;
    const deadline = hold.status === "ready" && hold.pickup_deadline ? `Pick up by ${localTime(hold.pickup_deadline)}` : null;
    row.setAttribute("aria-label", [name, HOLD_STATUS_WORD[hold.status], deadline].filter(Boolean).join(", "));
    const cancel =
      hold.status === "requested" || hold.status === "ready"
        ? plainButton("Cancel hold", { class: "button button--small" })
        : null;
    cancel?.addEventListener("click", () => void cancelHold(hold, cancel));
    row.replaceChildren(
      h(
        "div",
        { class: "row__main" },
        h("p", { class: "row__title" }, `${hold.item.name}, `, h("span", { class: "nowrap" }, `unit ${hold.unit.label}`)),
        h("p", { class: "row__meta mono" }, `${formatDay(hold.start_date)} – ${formatDay(hold.end_date)}`),
        deadline ? h("p", { class: "row__deadline mono" }, deadline) : null,
      ),
      h("div", { class: "row__side" }, holdChip(hold.status), cancel),
    );
  }

  function renderLoan(loan: Loan, row: HTMLLIElement): void {
    row.replaceChildren(
      h(
        "div",
        { class: "row__main" },
        h("a", { href: `/loans/${loan.id}`, class: "row__link" }, `${loan.item.name}, `, h("span", { class: "nowrap" }, `unit ${loan.unit.label}`)),
        h(
          "p",
          { class: "row__meta mono" },
          loan.returned_at ? `Returned ${localTime(loan.returned_at)}` : `Due ${localTime(loan.due_at)}${loan.renewed_at ? " (renewed)" : ""}`,
        ),
      ),
      h("div", { class: "row__side" }, loanChip(loan.status)),
    );
  }

  async function cancelHold(hold: Hold, button: HTMLButtonElement): Promise<void> {
    if (button.classList.contains("is-pending")) return;
    setPending(button, "Cancelling…");
    try {
      const result = await post<{ hold: Hold }>(`/api/holds/${hold.id}/cancel`);
      if (!active) return;
      holds.merge([result.hold], false);
      status.textContent = "Hold cancelled.";
    } catch (error) {
      if (!active) return;
      status.textContent = messageOf(error);
      try {
        const fresh = await get<{ hold: Hold }>(`/api/holds/${hold.id}`);
        if (active) holds.merge([fresh.hold], false);
      } catch {
        setPending(button, null);
      }
    }
  }

  const showEmpty = () => {
    holdsEmpty.replaceChildren(holds.rows.size ? "" : emptyState("No holds yet"));
    loansEmpty.replaceChildren(loans.rows.size ? "" : emptyState("No loans yet"));
    moreHolds.hidden = holds.cursor === null;
    moreLoans.hidden = loans.cursor === null;
  };

  async function readFirstPages(): Promise<void> {
    const [holdPage, loanPage] = await Promise.all([get<HoldPage>("/api/holds"), get<LoanPage>("/api/loans")]);
    if (!active) return;
    holds.merge(holdPage.holds, false);
    loans.merge(loanPage.loans, false);
    if (holds.pagesRead === 0) holds.cursor = holdPage.next_cursor;
    if (loans.pagesRead === 0) loans.cursor = loanPage.next_cursor;
    holds.pagesRead = Math.max(holds.pagesRead, 1);
    loans.pagesRead = Math.max(loans.pagesRead, 1);
    showEmpty();
  }

  async function showMore<T extends Listed>(list: RowList<T>, button: HTMLButtonElement, path: string, pick: (page: { next_cursor: string | null }) => T[], noun: string): Promise<void> {
    if (!list.cursor || button.classList.contains("is-pending")) return;
    setPending(button, "Loading more…");
    try {
      const page = await get<{ next_cursor: string | null }>(`${path}?cursor=${encodeURIComponent(list.cursor)}`);
      if (!active) return;
      const added = list.merge(pick(page), true);
      list.cursor = page.next_cursor;
      list.pagesRead += 1;
      showEmpty();
      const first = added[0];
      if (first) {
        markArrived(first);
        (first.querySelector<HTMLElement>("a") ?? first).focus();
      }
      status.textContent = `Showing ${list.rows.size} ${noun}.`;
    } catch (error) {
      status.textContent = messageOf(error);
    } finally {
      setPending(button, null);
    }
  }

  moreHolds.addEventListener("click", () => void showMore(holds, moreHolds, "/api/holds", (page) => (page as HoldPage).holds, "holds"));
  moreLoans.addEventListener("click", () => void showMore(loans, moreLoans, "/api/loans", (page) => (page as LoanPage).loans, "loans"));

  const waiting = loadingLine();
  root.append(h("div", { class: "page-head" }, h("h1", null, "My loans"), h("p", { class: "page-head__lede" }, "Your holds and your loans, newest first."), status), waiting);
  const lists = h(
      "div",
      { class: "grid myloans" },
      h("section", { class: "box myloans__holds", "aria-labelledby": "holds-title" }, h("div", { class: "box__head" }, h("h2", { id: "holds-title" }, "Holds")), holdsEmpty, holdsList, moreHolds),
      h("section", { class: "box myloans__loans", "aria-labelledby": "loans-title" }, h("div", { class: "box__head" }, h("h2", { id: "loans-title" }, "Loans")), loansEmpty, loansList, moreLoans),
  );

  const failed = (error: unknown) => {
    if (active && !(error instanceof ApiFailure && error.status === 401)) status.textContent = messageOf(error);
  };
  void readFirstPages()
    .then(() => waiting.replaceWith(lists))
    .catch(failed);
  const timer = window.setInterval(() => void readFirstPages().catch(failed), REFRESH_MS);
  return () => {
    active = false;
    window.clearInterval(timer);
  };
}
