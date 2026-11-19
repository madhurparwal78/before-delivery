/** The command palette: Control+K or Command+K from anywhere in the cockpit. */
import { SEARCH_MAX, SEARCH_MIN } from "../../shared/rules.js";
import { clear, h, openModal } from "../shared/dom.js";
import { after } from "../shared/timers.js";
import { Latest } from "./latest.js";
import { codePoints, searchFor } from "./search.js";

const PAUSE_MS = 250;

const PAGES = [
  { name: "Approvals", href: "/approvals" },
  { name: "Send payment", href: "/payments/new" },
  { name: "Recipients", href: "/payments/recipients" },
  { name: "Payments", href: "/payments" },
  { name: "Invoicing", href: "/invoices" },
  { name: "Loans", href: "/loans" },
];

interface Option {
  label: string;
  href: string;
  group: "Pages" | "Recipients";
}

export function installPalette(): void {
  document.addEventListener(
    "keydown",
    (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      if (document.querySelector("dialog[open]")) return;
      openPalette();
    },
    true,
  );
}

function openPalette(): void {
  const opener = document.activeElement as HTMLElement | null;
  const input = h("input", { class: "palette-input", type: "text", role: "textbox", "aria-label": "Search commands", "aria-controls": "palette-list", autocomplete: "off", spellcheck: "false", placeholder: "Search commands" });
  const list = h("div", { id: "palette-list", role: "listbox", "aria-label": "Commands", class: "palette-list" });
  const dialog = h("dialog", { class: "dialog palette", "aria-label": "Command palette" }, input, list);

  const latest = new Latest();
  let recipients: Option[] = [];
  let options: Option[] = [];
  let highlighted = 0;
  let cancelPause: (() => void) | null = null;

  function render(): void {
    const text = input.value.trim().toLowerCase();
    const pages: Option[] = PAGES.filter((page) => page.name.toLowerCase().includes(text)).map((page) => ({ label: page.name, href: page.href, group: "Pages" }));
    options = [...pages, ...recipients];
    if (highlighted >= options.length) highlighted = Math.max(0, options.length - 1);
    clear(list);
    let index = 0;
    for (const group of ["Pages", "Recipients"] as const) {
      const members = options.filter((option) => option.group === group);
      if (members.length === 0) continue;
      const heading = h("p", { class: "palette-group", id: `palette-${group}` }, group);
      const items = members.map((option) => {
        const position = index++;
        const element = h("div", { role: "option", id: `palette-option-${position}`, class: "palette-option", "aria-selected": String(position === highlighted) }, option.label);
        element.addEventListener("click", () => location.assign(option.href));
        element.addEventListener("pointermove", () => {
          highlighted = position;
          mark();
        });
        return element;
      });
      list.append(h("div", { role: "group", "aria-labelledby": `palette-${group}` }, heading, ...items));
    }
    mark();
  }

  function mark(): void {
    list.querySelectorAll('[role="option"]').forEach((element, position) => element.setAttribute("aria-selected", String(position === highlighted)));
    const active = list.querySelector(`#palette-option-${highlighted}`);
    if (active) input.setAttribute("aria-activedescendant", active.id);
    else input.removeAttribute("aria-activedescendant");
  }

  input.addEventListener("input", () => {
    cancelPause?.();
    latest.invalidate();
    recipients = [];
    highlighted = 0;
    render();
    const text = input.value.trim();
    const length = codePoints(text);
    if (length < SEARCH_MIN || length > SEARCH_MAX) return;
    const ticket = latest.begin();
    cancelPause = after(async () => {
      const answer = await searchFor(text);
      if (!answer || !latest.isCurrent(ticket) || input.value.trim() !== text) return;
      recipients = answer.recipients.filter((recipient) => recipient.status === "active").map((recipient) => ({ label: recipient.display_name, href: `/payments/new?recipient=${recipient.id}`, group: "Recipients" }));
      render();
    }, PAUSE_MS);
  });

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length === 0) return;
      highlighted = (highlighted + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      mark();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const chosen = options[highlighted];
      if (chosen) location.assign(chosen.href);
    }
  });

  render();
  const close = openModal(dialog, opener, () => {
    cancelPause?.();
    latest.invalidate();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close(true);
  });
  input.focus();
}
