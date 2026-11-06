// How it works: four accordions, one open at a time with the open one in the
// URL, three city headings, Copy address and the enquiry form.

import { el, link, type ScreenContext, heading, problems, workingButton, field } from "../lib/ui";
import { ApiError } from "../lib/state";
import { api } from "../lib/ui";

const SECTIONS: { key: string; label: string; text: string }[] = [
  { key: "script", label: "From script to frames", text: "A script file comes in as it was written, and every row becomes a frame with its own timing." },
  { key: "timing", label: "Timing the reel", text: "The Slate strip carries each clip at 2 pixels a frame, so the sum reads exact against the job's target." },
  { key: "review", label: "Review and notes", text: "A private page reaches the producer in their own language, and every pin comes back with its frame attached." },
  { key: "delivery", label: "Delivery and fee letter", text: "Boards PDF, edit decision list and shot list ship together, and the fee letter locks when it is accepted." },
];

const CITIES: { key: string; label: string; text: string }[] = [
  { key: "amsterdam", label: "Amsterdam", text: "Prinsengracht 100, 1015 EA Amsterdam" },
  { key: "new-york", label: "New York", text: "Visits by appointment, Manhattan" },
  { key: "toronto", label: "Toronto", text: "Visits by appointment, Toronto" },
];

export async function buildHowItWorks(ctx: ScreenContext, query: URLSearchParams): Promise<{ heading: HTMLElement; body: HTMLElement }> {
  const h = heading(["How the work runs"], ctx.announcer);
  const openKey = query.get("open") ?? null;
  const accordions = el("div", { class: "accordions" });
  const contact = el("section", { class: "contact" });
  const cities = el("div", { class: "cities" });

  for (const section of SECTIONS) {
    const button = el("button", { type: "button", class: "accordion-button", "aria-expanded": openKey === section.key ? "true" : "false" }, section.label);
    button.style.minHeight = "44px";
    const panel = el("div", { class: "accordion-panel", hidden: openKey === section.key ? "" : "true" });
    panel.append(el("p", {}, section.text));
    button.addEventListener("click", () => {
      const isOpen = button.getAttribute("aria-expanded") === "true";
      void ctx.router.go(isOpen ? "/how-it-works" : `/how-it-works?open=${section.key}`);
    });
    if (openKey === section.key) {
      button.setAttribute("aria-expanded", "true");
      panel.hidden = false;
    }
    accordions.append(button, panel);
  }

  for (const city of CITIES) {
    const headingNode = el("h2", { id: city.key, tabindex: "-1" }, city.label);
    const text = el("p", {}, city.text);
    const cityBlock = el("div", { class: "city" }, headingNode, text);
    cities.append(cityBlock);
  }
  const address = el("p", { class: "address", id: "the-address" }, "desk@noorbakkerboards.example");
  const copyButton = el("button", { type: "button", class: "copy-address" }, "Copy address");
  copyButton.style.minHeight = "44px";
  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText("desk@noorbakkerboards.example");
      ctx.announcer.announce("Address copied.");
    } catch {
      const range = document.createRange();
      range.selectNodeContents(address);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      ctx.announcer.announce("Press Ctrl+C to copy the address.");
    }
  });

  const problem = problems();
  const name = field("input", { type: "text", autocomplete: "name" });
  const email = field("input", { type: "email", autocomplete: "email" });
  const phone = field("input", { type: "tel", autocomplete: "tel" });
  const message = field("textarea", {});
  const form = el("form", { "aria-label": "Enquiry", novalidate: "" }) as HTMLFormElement;
  form.append(
    el("label", { for: "enq-name" }, "Name"),
    name,
    el("label", { for: "enq-email" }, "Email"),
    email,
    el("label", { for: "enq-phone" }, "Phone"),
    phone,
    el("label", { for: "enq-message" }, "Message"),
    message,
    workingButton("Send enquiry", async () => {
      const fields: { field: string; text: string }[] = [];
      if (name.value.trim().length === 0) fields.push({ field: "name", text: "Type a name." });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
        fields.push({ field: "email", text: "Type a mail address such as name@example.test." });
      }
      if (message.value.trim().length === 0) fields.push({ field: "message", text: "Type your message." });
      problem.show(fields);
      if (fields.length > 0) return;
      try {
        const answer = await api.post("/api/enquiries", {
          name: name.value.trim(),
          email: email.value.trim(),
          phone: phone.value.trim().length === 0 ? undefined : phone.value.trim(),
          message: message.value,
        });
        ctx.announcer.announce(String(answer.message ?? ""));
        form.reset();
      } catch (e) {
        if (e instanceof ApiError) {
          ctx.announcer.announce(e.message);
        }
      }
    }, "Working…"),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
  });

  contact.append(
    cities,
    address,
    copyButton,
    problem.region,
    form,
  );

  const body = el("main", { class: "how-it-works" }, h, accordions, contact);
  void link;
  return { heading: h, body };
}
