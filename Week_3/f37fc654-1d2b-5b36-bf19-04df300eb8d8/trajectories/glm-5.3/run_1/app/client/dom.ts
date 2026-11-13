/** DOM helpers and live regions. */

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | null> = {}, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Sets a live region's message. */
export function setStatus(node: HTMLElement | null, message: string): void {
  if (!node) return;
  node.textContent = message;
}

/** Announces through a toast pinned for six seconds. */
export function toast(text: string): void {
  const region = document.getElementById('notices');
  if (!region) return;
  const item = el('div', { class: 'toast' }, text);
  region.append(item);
  setTimeout(() => {
    item.classList.add('toast-out');
    setTimeout(() => item.remove(), 300);
  }, 6000);
}
