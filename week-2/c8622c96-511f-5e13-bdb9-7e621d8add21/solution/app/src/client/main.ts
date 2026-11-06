// Boot, sign-in, the shell and section routing.
import { attempt, call, DATABASE_DOWN, get, NETWORK_DOWN, whenSignedOut } from "./api.js";
import { h, icon, replace } from "./dom.js";
import type { Role, User } from "./types.js";
import { mountSheet } from "./sheet.js";
import { mountStudio } from "./studio.js";
import { mountRoyalties } from "./royalties.js";
import { mountShortlist } from "./shortlist.js";
import { mountFollowing } from "./following.js";
import { mountLicences } from "./licences.js";
import { mountUsage } from "./usage.js";
import { mountReview } from "./review.js";
import { mountAllEssays } from "./all-essays.js";
import { mountRates } from "./rates.js";
import { mountStatements } from "./statements.js";

export interface AppContext {
  user: User;
}

type Mount = (root: HTMLElement, app: AppContext) => () => void;

const SCREENS: Record<string, { label: string; mount: Mount }> = {
  "/sheet": { label: "Contact sheet", mount: mountSheet },
  "/studio": { label: "Studio", mount: mountStudio },
  "/royalties": { label: "Royalties", mount: mountRoyalties },
  "/shortlist": { label: "Shortlist", mount: mountShortlist },
  "/licences": { label: "Licences", mount: mountLicences },
  "/following": { label: "Following", mount: mountFollowing },
  "/usage": { label: "Usage", mount: mountUsage },
  "/review": { label: "Review queue", mount: mountReview },
  "/essays": { label: "All essays", mount: mountAllEssays },
  "/rates": { label: "Rates", mount: mountRates },
  "/statements": { label: "Statements", mount: mountStatements },
};

const SECTIONS: Record<Role, string[]> = {
  contributor: ["/sheet", "/studio", "/royalties"],
  picture_editor: ["/sheet", "/shortlist", "/licences", "/following"],
  licensing_manager: ["/licences", "/usage"],
  desk_editor: ["/sheet", "/review", "/essays"],
  treasurer: ["/rates", "/statements"],
};

const root = document.getElementById("app") as HTMLElement;
let cleanup: () => void = () => undefined;
let currentPath = "";

function showSignIn(): void {
  cleanup();
  cleanup = () => undefined;
  currentPath = "";
  document.title = "Sign in · Saltprint Desk";
  const email = h("input", { id: "signin-email", type: "email", name: "email", autocomplete: "username", required: true });
  const password = h("input", { id: "signin-password", type: "password", name: "password", autocomplete: "current-password",
    required: true });
  const alert = h("p", { class: "signin-alert", role: "alert", hidden: true });
  const button = h("button", { type: "submit", class: "button button-primary button-wide" }, "Sign in");
  const form = h("form", { class: "signin-form", novalidate: true },
    h("label", { for: "signin-email" }, "Email"), email,
    h("label", { for: "signin-password" }, "Password"), password,
    alert, button);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      button.disabled = true;
      const answer = await attempt(() => call<{ user: User }>("POST", "/api/session",
        { email: email.value, password: password.value }));
      button.disabled = false;
      if (answer?.ok && answer.data) {
        start(answer.data.user);
        return;
      }
      alert.hidden = false;
      alert.textContent = answer === null ? NETWORK_DOWN
        : answer.status === 503 ? DATABASE_DOWN
          : answer.status === 401 ? "That email and password don't match a Saltprint account. Check them and try again."
            : "Enter your email and password.";
      password.value = "";
      password.focus();
    })();
  });
  replace(root, h("main", { class: "signin" },
    h("div", { class: "signin-column" },
      h("p", { class: "signin-coop" }, "Saltprint Picture Co-operative"),
      h("h1", { class: "signin-title" }, "Sign in to Saltprint Desk"),
      h("p", { class: "signin-lede" }, "The co-operative's licensing desk for embargoed photo essays."),
      form)));
}

function shell(user: User, path: string): HTMLElement {
  const nav = h("nav", { class: "sections", "aria-label": "Desk sections" },
    ...SECTIONS[user.role].map((p) => h("a", {
      href: p, class: "section-link", "aria-current": p === path ? "page" : null,
      onclick: (event: Event) => {
        const e = event as MouseEvent;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(p);
      },
    }, SCREENS[p]?.label ?? p)));
  const signOut = h("button", { type: "button", class: "button button-quiet signout" }, icon("log-out"), "Sign out");
  signOut.addEventListener("click", () => {
    void attempt(() => call("DELETE", "/api/session")).then(() => {
      history.replaceState(null, "", "/sheet");
      showSignIn();
    });
  });
  return h("header", { class: "topbar" },
    h("div", { class: "masthead" },
      h("p", { class: "brand" }, "Saltprint Desk"),
      h("p", { class: "who" }, h("span", { class: "who-name" }, user.name),
        h("span", { class: "who-room" }, user.newsroom?.name ?? "Saltprint Picture Co-operative"))),
    nav, signOut);
}

let user: User | null = null;

function render(): void {
  if (!user) return;
  const path = location.pathname;
  if (path === currentPath) return;
  cleanup();
  currentPath = path;
  const screen = SCREENS[path];
  const main = h("main", { class: "screen", id: "main" });
  replace(root, shell(user, path), h("p", { class: "outage", role: "alert", id: "outage", hidden: true }), main);
  document.title = `${screen?.label ?? "Saltprint Desk"} · Saltprint Desk`;
  cleanup = screen ? screen.mount(main, { user }) : () => undefined;
}

export function navigate(path: string): void {
  history.pushState(null, "", path);
  render();
}

function start(signedIn: User): void {
  user = signedIn;
  const sections = SECTIONS[signedIn.role];
  if (!sections.includes(location.pathname)) history.replaceState(null, "", sections[0]);
  currentPath = "";
  render();
}

window.addEventListener("popstate", () => {
  if (location.pathname !== currentPath) render();
});

whenSignedOut(() => {
  user = null;
  showSignIn();
});

void (async () => {
  const answer = await attempt(() => get<{ user: User }>("/api/me"));
  if (answer?.ok && answer.data) start(answer.data.user);
  else showSignIn();
})();
