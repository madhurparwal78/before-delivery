// Live regions: present in the page before any text arrives, written once per event.

export function announce(region, text) {
  if (!region) return;
  region.textContent = "";
  queueMicrotask(() => { region.textContent = text; });
}
