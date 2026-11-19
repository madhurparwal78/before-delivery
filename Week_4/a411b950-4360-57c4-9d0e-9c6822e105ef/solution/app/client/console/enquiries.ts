import { byId, request } from "../lib/api.js";
import { openDialog } from "../lib/dialog.js";
import { formatBusinessDate, formatCalendarDate, monthLabel } from "../../shared/dates.js";
import { type EnquiryStatus as Status, PIPELINE, PROPOSAL_WRITABLE, type TRIAGE_WRITABLE } from "../../shared/lifecycle.js";
import { decimalToCents, formatUsd } from "../../shared/money.js";
import {
  BILLING_DOWN, backToList, button, copyText, el, emptyState, type Field, field, input, poll, say, showErrors,
  skeletonRows, STALE, textarea, zone,
} from "./ui.js";

type Delivery = "sent" | "pending" | "cancelled" | null;

interface Milestone {
  number: number;
  name: string;
  percent: number;
  amount_cents: number;
}

interface Proposal {
  token: string;
  url: string;
  producer_name: string;
  producer_email: string;
  project_title: string;
  scope: string;
  fee_cents: number;
  production_month: string;
  milestones: Milestone[];
  expires_at: string;
  email: Delivery;
  held_email: Delivery;
  deposit_email: Delivery;
  invoiced_milestones: number[];
}

interface Enquiry {
  id: string;
  reference: string;
  version: number;
  received_at: string;
  status: Status;
  name: string;
  email: string;
  studio: string;
  brief: string;
  preferred_month: string | null;
  project_slug: string | null;
  attachment: { filename: string; bytes: number; url: string } | null;
  receipt: Delivery;
  triage_notes: string;
  fit_score: number | null;
  rate_floor_cents: number | null;
  proposal: Proposal | null;
}

interface Refusal {
  error?: string;
  errors?: Record<string, string>;
  current?: Enquiry;
}

interface Answer<T> {
  status: number;
  body: T & Refusal;
}

interface ProductionMonth {
  month: string;
  label: string;
  open: boolean;
}

const STATUS_LABELS: Record<Status, string> = {
  new: "New", qualified: "Qualified", proposal_sent: "Proposal sent", accepted: "Accepted",
  deposit_paid: "Deposit paid", booked: "Booked", declined: "Declined", expired: "Expired",
};

/** The four emails an enquiry can carry, in announcement order. */
const EMAILS = [
  { kind: "receipt", read: (e: Enquiry) => e.receipt, label: "Receipt", announce: "Receipt for {r} sent." },
  { kind: "proposal", read: (e: Enquiry) => e.proposal?.email ?? null, label: "Proposal email", announce: "Proposal email for {r} sent." },
  { kind: "held", read: (e: Enquiry) => e.proposal?.held_email ?? null, label: "Month-held email", announce: "Month-held email for {r} sent." },
  { kind: "deposit", read: (e: Enquiry) => e.proposal?.deposit_email ?? null, label: "Deposit email", announce: "Deposit email for {r} sent." },
] as const;

/** "Receipt pending", "Proposal email sent", "Proposal email cancelled"… for each email the enquiry carries. */
function emailBadges(enquiry: Enquiry, emails: readonly (typeof EMAILS)[number][]): HTMLElement[] {
  return emails.flatMap((email) => {
    const state = email.read(enquiry);
    return state === null ? [] : [el("span", { className: state === "sent" ? "badge sent" : "badge", text: `${email.label} ${state}` })];
  });
}

const view = byId("enquiries-view");
const list = byId("enquiry-list");
const listPane = list.parentElement as HTMLElement;
const detail = byId("enquiry-detail");
const filter = byId<HTMLSelectElement>("status-filter");
const more = byId<HTMLButtonElement>("more-enquiries");
const rows = new Map<string, HTMLLIElement>();
/** Where "Show more enquiries" reads next (a null cursor is the first page); null when no older matching enquiry exists. */
let older: { cursor: string | null } | null = null;
/** The oldest reference shown, which each reload reads down to. */
let oldestShown: string | null = null;
/** List reads run one at a time so a reload and "Show more enquiries" never interleave. */
let reading: Promise<void> = Promise.resolve();
let previous: Map<string, Enquiry> | null = null;
let selected: Enquiry | null = null;

// ---- List ----

