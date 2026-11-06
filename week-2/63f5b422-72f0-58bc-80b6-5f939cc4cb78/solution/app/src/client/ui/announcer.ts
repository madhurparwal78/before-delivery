/**
 * The announcer (`#announcer`, the only live region for notices) and the toast that repeats a notice
 * after the person's own action. Both are written directly, inside whatever handler produced the
 * notice, so they update without waiting for a render or a timer.
 */

const TOAST_MS = 4000;
let toastTimer = 0;

export function announce(text: string, own = false): void {
  const region = document.getElementById("announcer");
  if (!region) return;
  const count = Number(region.getAttribute("data-announcement-count") ?? "0") + 1;
  region.setAttribute("data-announcement-count", String(count));
  region.textContent = text;
  if (own) toast(text);
}

function toast(text: string): void {
  const element = document.querySelector<HTMLElement>("[data-toast]");
  if (!element) return;
  element.textContent = text;
  element.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    element.hidden = true;
    element.textContent = "";
  }, TOAST_MS);
}
