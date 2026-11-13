import { el } from "./dom.js";
import { DateTime } from "luxon";

export const DURATIONS = {
  short: 160,
  medium: 320,
  long: 640,
} as const;

export const EASING = "cubic-bezier(0.2, 0, 0.2, 1)";

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Animate via the browser's Web Animations interface or jump to the end state. */
export function animate(
  node: Element,
  keyframes: Keyframe[],
  duration: number,
  fill: FillMode = "forwards"
): Animation | null {
  if (prefersReducedMotion()) {
    if (keyframes.length > 0) {
      const last = keyframes[keyframes.length - 1] as Keyframe | undefined;
      if (last) {
        for (const [property, value] of Object.entries(last)) {
          if (property === "offset") continue;
          (node as HTMLElement).style.setProperty(property, String(value));
        }
      }
    }
    return null;
  }
  return node.animate(keyframes, { duration, easing: EASING, fill });
}

/** Open motion: fade and rise slightly. */
export function openDialogMotion(node: HTMLElement): void {
  animate(
    node,
    [
      { opacity: "0", transform: "translateY(8px)" },
      { opacity: "1", transform: "translateY(0)" },
    ],
    DURATIONS.short
  );
}

/** Close motion: fade on close. Returns the duration to wait (0 under reduced motion). */
export function closeDialogMotion(node: HTMLElement): number {
  if (prefersReducedMotion()) {
    return 0;
  }
  animate(node, [{ opacity: "1" }, { opacity: "0" }], DURATIONS.short);
  return DURATIONS.short;
}

/** Price roll: old value slides up and out while the new slides in, both medium. */
export function rollValue(container: HTMLElement, renderNew: () => HTMLElement): void {
  const old = container.firstElementChild as HTMLElement | null;
  const fresh = renderNew();
  if (!old) {
    container.append(fresh);
    return;
  }
  if (prefersReducedMotion()) {
    container.replaceChildren(fresh);
    return;
  }
  old.style.position = "absolute";
  old.style.inset = "0";
  old.animate(
    [
      { transform: "translateY(0)", opacity: "1" },
      { transform: "translateY(-100%)", opacity: "0" },
    ],
    { duration: DURATIONS.medium, easing: EASING, fill: "forwards" }
  );
  fresh.style.position = "absolute";
  fresh.style.inset = "0";
  fresh.animate(
    [
      { transform: "translateY(100%)", opacity: "0" },
      { transform: "translateY(0)", opacity: "1" },
    ],
    { duration: DURATIONS.medium, easing: EASING, fill: "forwards" }
  );
  container.append(fresh);
  const oldNode = old;
  window.setTimeout(() => {
    oldNode.remove();
    fresh.style.position = "";
    fresh.style.inset = "";
  }, DURATIONS.medium);
}

export function announce(message: string, link?: { label: string; href: string }): void {
  const region = document.getElementById("announcements");
  if (!region) return;
  const live = el("p", {}, message);
  if (link) {
    live.append(" ", el("a", { href: link.href, class: "link" }, link.label));
  }
  region.replaceChildren(live);
}

export function formatDate(date: string, zone = "America/Phoenix"): string {
  return DateTime.fromISO(date, { zone }).toFormat("ccc dd MMM yyyy");
}

export function formatInstant(instant: string, zone: string): string {
  return DateTime.fromISO(instant, { zone }).toFormat("ccc dd MMM yyyy, HH:mm");
}

export function formatMoney(amountCents: number): string {
  const dollars = Math.floor(Math.abs(amountCents) / 100);
  const cents = Math.abs(amountCents) % 100;
  const groups = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = amountCents < 0 ? "-" : "";
  return `${sign}$${groups}.${cents.toString().padStart(2, "0")}`;
}