function rowContent(enquiry: Enquiry): HTMLElement[] {
  const badges = emailBadges(enquiry, EMAILS);
  return [
    el("span", { className: "row-top" },
      el("span", { className: "row-title mono", text: enquiry.reference }),
      el("span", { className: "badge", text: STATUS_LABELS[enquiry.status] })),
    el("span", { className: "row-meta", text: `${enquiry.studio} · ${enquiry.name}` }),
    el("span", { className: "row-badges" }, ...badges),
  ];
}

function upsertRow(enquiry: Enquiry): HTMLLIElement {
  let row = rows.get(enquiry.id);
  if (!row) {
    const open = el("button", { attrs: { type: "button" } });
    open.addEventListener("click", () => void openEnquiry(enquiry.id));
    row = el("li", { attrs: { "data-id": enquiry.id } }, open);
    rows.set(enquiry.id, row);
  }
  const open = row.firstElementChild as HTMLButtonElement;
  open.setAttribute("aria-label", `Open ${enquiry.reference}`);
  open.replaceChildren(...rowContent(enquiry));
  if (selected?.id === enquiry.id) open.setAttribute("aria-current", "true");
  else open.removeAttribute("aria-current");
  return row;
}

type Page = { enquiries: Enquiry[]; next_cursor: string | null };

async function readPage(cursor: string | null): Promise<Page | null> {
  const params = new URLSearchParams();
  if (filter.value) params.set("status", filter.value);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  const answer = await request<Page>(`/api/console/enquiries${query ? `?${query}` : ""}`);
  return answer.status === 200 ? answer.body : null;
}

function serially(work: () => Promise<void>): Promise<void> {
  reading = reading.then(work, work);
  return reading;
}

function showMore(next: { cursor: string | null } | null): void {
  older = next;
  more.hidden = next === null;
}

/** The first row at least partly in view in the scrolled list pane that the reload keeps, and its place on screen. */
function anchorRow(kept: Set<string>): { row: HTMLElement; top: number } | null {
  if (listPane.scrollTop === 0) return null;
  const paneTop = listPane.getBoundingClientRect().top;
  for (const row of list.querySelectorAll<HTMLLIElement>(":scope > li[data-id]")) {
    const box = row.getBoundingClientRect();
    if (box.bottom > paneTop && kept.has(row.dataset.id ?? "")) return { row, top: box.top };
  }
  return null;
}

/** One "Console status" update for every email that moved from pending to sent since the previous reload. */
function announceDeliveries(enquiries: Enquiry[]): void {
  if (!previous) return;
  const sentences: string[] = [];
  const sorted = [...enquiries].sort((a, b) => (a.reference < b.reference ? -1 : 1));
  for (const enquiry of sorted) {
    const before = previous.get(enquiry.id);
    if (!before) continue;
    for (const email of EMAILS) {
      if (email.read(before) === "pending" && email.read(enquiry) === "sent") sentences.push(email.announce.replace("{r}", enquiry.reference));
    }
  }
  if (sentences.length) say(sentences.join(" "));
}

/**
 * Reloads from the newest matching enquiry down to the oldest row already shown, page after page, updating rows
 * in place (never focus, selection or the detail pane), keeping the rows in view where they are on screen, and
 * announcing deliveries since the previous reload.
 */
function reload(): Promise<void> {
  return serially(async () => {
    const read: Enquiry[] = [];
    let cursor: string | null = null;
    let lastPage: string | null = null;
    do {
      lastPage = cursor;
      const page = await readPage(cursor);
      if (!page) return;
      read.push(...page.enquiries);
      cursor = page.next_cursor;
    } while (cursor !== null && oldestShown !== null && (read.at(-1)?.reference ?? "") > oldestShown);
    const floor = oldestShown;
    const enquiries = floor === null ? read : read.filter((enquiry) => enquiry.reference >= floor);
    const kept = new Set(enquiries.map((enquiry) => enquiry.id));
    const anchor = anchorRow(kept);
    for (const [id, row] of rows) {
      if (!kept.has(id)) {
        row.remove();
        rows.delete(id);
      }
    }
    list.querySelectorAll(".skeleton, .empty").forEach((node) => node.remove());
    enquiries.forEach((enquiry, index) => {
      const row = upsertRow(enquiry);
      if (list.children[index] !== row) list.insertBefore(row, list.children[index] ?? null);
    });
    if (enquiries.length === 0) list.append(emptyState("No enquiries with this status."));
    if (anchor) listPane.scrollTop += anchor.row.getBoundingClientRect().top - anchor.top;
    oldestShown = enquiries.at(-1)?.reference ?? null;
    // Rows read past the oldest one shown stay for "Show more enquiries", which reads that last page again.
    showMore(enquiries.length < read.length ? { cursor: lastPage } : cursor === null ? null : { cursor });
    announceDeliveries(enquiries);
    previous = new Map(enquiries.map((e) => [e.id, e]));
  });
}

