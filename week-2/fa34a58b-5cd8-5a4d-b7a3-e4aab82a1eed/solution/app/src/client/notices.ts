// The Notices page: every household notice newest first, with its queued or sent state.

import type { Notice } from "../shared/types.ts";
import { load } from "./api.ts";
import { emptyNote, h, num, pulse } from "./dom.ts";
import { clockOf, live } from "./live.ts";
import type { Shell } from "./shell.ts";

const MAIL_BANNER = "Mail is unreachable. Notices are queued and each will be sent once when it is back.";


export async function noticesPage(shell: Shell): Promise<void> {
  const mail = h("p", { role: "status", "aria-label": "Mail", class: "mail-status" });
  const list = h("ul", { class: "line-list", "aria-label": "Notices" });
  const empty = emptyNote("No notices yet. Guest scene endings, schedule changes and stored motion clips appear here.");
  shell.main.append(
    h("div", { class: "page-head" }, h("h1", {}, "Notices")),
    h("p", { class: "lede" }, "Plain household emails, written to the outbox first and sent once."),
    mail, list, empty,
  );

  const rows = new Map<string, HTMLElement>();
  function row(notice: Notice): HTMLElement {
    const state = notice.state === "sent" && notice.sent_at ? `Sent ${clockOf(notice.sent_at)}` : "Queued";
    return h("li", { class: `line notice is-${notice.state}` }, h("span", { class: "line-text" },
      h("span", { class: "notice-subject" }, notice.subject), h("span", { class: "muted" }, ` · to ${notice.to} · `),
      h("span", { class: `state state-${notice.state}` }, num(state))));
  }
  function upsert(notice: Notice, flash: boolean): void {
    const fresh = row(notice);
    const old = rows.get(notice.id);
    if (old) old.replaceWith(fresh);
    else list.prepend(fresh);
    rows.set(notice.id, fresh);
    empty.hidden = true;
    if (flash) pulse(fresh);
  }
  async function reload(): Promise<void> {
    const notices = (await load<{ notices: Notice[] }>("/api/notices")).notices;
    rows.clear();
    list.replaceChildren(...notices.map((notice) => {
      const item = row(notice);
      rows.set(notice.id, item);
      return item;
    }));
    empty.hidden = notices.length > 0;
  }
  const paintMail = () => {
    const down = live.status.services.mail === "down";
    mail.textContent = down ? MAIL_BANNER : "";
    mail.classList.toggle("is-down", down);
  };
  paintMail();
  live.on("status", paintMail);
  live.on("notice", (message) => upsert(message.notice, true));
  live.onReconnect(() => void reload());
  await reload();
}
