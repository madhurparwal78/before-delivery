import { append, clear, el } from './dom.js';

const bands = (): HTMLElement => document.getElementById('bands') as HTMLElement;

export function navigation(current: string): HTMLElement {
  const link = (href: string, label: string): HTMLElement =>
    el('a', { href, text: label, 'aria-current': current === href ? 'page' : null, onclick: follow });
  return el('nav', { 'aria-label': 'Workspace' }, [
    el('a', { href: '/', class: 'wordmark', text: 'Nachtwit', onclick: follow }),
    link('/sites', 'Walls'),
    link('/kit', 'Shelf'),
    link('/hire', 'Hire'),
  ]);
}

export function follow(event: Event): void {
  const anchor = (event.currentTarget as HTMLAnchorElement).getAttribute('href');
  if (anchor === null) return;
  event.preventDefault();
  history.pushState({}, '', anchor);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export interface HeadingParts {
  readonly sentence: string;
  readonly slot?: HTMLElement;
  readonly rollingFrom?: number;
  readonly sentenceCase?: boolean;
}

/** The screen's one sentence, with its slot left out of the accessible name. */
export function heading(parts: HeadingParts): HTMLHeadingElement {
  const node = el('h1', {
    'aria-label': parts.sentence,
    class: parts.sentenceCase === true ? 'sentence-case' : null,
  });
  if (parts.slot === undefined) {
    node.appendChild(document.createTextNode(parts.sentence));
    return node;
  }
  append(node, [el('span', { 'aria-hidden': 'true', text: parts.sentence }), parts.slot]);
  return node;
}

export function showBand(copy: string, kind: 'alert' | 'status' = 'alert'): void {
  const node = bands();
  clear(node);
  node.appendChild(
    el('p', { class: 'band', role: kind, 'aria-label': kind === 'alert' ? 'Outage' : undefined, text: copy }),
  );
}

export function clearBand(): void {
  clear(bands());
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
