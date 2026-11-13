const regions: Record<string, HTMLElement> = {};

/** Announces a message in the named polite live region, creating it once. */
export function announce(region: string, text: string): void {
  let node = regions[region];
  if (!node) {
    node = document.createElement('div');
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    node.setAttribute('aria-label', region);
    node.className = 'visually-hidden';
    document.body.appendChild(node);
    regions[region] = node;
  }
  node.textContent = '';
  setTimeout(() => {
    node!.textContent = text;
  }, 10);
}
