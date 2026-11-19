/** Approvals: held payments, decided by keyboard or pointer, live without moving the user's focus. */
import { APPROVALS_REFRESH_SECONDS } from "../../shared/rules.js";
import { formatDollars } from "../../shared/money.js";
import { announce } from "../shared/announce.js";
import { api, ServerFault, SignedOut, Unreachable } from "../shared/api.js";
import { COPY } from "../shared/copy.js";
import { h, ICONS, isPending, pending, query, svg } from "../shared/dom.js";
import { calendarDate, methodLabel } from "../shared/format.js";
import { actionFailed, actionSucceeded } from "../shared/outage.js";
import { every } from "../shared/timers.js";
import { onLiveReconnect, onLiveTransaction, Refresher } from "./refresh.js";
import { currentMe, setWaiting } from "./store.js";

interface Approval {
  id: string;
  recipient_name: string;
  method: string;
  amount_cents: number;
  creator_name: string;
  source_account_name: string;
  approvals_required: number;
  approvals: Array<{ name: string }>;
  approve_by: string;
}

const EXIT_MS = 200;

function titleOf(approval: Approval): string {
  return `${formatDollars(approval.amount_cents)} to ${approval.recipient_name} from ${approval.source_account_name}`;
}

export function mountApprovals(root: HTMLElement): void {
  const list = h("ul", { class: "approval-list", "aria-label": "Payments waiting for approval" });
  const empty = h("p", { class: "empty-state", hidden: true }, "Nothing waits for approval.");
  root.append(list, empty);
  const heading = query(document, "#page-title");
  const canDecide = currentMe().user.role !== "member";
  const prefersStill = window.matchMedia("(prefers-reduced-motion: reduce)");
  let rows: Approval[] = [];
  let known = false;

  function rowFor(id: string): HTMLElement | null {
    return list.querySelector<HTMLElement>(`[data-payment="${CSS.escape(id)}"]`);
  }

  function liveRows(): HTMLElement[] {
    return [...list.querySelectorAll<HTMLElement>("li[data-payment]:not([data-leaving])")];
  }

  function buildRow(approval: Approval): HTMLElement {
    const row = h(
      "li",
      { class: "approval-row enter", "data-payment": approval.id },
      h(
        "div",
        { class: "approval-details" },
        h("strong", { class: "approval-recipient" }, approval.recipient_name),
        h("span", { class: "chip" }, methodLabel(approval.method)),
        h("span", { class: "mono approval-amount" }, formatDollars(approval.amount_cents)),
        h("span", { class: "approval-meta" }, `Created by ${approval.creator_name}`),
        h("span", { class: "approval-meta" }, `from ${approval.source_account_name}`),
        h("span", { class: "approval-progress", "data-progress": "" }),
        h("span", { class: "approval-meta", "data-approved-by": "" }),
        h("span", { class: "approve-by" }, svg(ICONS.clock), h("span", { "data-approve-by": "" })),
      ),
    );
    if (canDecide) {
      row.append(
        h(
          "div",
          { class: "approval-actions" },
          h("button", { class: "btn btn-primary", type: "button", "data-approve": "" }, h("span", {}, "Approve")),
          h("button", { class: "btn btn-quiet", type: "button", "data-reject": "" }, h("span", {}, "Reject")),
        ),
      );
    }
    return row;
  }

  function fill(row: HTMLElement, approval: Approval): void {
    query(row, "[data-progress]").textContent = `${approval.approvals.length} of ${approval.approvals_required} approvals`;
    const names = query(row, "[data-approved-by]");
    names.textContent = approval.approvals.length > 0 ? `Approved by ${approval.approvals.map((entry) => entry.name).join(", ")}` : "";
    query(row, "[data-approve-by]").textContent = `Approve by ${calendarDate(approval.approve_by)}`;
  }

  /** Names every row's buttons in full; rows that share amount, recipient and source gain "(payment k of m)". */
  function nameButtons(): void {
    const groups = new Map<string, HTMLElement[]>();
    for (const row of liveRows()) {
      const approval = rows.find((candidate) => candidate.id === row.dataset.payment);
      if (!approval) continue;
      const key = titleOf(approval);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    for (const [title, members] of groups) {
      members.forEach((row, index) => {
        const suffix = members.length > 1 ? ` (payment ${index + 1} of ${members.length})` : "";
        row.querySelector("[data-approve]")?.setAttribute("aria-label", `Approve ${title}${suffix}`);
        row.querySelector("[data-reject]")?.setAttribute("aria-label", `Reject ${title}${suffix}`);
      });
    }
  }

  /** Where focus goes when the row that held it leaves: the next row's Approve, else the previous row's, else the heading. */
  function focusAfterDeparture(before: HTMLElement[], departedIndex: number): void {
    const remaining = liveRows();
    const after = before.slice(departedIndex + 1).find((row) => remaining.includes(row));
    const previous = [...before.slice(0, departedIndex)].reverse().find((row) => remaining.includes(row));
    const target = after ?? previous;
    const approve = target?.querySelector<HTMLElement>("[data-approve]");
    if (approve) approve.focus();
    else heading.focus();
  }

  function depart(row: HTMLElement): void {
    row.setAttribute("data-leaving", "");
    row.setAttribute("inert", "");
    if (prefersStill.matches) {
      row.remove();
      return;
    }
    row.classList.add("leaving");
    window.setTimeout(() => row.remove(), EXIT_MS);
  }

  function apply(next: Approval[], quiet: boolean): void {
    const before = liveRows();
    const focused = before.findIndex((row) => row.contains(document.activeElement));
    const previousCount = rows.length;
    rows = next;
    const ids = new Set(next.map((approval) => approval.id));
    const departed = before.filter((row) => !ids.has(row.dataset.payment ?? "") && row.dataset.busy !== "true");
    for (const approval of next) {
      let row = rowFor(approval.id);
      if (!row) {
        row = buildRow(approval);
        const successor = next.slice(next.indexOf(approval) + 1).map((later) => rowFor(later.id)).find((element): element is HTMLElement => element !== null && !element.hasAttribute("data-leaving"));
        list.insertBefore(row, successor ?? null);
      }
      fill(row, approval);
    }
    for (const row of departed) depart(row);
    nameButtons();
    empty.hidden = next.length > 0;
    setWaiting(next.length);
    if (focused !== -1 && departed.includes(before[focused] as HTMLElement)) focusAfterDeparture(before, focused);
    if (known && !quiet && next.length !== previousCount) announce(`Payments waiting for approval: ${next.length}`);
    known = true;
  }

  let issued = 0;
  let applied = 0;

  /** Answers can arrive out of order; one older than the last applied is dropped. */
  async function load(quiet: boolean): Promise<void> {
    const ticket = ++issued;
    const { data } = await api<{ approvals: Approval[] }>("GET", "/api/approvals");
    if (ticket < applied) return;
    applied = ticket;
    apply(data.approvals, quiet);
  }

  const refresher = new Refresher(() => load(false));
  every(() => void refresher.run(), APPROVALS_REFRESH_SECONDS * 1000);
  onLiveTransaction(() => void refresher.run());
  onLiveReconnect(() => void refresher.run());
  void refresher.run();

  list.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-approve], [data-reject]");
    if (!button || isPending(button)) return;
    void decide(button, button.hasAttribute("data-approve") ? "approve" : "reject");
  });

  async function decide(button: HTMLButtonElement, verb: "approve" | "reject"): Promise<void> {
    const row = button.closest<HTMLElement>("li[data-payment]");
    if (!row) return;
    const id = row.dataset.payment ?? "";
    const label = verb === "approve" ? "Approving…" : "Rejecting…";
    const buttons = [...row.querySelectorAll<HTMLButtonElement>("button")];
    const finishers = buttons.map((member) => pending(member, member === button ? label : (member.textContent ?? ""), member.querySelector("span") ?? member));
    row.dataset.busy = "true";
    announce(label);
    try {
      const { status, data } = await api<any>("POST", `/api/payments/${id}/${verb}`);
      actionSucceeded();
      if (status === 200) {
        if (verb === "reject") announce("Payment rejected");
        else if (data.status === "posted") {
          const effective: string | null = data.effective_date;
          announce(effective !== null && effective !== currentMe().business_date ? `Payment approved and sent Settles on ${calendarDate(effective)}` : "Payment approved and sent");
        } else announce("Approval recorded");
        delete row.dataset.busy;
        await load(true);
        if (data.status === "pending_approval" && verb === "approve") row.querySelector<HTMLElement>("[data-reject]")?.focus();
      } else if (data.error === "already_approved") announce("You've already approved this payment.");
      else if (data.error === "payment_not_pending") {
        announce("This payment is no longer waiting for approval.");
        delete row.dataset.busy;
        await load(true);
      } else if (status === 403) announce("You can't decide this payment.");
    } catch (error) {
      if (error instanceof Unreachable) actionFailed();
      else if (error instanceof ServerFault) announce(COPY.serverError);
      else if (!(error instanceof SignedOut)) throw error;
    } finally {
      delete row.dataset.busy;
      finishers.forEach((finish) => finish());
    }
  }
}
