import "../styles/fonts.css";
import "../styles/base.css";
import "../styles/console.css";

import { byId, request } from "../lib/api.js";
import { closeOpenDialog } from "../lib/dialog.js";
import { addMonths, monthKeyAt, monthLabel } from "../../shared/dates.js";
import { setupEnquiries, startEnquiries } from "./enquiries.js";
import { loadProjects, setupProjects } from "./projects.js";
import { el, poll, say, zone } from "./ui.js";

type View = "projects" | "enquiries" | "months" | "settings";
const VIEWS: View[] = ["projects", "enquiries", "months", "settings"];

const nav = byId("console-nav");
const signOut = byId<HTMLButtonElement>("sign-out");

interface Settings {
  time_zone: string;
  operator_email: string;
}

function currentView(): View {
  const hash = location.hash.slice(1) as View;
  return VIEWS.includes(hash) ? hash : "projects";
}

/** Stops the open view's live re-reads; every view's polling ends when another view opens. */
let stopLive = (): void => {};

function show(view: View | "signin"): void {
  byId("signin-view").hidden = view !== "signin";
  for (const name of VIEWS) byId(`${name}-view`).hidden = name !== view;
  for (const link of nav.querySelectorAll<HTMLAnchorElement>("a")) {
    if (link.dataset.view === view) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  stopLive();
  stopLive = view === "enquiries" ? startEnquiries()
    : view === "months" ? startMonths()
      : view === "settings" ? startMailQueue()
        : () => {};
  if (view === "projects") void loadProjects();
  if (view === "settings") void loadSettings();
}

function signedIn(settings: Settings): void {
  zone.value = settings.time_zone;
  nav.hidden = false;
  signOut.hidden = false;
  show(currentView());
}

function signedOut(): void {
  nav.hidden = true;
  signOut.hidden = true;
  show("signin");
}

// ---- Sign in ----

byId<HTMLFormElement>("signin-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  say("Signing in…");
  const answer = await request<{ operator?: { email: string } }>("/api/console/session", {
    method: "POST",
    json: { email: byId<HTMLInputElement>("signin-email").value, password: byId<HTMLInputElement>("signin-password").value },
  });
  if (answer.status !== 200) {
    say("That email and password don’t match.");
    byId<HTMLInputElement>("signin-password").focus();
    return;
  }
  byId<HTMLInputElement>("signin-password").value = "";
  const settings = await request<Settings>("/api/console/settings");
  say("");
  if (settings.status === 200) signedIn(settings.body);
});

signOut.addEventListener("click", async () => {
  await request("/api/console/session", { method: "DELETE" });
  say("Signed out.");
  signedOut();
});

window.addEventListener("hashchange", () => {
  closeOpenDialog();
  if (!nav.hidden) show(currentView());
});

// ---- Months ----

interface MonthRow {
  month: string;
  label: string;
  capacity: number;
  claimed: number;
}

interface MonthEntry {
  row: HTMLTableRowElement;
  input: HTMLInputElement;
  error: HTMLElement;
  claimed: HTMLElement;
  /** The capacity at the last load or save. */
  saved: number;
  /** Whether the operator has changed the capacity since the last load or save. */
  edited: boolean;
}

const monthRows = byId("month-rows");
const monthInputs = new Map<string, MonthEntry>();

function monthEntry(row: MonthRow): MonthEntry {
  const input = el("input", { attrs: { type: "number", min: "0", max: "12", step: "1", "aria-label": `Capacity for ${row.label}` } });
  const error = el("p", { className: "field-error" });
  input.setAttribute("aria-describedby", `capacity-error-${row.month}`);
  error.id = `capacity-error-${row.month}`;
  const claimed = el("td", { className: "mono" });
  const entry: MonthEntry = {
    row: el("tr", {}, el("th", { text: row.label, attrs: { scope: "row" } }), el("td", {}, input, error), claimed),
    input, error, claimed, saved: row.capacity, edited: false,
  };
  input.addEventListener("input", () => {
    entry.edited = true;
  });
  return entry;
}

/**
 * Reads the months and updates the table in place: new months get rows, every "Claimed" cell follows the server,
 * and a capacity takes the server's value unless the operator changed it since the last load or save (`saved` true
 * overrides every capacity). Focus never moves.
 */
async function loadMonths(saved = false): Promise<void> {
  const answer = await request<{ months: MonthRow[] }>("/api/console/months");
  if (answer.status !== 200) return;
  const stored = new Map(answer.body.months.map((row) => [row.month, row]));
  const current = monthKeyAt(new Date(), zone.value);
  for (let i = 0; i < 12; i += 1) {
    const month = addMonths(current, i);
    if (!stored.has(month)) stored.set(month, { month, label: monthLabel(month), capacity: 0, claimed: 0 });
  }
  for (const row of [...stored.values()].sort((a, b) => (a.month < b.month ? -1 : 1))) {
    let entry = monthInputs.get(row.month);
    if (!entry) {
      entry = monthEntry(row);
      monthInputs.set(row.month, entry);
      const later = [...monthInputs.entries()].filter(([month]) => month > row.month).sort(([a], [b]) => (a < b ? -1 : 1))[0];
      monthRows.insertBefore(entry.row, later?.[1].row ?? null);
    }
    if (saved || !entry.edited) {
      entry.input.value = String(row.capacity);
      entry.saved = row.capacity;
      entry.edited = false;
    }
    entry.claimed.textContent = String(row.claimed);
  }
}

