/** The shared signed-in shell: top bar with the kitchen clock, navigation and sign-out. */

import type { User } from "../shared/api-types.js";
import { kitchenClockFormatter } from "./kitchen-time.js";

export interface Shell {
  root: HTMLElement;
  nav: HTMLElement;
  clock: HTMLElement;
  updateClock(epochMs: number): void;
}

export interface NavItem {
  path: string;
  label: string;
}

export const NAV_BY_ROLE: Record<User["role"], NavItem[]> = {
  operator: [
    { path: "/", label: "Dial" },
    { path: "/bookings", label: "Bookings" },
    { path: "/documents", label: "Documents" },
    { path: "/billing", label: "Billing" },
    { path: "/tenants", label: "Tenants" },
    { path: "/settings", label: "Settings" }
  ],
  owner: [
    { path: "/", label: "Dial" },
    { path: "/bookings", label: "Bookings" },
    { path: "/documents", label: "Documents" },
    { path: "/billing", label: "Billing" }
  ],
  cook: [
    { path: "/", label: "Dial" },
    { path: "/bookings", label: "Bookings" }
  ]
};

export function buildShell(
  parent: HTMLElement,
  user: User,
  kitchenZone: string,
  currentPath: string,
  onSignOut: () => void,
  onNavigate: (path: string) => void
): Shell {
  parent.replaceChildren();

  const topbar = document.createElement("header");
  topbar.className = "topbar";

  const brand = document.createElement("span");
  brand.className = "brand";
  brand.textContent = "Stationkeeper";
  topbar.appendChild(brand);

  const clock = document.createElement("span");
  clock.className = "kitchen-clock";
  clock.textContent = "Kitchen time --:--";
  topbar.appendChild(clock);

  const menuButton = document.createElement("button");
  menuButton.className = "btn menu-button";
  menuButton.textContent = "Menu";
  menuButton.setAttribute("aria-expanded", "false");
  topbar.appendChild(menuButton);

  const nav = document.createElement("nav");
  nav.className = "topnav";
  nav.setAttribute("aria-label", "Main");
  for (const item of NAV_BY_ROLE[user.role]) {
    const link = document.createElement("a");
    link.href = item.path;
    link.textContent = item.label;
    if (item.path === currentPath || (item.path === "/" && currentPath === "/")) {
      link.setAttribute("aria-current", "page");
    }
    link.addEventListener("click", (event) => {
      event.preventDefault();
      onNavigate(item.path);
    });
    nav.appendChild(link);
  }
  topbar.appendChild(nav);

  const spacer = document.createElement("span");
  spacer.className = "spacer";
  topbar.appendChild(spacer);

  const signOut = document.createElement("button");
  signOut.className = "btn";
  signOut.textContent = "Sign out";
  signOut.addEventListener("click", () => onSignOut());
  topbar.appendChild(signOut);

  menuButton.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    menuButton.setAttribute("aria-expanded", String(open));
  });

  parent.appendChild(topbar);

  const formatClock = kitchenClockFormatter(kitchenZone);
  const shell: Shell = {
    root: parent,
    nav,
    clock,
    updateClock(epochMs: number): void {
      clock.textContent = `Kitchen time ${formatClock(epochMs)}`;
    }
  };
  return shell;
}

export function removeLiveRegions(): void {
  document.querySelector(".live-regions")?.remove();
}

export function liveRegionElements(): { activity: HTMLElement; problem: HTMLElement } {
  const activity = document.querySelector<HTMLElement>(".activity");
  const problem = document.querySelector<HTMLElement>(".problem");
  if (activity === null || problem === null) {
    throw new Error("live regions missing");
  }
  return { activity, problem };
}