/** Appends the next page under the rows shown; focus stays on the button, or moves to the first new row once none remain. */
function loadOlder(): Promise<void> {
  return serially(async () => {
    if (older === null) return;
    const page = await readPage(older.cursor);
    if (!page) {
      say("Older enquiries could not load. Press Show more enquiries to try again.");
      return;
    }
    const floor = oldestShown;
    const fresh = page.enquiries.filter((enquiry) => floor === null || enquiry.reference < floor);
    const appended = fresh.map((enquiry) => {
      const row = upsertRow(enquiry);
      list.append(row);
      previous?.set(enquiry.id, enquiry);
      return row;
    });
    oldestShown = fresh.at(-1)?.reference ?? oldestShown;
    const hadFocus = document.activeElement === more;
    showMore(page.next_cursor === null ? null : { cursor: page.next_cursor });
    if (more.hidden && hadFocus) appended[0]?.querySelector("button")?.focus();
  });
}

/** Opening the list or changing the filter starts again from the first page, announcing nothing on that read. */
function fromFirstPage(): void {
  previous = null;
  oldestShown = null;
  showMore(null);
}

/** Opens the list; the returned function stops its reloads and the detail pane's milestone re-reads. */
export function startEnquiries(): () => void {
  if (rows.size === 0) list.replaceChildren(...skeletonRows());
  fromFirstPage();
  const stopList = poll(reload);
  const stopInvoices = poll(followInvoices);
  return () => {
    stopList();
    stopInvoices();
  };
}

// ---- Detail ----

async function openEnquiry(id: string): Promise<void> {
  const answer = await request<{ enquiry: Enquiry }>(`/api/console/enquiries/${id}`);
  if (answer.status !== 200) return;
  selected = answer.body.enquiry;
  for (const [rowId, row] of rows) {
    const open = row.firstElementChild as HTMLElement;
    if (rowId === id) open.setAttribute("aria-current", "true");
    else open.removeAttribute("aria-current");
  }
  renderDetail(selected);
  view.classList.add("show-detail");
}

type TriageKey = (typeof TRIAGE_WRITABLE)[number];
type TriageValue = string | number | null;

interface Pane {
  triage: Record<TriageKey, HTMLInputElement | HTMLTextAreaElement>;
  conflicts: HTMLElement;
  facts: HTMLElement;
  actions: HTMLElement;
  milestoneBlock: HTMLElement;
  milestones: HTMLUListElement;
  invoice: HTMLButtonElement | null;
  /** Milestones the list shows as invoiced; the second-tab re-read changes these without taking a new version. */
  invoiced: readonly number[];
  /** The milestone whose invoice request from this pane is pending. */
  invoicing: number | null;
  /** Counts the enquiries the pane has taken, so a re-read sent before the latest one never overwrites it. */
  generation: number;
  proposal: HTMLElement;
  status: HTMLElement;
}

let pane: Pane | null = null;

const centsText = (cents: number | null): string => (cents === null ? "" : formatUsd(cents).replaceAll(",", ""));

/** The triage fields in merge order, each compared as the brief says: exact text, whole number, integer cents. */
const TRIAGE_FIELDS: readonly {
  key: TriageKey;
  label: string;
  stored: (enquiry: Enquiry) => TriageValue;
  /** The value the field's text stands for; an empty fit score or rate floor is null. */
  typed: (text: string) => TriageValue;
  /** The field text for a value. */
  text: (value: TriageValue) => string;
  /** The value as written in "Changed in another window". */
  written: (value: TriageValue) => string;
}[] = [
  {
    key: "triage_notes", label: "Triage notes", stored: (e) => e.triage_notes, typed: (text) => text,
    text: (value) => String(value ?? ""), written: (value) => (value ? String(value) : "(empty)"),
  },
  {
    key: "fit_score", label: "Fit score", stored: (e) => e.fit_score,
    typed: (text) => (text.trim() ? Number(text) : null),
    text: (value) => (value === null ? "" : String(value)), written: (value) => (value === null ? "(empty)" : String(value)),
  },
  {
    key: "rate_floor_cents", label: "Rate floor (USD)", stored: (e) => e.rate_floor_cents,
    typed: (text) => (text.trim() ? decimalToCents(text) ?? text.trim() : null),
    text: (value) => (typeof value === "number" ? centsText(value) : value ?? ""),
    written: (value) => (value === null ? "(empty)" : typeof value === "number" ? `$${formatUsd(value)}` : value),
  },
];

