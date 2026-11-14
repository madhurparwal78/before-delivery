import { formatLocalDateTime } from "../shared/formats.js";
import { M } from "../shared/messages.js";
import type { FormState } from "../shared/types.js";
import { api } from "./api.js";
import { clear, h, setTitle } from "./dom.js";

export const root = (): HTMLElement => document.getElementById("root") as HTMLElement;

export const STATE_TEXT: Record<FormState, string> = { draft: "Draft", open: "Open", closed: "Closed" };

/** A page with one main landmark; returns the main element. */
export function page(...before: HTMLElement[]): HTMLElement {
  const main = h("main", { id: "main" });
  clear(root(), ...before, main);
  return main;
}

function mainNav(): HTMLElement {
  return h(
    "nav",
    { "aria-label": "Main", class: "nav-main" },
    h("a", { href: "/forms", class: "brand-link" }, "Forms"),
    h("button", {
      type: "button",
      class: "quiet",
      onclick: async () => {
        await api("DELETE", "/api/session");
        location.assign("/signin");
      },
    }, "Sign out"),
  );
}

export interface OwnerFrame {
  main: HTMLElement;
  stateBadge: HTMLElement;
}

/** The owner frame: Main navigation, and for form pages the Form navigation and state badge. */
export function ownerPage(formId: string | null, current?: "edit" | "summary" | "responses" | "editions"): OwnerFrame {
  const stateBadge = h("span", { id: "form-state", class: "state-badge" });
  const header = h("header", { class: "owner-header" }, h("span", { class: "wordmark" }, "Nightform"), mainNav());
  if (formId) {
    const link = (key: typeof current, label: string, href: string): HTMLElement =>
      h("a", { href, "aria-current": key === current ? "page" : null }, label);
    header.append(
      h(
        "nav",
        { "aria-label": "Form", class: "nav-form" },
        link("edit", "Edit", `/forms/${formId}/edit`),
        link("summary", "Summary", `/forms/${formId}/summary`),
        link("responses", "Responses", `/forms/${formId}/responses`),
        link("editions", "Editions", `/forms/${formId}/editions`),
      ),
    );
  }
  const main = page(header);
  main.setAttribute("aria-busy", "true");
  return { main, stateBadge };
}

export function setFormState(badge: HTMLElement, state: FormState): void {
  badge.textContent = STATE_TEXT[state];
  badge.dataset.state = state;
}

export function notFoundPage(): void {
  const main = page();
  main.append(h("h1", { tabindex: "-1" }, M.notFound), h("p", {}, h("a", { href: "/" }, "Go to Nightform")));
  setTitle(`${M.notFound} - Nightform`);
}

export function messagePage(heading: string): void {
  const main = page();
  main.append(h("h1", { tabindex: "-1" }, heading));
  setTitle(`${heading} - Nightform`);
}

/** Formats an API time (ISO with the server's zone offset) as `14 Mar 2026, 17:00`. */
export function localTimeText(iso: string): string {
  return formatLocalDateTime(iso.slice(0, 16));
}

/** A dim page map shown while a screen's first data loads. */
export function loadingMap(): HTMLElement {
  return h(
    "div",
    { class: "loading-map", "aria-hidden": "true" },
    h("span", {}),
    h("span", {}),
    h("span", {}),
    h("span", {}),
  );
}
