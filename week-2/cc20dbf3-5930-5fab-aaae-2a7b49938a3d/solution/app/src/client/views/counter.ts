import type { CounterStatus, Hold, HoldPage, Item, Lanes, Loan, LoanPage } from "../../shared/api.js";
import { formatDay, instantFromLocalInput } from "../../shared/calendar.js";
import { BLOCKED_ROW, SERVICE_BANNER } from "../../shared/copy.js";
import { ApiFailure, get, messageOf, post, withRetryKey } from "../api.js";
import { emptyState, h, loadingLine, markArrived, statusRegion, uid } from "../dom.js";
import { library, localTime } from "../session.js";
import { loanChip } from "../status.js";
import { fieldError, plainButton, primaryButton, setPending, showFieldErrors } from "./forms.js";

const REFRESH_MS = 10_000;

async function allPages<T>(path: string, pick: (page: { next_cursor: string | null }) => T[]): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  do {
    const query: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const page: { next_cursor: string | null } = await get(`${path}${path.includes("?") ? "&" : "?"}limit=50${query}`);
    out.push(...pick(page));
    cursor = page.next_cursor;
  } while (cursor);
  return out;
}

const holdsOf = (page: { next_cursor: string | null }) => (page as HoldPage).holds;
const loansOf = (page: { next_cursor: string | null }) => (page as LoanPage).loans;