/** Triage notes typed in the pane but not saved, which a reload of the enquiry keeps. */
const typedNotes = (): boolean => pane !== null && selected !== null && pane.triage.triage_notes.value !== selected.triage_notes;

function renderDetail(enquiry: Enquiry): void {
  const notes = field("Triage notes", textarea(enquiry.triage_notes, 5), "span");
  const fit = field("Fit score", input("number"));
  fit.input.setAttribute("min", "1");
  fit.input.setAttribute("max", "5");
  const floor = field("Rate floor (USD)", input("text"));
  floor.input.setAttribute("inputmode", "decimal");
  const triageFields: Record<TriageKey, Field> = { triage_notes: notes, fit_score: fit, rate_floor_cents: floor };
  const conflicts = el("section", { className: "conflicts", attrs: { role: "region", "aria-label": "Changed in another window" } });
  conflicts.hidden = true;
  const save = el("button", { className: "button primary", text: "Save triage", attrs: { type: "submit" } });
  const triage = el("form", { className: "panel", attrs: { "aria-label": "Triage", novalidate: "" } },
    el("h3", { text: "Triage" }),
    el("p", { className: "hint", text: "Private to you: never shown to directors or producers, never in an email." }),
    el("div", { className: "form-grid" }, notes.wrapper, fit.wrapper, floor.wrapper),
    conflicts,
    el("div", { className: "actions" }, save));
  const facts = el("dl", { className: "facts" });
  const actions = el("div", { className: "actions" });
  const milestones = el("ul", { className: "milestone-list", attrs: { "aria-label": "Milestone invoices", tabindex: "-1" } });
  const milestoneBlock = el("div", { className: "milestone-invoices" }, milestones);
  milestoneBlock.hidden = true;
  const proposal = el("div", { className: "proposal-summary" });
  const status = el("p", { className: "label" });
  const heading = el("h2", { className: "mono", text: enquiry.reference, attrs: { tabindex: "-1" } });
  detail.replaceChildren(
    el("div", { className: "detail-head" },
      backToList(view, () => rows.get(enquiry.id)?.querySelector("button") ?? null), status, heading),
    el("section", { className: "panel", attrs: { "aria-label": "Brief" } }, el("h3", { text: "Brief" }), facts),
    triage,
    el("section", { className: "panel", attrs: { "aria-label": "Pipeline" } },
      el("h3", { text: "Pipeline" }), actions, milestoneBlock, proposal),
  );
  pane = {
    triage: {
      triage_notes: notes.input as HTMLTextAreaElement, fit_score: fit.input as HTMLInputElement,
      rate_floor_cents: floor.input as HTMLInputElement,
    },
    conflicts, facts, actions, milestoneBlock, milestones, invoice: null, invoiced: [], invoicing: null, generation: 0,
    proposal, status,
  };
  triage.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveTriage(triageFields);
  });
  paint(enquiry);
}

/** The pane takes the enquiry and its version; unsaved triage notes stay when asked. */
function paint(enquiry: Enquiry, keepNotes = false): void {
  if (!pane) return;
  selected = enquiry;
  upsertRow(enquiry);
  const p = pane;
  p.generation += 1;
  p.status.textContent = STATUS_LABELS[enquiry.status];
  for (const triageField of TRIAGE_FIELDS) {
    if (keepNotes && triageField.key === "triage_notes") continue;
    p.triage[triageField.key].value = triageField.text(triageField.stored(enquiry));
  }
  const fact = (term: string, value: Node | string): HTMLElement[] => [el("dt", { text: term }), el("dd", {}, value)];
  const attachment = enquiry.attachment
    ? el("a", { text: `${enquiry.attachment.filename} (${enquiry.attachment.bytes.toLocaleString("en-US")} bytes)`, attrs: { href: enquiry.attachment.url } })
    : "None";
  p.facts.replaceChildren(
    ...fact("Received", formatBusinessDate(enquiry.received_at, zone.value)),
    ...fact("Name", enquiry.name),
    ...fact("Email", enquiry.email),
    ...fact("Studio", enquiry.studio),
    ...fact("Preferred month", enquiry.preferred_month ? monthLabel(enquiry.preferred_month) : "No preference"),
    ...fact("Heard project", enquiry.project_slug ?? "None"),
    ...fact("Reference file", attachment),
    ...fact("Brief", el("span", { className: "brief-text", text: enquiry.brief })),
  );
  const buttons: HTMLButtonElement[] = [];
  const moves = PIPELINE[enquiry.status];
  if (moves.includes("qualified")) buttons.push(button("Qualify", () => void transition("qualified"), true));
  if (moves.includes("proposal_sent")) {
    const builder = button("Build proposal", () => buildProposal(builder), true);
    buttons.push(builder);
  }
  if (moves.includes("declined")) buttons.push(button("Decline", () => void transition("declined")));
  if (moves.includes("booked")) buttons.push(button("Start production", () => void transition("booked"), true));
  if (enquiry.proposal) {
    const url = `${location.origin}${enquiry.proposal.url}`;
    buttons.push(button("Copy proposal link", async () => say(await copyText(url) ? "Proposal link copied." : `Copy this link: ${url}`)));
  }
  p.actions.replaceChildren(...buttons);
  const booked = enquiry.status === "booked" && enquiry.proposal !== null;
  p.milestoneBlock.hidden = !booked;
  p.invoiced = enquiry.proposal?.invoiced_milestones ?? [];
  if (booked) paintMilestones();
  p.proposal.replaceChildren(...proposalSummary(enquiry));
}

