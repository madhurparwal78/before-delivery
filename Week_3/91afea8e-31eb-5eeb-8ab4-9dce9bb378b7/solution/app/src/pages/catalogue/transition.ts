import { flushSync } from "react-dom";
import type { NavigateFunction } from "react-router-dom";

const NAME = "product-hero";

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Opens a product from a card: the card image morphs into the product hero (View Transitions API). Without the API,
 * or under reduced motion, the page swaps at once. Modified clicks are left to the browser.
 */
export function openProduct(event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; preventDefault: () => void }, navigate: NavigateFunction, to: string, image: HTMLElement | null): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (typeof document.startViewTransition !== "function" || reducedMotion() || !image) {
    navigate(to);
    return;
  }
  image.style.viewTransitionName = NAME;
  const transition = document.startViewTransition(() => flushSync(() => navigate(to)));
  void transition.finished.finally(() => {
    image.style.viewTransitionName = "";
  });
}

/**
 * Back from a product: the browser's own pop is held back until the transition has captured the hero, then replayed
 * inside it, so the hero morphs back into the card it came from.
 */
export function holdBackNavigation(productId: string): () => void {
  let replaying = false;
  const onPop = (event: PopStateEvent): void => {
    if (replaying || typeof document.startViewTransition !== "function" || reducedMotion()) return;
    event.stopImmediatePropagation();
    let card: HTMLElement | null = null;
    const transition = document.startViewTransition(() => {
      flushSync(() => {
        replaying = true;
        window.dispatchEvent(new PopStateEvent("popstate", { state: event.state }));
        replaying = false;
      });
      card = document.querySelector<HTMLElement>(`[data-product="${CSS.escape(productId)}"] img`);
      if (card) card.style.viewTransitionName = NAME;
    });
    void transition.finished.finally(() => {
      if (card) (card as HTMLElement).style.viewTransitionName = "";
    });
  };
  window.addEventListener("popstate", onPop, true);
  return () => window.removeEventListener("popstate", onPop, true);
}
