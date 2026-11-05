import { settle, tween } from "../lib/motion";
import type { EntrySummary } from "../../shared/domain";

// The case-study open: the activated card lifts out of the deck and grows to fill the stage over
// about two-thirds of a second (a FLIP overlay that animates transform only), then the text appears.
// Going back plays the same movement in reverse onto the card.

const LIFT_MS = 667;

export const lift: { slug: string | null; rect: DOMRect | null; entry: EntrySummary | null } = { slug: null, rect: null, entry: null };
export const returning: { slug: string | null } = { slug: null };

function overlayFor(): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.className = "lift";
  overlay.setAttribute("aria-hidden", "true");
  document.body.append(overlay);
  return overlay;
}

function place(overlay: HTMLElement, rect: DOMRect, progress: number, direction: "open" | "close") {
  const t = direction === "open" ? settle(progress) : 1 - settle(progress);
  const width = window.innerWidth;
  const height = window.innerHeight;
  const scaleX = rect.width / width + (1 - rect.width / width) * t;
  const scaleY = rect.height / height + (1 - rect.height / height) * t;
  const x = rect.left * (1 - t);
  const y = rect.top * (1 - t);
  overlay.style.transform = `translate(${x}px, ${y}px) scale(${scaleX}, ${scaleY})`;
  overlay.style.boxShadow = `0 ${12 + 28 * t}px ${32 + 48 * t}px -18px rgba(26, 29, 38, ${0.28 + 0.1 * t})`;
}

/** Plays the lift from `rect` to the full stage (open) or from the stage back onto `card` (close). */
export function playLift(target: HTMLElement | DOMRect, direction: "open" | "close", done?: () => void): () => void {
  const rect = target instanceof HTMLElement ? target.getBoundingClientRect() : target;
  const overlay = overlayFor();
  place(overlay, rect, 0, direction);
  const cancel = tween(
    LIFT_MS,
    (p) => place(overlay, rect, p, direction),
    () => {
      overlay.remove();
      done?.();
    },
  );
  return () => {
    cancel();
    overlay.remove();
  };
}
