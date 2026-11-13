// keyboard.ts — the published single-key shortcuts, working with focus
// anywhere on the calendar screen, off in text fields and open dialogs.

import { navigate } from "./main";

const SHORTCUTS: [string, string][] = [];

function registerShortcut(key: string, label: string): void {
  SHORTCUTS.push([key, label]);
}

export function shortcutList(): [string, string][] {
  return SHORTCUTS.slice();
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shiftDate(days: number): void {
  const current = new URLSearchParams(location.search);
  const date = current.get("date") ?? todayISO();
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  navigate("/calendar", {
    view: current.get("view") ?? "week",
    date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
  });
}

export function openGoToDate(): void {
  void import("./dom").then(({ dialog, button, textbox }) => {
    const dlg = dialog("Go to date");
    const box = textbox("Date", "");
    const go = button("Go", { class: "btn accent", onclick: () => {
      dlg.close();
      navigate("/calendar", { view: new URLSearchParams(location.search).get("view") ?? "week", date: box.value });
    } }, "Go");
    const cancel = button("Cancel", { class: "btn ghost", onclick: () => dlg.close() }, "Cancel");
    dlg.append(box, go, cancel);
    document.body.appendChild(dlg);
    dlg.showModal();
    box.focus();
    dlg.addEventListener("close", () => dlg.remove());
  });
}

export function openShortcutsDialog(): void {
  void import("./dom").then(({ dialog, button, h }) => {
    const dlg = dialog("Keyboard shortcuts");
    const list = h("ul", { "aria-label": "Shortcuts", class: "shortcuts" });
    for (const [key, label] of shortcutList()) {
      list.appendChild(h("li", null, `${key} — ${label}`));
    }
    const close = button("Close", { class: "btn ghost", onclick: () => dlg.close() }, "Close");
    dlg.append(list, close);
    document.body.appendChild(dlg);
    dlg.showModal();
    close.focus();
    dlg.addEventListener("close", () => dlg.remove());
  });
}

export function handleGlobalKey(e: KeyboardEvent): void {
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) {
    return;
  }
  if (document.querySelector("dialog[open]")) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key.toLowerCase();
  const current = new URLSearchParams(location.search);
  const date = current.get("date") ?? todayISO();
  const toCalendar = (q: Record<string, string | undefined>) => {
    e.preventDefault();
    navigate("/calendar", q);
  };
  const views: Record<string, string> = { d: "day", "1": "day", w: "week", "2": "week", m: "month", "3": "month", x: "custom", "4": "custom", a: "schedule", "5": "schedule" };
  if (views[key]) {
    toCalendar({ view: views[key], date });
    return;
  }
  switch (key) {
    case "t":
      toCalendar({ view: current.get("view") ?? undefined, date: todayISO() });
      break;
    case "j":
      e.preventDefault();
      shiftDate(1);
      break;
    case "k":
      e.preventDefault();
      shiftDate(-1);
      break;
    case "g":
      e.preventDefault();
      openGoToDate();
      break;
    case "c":
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("wren:new-event"));
      break;
    case "z":
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("wren:undo"));
      break;
    case "/":
      e.preventDefault();
      navigate("/search", {});
      break;
    case "s":
      e.preventDefault();
      navigate("/settings", {});
      break;
    case "?":
      e.preventDefault();
      openShortcutsDialog();
      break;
    case "e":
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("wren:open-focused"));
      break;
    case "delete":
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("wren:delete-focused"));
      break;
  }
}

registerShortcut("1 or D", "Day");
registerShortcut("2 or W", "Week");
registerShortcut("3 or M", "Month");
registerShortcut("4 or X", "Custom days");
registerShortcut("5 or A", "Schedule");
registerShortcut("T", "Today");
registerShortcut("J", "Next period");
registerShortcut("K", "Previous period");
registerShortcut("G", "Go to a date");
registerShortcut("C", "New event");
registerShortcut("E", "Open the focused event");
registerShortcut("Z", "Undo");
registerShortcut("Delete", "Delete the focused event");
registerShortcut("/", "Search");
registerShortcut("S", "Settings");
registerShortcut("?", "This list");