export function counterView(root: HTMLElement): () => void {
  let active = true;
  const result = statusRegion("Counter result");
  const banner = h("div", { role: "status", "aria-label": "Counter services", class: "banner sr-only" });
  const prepareList = h("ul", { class: "rows" });
  const readyList = h("ul", { class: "rows" });
  const outList = h("ul", { class: "rows" });
  let items = new Map<string, Item>();
  let status: CounterStatus | null = null;
  const placed = new Map<string, string>();

  const section = (titleId: string, title: string, ...body: (Node | null)[]) =>
    h("section", { class: "box counter__section", "aria-labelledby": titleId }, h("div", { class: "box__head" }, h("h2", { id: titleId }, title)), ...body);

  function rowFor(id: string, where: string, build: () => HTMLLIElement): HTMLLIElement {
    const row = build();
    if (placed.get(id) !== where && placed.has(id)) markArrived(row);
    placed.set(id, where);
    return row;
  }

  const holdLine = (hold: Hold) =>
    h(
      "div",
      { class: "row__main" },
      h("p", { class: "row__title" }, hold.member.name),
      h("p", null, `${hold.item.name}, unit ${hold.unit.label}`),
      h("p", { class: "row__meta mono" }, `${formatDay(hold.start_date)} – ${formatDay(hold.end_date)}`),
    );

  function prepareRow(hold: Hold): HTMLLIElement {
    const button = plainButton("Mark ready");
    button.addEventListener("click", async () => {
      if (button.classList.contains("is-pending")) return;
      setPending(button, "Marking ready…");
      try {
        await post(`/api/holds/${hold.id}/ready`);
        result.textContent = `Marked ready. Pickup notice queued for ${hold.member.name}.`;
      } catch (error) {
        result.textContent = messageOf(error);
      }
      await refresh();
    });
    return rowFor(hold.id, "prepare", () => h("li", { class: "row" }, holdLine(hold), h("div", { class: "row__side" }, button)));
  }

  function readyRow(hold: Hold): HTMLLIElement {
    const blocked = status?.billing === "down" && (items.get(hold.item.id)?.deposit_cents ?? 0) > 0;
    const button = primaryButton("Check out", { disabled: blocked });
    button.addEventListener("click", async () => {
      if (button.classList.contains("is-pending")) return;
      setPending(button, "Lending…");
      try {
        const { loan } = await withRetryKey(`checkout:${hold.id}`, (key) => post<{ loan: Loan }>("/api/loans", { hold_id: hold.id }, key));
        result.textContent = `Lent to ${loan.member.name}. Due ${localTime(loan.due_at)}.`;
        await refresh();
        focusLoan(loan.id);
      } catch (error) {
        result.textContent = messageOf(error);
        await refresh();
      }
    });
    return rowFor(hold.id, "ready", () =>
      h(
        "li",
        { class: `row${blocked ? " row--blocked" : ""}` },
        h(
          "div",
          { class: "row__main" },
          ...holdLine(hold).childNodes,
          hold.pickup_deadline ? h("p", { class: "row__deadline mono" }, `Pick up by ${localTime(hold.pickup_deadline)}`) : null,
          blocked ? h("p", { class: "row__blocked label" }, BLOCKED_ROW) : null,
        ),
        h("div", { class: "row__side" }, button),
      ),
    );
  }

  function outRow(loan: Loan): HTMLLIElement {
    return rowFor(loan.id, "out", () =>
      h(
        "li",
        { class: "row", "data-loan": loan.id },
        h(
          "div",
          { class: "row__main" },
          h("a", { href: `/loans/${loan.id}`, class: "row__link" }, `${loan.item.name}, `, h("span", { class: "nowrap" }, `unit ${loan.unit.label}`)),
          h("p", { class: "row__title" }, loan.member.name),
          h("p", { class: "row__meta mono" }, `Due ${localTime(loan.due_at)}`),
        ),
        h("div", { class: "row__side" }, loanChip(loan.status)),
      ),
    );
  }

  function focusLoan(loanId: string): void {
    outList.querySelector<HTMLElement>(`[data-loan="${loanId}"] a`)?.focus();
  }

  function fill(list: HTMLUListElement, rows: HTMLLIElement[], empty: string): void {
    if (rows.length) list.replaceChildren(...rows);
    else list.replaceChildren(h("li", { class: "row" }, emptyState(empty)));
  }

  function showBanner(): void {
    const lines: string[] = [];
    if (status?.billing === "down") lines.push(SERVICE_BANNER.billing);
    if (status?.photo_storage === "down") lines.push(SERVICE_BANNER.photoStorage);
    banner.replaceChildren(...lines.map((line) => h("p", { class: "banner__line" }, line)));
    banner.classList.toggle("sr-only", lines.length === 0);
  }

  let refreshing: Promise<void> | null = null;
  async function load(): Promise<void> {
    const [requested, ready, out, overdue, services] = await Promise.all([
      allPages("/api/holds?status=requested", holdsOf),
      allPages("/api/holds?status=ready", holdsOf),
      allPages("/api/loans?status=out", loansOf),
      allPages("/api/loans?status=overdue", loansOf),
      get<CounterStatus>("/api/counter/status"),
    ]);
    if (!active) return;
    status = services;
    showBanner();
    const byDue = [...overdue, ...out].sort((a, b) => a.due_at.localeCompare(b.due_at));
    fill(prepareList, requested.map(prepareRow), "Nothing to prepare");
    fill(readyList, ready.map(readyRow), "Nothing waiting for pickup");
    fill(outList, byDue.map(outRow), "Nothing out on loan");
  }
  function refresh(): Promise<void> {
    refreshing ??= load()
      .catch((error: unknown) => {
        if (active && !(error instanceof ApiFailure && error.status === 401)) result.textContent = messageOf(error);
      })
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  // Walk-in loan
  const memberId = uid("member");
  const unitId = uid("unit");
  const dueId = uid("due");
  const checkedOutId = uid("checked-out");
  const member = h("select", { id: memberId }, h("option", { value: "" }, "Choose a member"));
  const unit = h("select", { id: unitId }, h("option", { value: "" }, "Choose a unit"));
  const due = h("input", { id: dueId, type: "date" });
  const checkedOut = h("input", { id: checkedOutId, type: "datetime-local" });
  const errors = { member_id: fieldError(member), unit_id: fieldError(unit), due_date: fieldError(due), checked_out_at: fieldError(checkedOut) };
  const lend = primaryButton("Lend now", { type: "submit" });
  const walkIn = h(
    "form",
    {
      class: "walkin",
      novalidate: true,
      onsubmit: async (event: Event) => {
        event.preventDefault();
        if (lend.classList.contains("is-pending")) return;
        setPending(lend, "Lending…");
        showFieldErrors({}, errors);
        const at = checkedOut.value ? instantFromLocalInput(checkedOut.value, library().time_zone) : null;
        const body = { member_id: member.value, unit_id: unit.value, due_date: due.value, ...(at ? { checked_out_at: at.toISOString() } : {}) };
        try {
          const { loan } = await withRetryKey(`walk-in:${JSON.stringify(body)}`, (key) => post<{ loan: Loan }>("/api/loans", body, key));
          result.textContent = `Lent to ${loan.member.name}. Due ${localTime(loan.due_at)}.`;
          await refresh();
          focusLoan(loan.id);
        } catch (error) {
          result.textContent = messageOf(error);
          if (error instanceof ApiFailure) showFieldErrors(error.fields, errors);
        } finally {
          setPending(lend, null);
        }
      },
    },
    h("div", { class: "field" }, h("label", { for: memberId, class: "label" }, "Member"), member, errors.member_id),
    h("div", { class: "field" }, h("label", { for: unitId, class: "label" }, "Unit"), unit, errors.unit_id),
    h("div", { class: "field" }, h("label", { for: dueId, class: "label" }, "Due date"), due, errors.due_date),
    h(
      "div",
      { class: "field" },
      h("label", { for: checkedOutId, class: "label" }, "Checked out at"),
      checkedOut,
      h("p", { class: "field__hint" }, "Optional: the time written on a paper sheet."),
      errors.checked_out_at,
    ),
    h("div", { class: "walkin__submit" }, lend),
  );

  const waiting = loadingLine();
  root.append(h("div", { class: "page-head" }, h("h1", null, "Counter"), result), waiting);
  const screen = [
    banner,
    h(
      "div",
      { class: "grid counter" },
      section("prepare-title", "Holds to prepare", prepareList),
      section("ready-title", "Ready for pickup", readyList),
      section("out-title", "Out on loan", outList),
      h("section", { class: "box counter__section counter__walkin", "aria-labelledby": "walkin-title" }, h("div", { class: "box__head" }, h("h2", { id: "walkin-title" }, "Walk-in loan")), walkIn),
    ),
  ];

  void (async () => {
    try {
      const [{ members }, { items: list }] = await Promise.all([
        get<{ members: { id: string; name: string }[] }>("/api/members"),
        get<{ items: Item[] }>("/api/items"),
      ]);
      if (!active) return;
      items = new Map(list.map((item) => [item.id, item]));
      member.append(...members.map((m) => h("option", { value: m.id }, m.name)));
      const [lanes] = await Promise.all([Promise.all(list.map((item) => get<Lanes>(`/api/items/${item.id}/lanes`))), refresh()]);
      if (!active) return;
      waiting.replaceWith(...screen);
      unit.append(
        ...list.map((item, i) =>
          h("optgroup", { label: item.name }, (lanes[i]?.lanes ?? []).map((lane) => h("option", { value: lane.unit_id }, `${lane.label} · ${item.name}`))),
        ),
      );
    } catch (error) {
      if (active) result.textContent = messageOf(error);
    }
  })();

  const timer = window.setInterval(() => void refresh(), REFRESH_MS);
  return () => {
    active = false;
    window.clearInterval(timer);
  };
}
