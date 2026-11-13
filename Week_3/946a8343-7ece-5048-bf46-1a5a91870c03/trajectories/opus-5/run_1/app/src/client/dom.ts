export type Attrs = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | null)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function svgEl(tag: string, attrs: Attrs = {}, children: Node[] = []): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(key, String(value));
  }
  for (const child of children) node.append(child);
  return node as SVGElement;
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.firstChild.remove();
}

export function button(name: string, attrs: Attrs = {}, label?: string): HTMLButtonElement {
  return el('button', { type: 'button', 'aria-label': name, ...attrs }, [label ?? name]);
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type MotionId = 'train-step' | 'train-leave' | 'card-settle' | 'job-status' | 'check-flip' | 'sheet-rise';

const durations: Record<MotionId, number> = {
  'train-step': 300,
  'train-leave': 160,
  'card-settle': 200,
  'job-status': 240,
  'check-flip': 180,
  'sheet-rise': 220,
};

const frames: Record<MotionId, Keyframe[]> = {
  'train-step': [{ transform: 'translateY(-24px)' }, { transform: 'translateY(0)' }],
  'train-leave': [{ opacity: 1 }, { opacity: 0 }],
  'card-settle': [{ transform: 'scale(1.04)' }, { transform: 'scale(1)' }],
  'job-status': [{ opacity: 0.4 }, { opacity: 1 }],
  'check-flip': [{ opacity: 0.4 }, { opacity: 1 }],
  'sheet-rise': [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }],
};

export function play(element: Element, id: MotionId, options: { delay?: number; rising?: boolean } = {}): void {
  if (reducedMotion()) return;
  const keyframes =
    id === 'train-step' && options.rising === true
      ? [{ transform: 'translateY(24px)' }, { transform: 'translateY(0)' }]
      : frames[id];
  const animation = element.animate(keyframes, {
    duration: durations[id],
    delay: options.delay ?? 0,
    easing: 'cubic-bezier(0.2, 0, 0, 1)',
    fill: 'none',
  });
  animation.id = id;
}

export function trapFocus(dialog: HTMLElement, opener: HTMLElement | null, onClose: () => void): () => void {
  const selector =
    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
  const handler = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      if (opener !== null) opener.focus();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll<HTMLElement>(selector)].filter(
      (item) => item.offsetParent !== null || item === document.activeElement,
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  dialog.addEventListener('keydown', handler);
  return () => dialog.removeEventListener('keydown', handler);
}

export function formatServerTime(iso: string | null, zone: string): string {
  if (iso === null) return 'unknown';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')} ${zone}`;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
