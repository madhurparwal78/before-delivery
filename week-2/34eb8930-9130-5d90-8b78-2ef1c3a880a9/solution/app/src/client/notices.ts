import { ICONS, formatWhen, h, setText, svgIcon } from "./dom.js";
import { api } from "./net.js";
import { navigate } from "./router.js";
import { openDialog } from "./ui.js";
import type { Notice } from "../shared/types.js";

/** The Notices button with its unread badge and the Notices dialog (Public screens). */
export class NoticesControl {
  readonly button: HTMLButtonElement;
  private badge = h("span", { class: "badge", "aria-hidden": "true", hidden: true });
  private notices: Notice[] = [];
  private list = h("ul", { "aria-label": "Notices", class: "notice-list" });
  private dialog = h("dialog", { class: "dialog notices-dialog", "aria-labelledby": "notices-title" });
  private handle: (() => void) | null = null;

  constructor() {
    this.button = h("button", { type: "button", class: "chrome-btn", "aria-label": "Notices", onclick: () => this.open() }, svgIcon(ICONS.bell), h("span", { class: "label" }, "Notices"), this.badge);
    const close = h("button", { type: "button", class: "btn quiet" }, "Close");
    this.dialog.append(h("h2", { id: "notices-title", class: "dialog-title" }, "Notices"), this.list, h("div", { class: "dialog-actions" }, close));
    close.addEventListener("click", () => this.handle?.());
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const data = await api<{ unread: number; notices: Notice[] }>("GET", "/api/notices").catch(() => null);
    if (!data) return;
    this.notices = data.notices;
    setText(this.badge, String(data.unread));
    this.badge.hidden = data.unread === 0;
    this.render();
  }

  private render(): void {
    const sig = JSON.stringify(this.notices.map((n) => [n.id, n.read, n.text]));
    if (this.list.dataset.sig === sig) return;
    this.list.dataset.sig = sig;
    this.list.replaceChildren(...(this.notices.length ? this.notices.map((n) => {
      const href = `/d/${encodeURIComponent(n.documentId)}${n.commentId ? `?card=${encodeURIComponent(n.commentId)}` : ""}`;
      const link = h("a", { href, class: n.read ? "notice read" : "notice unread", onclick: (e: Event) => { e.preventDefault(); void this.follow(n, href); } }, n.text);
      return h("li", {}, link, h("span", { class: "meta" }, formatWhen(n.createdAt)));
    }) : [h("li", { class: "empty-line" }, "No notices yet.")]));
  }

  private async follow(n: Notice, href: string): Promise<void> {
    await api("POST", `/api/notices/${encodeURIComponent(n.id)}/read`, {}).catch(() => undefined);
    this.handle?.();
    navigate(href);
  }

  destroy(): void {
    this.handle?.();
    this.dialog.remove();
  }

  private open(): void {
    void this.refresh();
    this.handle = openDialog(this.dialog, { opener: this.button });
  }
}
