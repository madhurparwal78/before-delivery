// Review queue (desk editor): publish or hold submissions, and carry out withdrawal requests.
import { dollars, percent } from "../shared/money.js";
import { attempt, call, failureText, get } from "./api.js";
import { openDialog } from "./dialog.js";
import { h, icon, replace, say } from "./dom.js";
import type { Essay } from "./types.js";
import { emptyNote, mono, outageFrom, pageHead, statusLine } from "./ui.js";

export function mountReview(root: HTMLElement): () => void {
  const status = statusLine("Desk status");
  const queue = h("div", {});
  const withdrawals = h("div", {});
  replace(root, pageHead("Review queue", "Submissions waiting for the desk, oldest first. Publishing puts an essay into embargo until its lift."),
    status, h("h2", { class: "section-title" }, "In review"), queue,
    h("h2", { class: "section-title" }, "Withdrawal requests"), withdrawals);

  async function act(button: HTMLButtonElement, path: string, body: unknown, done: string, busy?: string): Promise<boolean> {
    button.disabled = true;
    if (busy) say(status, busy);
    const answer = await attempt(() => call<Essay>("POST", path, body));
    if (answer?.ok) {
      say(status, done);
      await load();
      return true;
    }
    button.disabled = false;
    say(status, failureText(answer));
    return false;
  }

  function reviewItem(essay: Essay): HTMLElement {
    const publish = h("button", { type: "button", class: "button button-primary", "aria-label": `Publish ${essay.title}` }, "Publish");
    const hold = h("button", { type: "button", class: "button button-ghost", "aria-label": `Hold ${essay.title}` }, "Hold");
    publish.addEventListener("click", () => void act(publish, `/api/essays/${encodeURIComponent(essay.id)}/publish`, {},
      "Published.", "Publishing…"));
    hold.addEventListener("click", () => openDialog("Hold essay", hold, (close) => {
      const note = h("textarea", { id: "desk-note", rows: 4, maxlength: 1000, "aria-describedby": "desk-note-help" });
      const error = h("p", { class: "field-error", id: "desk-note-error", hidden: true });
      const submit = h("button", { type: "submit", class: "button button-primary" }, "Hold essay");
      const cancel = h("button", { type: "button", class: "button button-quiet" }, "Cancel");
      cancel.addEventListener("click", close);
      const form = h("form", { class: "modal-form" },
        h("label", { for: "desk-note" }, "Desk note"),
        h("p", { class: "field-help", id: "desk-note-help" }, `Returned to ${essay.credit_line.replace("Photographs by ", "")} with the draft. Never shown to newsrooms.`),
        note, error, h("div", { class: "modal-actions" }, cancel, submit));
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void (async () => {
          submit.disabled = true;
          const answer = await attempt(() => call<Essay>("POST", `/api/essays/${encodeURIComponent(essay.id)}/hold`, { note: note.value }));
          submit.disabled = false;
          if (answer?.ok) {
            close();
            say(status, "Held and returned to the contributor.");
            await load();
            status.focus();
            return;
          }
          error.hidden = false;
          error.textContent = answer?.error?.fields?.note ?? failureText(answer);
          note.setAttribute("aria-describedby", "desk-note-error desk-note-help");
          note.focus();
        })();
      });
      return [h("h2", { class: "modal-title" }, `Hold ${essay.title}`), form];
    }));
    return h("li", { class: "review-item" },
      h("div", { class: "strip" }, ...essay.frames.map((f) =>
        f.grid_url ? h("img", { src: f.grid_url, alt: `Frame ${f.position}`, width: 600, height: 600, loading: "lazy" }) : null)),
      h("div", { class: "review-text" },
        h("h3", { class: "item-heading" }, essay.title),
        h("p", { class: "item-meta" }, essay.caption || "No caption."),
        h("dl", { class: "facts" },
          h("dt", {}, "Credits"), h("dd", {}, ...essay.credits.map((c, i) => h("span", { class: "credit-chip" },
            `${c.name} `, mono(`${percent(c.split_bp ?? 0)}%`), i < essay.credits.length - 1 ? " · " : ""))),
          h("dt", {}, "Lift"), h("dd", {}, mono(essay.lift_display)),
          h("dt", {}, "Exclusive"), h("dd", {}, mono(`${essay.exclusive_days} d · ${dollars(essay.exclusive_price_minor)}`)),
          h("dt", {}, "Standard"), h("dd", {}, mono(`${essay.standard_days} d · ${dollars(essay.standard_price_minor)}`)))),
      h("div", { class: "item-actions" }, publish, hold));
  }

  function withdrawalItem(essay: Essay): HTMLElement {
    const button = h("button", { type: "button", class: "button button-ghost", "aria-label": `Carry out withdrawal of ${essay.title}` },
      icon("x"), "Carry out withdrawal");
    button.addEventListener("click", () => void act(button, `/api/essays/${encodeURIComponent(essay.id)}/withdraw`, {},
      "Withdrawal carried out."));
    return h("li", { class: "review-item review-item-compact" },
      h("div", { class: "review-text" }, h("h3", { class: "item-heading" }, essay.title),
        h("p", { class: "item-meta" }, essay.credit_line, " · ", mono(essay.lift_display))),
      h("div", { class: "item-actions" }, button));
  }

  async function load(): Promise<void> {
    const answer = await attempt(() => get<{ essays: Essay[]; withdrawal_requests: Essay[] }>("/api/desk/queue"));
    outageFrom(answer);
    if (!answer?.ok || !answer.data) return;
    const { essays, withdrawal_requests: requests } = answer.data;
    replace(queue, essays.length ? h("ul", { class: "review-list", "aria-label": "Review queue" }, ...essays.map(reviewItem))
      : emptyNote("The review queue is empty."));
    replace(withdrawals, requests.length
      ? h("ul", { class: "review-list", "aria-label": "Withdrawal requests" }, ...requests.map(withdrawalItem))
      : emptyNote("No withdrawal requests."));
  }

  status.tabIndex = -1;
  void load();
  const timer = window.setInterval(() => void load(), 30_000);
  return () => window.clearInterval(timer);
}
