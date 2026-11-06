// /track, /support and /contact (brief: Tracking and support): lookups show only the API's answer.
import { api } from "../api.ts";
import { h, replace } from "../dom.ts";
import { busy, form, input, showRefusal, textarea, type Field } from "../forms.ts";
import { capitalised, longDate } from "../format.ts";
import type { PageContext } from "../router.ts";
import { pageHead } from "../ui.ts";
import { timeline } from "./order.ts";

function lookupForm(title: string, labels: [string, string], keys: [string, string], button: string, path: string, show: (data: Record<string, unknown>) => HTMLElement): HTMLElement {
  const a = input(labels[0], { name: keys[0], autocomplete: "off" });
  const b = input(labels[1], { type: "email", name: keys[1], autocomplete: "email" });
  const submit = h("button", { type: "submit", class: "pill" }, button);
  const answer = h("div", { class: "lookup-answer", "aria-live": "polite" });
  const f = form({ class: "stack-form" }, a.wrap, b.wrap, submit);
  f.el.addEventListener("submit", async (event) => {
    event.preventDefault();
    const r = await busy(submit, "Searching...", () => api<Record<string, unknown>>("POST", path, { [keys[0]]: a.control.value, email: b.control.value }));
    replace(answer, r.ok ? show(r.data) : h("p", { class: "lookup-miss" }, r.error.message));
  });
  return h("section", { class: "card" }, h("h2", null, title), f.el, answer);
}

export function track({ main }: PageContext): void {
  document.title = "Track an order | Tern Foils";
  main.append(pageHead("Track an order or case", "Enter the reference and the email that goes with it."),
    h("div", { class: "wrap two-up" },
      lookupForm("Order status", ["Order number", "Order email"], ["order_number", "email"], "Track order", "/api/track", (d) =>
        h("div", null, h("p", null, `${String(d.number)}: ${capitalised(String(d.status))}`), timeline(d.events as { status: string; at: string }[]))),
      lookupForm("Case status", ["Case reference", "Case email"], ["reference", "email"], "Find case", "/api/cases/lookup", (d) =>
        h("div", null, h("p", null, `${String(d.reference)}: ${capitalised(String(d.status))}`), h("p", { class: "caption" }, `${String(d.subject)}, opened ${longDate(String(d.opened_at))}`)))));
}

function caseForm(withSubject: boolean): HTMLElement {
  const fields: Record<string, Field> = {
    email: input("Email", { type: "email", name: "email", autocomplete: "email" }),
    ...(withSubject ? { order_number: input("Order number (optional)", { name: "order_number", autocomplete: "off" }), subject: input("Subject", { name: "subject" }) } : {}),
    message: textarea("Message", { name: "message", maxlength: 2000 }),
  };
  const submit = h("button", { type: "submit", class: "pill pill-large" }, withSubject ? "Open case" : "Send message");
  const done = h("p", { class: "form-done", tabindex: "-1" });
  const f = form({ class: "stack-form card" }, ...Object.values(fields).map((x) => x.wrap), submit, done);
  f.el.addEventListener("submit", async (event) => {
    event.preventDefault();
    done.textContent = "";
    const value = (k: string) => fields[k]?.control.value ?? "";
    const r = await busy(submit, withSubject ? "Opening..." : "Sending...", () => api<{ reference: string }>("POST", "/api/cases", {
      email: value("email"), order_number: value("order_number"), subject: withSubject ? value("subject") : "Contact form", message: value("message"),
    }));
    if (!r.ok) {
      showRefusal(r.error, fields, f.alert);
      return;
    }
    showRefusal({ error: "", message: "" }, fields, f.alert);
    done.textContent = `Case ${r.data.reference} opened.`;
    done.focus();
  });
  return f.el;
}

export function support({ main }: PageContext): void {
  document.title = "Support | Tern Foils";
  main.append(pageHead("Open a support case", "Our workshop replies within two business days."), h("div", { class: "wrap narrow" }, caseForm(true)));
}

export function contact({ main }: PageContext): void {
  document.title = "Contact | Tern Foils";
  main.append(pageHead("Write to the workshop", "Questions about boards, parts or riding: we read every message."), h("div", { class: "wrap narrow" }, caseForm(false)));
}
