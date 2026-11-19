export function announce(region: HTMLElement, text: string, force = false): void {
  if (!force && region.textContent === text) return;
  region.textContent = '';
  region.textContent = text;
}

export function statusRegion(name: string, extraClass = ''): HTMLElement {
  const node = document.createElement('p');
  node.setAttribute('role', 'status');
  node.setAttribute('aria-live', 'polite');
  node.setAttribute('aria-label', name);
  node.className = `status ${extraClass}`.trim();
  return node;
}

export function alertRegion(name: string): HTMLElement {
  const node = document.createElement('p');
  node.setAttribute('role', 'alert');
  node.setAttribute('aria-label', name);
  node.className = 'alert';
  return node;
}
