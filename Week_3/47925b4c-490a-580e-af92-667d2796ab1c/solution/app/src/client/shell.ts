import { append, clear, el, icon } from './dom.js';

const bands = (): HTMLElement => document.getElementById('bands') as HTMLElement;

export function navigation(current: string): HTMLElement {
  const link = (href: string, label: string, glyph: Parameters<typeof icon>[0]): HTMLElement =>
    el('a', { href, 'aria-current': current === href ? 'page' : null, onclick: follow }, [icon(glyph), label]);
  return el('nav', { 'aria-label': 'Workspace' }, [
    el('a', { href: '/', class: 'wordmark', text: 'Nachtwit', onclick: follow }),
    link('/sites', 'Walls', 'scan-line'),
    link('/kit', 'Shelf', 'package'),
    link('/hire', 'Hire', 'handshake'),
  ]);
}

export function follow(event: Event): void {
  const anchor = (event.currentTarget as HTMLAnchorElement).getAttribute('href');
  if (anchor === null) return;
  event.preventDefault();
  history.pushState({}, '', anchor);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

interface HeadingParts {
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
    el('p', { class: 'band', role: kind, 'aria-label': kind === 'alert' ? 'Outage' : undefined }, [
      kind === 'alert' ? icon('triangle-alert') : null,
      el('span', { text: copy }),
    ]),
  );
}

export function clearBand(): void {
  clear(bands());
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
