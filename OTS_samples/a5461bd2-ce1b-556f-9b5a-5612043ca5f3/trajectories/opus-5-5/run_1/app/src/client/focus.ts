const CLEAR_TOP = 72;

let pointerTarget: Element | null = null;
let tabScrollY: number | null = null;

export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function revealInStrip(el: Element): void {
  const strip = el.closest(".strip");
  if (strip === null || strip.scrollWidth <= strip.clientWidth) return;
  const box = el.getBoundingClientRect();
  const frame = strip.getBoundingClientRect();
  if (box.left < frame.left) strip.scrollLeft -= frame.left - box.left;
  else if (box.right > frame.right) strip.scrollLeft += box.right - frame.right;
}

/** Scrolls the page just enough to bring the element below the header and inside the viewport. */
function scrollIntoClearZone(el: Element): void {
  revealInStrip(el);
  if (el.closest("[role=dialog]") !== null) return;
  const box = el.getBoundingClientRect();
  const height = window.innerHeight;
  let delta = 0;
  if (box.top < CLEAR_TOP) delta = box.top - CLEAR_TOP;
  else if (box.bottom > height) delta = box.height <= height - CLEAR_TOP ? box.bottom - height : box.top - CLEAR_TOP;
  if (delta !== 0) window.scrollTo(0, window.scrollY + delta);
}

/** Moves focus by script; the focusin rule below then scrolls it clear of the header. */
export function moveFocus(el: HTMLElement | null): void {
  el?.focus({ preventScroll: true });
}

function focusedByPointer(el: Element): boolean {
  if (pointerTarget === null) return false;
  if (el.contains(pointerTarget)) return true;
  const label = pointerTarget.closest("label");
  return label !== null && label.control === el;
}

export function installFocusRule(): void {
  document.documentElement.style.scrollBehavior = "auto";
  document.addEventListener(
    "pointerdown",
    (event) => {
      pointerTarget = event.target instanceof Element ? event.target : null;
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (event) => {
      pointerTarget = null;
      if (event.key !== "Tab") return;
      tabScrollY = window.scrollY;
      setTimeout(() => (tabScrollY = null), 0);
    },
    true,
  );
  document.addEventListener(
    "click",
    () => {
      setTimeout(() => (pointerTarget = null), 0);
    },
    true,
  );
  document.addEventListener("focusin", (event) => {
    const el = event.target;
    if (!(el instanceof Element) || focusedByPointer(el)) return;
    // The browser has already centred the element for Tab; start from where the page was instead.
    if (tabScrollY !== null && window.scrollY !== tabScrollY) window.scrollTo(0, tabScrollY);
    scrollIntoClearZone(el);
  });
}

/** Keeps Tab and Shift+Tab inside a modal container. */
export function trapTab(container: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== "Tab") return;
  const focusables = [...container.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input, select, textarea")].filter(
    (el) => el.getClientRects().length > 0,
  );
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !container.contains(active))) {
    event.preventDefault();
    moveFocus(last);
  } else if (!event.shiftKey && (active === last || !container.contains(active))) {
    event.preventDefault();
    moveFocus(first);
  }
}
