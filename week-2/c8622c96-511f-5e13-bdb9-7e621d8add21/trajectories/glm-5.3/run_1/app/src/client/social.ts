// The picture editor's Shortlist and Following screens.
import { el, clear } from "./dom.js";
import { api, errorOf } from "./api.js";
import type { User } from "./shell.js";

interface ShortlistItem {
  id: number;
  essay_id: string;
  essay_title: string;
  frame_id: string;
  position: number;
  added_by: string;
  added_display: string;
}

export async function renderShortlist(main: HTMLElement, user: User): Promise<void> {
  clear(main);
  const result = await api.get<{ items: ShortlistItem[]; count: number }>("/api/shortlist");
  if (result.status !== 200) {
    const err = errorOf(result);
    main.append(el("div", { class: "status", role: "status", text: err?.message ?? "Couldn't reach Saltprint Desk. Nothing was changed; try again." }));
    return;
  }
  const data = result.body as { items: ShortlistItem[]; count: number };
  const status = el("div", { id: "shortlist-status", class: "status", role: "status", "aria-label": "Shortlist status" });
  main.append(el("h1", { class: "display", text: `Shortlist · ${data.count} frames` }));
  const list = el("ul", { class: "cards", role: "list", "aria-label": "Shortlist" });
  for (const item of data.items) {
    const remove = el("button", { class: "btn ghost", type: "button", "aria-label": `Remove frame ${item.position} of ${item.essay_title} from shortlist`, text: "Remove" }) as HTMLButtonElement;
    remove.addEventListener("click", async () => {
      const res = await api.delete(`/api/shortlist/${item.id}`);
      if (res.status === 204) {
        status.textContent = "Removed from shortlist.";
        void renderShortlist(main, user);
      }
    });
    list.append(el("li", { class: "card" },
      el("img", { class: "card-thumb", src: `/media/frames/${item.frame_id}/grid`, alt: "" }),
      el("div", { class: "card-body" },
        el("div", { class: "card-title", text: item.essay_title }),
        el("div", { class: "mono dim", text: `Frame ${item.position} · ${item.added_by} · ${item.added_display}` }),
        remove,
      ),
    ));
  }
  main.append(status, list);
  void user;
}

interface Follow {
  id: number;
  essay_id: string | null;
  contributor: string | null;
}

export async function renderFollowing(main: HTMLElement): Promise<void> {
  clear(main);
  main.append(el("h1", { class: "display", text: "Following" }));
  const result = await api.get<{ follows: Follow[] }>("/api/follows");
  const status = el("div", { class: "status", role: "status", "aria-label": "Follow status" });
  const list = el("ul", { class: "cards", role: "list", "aria-label": "Following" });
  if (result.status === 200) {
    const follows = (result.body as { follows: Follow[] }).follows;
    for (const follow of follows) {
      const label = follow.essay_id ?? follow.contributor ?? "";
      const unfollow = el("button", { class: "btn ghost", type: "button", "aria-label": `Unfollow ${label}`, text: "Unfollow" }) as HTMLButtonElement;
      unfollow.addEventListener("click", async () => {
        const res = await api.delete(`/api/follows/${follow.id}`);
        if (res.status === 204) {
          status.textContent = `Unfollowed ${label}.`;
          void renderFollowing(main);
        }
      });
      list.append(el("li", { class: "card" },
        el("div", { class: "card-body" },
          el("div", { class: "card-title", text: label }),
          unfollow,
        ),
      ));
    }
  }
  main.append(status, list);
}
