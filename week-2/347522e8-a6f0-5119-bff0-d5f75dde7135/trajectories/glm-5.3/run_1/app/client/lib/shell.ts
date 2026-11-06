// The app shell: routing, role landing, the header and the phone menu.
// Each screen is a render function that receives a mount point.

import { apiJson, postJson, deleteJson, type User } from "./api.js";
import { clear, el, trapFocus } from "./dom.js";

export type Navigate = (path: string, replace?: boolean) => void;

export type AppCtx = {
  user: User;
  navigate: Navigate;
  today: string;
  rerender: () => Promise<void>;
};

export type Screen = {
  path: string;
  title: string;
  render: (mount: HTMLElement, ctx: AppCtx) => Promise<void> | void;
};

export const kitchenToday = (): string => {
  // Filled by /api/stations on load; falls back to the server date endpoint.
  return window.__railsideToday ?? "";
};

declare global {
  interface Window {
    __railsideToday?: string;
  }
}

export const roleLanding = (user: User): string => {
  if (user.role === "operator") return "/operator";
  if (user.role === "shift_lead") return "/shift";
  if (user.renter_status === "applied" || user.renter_status === "documents_review") return "/kitchen";
  return "/board";
};

export const headerFor = (user: User, navigate: Navigate): HTMLElement => {
  const links: { href: string; label: string }[] = [];
  if (user.role === "renter") links.push({ href: "/board", label: "Board" }, { href: "/kitchen", label: "My kitchen" });
  if (user.role === "operator") links.push({ href: "/operator", label: "Operator" }, { href: "/board", label: "Board" }, { href: "/shift", label: "Shift" });
  if (user.role === "shift_lead") links.push({ href: "/shift", label: "Shift" }, { href: "/board", label: "Board" });

  const onSignOut = async (event: Event): Promise<void> => {
    event.preventDefault();
    try {
      await deleteJson("/api/session");
    } finally {
      navigate("/", true);
    }
  };

  const makeLinks = (): HTMLElement[] =>
    links.map((link) => el("a", { href: link.href }, link.label));

  const signOut = el("button", { type: "button" }, "Sign out");
  signOut.addEventListener("click", onSignOut);
  const signOutDrawer = el("button", { type: "button" }, "Sign out");
  signOutDrawer.addEventListener("click", onSignOut);

  const nav = el("nav", { "aria-label": "Main" }, ...makeLinks());
  const brand = el("span", { class: "brand" }, "Railside");

  // The drawer exists at every width; CSS hides the toggle above 768px and
  // keeps the inline nav visible there (DP-55).
  const menuButton = el(
    "button",
    { type: "button", class: "menu-toggle", "aria-expanded": "false", "aria-controls": "main-menu-drawer" },
    "Menu",
  );

  const drawer = el("div", { class: "menu-drawer", id: "main-menu-drawer", hidden: true });
  drawer.append(...makeLinks(), signOutDrawer);

  const closeDrawer = (): void => {
    drawer.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.focus();
  };
  const onDrawerKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeDrawer();
      return;
    }
    // While open, Tab and Shift+Tab cycle through Menu and the drawer's
    // controls only, so the header becomes the focus scope (DP-55).
    trapFocus(drawer.parentElement as HTMLElement, event);
  };
  menuButton.addEventListener("click", () => {
    if (!drawer.hidden) {
      closeDrawer();
      return;
    }
    drawer.hidden = false;
    menuButton.setAttribute("aria-expanded", "true");
    const first = drawer.querySelector<HTMLElement>("a, button");
    if (first) first.focus();
  });
  drawer.addEventListener("keydown", onDrawerKey);
  menuButton.addEventListener("keydown", (event) => {
    if (!drawer.hidden) onDrawerKey(event);
  });
  document.addEventListener("keydown", (event) => {
    if (!drawer.hidden && event.key === "Escape") {
      event.preventDefault();
      closeDrawer();
    }
  });
  drawer.addEventListener("click", (event) => {
    if (event.target instanceof HTMLElement && event.target.closest("a")) closeDrawer();
  });

  return el("header", { class: "app-header" }, brand, menuButton, nav, signOut, drawer);
};

export const screenFrame = (user: User, navigate: Navigate, body: HTMLElement, h: string): HTMLElement => {
  const header = headerFor(user, navigate);
  const main = el("main", { class: "screen" }, body);
  const frame = el("div", { class: "frame" }, header, main);
  const heading = el("h1", { id: "screen-heading" }, h);
  body.prepend(heading);
  frame.addEventListener("keydown", (event) => {
    trapFocus(frame, event);
  });
  return frame;
};

export const loadUser = async (): Promise<User | null> => {
  try {
    const data = await apiJson<{ user: User }>("/api/me");
    return data.user;
  } catch {
    return null;
  }
};

export const signIn = (email: string, password: string): Promise<{ user: User }> =>
  postJson<{ user: User }>("/api/session", { email, password });
