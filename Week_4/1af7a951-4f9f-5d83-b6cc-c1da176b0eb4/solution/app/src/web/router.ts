import { useEffect, useState, type MouseEvent } from "react";

export type Screen =
  | { name: "cohorts" }
  | { name: "enroll"; cohortId: string }
  | { name: "enrollment"; enrollmentId: string }
  | { name: "signin"; next: string | null }
  | { name: "logbook" }
  | { name: "coach"; cohortId: string | null }
  | { name: "not-found" };

function screenOf(location: Location): Screen {
  const path = location.pathname;
  const query = new URLSearchParams(location.search);
  const enroll = /^\/enroll\/([^/]+)$/.exec(path);
  if (enroll?.[1]) return { name: "enroll", cohortId: decodeURIComponent(enroll[1]) };
  const enrollment = /^\/enrollments\/([^/]+)$/.exec(path);
  if (enrollment?.[1]) return { name: "enrollment", enrollmentId: decodeURIComponent(enrollment[1]) };
  if (path === "/") return { name: "cohorts" };
  if (path === "/signin") return { name: "signin", next: query.get("next") };
  if (path === "/logbook") return { name: "logbook" };
  if (path === "/coach") return { name: "coach", cohortId: query.get("cohort") || null };
  return { name: "not-found" };
}

const CHANGE = "lanternfish:navigate";

export function navigate(path: string, options: { replace?: boolean; state?: unknown } = {}): void {
  if (options.replace) history.replaceState(options.state ?? null, "", path);
  else history.pushState(options.state ?? null, "", path);
  window.dispatchEvent(new Event(CHANGE));
  window.scrollTo({ top: 0 });
}

export function useScreen(): Screen {
  const [screen, setScreen] = useState(() => screenOf(location));
  useEffect(() => {
    const update = () => setScreen(screenOf(location));
    window.addEventListener("popstate", update);
    window.addEventListener(CHANGE, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(CHANGE, update);
    };
  }, []);
  return screen;
}

/** Same-origin links that route inside the app without a page load. */
export function follow(event: MouseEvent<HTMLAnchorElement>): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(event.currentTarget.getAttribute("href") ?? "/");
}
