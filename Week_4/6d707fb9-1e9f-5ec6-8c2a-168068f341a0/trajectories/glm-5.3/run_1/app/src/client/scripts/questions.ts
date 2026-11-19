// The questions page: accordions with the open question in the address.

import { el } from "./api.js";
import type { RouteCtx } from "./app.js";
import { navigate } from "./app.js";

interface Question {
  slug: string;
  q: string;
  a: string;
}

const QUESTIONS: Question[] = [
  { slug: "who-is-it-for", q: "Who is the desk for?", a: "One independent assessor working alone, running every style from supplier facts to a published passport." },
  {
    slug: "legal-claim",
    q: "Does the desk make a legal claim?",
    a: "No. The desk stores, converts units, works out published sums and shows what the providers answered. It gives no compliance advice.",
  },
  { slug: "factors", q: "Where do the factors come from?", a: "A third-party factor library, read by edition. Each result keeps the rows it used, so earlier results never change." },
  { slug: "supplier-accounts", q: "Do suppliers need an account?", a: "No. They answer on a private page sent by mail, in their own language, and the page ends on its own." },
  { slug: "poor-signal", q: "What happens with poor signal?", a: "Readings wait on the phone and send themselves in the order taken when the network returns." },
  { slug: "shopper", q: "What does a shopper see?", a: "A public passport with the published sums, the factor edition, the data quality and no supplier details." },
];

export function registerQuestions(ctx: RouteCtx): () => void {
  const main = ctx.main;
  const h1 = el("h1", {}, "Questions");
  const list = el("div", { class: "accordion" });
  const openSlug = ctx.params.get("q") ?? null;
  for (const question of QUESTIONS) {
    const item = el("div", { class: "accordion-item", "data-question": question.slug });
    const head = el("button", { class: "accordion-head", "aria-expanded": "false", "aria-controls": `panel-${question.slug}` }, question.q);
    const panel = el("div", { class: "accordion-panel", id: `panel-${question.slug}`, "data-open": "false" });
    const inner = el("div", { style: "padding:0 4px 16px" }, question.a);
    panel.append(inner);
    if (openSlug === question.slug) {
      head.setAttribute("aria-expanded", "true");
      panel.setAttribute("data-open", "true");
      panel.style.height = "auto";
      panel.style.visibility = "visible";
    } else {
      panel.style.height = "0";
    }
    head.addEventListener("click", () => {
      const isOpen = head.getAttribute("aria-expanded") === "true";
      if (isOpen) {
        closePanel(head, panel, item);
        history.pushState(null, "", `/questions`);
      } else {
        for (const other of [...list.querySelectorAll<HTMLElement>(".accordion-item")]) {
          if (other !== item) {
            const otherHead = other.querySelector<HTMLElement>(".accordion-head");
            const otherPanel = other.querySelector<HTMLElement>(".accordion-panel");
            if (otherHead && otherPanel && otherHead.getAttribute("aria-expanded") === "true") {
              closePanel(otherHead, otherPanel, other);
            }
          }
        }
        openPanel(head, panel);
        history.pushState(null, "", `/questions?q=${question.slug}`);
      }
    });
    item.append(head, panel);
    list.append(item);
  }
  main.append(h1, list);
  return () => {
  };
}

function openPanel(head: HTMLElement, panel: HTMLElement): void {
  head.setAttribute("aria-expanded", "true");
  panel.setAttribute("data-open", "true");
  panel.style.visibility = "visible";
  const target = panel.scrollHeight;
  panel.style.height = "0";
  requestAnimationFrame(() => {
    panel.style.height = `${target}px`;
    window.setTimeout(() => {
      if (panel.getAttribute("data-open") === "true") panel.style.height = "auto";
    }, 340);
  });
}

function closePanel(head: HTMLElement, panel: HTMLElement, item: HTMLElement): void {
  head.setAttribute("aria-expanded", "false");
  panel.setAttribute("data-open", "false");
  panel.style.height = `${panel.scrollHeight}px`;
  requestAnimationFrame(() => {
    panel.style.height = "0";
    panel.style.visibility = "hidden";
  });
}
