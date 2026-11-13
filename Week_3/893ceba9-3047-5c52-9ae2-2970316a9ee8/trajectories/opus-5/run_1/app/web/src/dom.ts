// Small element helpers shared by every screen.

type Handler = (event: never) => void;

type Attrs = Record<string, string | number | boolean | null | undefined | Handler>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (name.startsWith('on') && typeof value === 'function') {
      node.addEventListener(name.slice(2), value as EventListener);
    } else if (name === 'class') {
      node.className = String(value);
    } else if (name === 'text') {
      node.textContent = String(value);
    } else if (name === 'html') {
      node.innerHTML = String(value);
    } else if (value === true) {
      node.setAttribute(name, '');
    } else {
      node.setAttribute(name, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// localTime shows a server time in the browser's local 24-hour clock.
export function localTime(iso: string): string {
  const at = new Date(iso);
  const hours = String(at.getHours()).padStart(2, '0');
  const minutes = String(at.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function statusWord(status: string): string {
  switch (status) {
    case 'untranslated':
      return 'Untranslated';
    case 'drafted':
      return 'Drafted';
    case 'scored':
      return 'Scored';
    case 'needs_review':
      return 'Needs review';
    case 'approved':
      return 'Approved';
    case 'open':
      return 'Open';
    case 'in_review':
      return 'In review';
    case 'merged':
      return 'Merged';
    case 'abandoned':
      return 'Abandoned';
    case 'queued':
      return 'Queued';
    case 'awaiting_host_confirmation':
      return 'Awaiting host confirmation';
    case 'published':
      return 'Published';
    case 'failed':
      return 'Failed';
    case 'active':
      return 'Active';
    case 'completed':
      return 'Completed';
    case 'expired':
      return 'Expired';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}

// statusTag spells a status out in words, with a small square shape.
export function statusTag(status: string): HTMLElement {
  const filled = ['approved', 'published', 'merged'].includes(status);
  return el('span', { class: 'status' }, [
    el('span', { class: `status-shape ${filled ? 'filled' : 'outlined'}`, 'aria-hidden': 'true' }),
    statusWord(status),
  ]);
}
