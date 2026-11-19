// The one announcement rule: every result is written into the page's polite
// status region, which is emptied first so a repeated message is announced
// afresh.

const pending = new WeakMap();

export function statusRegion() {
  return document.querySelector('[data-status-region]');
}

export function announce(message) {
  const region = statusRegion();
  if (!region) return;
  const timer = pending.get(region);
  if (timer) clearTimeout(timer);
  region.textContent = '';
  pending.set(
    region,
    setTimeout(() => {
      region.textContent = message;
      pending.delete(region);
    }, 60)
  );
}

export function clearStatus() {
  const region = statusRegion();
  if (!region) return;
  const timer = pending.get(region);
  if (timer) clearTimeout(timer);
  region.textContent = '';
}
