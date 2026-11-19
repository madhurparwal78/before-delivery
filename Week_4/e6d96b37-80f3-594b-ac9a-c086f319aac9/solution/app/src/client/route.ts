// A small history router for the published pages; links navigate in place so the live desk stays open.

import { useEffect, useState, type MouseEvent } from "react";
import { WORKSPACES, type WorkspaceSlug } from "../shared/drafts";

type Route =
  | { kind: "root" }
  | { kind: "home"; ns: string }
  | { kind: "workspace"; ns: string; slug: WorkspaceSlug }
  | { kind: "help"; page: "help" | "evidence" | "keyboard" }
  | { kind: "signin-down" };

const SLUGS = Object.values(WORKSPACES) as string[];

function parse(path: string): Route {
  const desk = /^\/desk\/([a-z0-9-]+)(?:\/([a-z]+))?$/.exec(path);
  if (desk && !desk[2]) return { kind: "home", ns: desk[1]! };
  if (desk && SLUGS.includes(desk[2]!)) return { kind: "workspace", ns: desk[1]!, slug: desk[2] as WorkspaceSlug };
  if (path === "/help") return { kind: "help", page: "help" };
  if (path === "/help/evidence") return { kind: "help", page: "evidence" };
  if (path === "/help/keyboard") return { kind: "help", page: "keyboard" };
  if (path.startsWith("/auth/")) return { kind: "signin-down" };
  return { kind: "root" };
}

export function navigate(href: string): void {
  history.pushState(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0 });
}

/** Click handler for in-app links: plain left clicks navigate without a reload. */
export function follow(event: MouseEvent<HTMLAnchorElement>): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(event.currentTarget.getAttribute("href")!);
}

export function useLocation(): { route: Route; query: URLSearchParams } {
  const read = () => ({ route: parse(location.pathname), query: new URLSearchParams(location.search) });
  const [value, setValue] = useState(read);
  useEffect(() => {
    const update = () => setValue(read());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return value;
}

type Layout = "phone" | "tablet" | "desktop";

/** The published layout for the current width: phone below 768, tablet to 1279, desktop from 1280. */
export function useLayout(): Layout {
  const read = (): Layout => (window.matchMedia("(min-width: 1280px)").matches ? "desktop" : window.matchMedia("(min-width: 768px)").matches ? "tablet" : "phone");
  const [layout, setLayout] = useState(read);
  useEffect(() => {
    const queries = [window.matchMedia("(min-width: 1280px)"), window.matchMedia("(min-width: 768px)")];
    const update = () => setLayout(read());
    queries.forEach((q) => q.addEventListener("change", update));
    return () => queries.forEach((q) => q.removeEventListener("change", update));
  }, []);
  return layout;
}
