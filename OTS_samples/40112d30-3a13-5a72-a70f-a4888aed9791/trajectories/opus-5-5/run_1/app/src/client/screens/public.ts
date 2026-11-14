import { M } from "../../shared/messages.js";
import type { ErrorItem } from "../../shared/types.js";
import { api } from "../api.js";
import { alertText, field, h, setTitle, svg } from "../dom.js";
import { notFoundPage, page } from "../layout.js";

const CAPABILITIES = ["Branching", "Formulas", "Save and resume", "Live summary", "Co-editing", "CSV export"];
const SAMPLES: { title: string; pages: number; lit: number[] }[] = [
  { title: "Allotment waiting list", pages: 3, lit: [0, 1, 2] },
  { title: "Choir audition", pages: 5, lit: [0, 1, 3, 4] },
  { title: "Bakery pre-order", pages: 2, lit: [0, 1] },
  { title: "Supper club RSVP", pages: 4, lit: [0, 1, 3] },
  { title: "Trip dates", pages: 3, lit: [0, 2] },
  { title: "Household budget", pages: 4, lit: [0, 1, 2, 3] },
  { title: "Book club sign-up", pages: 3, lit: [0, 1] },
];

/** A dim drawing of a form's page map with its lit path. */
function thumbnail(sample: (typeof SAMPLES)[number]): SVGElement {
  const rows = sample.pages;
  const height = 24 + rows * 34;
  const lastLit = sample.lit[sample.lit.length - 1];
  const parts: SVGElement[] = [];
  for (let i = 0; i < rows; i++) {
    const y = 14 + i * 34;
    const lit = sample.lit.includes(i);
    parts.push(svg("rect", { x: 22, y, width: 92, height: 20, class: lit ? "thumb-lit" : "thumb-dim" }));
    parts.push(svg("rect", { x: 30, y: y + 8, width: 44 + ((i * 17) % 30), height: 4, class: lit ? "thumb-line" : "thumb-line-dim" }));
  }
  parts.push(svg("rect", { x: 8, y: 14 + lastLit * 34, width: 4, height: 20, class: "thumb-marker" }));
  return svg("svg", { viewBox: `0 0 128 ${height}`, role: "img", "aria-label": `${sample.title} page map`, class: "thumb" }, parts);
}

export function marketing(): void {
  const main = page();
  main.classList.add("marketing");
  main.append(
    h(
      "section",
      { class: "band" },
      h("h1", { class: "band-name" }, "Nightform"),
      h("p", { class: "band-status" }, "Open for new workspaces"),
      h("ul", { class: "band-capabilities", "aria-label": "Capabilities" }, CAPABILITIES.map((c) => h("li", {}, c))),
      h("ul", { class: "band-samples", "aria-label": "Sample forms" }, SAMPLES.map((s) => h("li", {}, s.title))),
      h(
        "div",
        { class: "band-actions" },
        h("a", { href: "/signin" }, "Sign in"),
        h("a", { href: "/signup", class: "primary-link" }, "Start a form"),
      ),
    ),
    h(
      "div",
      { class: "sheet" },
      SAMPLES.map((s) => h("figure", { class: "sheet-item" }, h("figcaption", {}, s.title), thumbnail(s))),
    ),
  );
  setTitle("Nightform");
}

function nextPath(): string {
  const next = new URLSearchParams(location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/forms";
}

interface FieldSpec {
  key: string;
  label: string;
  type: string;
  autocomplete: string;
}

interface AccountForm {
  showErrors(items: ErrorItem[]): void;
  status: HTMLElement;
}

function accountForm(heading: string, fields: FieldSpec[], action: string, submit: (values: Record<string, string>) => Promise<void>): AccountForm {
  const main = page();
  main.classList.add("narrow");
  const inputs = new Map<string, HTMLInputElement>();
  const errors = new Map<string, HTMLElement>();
  const status = h("p", { class: "form-status" });
  const form = h("form", { class: "stack", novalidate: true });
  for (const spec of fields) {
    const input = h("input", { type: spec.type, name: spec.key, autocomplete: spec.autocomplete });
    const error = h("p", { class: "field-error", id: `error-${spec.key}` });
    inputs.set(spec.key, input);
    errors.set(spec.key, error);
    form.append(field(spec.label, input, error));
  }
  form.append(h("button", { type: "submit", class: "primary" }, action));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values: Record<string, string> = {};
    for (const [key, input] of inputs) values[key] = input.value;
    void submit(values);
  });
  main.append(h("h1", {}, heading), status, form);
  setTitle(`${heading} - Nightform`);
  return {
    status,
    showErrors(items) {
      for (const [key, el] of errors) {
        const item = items.find((i) => i.key === key);
        el.textContent = item?.message ?? "";
        const input = inputs.get(key) as HTMLInputElement;
        if (item) {
          input.setAttribute("aria-invalid", "true");
          input.setAttribute("aria-describedby", el.id);
        } else {
          input.removeAttribute("aria-invalid");
          input.removeAttribute("aria-describedby");
        }
      }
      if (items[0]) inputs.get(items[0].key)?.focus();
    },
  };
}

export function signup(): void {
  const view = accountForm(
    "Create your account",
    [
      { key: "name", label: "Name", type: "text", autocomplete: "name" },
      { key: "email", label: "Email", type: "email", autocomplete: "email" },
      { key: "password", label: "Password", type: "password", autocomplete: "new-password" },
    ],
    "Create account",
    async (values) => {
      const result = await api("POST", "/api/account", values);
      if (result.ok) {
        location.assign(nextPath());
        return;
      }
      view.showErrors(result.error?.items ?? []);
      view.status.textContent = result.error?.message ?? "";
      alertText(result.error?.message ?? "");
    },
  );
}

export function signin(): void {
  const view = accountForm(
    "Sign in",
    [
      { key: "email", label: "Email", type: "email", autocomplete: "email" },
      { key: "password", label: "Password", type: "password", autocomplete: "current-password" },
    ],
    "Sign in",
    async (values) => {
      const result = await api("POST", "/api/session", values);
      if (result.ok) {
        location.assign(nextPath());
        return;
      }
      const message = result.error?.message ?? M.signInFailed;
      view.status.textContent = message;
      alertText(message);
    },
  );
}

export async function invitation(token: string): Promise<void> {
  const [invite, session] = await Promise.all([
    api<{ form_title: string }>("GET", `/api/invitations/${encodeURIComponent(token)}`),
    api("GET", "/api/session"),
  ]);
  if (!invite.ok) {
    notFoundPage();
    return;
  }
  const main = page();
  main.classList.add("narrow");
  const heading = `Join ${invite.data.form_title}`;
  main.append(h("h1", {}, heading));
  setTitle(`${heading} - Nightform`);
  const back = encodeURIComponent(`/invite/${token}`);
  if (!session.ok) {
    main.append(
      h(
        "p",
        { class: "actions" },
        h("a", { href: `/signin?next=${back}` }, "Sign in"),
        h("a", { href: `/signup?next=${back}` }, "Create account"),
      ),
    );
    return;
  }
  const status = h("p", { class: "form-status" });
  const accept = async (): Promise<void> => {
    const result = await api<{ form_id: string }>("POST", `/api/invitations/${encodeURIComponent(token)}/accept`, {});
    if (result.ok) {
      location.assign(`/forms/${result.data.form_id}/edit`);
      return;
    }
    status.textContent = result.error?.message ?? "";
    alertText(result.error?.message ?? "");
  };
  main.append(h("button", { type: "button", class: "primary", onclick: () => void accept() }, "Accept invitation"), status);
}
