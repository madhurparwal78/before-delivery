// The two page shells: the desk (top bar, rail, Menu sheet, live regions) and the public pages (marquee).
import { h } from "./dom.js";
import { openDialog } from "./dialog.js";
import { watchSettlement } from "./clock.js";
import { announce } from "./announce.js";
import { post, session } from "./api.js";
import { marquee } from "./marquee.js";

const NAV = {
  analyst: [["/windows", "Windows"]],
  verifier: [["/review", "Review queue"]],
  lead: [["/group", "Group scores"]],
};
const wide = matchMedia("(min-width: 1200px)");

function navLinks(user) {
  const menuLinks = [...(NAV[user.role] || []), ["/check", "Check a statement"]];
  return h("nav", { "aria-label": "Desk" }, h("ul", { class: "navlist" },
    menuLinks.map(([path, text]) => h("li", {}, h("a", { href: path, text })))));
}

export function deskShell(root, user, navigate) {
  const status = h("div", { role: "status", "aria-label": "Desk status", "aria-live": "polite" });
  const alert = h("div", { role: "alert", "aria-label": "Desk alert" });
  const timer = h("div", { role: "timer", "aria-label": "Settlement time", class: "settlement" });
  const view = h("main", { id: "view", tabindex: "-1" });
  const menuButton = h("button", { type: "button", class: "menu-button", text: "Menu" });
  const signOut = h("button", { type: "button", text: "Sign out" });
  const rail = h("aside", { class: "rail field-band" }, navLinks(user));
  const topbar = h("header", { class: "topbar field-band" },
    h("a", { href: user.role === "analyst" ? "/windows" : user.role === "verifier" ? "/review" : "/group", class: "wordmark", text: "Hourproof" }),
    h("span", { class: "who", text: user.name }), timer, menuButton, signOut);
  root.replaceChildren(h("div", { class: "shell" }, rail,
    h("div", { class: "shell-main" }, topbar, h("div", { class: "sr-only" }, status, alert), view)));
  const stopTimer = watchSettlement(timer);

  let menu = null;
  const closeMenu = (restore) => { if (menu) { const open = menu; menu = null; open.close({ restore }); } };
  menuButton.addEventListener("click", () => {
    const close = h("button", { type: "button", text: "Close" });
    const dialog = h("dialog", { class: "sheet field-yellow", "aria-label": "Menu" }, h("div", { class: "stack" }, navLinks(user), close));
    menu = openDialog(dialog, { opener: menuButton, onClose: () => { menu = null; } });
    close.addEventListener("click", () => closeMenu(true));
    dialog.addEventListener("click", (event) => { if (event.target.closest("a")) closeMenu(false); });
  });
  const onWide = () => {
    if (wide.matches && menu) {
      closeMenu(false);
      rail.querySelector("a")?.focus();
    }
  };
  wide.addEventListener("change", onWide);
  signOut.addEventListener("click", async () => {
    try { await post("/api/auth/sign-out", {}); } finally { session.user = null; navigate("/sign-in", { replace: true }); }
  });
  return {
    view,
    status: (text) => announce(status, text),
    alert: (text) => announce(alert, text),
    destroy() { stopTimer(); wide.removeEventListener("change", onWide); closeMenu(false); },
  };
}

export function publicShell(root) {
  const view = h("main", { id: "view", tabindex: "-1" });
  const bar = marquee();
  root.replaceChildren(h("div", { class: "public" }, bar.el, view));
  return { view, status: () => {}, alert: () => {}, destroy() { bar.destroy(); } };
}
