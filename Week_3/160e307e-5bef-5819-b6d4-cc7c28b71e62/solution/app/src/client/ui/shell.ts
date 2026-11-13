import { app } from "../app";
import { h } from "../dom";
import { go } from "../router";
import { avatarArt } from "./avatar";

/** Pieces shared by the working pages. */

export function loader(): HTMLElement {
  return h(
    "div",
    { id: "loading", class: "loading", role: "status", "aria-label": "Loading" },
    h("div", { class: "loading-board", "aria-hidden": "true" }, ...[0, 1, 2, 3].map((n) => h("span", { class: "loading-pocket", style: `--n:${n}` }))),
  );
}

export function topBar(withWordmark: boolean): HTMLElement {
  const me = app.me;
  return h(
    "header",
    { class: "topbar" },
    withWordmark ? h("a", { href: "/", class: "wordmark" }, "Due Coin") : null,
    me
      ? h(
          "a",
          { href: `/profile/${encodeURIComponent(me.name)}`, class: "topbar-profile" },
          h("span", { class: "topbar-avatar" }, avatarArt(me.avatar, 28)),
          h("span", { class: "topbar-name" }, me.name),
          h("span", { class: "sr-only" }, " profile"),
        )
      : null,
    h("span", { id: "chalk-balance", class: "chalk" }, me ? `${me.chalk} chalk` : ""),
    h("a", { href: "/shop", class: "topbar-link" }, "Shop"),
    h("a", { href: "/leaderboard", class: "topbar-link" }, "Leaderboard"),
  );
}

export function deniedPage(heading: string, message?: string): HTMLElement {
  return h(
    "div",
    { class: "denied" },
    h("h1", { class: "giant-heading", tabindex: -1 }, heading),
    message ? h("p", { class: "lede" }, message) : null,
    h("a", { href: "/", class: "btn btn-ink" }, "Home"),
  );
}

export function navigateOnClick(): void {
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const anchor = (event.target as Element | null)?.closest("a");
    if (!anchor || anchor.getAttribute("aria-disabled") === "true") return;
    const href = anchor.getAttribute("href");
    if (!href || !href.startsWith("/") || anchor.target === "_blank") return;
    event.preventDefault();
    go(href);
  });
}
