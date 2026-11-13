// The shared navigation, the notices dialog, the keyboard list and the
// reminder regions every signed-in screen carries.

import { api, type Reminder } from "./api";
import { el, on } from "./dom";
import { openDialog } from "./dialogs";
import { firedReminders } from "./live";
import { announce, state, changed } from "./state";
import { go } from "./router";

export function mainNavigation(): HTMLElement {
  const nav = el("nav", { "aria-label": "Main", class: "main-nav" });
  const links: [string, string][] =
    state.me?.role === "guest"
      ? [
          ["/calendar", "Calendar"],
          ["/settings", "Settings"],
        ]
      : [
          ["/calendar", "Calendar"],
          ["/find", "Find a time"],
          ["/search", "Search"],
          ["/trash", "Trash"],
          ["/zone-rules", "Zone rules"],
          ["/sharing", "Sharing"],
          ["/settings", "Settings"],
        ];
  if (state.me?.role === "office_manager") links.splice(links.length - 1, 0, ["/prints", "Prints"]);
  for (const [href, label] of links) {
    const link = el("a", { href, text: label });
    on(link, "click", (event: MouseEvent) => {
      event.preventDefault();
      go(href);
    });
    nav.append(link);
  }
  const signOut = el("button", { type: "button", text: "Sign out" });
  on(signOut, "click", async () => {
    await api.signOut();
    window.location.href = "/";
  });
  nav.append(signOut);
  return nav;
}

export function openNotices(opener: HTMLElement | null): void {
  openDialog({ title: "Notices", opener }, (body) => {
    const list = el("ul", { role: "list", "aria-label": "Notices", class: "notices" });
    if (state.notices.length === 0) {
      list.append(el("li", { text: "No notices yet." }));
    }
    for (const notice of state.notices) {
      list.append(el("li", { text: notice.text }));
    }
    body.append(el("h2", { text: "Notices" }), list);
  });
}

const SHORTCUTS: [string, string][] = [
  ["1 or D", "Day"],
  ["2 or W", "Week"],
  ["3 or M", "Month"],
  ["4 or X", "Custom days"],
  ["5 or A", "Schedule"],
  ["T", "Today"],
  ["J", "Next period"],
  ["K", "Previous period"],
  ["G", "Go to a date"],
  ["C", "New event"],
  ["E", "Open the focused event's page"],
  ["Z", "Undo"],
  ["Delete", "Delete the focused event"],
  ["/", "Search"],
  ["S", "Settings"],
  ["?", "This list of shortcuts"],
];

export function openShortcuts(opener: HTMLElement | null): void {
  openDialog({ title: "Keyboard shortcuts", opener }, (body) => {
    const list = el("ul", { role: "list", "aria-label": "Shortcuts", class: "shortcuts" });
    for (const [keys, what] of SHORTCUTS) {
      list.append(el("li", { text: `${keys} — ${what}` }));
    }
    body.append(el("h2", { text: "Keyboard shortcuts" }), list);
  });
}

export function openGoToDate(opener: HTMLElement | null, onGo: (date: string) => void): void {
  openDialog({ title: "Go to date", opener }, (body, dialog) => {
    const input = el("input", { type: "text", "aria-label": "Date", placeholder: "YYYY-MM-DD" });
    const error = el("p", { class: "field-error" });
    const button = el("button", { type: "button", class: "primary", text: "Go" });
    on(button, "click", () => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.value.trim())) {
        error.textContent = "Use YYYY-MM-DD.";
        return;
      }
      const chosen = input.value.trim();
      dialog.close(false);
      onGo(chosen);
    });
    body.append(
      el("h2", { text: "Go to date" }),
      el("label", { class: "field" }, [el("span", { text: "Date" }), input]),
      error,
      el("div", { class: "row buttons" }, [button]),
    );
  });
}

/** reminderRegions draws one region per fired reminder of this person. */
export function reminderRegions(): HTMLElement {
  const holder = el("div", { class: "reminders" });
  for (const reminder of firedReminders.values()) {
    holder.append(reminderRegion(reminder));
  }
  return holder;
}

function reminderRegion(reminder: Reminder): HTMLElement {
  const select = el("select", { "aria-label": "Snooze for" });
  for (const minutes of [5, 10, 30]) {
    select.append(el("option", { value: String(minutes), text: `${minutes} minutes` }));
  }
  const snooze = el("button", { type: "button", text: "Snooze" });
  const dismiss = el("button", { type: "button", text: "Dismiss" });
  const region = el("div", { role: "region", "aria-label": `Reminder: ${reminder.title}`, class: "reminder" }, [
    el("p", { text: reminderText(reminder) }),
    el("label", { class: "field" }, [el("span", { text: "Snooze for" }), select]),
    snooze,
    dismiss,
  ]);
  on(snooze, "click", async () => {
    const minutes = Number(select.value);
    announce(`Snoozing ${reminder.title}...`);
    try {
      await api.snooze(reminder.id, minutes);
      announce(`Snoozed ${reminder.title} for ${minutes} minutes.`);
    } catch (error) {
      announce((error as Error).message);
    }
    firedReminders.delete(reminder.id);
    changed();
  });
  on(dismiss, "click", () => {
    firedReminders.delete(reminder.id);
    changed();
  });
  return region;
}

const reminderTexts = new Map<string, string>();

function reminderText(reminder: Reminder): string {
  return reminderTexts.get(reminder.id) ?? `Reminder: ${reminder.title}.`;
}
