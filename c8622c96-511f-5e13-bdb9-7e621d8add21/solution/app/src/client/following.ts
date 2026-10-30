// Following (picture editor): the signed-in person's own follows.
import { attempt, call, failureText, get } from "./api.js";
import { h, icon, replace, say } from "./dom.js";
import type { Follow } from "./types.js";
import { emptyNote, outageFrom, pageHead, statusLine } from "./ui.js";

export function mountFollowing(root: HTMLElement): () => void {
  const status = statusLine("Follow status");
  const body = h("div", {});
  replace(root, pageHead("Following", "Essays and photographers you follow. You get one email when an embargo you follow lifts."),
    status, body);

  async function load(): Promise<void> {
    const answer = await attempt(() => get<{ follows: Follow[] }>("/api/follows"));
    outageFrom(answer);
    if (!answer?.ok || !answer.data) return;
    const follows = answer.data.follows;
    const list = h("ul", { class: "follow-list", "aria-label": "Following" }, ...follows.map((follow) => {
      const name = follow.essay_title ?? follow.contributor_name ?? follow.contributor ?? "";
      const button = h("button", { type: "button", class: "button button-ghost", "aria-label": `Unfollow ${name}` },
        icon("x"), "Unfollow");
      button.addEventListener("click", () => void (async () => {
        button.disabled = true;
        const gone = await attempt(() => call("DELETE", `/api/follows/${encodeURIComponent(follow.id)}`));
        if (gone?.ok) {
          say(status, `Unfollowed ${name}.`);
          await load();
          status.focus();
        } else {
          button.disabled = false;
          say(status, failureText(gone));
        }
      })());
      return h("li", { class: "follow-item" },
        h("div", {}, h("p", { class: "item-title" }, name),
          h("p", { class: "item-meta" }, follow.essay_id ? "Essay" : "Photographer")),
        button);
    }));
    replace(body, follows.length ? list : emptyNote("You aren't following anything yet. Follow an essay or a photographer from the story viewer."));
  }

  status.tabIndex = -1;
  void load();
  return () => undefined;
}