function proposalSummary(enquiry: Enquiry): HTMLElement[] {
  const proposal = enquiry.proposal;
  if (!proposal) return [];
  const table = el("table", { className: "mini-table", attrs: { "aria-label": "Proposal milestones" } },
    el("thead", {}, el("tr", {}, ...["Milestone", "Amount"].map((h) => el("th", { text: h, attrs: { scope: "col" } })))),
    el("tbody", {}, ...proposal.milestones.map((m) => el("tr", {},
      el("td", { text: `${m.number}. ${m.name} (${m.percent}%)` }),
      el("td", { className: "amount mono", text: `$${formatUsd(m.amount_cents)}` })))));
  const badges = emailBadges(enquiry, EMAILS.slice(1));
  return [
    el("dl", { className: "facts" },
      el("dt", { text: "Producer" }), el("dd", { text: `${proposal.producer_name} <${proposal.producer_email}>` }),
      el("dt", { text: "Project" }), el("dd", { text: proposal.project_title }),
      el("dt", { text: "Fee" }), el("dd", { className: "mono", text: `$${formatUsd(proposal.fee_cents)}` }),
      el("dt", { text: "Month" }), el("dd", { text: monthLabel(proposal.production_month) }),
      el("dt", { text: "Accept by" }), el("dd", { text: formatBusinessDate(proposal.expires_at, zone.value) })),
    el("div", { className: "row-badges" }, ...badges),
    table,
  ];
}

/** A 412 on any write but "Save triage": the pane loads the newer enquiry and keeps unsaved notes. */
function loadStale(current: Enquiry): void {
  paint(current, typedNotes());
  say(STALE);
}

/**
 * Every console enquiry write sends the pane's version and only its own fields. A 412 hands the newer enquiry to
 * `onStale` and answers null, as does an answer that arrives after the pane moved to another enquiry.
 */
async function write<T>(
  method: string, path: string, body: unknown, onStale: (current: Enquiry) => void = loadStale,
): Promise<Answer<T> | null> {
  if (!selected) return null;
  const owner = pane;
  const answer = await request<T & Refusal>(`/api/console/enquiries/${selected.id}${path}`, {
    method, json: body, headers: { "If-Match": `"${selected.version}"` },
  });
  if (pane !== owner) return null;
  if (answer.status === 412 && answer.body.current) {
    onStale(answer.body.current);
    return null;
  }
  return answer;
}

/** Says the copy for a 503 and reports whether the write met one. */
function unavailable(answer: Answer<unknown>): boolean {
  if (answer.status !== 503) return false;
  say(answer.body.error === "billing_unavailable" ? BILLING_DOWN : "The console could not reach a service. Try again shortly.");
  return true;
}

// ---- Triage and the stale-save merge ----

interface Conflict {
  triageField: (typeof TRIAGE_FIELDS)[number];
  theirs: TriageValue;
  /** The field's text when the merge ran. */
  mine: string;
}

