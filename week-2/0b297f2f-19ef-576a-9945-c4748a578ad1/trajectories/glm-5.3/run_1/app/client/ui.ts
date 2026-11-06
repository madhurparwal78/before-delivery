
export function el(tag: string, attrs: Record<string, string | null> = {}, ...children: (Node | string | null | undefined)[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/** The skip link: first Tab stop on every page; moves focus to main. */
export function skipLink(): HTMLElement {
  const link = el('a', { class: 'skip-link', href: '#main', text: 'Skip to main content' });
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const main = document.getElementById('main');
    main?.focus();
  });
  return link;
}

export function banner(kind: 'database' | 'imageStore' | 'mailRelay'): HTMLElement {
  const copy = {
    database: `Hangline can't reach its database. Changes are paused until it's back.`,
    imageStore: `Image store unavailable. Condition photos can't be attached right now.`,
    mailRelay: `Mail relay unavailable. Preview emails will be sent when it's back.`,
  }[kind];
  const alert = el('div', { class: 'service-banner', role: 'alert', 'data-service': kind });
  alert.append(el('span', { text: copy }));
  if (kind === 'database') {
    alert.append(el('button', { class: 'primary', text: 'Try again', 'data-action': 'db-retry' }));
  }
  return alert;
}

export function focusHeading(root: HTMLElement, selector: string): void {
  const heading = root.querySelector(selector) as HTMLElement | null;
  if (heading !== null) {
    heading.setAttribute('tabindex', '-1');
    heading.focus();
  }
}
