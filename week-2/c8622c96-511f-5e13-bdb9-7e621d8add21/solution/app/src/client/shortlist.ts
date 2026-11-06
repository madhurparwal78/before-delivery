// Shortlist (picture editor): the newsroom's shared list of frames.
import { attempt, call, failureText, get } from "./api.js";
import { h, icon, replace, say } from "./dom.js";
import type { ShortlistItem } from "./types.js";
import { emptyNote, outageFrom, pageHead, statusLine } from "./ui.js";

export function mountShortlist(root: HTMLElement): () => void {
  const heading = h("h2", { class: "section-title" });
  const list = h("ul", { class: "frame-list", "aria-label": "Shortlist" });
  const status = statusLine("Shortlist status");
  const body = h("div", {});
  replace(root, pageHead("Shortlist", "Frames your newsroom has marked for a story. Everyone on your desk shares this list."),
    heading, status, body);

  async function load(focusAfter?: number): Promise<void> {
    const answer = await attempt(() => get<{ items: ShortlistItem[]; count: number }>("/api/shortlist"));
    outageFrom(answer);
    if (!answer?.ok || !answer.data) return;
    const { items, count } = answer.data;
    heading.textContent = `Shortlist · ${count} frames`;
    replace(list, ...items.map((item) => {
      const remove = h("button", { type: "button", class: "button button-ghost",
        "aria-label": `Remove frame ${item.position} of ${item.essay_title} from shortlist` }, icon("trash"), "Remove");
      remove.addEventListener("click", () => void (async () => {
        remove.disabled = true;
        const gone = await attempt(() => call("DELETE", `/api/shortlist/${encodeURIComponent(item.id)}`));
        if (gone?.ok) {
          say(status, "Removed from shortlist.");
          await load(items.indexOf(item));
        } else {
          remove.disabled = false;
          say(status, failureText(gone));
        }
      })());
      return h("li", { class: "frame-item" },
        h("img", { class: "thumb", src: `/media/frames/${encodeURIComponent(item.frame_id)}/grid`, alt: "", width: 600, height: 600 }),
        h("div", { class: "frame-item-text" },
          h("p", { class: "item-title" }, item.essay_title),
          h("p", { class: "item-meta" }, h("span", { class: "mono" }, `Frame ${item.position}`), " · added by ",
            item.added_by, " · ", h("span", { class: "mono" }, item.added_display))),
        remove);
    }));
    replace(body, items.length ? list : emptyNote("No frames on the shortlist yet. Add them from the story viewer."));
    if (focusAfter !== undefined) {
      const buttons = list.querySelectorAll<HTMLButtonElement>("button");
      (buttons[Math.min(focusAfter, buttons.length - 1)] ?? heading).focus();
    }
  }

  heading.tabIndex = -1;
  void load();
  const timer = window.setInterval(() => void load(), 30_000);
  return () => window.clearInterval(timer);
}
