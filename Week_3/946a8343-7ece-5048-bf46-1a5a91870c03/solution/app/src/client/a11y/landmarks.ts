// F6 / Shift+F6 landmark cycling. Order: header, files nav, main, panel, footer (only those present and visible).
//   header   <header> (the shell banner)       focus goes to its first focusable control
//   files    [data-landmark="files"]           the file list navigation (merge request pages, editor tree)
//   main     <main>                            main itself (tabindex -1)
//   panel    [data-landmark="panel"]           the right-hand panel (merge request panel)
//   footer   <footer> (contentinfo)            its first focusable link
// Page contributors mark their files nav and panel with data-landmark="files" / "panel". Focus is never trapped: the cycle
// wraps and every other key behaves as usual. `installLandmarkKeys()` is called once from main.tsx.
import { hasOpenDialog } from "./dialog.tsx";

interface Landmark {
  element: HTMLElement;
  focusFirst: boolean;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function visible(element: HTMLElement): boolean {
  return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
}

function collect(): Landmark[] {
  const found: Array<Landmark | null> = [
    pick("header.sp-header, header[role='banner']", true),
    pick("[data-landmark='files']", false),
    pick("main", false),
    pick("[data-landmark='panel']", false),
    pick("footer.sp-footer, footer[role='contentinfo']", true),
  ];
  return found.filter((entry): entry is Landmark => entry !== null);
}

function pick(selector: string, focusFirst: boolean): Landmark | null {
  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    if (visible(element) && !element.closest("[inert]")) return { element, focusFirst };
  }
  return null;
}

function focusLandmark(landmark: Landmark): void {
  const inner = landmark.focusFirst ? [...landmark.element.querySelectorAll<HTMLElement>(FOCUSABLE)].find(visible) : undefined;
  if (inner) {
    inner.focus();
    return;
  }
  if (!landmark.element.hasAttribute("tabindex")) landmark.element.setAttribute("tabindex", "-1");
  landmark.element.focus();
}

function cycleLandmark(backwards: boolean): void {
  const all = collect();
  if (all.length === 0) return;
  const active = document.activeElement;
  let index = all.findIndex((entry) => active !== null && entry.element.contains(active));
  if (index === -1) index = backwards ? 0 : all.length - 1;
  const next = (index + (backwards ? -1 : 1) + all.length) % all.length;
  const target = all[next];
  if (target) focusLandmark(target);
}

export function installLandmarkKeys(): void {
  document.addEventListener("keydown", (event) => {
    if (event.key !== "F6" || event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented) return;
    if (hasOpenDialog()) return;
    event.preventDefault();
    cycleLandmark(event.shiftKey);
  });
}