function conflictEntry(control: HTMLInputElement | HTMLTextAreaElement, { triageField, theirs, mine }: Conflict): HTMLElement {
  const choice = (label: string, text: string, checked: boolean): HTMLElement => {
    const radio = el("input", { attrs: { type: "radio", name: `merge-${triageField.key}` } });
    radio.checked = checked;
    radio.addEventListener("change", () => {
      control.value = text;
    });
    return el("label", { className: "choice" }, radio, label);
  };
  const labelId = `merge-${triageField.key}-label`;
  return el("div", { className: "conflict" },
    el("p", { className: "label", text: triageField.label, attrs: { id: labelId } }),
    el("p", { className: "brief-text", text: `Theirs: ${triageField.written(theirs)}` }),
    el("p", { className: "brief-text", text: `Yours: ${triageField.written(triageField.typed(mine))}` }),
    el("div", { className: "choices", attrs: { role: "radiogroup", "aria-labelledby": labelId } },
      choice("Keep mine", mine, true),
      choice("Use theirs", triageField.text(theirs), false)));
}

function showConflicts(conflicts: Conflict[]): void {
  if (!pane) return;
  const p = pane;
  p.conflicts.hidden = conflicts.length === 0;
  p.conflicts.replaceChildren(...(conflicts.length === 0 ? [] : [
    el("h4", { text: "Changed in another window" }),
    ...conflicts.map((conflict) => conflictEntry(p.triage[conflict.triageField.key], conflict)),
  ]));
}

/**
 * A "Save triage" answering 412 merges each triage field against the value last loaded: a field only the other
 * window changed takes theirs, a field only this pane changed keeps what was typed, and a field both changed to
 * different values is a conflict for the operator to choose. The response becomes the value last loaded.
 */
function mergeTriage(current: Enquiry): void {
  if (!pane || !selected) return;
  const p = pane;
  const loaded = selected;
  const merged = TRIAGE_FIELDS.map((triageField) => {
    const mine = p.triage[triageField.key].value;
    const typed = triageField.typed(mine);
    const was = triageField.stored(loaded);
    const theirs = triageField.stored(current);
    const changedThere = theirs !== was;
    return {
      triageField, theirs, mine,
      text: changedThere && typed === was ? triageField.text(theirs) : mine,
      conflict: changedThere && typed !== was && typed !== theirs,
    };
  });
  paint(current);
  for (const { triageField, text } of merged) p.triage[triageField.key].value = text;
  const conflicts = merged.filter((entry) => entry.conflict);
  showConflicts(conflicts);
  say(conflicts.length
    ? "This enquiry changed in another window. Choose which value to keep for each field shown, then save again."
    : "This enquiry changed in another window. Their changes are merged in; save again to apply yours.");
}

async function saveTriage(fields: Record<TriageKey, Field>): Promise<void> {
  if (!pane) return;
  const p = pane;
  const body = Object.fromEntries(TRIAGE_FIELDS.map((triageField) => [triageField.key, triageField.typed(p.triage[triageField.key].value)]));
  const answer = await write<{ enquiry: Enquiry }>("PATCH", "", body, mergeTriage);
  if (!answer || unavailable(answer)) return;
  if (answer.status === 200) {
    showErrors(fields, {});
    paint(answer.body.enquiry);
    showConflicts([]);
    say("Triage saved.");
  } else if (answer.status === 422) {
    showErrors(fields, answer.body.errors ?? {})?.focus();
    say("Check the highlighted fields.");
  }
}

async function transition(to: "qualified" | "declined" | "booked"): Promise<void> {
  const answer = await write<{ enquiry: Enquiry }>("POST", "/transition", { to });
  if (!answer || unavailable(answer)) return;
  if (answer.status === 200) {
    paint(answer.body.enquiry, typedNotes());
    say(to === "booked" ? "Production started." : to === "qualified" ? `${answer.body.enquiry.reference} is qualified.` : `${answer.body.enquiry.reference} is declined.`);
  } else {
    say("That move isn’t allowed from the current state.");
  }
}

// ---- Milestone invoices ----

type InvoiceState = "not-invoiced" | "invoicing" | "invoiced";

const INVOICE_STATE_COPY: Record<InvoiceState, string> = {
  "not-invoiced": "Not invoiced", invoicing: "Invoicing…", invoiced: "Invoiced",
};

/**
 * Draws milestones 2 to 4 from the pane's invoiced list and pending request, with the single "Invoice milestone <n>"
 * button under the list for the first one not invoiced. When the focused button goes, focus moves to the list.
 */
