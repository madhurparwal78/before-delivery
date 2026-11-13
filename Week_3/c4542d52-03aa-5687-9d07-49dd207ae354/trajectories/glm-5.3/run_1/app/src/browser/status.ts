// The polite status region named "Register updates", present from first paint.
// Each announcement is made exactly once per event per page.

let region: HTMLElement | null = null;
const announced = new Set<string>();

export function ensureStatusRegion(): HTMLElement {
  if (region && document.getElementById('status')) return region;
  region = document.createElement('div');
  region.id = 'status';
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  region.className = 'status-region';
  region.textContent = 'Register updates';
  document.body.appendChild(region);
  return region;
}

export function announce(message: string, key?: string): void {
  ensureStatusRegion();
  if (key) {
    if (announced.has(key)) return;
    announced.add(key);
  }
  const r = document.getElementById('status');
  if (r) {
    const node = document.createElement('p');
    node.textContent = message;
    r.appendChild(node);
    // Keep the region tidy.
    while (r.childNodes.length > 4) r.removeChild(r.firstChild!);
  }
}

export function resetAnnouncements(): void {
  announced.clear();
}
