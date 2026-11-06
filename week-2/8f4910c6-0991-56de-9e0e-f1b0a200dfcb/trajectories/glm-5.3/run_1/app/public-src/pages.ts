import { api, ApiFail, link, el, button, focusElement, focusHeading } from "./lib.js";
import { readTray } from "./stores.js";
import { formatReach, formatHeight, formatGirth, formatMoney } from "../shared/format.js";

export interface Page {
  path: string;
  title: () => string;
  render: (main: HTMLElement, params: URLSearchParams) => Promise<void> | void;
  workspace?: boolean;
}

export const pages: Page[] = [];

export function register(page: Page): void {
  pages.push(page);
}

/** Finds the page whose path matches the location. */
export function matchPath(pathname: string): Page | null {
  for (const page of pages) {
    if (page.path === pathname) return page;
    if (page.path.includes(":")) {
      const pattern = page.path.split("/");
      const actual = pathname.split("/");
      if (pattern.length === actual.length && pattern.every((seg, i) => seg.startsWith(":") || seg === actual[i])) {
        return page;
      }
    }
  }
  return null;
}

export function queryParams(): URLSearchParams {
  return new URLSearchParams(location.search);
}

/** An accessible live region for announcements. */
export function liveRegion(name: string, label: string): HTMLElement {
  const node = el("div");
  node.id = `live-${name}`;
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "polite");
  node.className = "status-live visually-hidden";
  node.dataset.label = label;
  return node;
}

export function announce(node: HTMLElement | null, message: string): void {
  if (!node) return;
  node.textContent = message;
}

export { api, ApiFail, link, el, button, focusElement, focusHeading, readTray, formatReach, formatHeight, formatGirth, formatMoney };