function paintMilestones(): void {
  if (!pane || !selected?.proposal) return;
  const p = pane;
  const later = selected.proposal.milestones.slice(1);
  const state = (number: number): InvoiceState =>
    p.invoiced.includes(number) ? "invoiced" : number === p.invoicing ? "invoicing" : "not-invoiced";
  p.milestones.replaceChildren(...later.map((m) => el("li",
    { attrs: { "data-milestone": String(m.number), "data-state": state(m.number) } },
    `Milestone ${m.number}: ${m.name}, `,
    el("span", { className: "mono", text: `$${formatUsd(m.amount_cents)}` }),
    `. ${INVOICE_STATE_COPY[state(m.number)]}`)));
  const next = p.invoicing === null ? later.find((m) => state(m.number) === "not-invoiced")?.number ?? null : null;
  if (p.invoice?.dataset.milestone === String(next)) return;
  const hadFocus = p.invoice !== null && document.activeElement === p.invoice;
  p.invoice?.remove();
  p.invoice = null;
  if (next !== null) {
    const invoice = button(`Invoice milestone ${next}`, () => void invoiceMilestone(next), true);
    invoice.dataset.milestone = String(next);
    p.milestones.after(invoice);
    p.invoice = invoice;
  }
  if (hadFocus) p.milestones.focus();
}

/** The milestone is shown as invoicing at once; the answer confirms it or the view returns to the server's state. */
async function invoiceMilestone(number: number): Promise<void> {
  if (!pane || !selected) return;
  const p = pane;
  const id = selected.id;
  p.invoicing = number;
  paintMilestones();
  p.milestones.focus();
  const answer = await write<{ enquiry: Enquiry; milestone: { amount_cents: number; invoice_date: string } }>(
    "POST", `/milestones/${number}/invoice`, {}, (current) => {
      p.invoicing = null;
      paint(current, typedNotes());
      say("This enquiry changed in another window. The milestones shown are the current state.");
    });
  if (!answer) return;
  if (answer.status === 201) {
    p.invoicing = null;
    paint(answer.body.enquiry, typedNotes());
    const { amount_cents: amount, invoice_date: day } = answer.body.milestone;
    say(`Milestone ${number} invoiced: $${formatUsd(amount)} on ${formatCalendarDate(day)}.`);
    return;
  }
  say(answer.status === 0
    ? `The request for milestone ${number} got no answer. The milestones shown are the current state.`
    : answer.status === 503 && answer.body.error === "billing_unavailable"
      ? BILLING_DOWN
      : answer.body.error === "milestone_mismatch"
        ? `Kill Bill already holds a different amount for milestone ${number}. Nothing was invoiced.`
        : `Milestone ${number} was not invoiced. The milestones shown are the current state.`);
  const reread = await request<{ enquiry: Enquiry }>(`/api/console/enquiries/${id}`);
  if (pane !== p) return;
  p.invoicing = null;
  if (reread.status === 200) paint(reread.body.enquiry, typedNotes());
  else paintMilestones();
}

/**
 * The second-tab re-read: while the pane shows a booked enquiry with a milestone not invoiced and no invoice request
 * pending, it reads the enquiry again and updates only the milestone list and its button.
 */
async function followInvoices(): Promise<void> {
  const p = pane;
  const enquiry = selected;
  if (!p || !enquiry?.proposal || enquiry.status !== "booked" || p.invoicing !== null) return;
  if (enquiry.proposal.milestones.slice(1).every((m) => p.invoiced.includes(m.number))) return;
  const generation = p.generation;
  const answer = await request<{ enquiry: Enquiry }>(`/api/console/enquiries/${enquiry.id}`);
  if (answer.status !== 200 || pane !== p || p.generation !== generation || p.invoicing !== null) return;
  p.invoiced = answer.body.enquiry.proposal?.invoiced_milestones ?? [];
  paintMilestones();
}

// ---- Build proposal ----

