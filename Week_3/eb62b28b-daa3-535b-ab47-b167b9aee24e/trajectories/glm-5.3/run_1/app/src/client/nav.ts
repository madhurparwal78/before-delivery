import { el, api } from "./dom.js";
import { navigate } from "./router.js";
import type { MemberSelf } from "./pages-member.js";
import { MEMBERSHIP_STATE_LABEL } from "../shared/enums.js";

/** The Member navigation bar with a Menu sheet at 375. */
export function memberNav(member: MemberSelf, activeHref: string): HTMLElement {
  const links: { label: string; href: string }[] = [
    { label: "Home", href: "/me" },
    { label: "Membership", href: "/me/membership" },
    { label: "Draws", href: "/me/draws" },
    { label: "Results", href: "/me/results" },
    { label: "Plan", href: "/me/plan" },
    { label: "Messages", href: "/me/messages" },
    { label: "Records", href: "/me/records" },
    { label: "Account", href: "/me/account" },
  ];
  const bar = el("nav", { class: "member-nav", "aria-label": "Member" });
  for (const link of links) {
    bar.append(
      el(
        "a",
        {
          href: link.href,
          class: `member-nav-link${link.href === activeHref ? " active" : ""}`,
          "aria-current": link.href === activeHref ? "page" : "",
        },
        link.label
      )
    );
  }
  const state = MEMBERSHIP_STATE_LABEL[member.membership.state as keyof typeof MEMBERSHIP_STATE_LABEL] ?? member.membership.state;
  bar.append(el("span", { class: "member-nav-state" }, state));
  const signOut = el("button", { type: "button", class: "button ghost nav-signout" }, "Sign out");
  signOut.addEventListener("click", async () => {
    await api("/api/session", { method: "DELETE" });
    navigate("/signin");
    window.location.reload();
  });
  bar.append(signOut);

  const menuButton = el("button", { type: "button", class: "button menu-button" }, "Menu");
  menuButton.addEventListener("click", () => {
    openMenuSheet(menuButton, member, activeHref);
  });
  bar.append(menuButton);
  return bar;
}

function openMenuSheet(opener: HTMLElement, member: MemberSelf, activeHref: string): void {
  import("./dialogs.js").then(({ openDialog }) => {
    openDialog(
      {
        title: "Menu",
        content: (dialog) => {
          const wrap = el("div", { class: "menu-sheet" });
          for (const link of [
            { label: "Home", href: "/me" },
            { label: "Membership", href: "/me/membership" },
            { label: "Draws", href: "/me/draws" },
            { label: "Results", href: "/me/results" },
            { label: "Plan", href: "/me/plan" },
            { label: "Messages", href: "/me/messages" },
            { label: "Records", href: "/me/records" },
            { label: "Account", href: "/me/account" },
          ]) {
            const anchor = el("a", { href: link.href, class: "menu-sheet-link" }, link.label);
            anchor.addEventListener("click", () => {
              dialog.close();
              dialog.remove();
              navigate(link.href);
            });
            wrap.append(anchor);
          }
          const signOut = el("button", { type: "button", class: "button ghost" }, "Sign out");
          signOut.addEventListener("click", async () => {
            await api("/api/session", { method: "DELETE" });
            dialog.close();
            dialog.remove();
            navigate("/signin");
            window.location.reload();
          });
          wrap.append(signOut);
          void member;
          void activeHref;
          return wrap;
        },
      },
      opener,
      true
    );
  });
}