/** Opens the Months view with a fresh table, read now and every two seconds while it stays open. */
function startMonths(): () => void {
  monthInputs.clear();
  monthRows.replaceChildren();
  return poll(loadMonths);
}

byId("save-months").addEventListener("click", async () => {
  let failed = false;
  let storage = false;
  for (const [month, entry] of monthInputs) {
    entry.error.textContent = "";
    entry.input.removeAttribute("aria-invalid");
    const capacity = Number(entry.input.value);
    if (entry.input.value.trim() === "" || capacity === entry.saved) continue;
    const answer = await request<{ errors?: Record<string, string> }>(`/api/console/months/${month}`, {
      method: "PUT",
      json: { capacity: Number.isInteger(capacity) ? capacity : entry.input.value },
    });
    if (answer.status === 200) continue;
    failed = true;
    storage ||= answer.status === 503;
    entry.error.textContent = answer.body.errors?.capacity ?? answer.body.errors?.month ?? "This capacity could not be saved.";
    entry.input.setAttribute("aria-invalid", "true");
  }
  if (!failed) {
    say("Months saved.");
    await loadMonths(true);
  } else {
    say(storage ? "The console could not reach a service. Try again shortly." : "Check the highlighted fields.");
  }
});

// ---- Settings ----

async function loadSettings(): Promise<void> {
  const answer = await request<Settings>("/api/console/settings");
  if (answer.status !== 200) return;
  const select = byId<HTMLSelectElement>("time-zone");
  const zones = Intl.supportedValuesOf("timeZone");
  if (!zones.includes(answer.body.time_zone)) zones.unshift(answer.body.time_zone);
  select.replaceChildren(...zones.map((name) => new Option(name.replaceAll("_", " "), name)));
  select.value = answer.body.time_zone;
  byId("operator-email").textContent = `New-brief alerts go to ${answer.body.operator_email}.`;
}

byId("save-settings").addEventListener("click", async () => {
  const answer = await request<Settings>("/api/console/settings", {
    method: "PUT", json: { time_zone: byId<HTMLSelectElement>("time-zone").value },
  });
  if (answer.status === 200) {
    zone.value = answer.body.time_zone;
    say("Settings saved.");
  } else {
    say("Choose a time zone from the list.");
  }
});

// ---- Mail queue ----

type MailKind = "receipt" | "alert" | "proposal" | "month_held" | "deposit";

interface QueuedEmail {
  kind: MailKind;
  reference: string;
  to: string;
  queued_at: string;
  retry_at: string | null;
}

const MAIL_KIND_LABELS: Record<MailKind, string> = {
  receipt: "Receipt", alert: "New-brief alert", proposal: "Proposal email", month_held: "Month-held email", deposit: "Deposit email",
};

const pendingEmails = byId("pending-emails");
const mailQueueNote = byId("mail-queue-note");

/** "Sending" while no try is scheduled, "Next try in <s>s" before it, "Retrying" from it on. */
function countdown(email: QueuedEmail, now: number): string {
  if (email.retry_at === null) return "Sending";
  const left = Date.parse(email.retry_at) - now;
  return left > 0 ? `Next try in ${Math.ceil(left / 1000)}s` : "Retrying";
}

/**
 * Opens the Settings view's "Mail queue": it reads the queue now and every two seconds, and redraws each countdown
 * once a second from the server's clock (its offset from this page's clock is noted on each read). A failed read
 * keeps the items and their countdowns running. Nothing here moves focus or touches the time zone form.
 */
function startMailQueue(): () => void {
  let emails: QueuedEmail[] = [];
  let offset = 0;
  let failed = false;
  let open = true;
  pendingEmails.replaceChildren();
  mailQueueNote.textContent = "";
  const draw = (): void => {
    const now = Date.now() + offset;
    pendingEmails.replaceChildren(...emails.map((email) => el("li", {
      text: `${MAIL_KIND_LABELS[email.kind]} for ${email.reference} to ${email.to}. ${countdown(email, now)}`,
      attrs: { "data-kind": email.kind },
    })));
    mailQueueNote.textContent = failed
      ? "The mail queue could not refresh. Retrying…"
      : emails.length === 0 ? "No emails are waiting." : "";
  };
  const read = async (): Promise<void> => {
    const answer = await request<{ server_time: string; emails: QueuedEmail[] }>("/api/console/mail-queue");
    if (!open) return;
    failed = answer.status !== 200;
    if (!failed) {
      offset = Date.parse(answer.body.server_time) - Date.now();
      emails = answer.body.emails;
    }
    draw();
  };
  const stopReads = poll(read);
  const ticker = window.setInterval(draw, 1000);
  return () => {
    open = false;
    stopReads();
    window.clearInterval(ticker);
  };
}

// ---- Start ----

const header = document.querySelector<HTMLElement>(".console-header");
const measureHeader = (): void => {
  if (header) document.documentElement.style.setProperty("--header-height", `${header.offsetHeight}px`);
};
new ResizeObserver(measureHeader).observe(header ?? document.body);

setupProjects();
setupEnquiries();
void request<Settings>("/api/console/settings").then((answer) => {
  if (answer.status === 200) signedIn(answer.body);
  else signedOut();
});