function buildProposal(opener: HTMLButtonElement): void {
  const enquiry = selected;
  if (!enquiry) return;
  const dialog = byId("proposal-dialog");
  const form = byId<HTMLFormElement>("proposal-form");
  const send = byId<HTMLButtonElement>("send-proposal");
  const fullNote = byId("pf-production_month-full");
  const fields = Object.fromEntries(PROPOSAL_WRITABLE.map((key) => {
    const control = byId<HTMLInputElement>(`pf-${key}`);
    return [key, { wrapper: control.parentElement as HTMLDivElement, input: control, error: byId<HTMLParagraphElement>(`pf-${key}-error`) }];
  })) as Record<(typeof PROPOSAL_WRITABLE)[number], Field>;
  for (const entry of Object.values(fields)) entry.input.value = "";
  showErrors(fields, {});
  byId("preview-rows").replaceChildren();
  const months = fields.production_month.input as HTMLSelectElement;
  months.replaceChildren();
  const cancel = form.querySelector<HTMLButtonElement>("[data-cancel]");
  let previewTimer = 0;
  let open = true;
  /** The production month the operator has chosen; it stays selected while it is full. */
  let chosen: string | null = null;
  const feeInput = fields.fee_cents.input;
  const refreshPreview = (): void => {
    window.clearTimeout(previewTimer);
    const cents = decimalToCents(feeInput.value);
    previewTimer = window.setTimeout(async () => {
      if (cents === null) {
        byId("preview-rows").replaceChildren();
        return;
      }
      const answer = await request<{ milestones: Milestone[] }>("/api/console/milestones/preview", { method: "POST", json: { fee_cents: cents } });
      byId("preview-rows").replaceChildren(...(answer.status === 200 ? answer.body.milestones : []).map((m) => el("tr", {},
        el("td", { text: m.name }), el("td", { className: "mono", text: `${m.percent}%` }),
        el("td", { className: "amount mono", text: `$${formatUsd(m.amount_cents)}` }))));
    }, 300);
  };
  /** While the selected month is full, the month-full copy describes the combobox and "Send proposal" is disabled. */
  const showFullness = (): void => {
    const option = months.selectedOptions[0];
    fullNote.textContent = option?.disabled ? `${monthLabel(option.value)} is now full. Choose another production month.` : "";
    send.disabled = option?.disabled ?? false;
  };
  const chooseMonth = (): void => {
    chosen = months.value;
    showFullness();
  };
  /** Marks months full or open again in place, never moving focus or touching the other fields. */
  const readMonths = async (): Promise<void> => {
    const answer = await request<{ months: ProductionMonth[] }>("/api/console/months");
    if (answer.status !== 200 || !open) return;
    const shown = new Map([...months.options].map((option) => [option.value, option]));
    const options = answer.body.months.map((month) => {
      const option = shown.get(month.month) ?? new Option(month.label, month.month);
      const label = month.open ? month.label : `${month.label} (full)`;
      if (option.text !== label) option.text = label;
      option.disabled = !month.open;
      if (month.open) option.removeAttribute("aria-disabled");
      else option.setAttribute("aria-disabled", "true");
      return option;
    });
    if (options.length !== months.options.length || options.some((option, index) => months.options[index] !== option)) {
      months.replaceChildren(...options);
    }
    const keep = options.find((option) => option.value === chosen) ?? options.find((option) => !option.disabled) ?? options[0];
    if (keep && !keep.selected) keep.selected = true;
    chosen = keep?.value ?? null;
    showFullness();
  };
  const submit = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    const cents = decimalToCents(feeInput.value);
    const body: Record<(typeof PROPOSAL_WRITABLE)[number], unknown> = {
      producer_name: fields.producer_name.input.value,
      producer_email: fields.producer_email.input.value,
      project_title: fields.project_title.input.value,
      scope: fields.scope.input.value,
      fee_cents: cents ?? feeInput.value,
      production_month: months.value,
    };
    const answer = await write<{ enquiry: Enquiry }>("POST", "/proposal", body);
    if (!answer || unavailable(answer)) {
      handle.close();
      return;
    }
    if (answer.status === 201) {
      handle.close();
      paint(answer.body.enquiry, typedNotes());
      (detail.querySelector("h2") as HTMLElement | null)?.focus();
      say(answer.body.enquiry.proposal?.email === "sent"
        ? `Proposal sent to ${body.producer_email}.`
        : "Proposal saved. The email is queued and will go out when mail is reachable.");
    } else if (answer.status === 422) {
      showErrors(fields, answer.body.errors ?? {})?.focus();
      say("Check the highlighted fields.");
    } else {
      say("That move isn’t allowed from the current state.");
    }
  };
  const close = (): void => handle.close();
  const handle = openDialog(dialog, {
    background: [byId("console-main")], returnTo: opener, initial: fields.producer_name.input, rise: true,
    onClose: () => {
      open = false;
      stopMonths();
      window.clearTimeout(previewTimer);
      fullNote.textContent = "";
      send.disabled = false;
      feeInput.removeEventListener("input", refreshPreview);
      months.removeEventListener("change", chooseMonth);
      form.removeEventListener("submit", submit);
      cancel?.removeEventListener("click", close);
    },
  });
  feeInput.addEventListener("input", refreshPreview);
  months.addEventListener("change", chooseMonth);
  form.addEventListener("submit", submit);
  cancel?.addEventListener("click", close);
  const stopMonths = poll(readMonths);
}

export function setupEnquiries(): void {
  filter.addEventListener("change", () => {
    fromFirstPage();
    void reload();
  });
  more.addEventListener("click", () => void loadOlder());
}
