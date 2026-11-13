// Public page and shared shell pieces.
import { renderFormatted } from './formatting';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string | null | undefined> = {}, ...children: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined) continue;
    element.setAttribute(name, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    element.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return element;
}

export function hushlineWordmark(): HTMLElement {
  return el('a', { href: '/', class: 'wordmark' }, 'Hushline');
}

export function wordmarkLink(): HTMLElement {
  const link = el('a', { href: '/' }, 'Hushline');
  return link;
}

export function glassSlab(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'hero-slab');
  svg.setAttribute('viewBox', '0 0 400 200');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', '20');
  rect.setAttribute('y', '20');
  rect.setAttribute('width', '380');
  rect.setAttribute('height', '160');
  rect.setAttribute('fill', 'var(--accent)');
  rect.setAttribute('opacity', '0.28');
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', '48');
  text.setAttribute('y', '78');
  text.setAttribute('fill', 'var(--ink)');
  text.setAttribute('font-size', '24');
  text.setAttribute('font-style', 'italic');
  text.textContent = 'i never got the lantern pack';
  const lines: [string, number][] = [
    ['signature valid', 112],
    ['7 of 8', 136],
    ['nothing removed', 160],
    ['no link', 184],
  ];
  for (const [line, y] of lines) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    element.setAttribute('x', '48');
    element.setAttribute('y', String(y));
    element.setAttribute('fill', 'var(--ink)');
    element.setAttribute('font-size', '17');
    element.textContent = line;
    svg.append(element);
  }
  svg.append(rect, text);
  return svg;
}

export function publicPage(root: HTMLElement): void {
  document.title = 'Hushline';
  const panel = el('div', { class: 'hero-panel' });
  const top = el('div', { class: 'hero-top' });
  top.append(
    wordmarkLink(),
    el('nav', {},
      el('a', { href: '#how-it-checks' }, 'How it checks'),
      el('a', { href: '#the-widget' }, 'The widget'),
      el('a', { href: '#security' }, 'Security'),
    ),
    el('a', { href: '/signin' }, 'Sign in'),
  );
  panel.append(top, glassSlab());
  const headline = el('h1', { class: 'hero-headline' },
    el('span', {}, 'Every message,'),
    el('span', { class: 'second' }, 'already checked.'),
  );
  panel.append(headline);
  panel.append(el('img', { class: 'visually-hidden', alt: 'A player message seen through Tamperglass', src: '/assets/slab.svg' }));

  const hero = el('div', { class: 'hero-sub' });
  const container = el('div', { class: 'column' });
  container.append(panel);
  hero.append(el('p', { class: 'hero-sentence' }, 'Answer your players from inside the game, with every purchase, match and pasted link checked before you read it.'));
  hero.append(el('a', { href: '/inbox' }, 'Open the inbox'));
  hero.append(
    el('section', { id: 'how-it-checks' },
      el('h2', {}, 'How it checks'),
      el('p', {}, 'Every message a player sends is checked before it reaches you. The signature, the send rate, the text and any link each get a verdict.'),
      el('p', {}, 'Verdicts are computed once, stored, and shown beside the thread in Tamperglass.'),
    ),
    el('section', { id: 'the-widget' },
      el('h2', {}, 'The widget'),
      el('p', {}, 'Players write from inside the game launcher. A player sees only their own thread, with their own receipts and replies.'),
      el('p', {}, 'A retried send arrives once, and a slow connection changes nothing.'),
    ),
    el('section', { id: 'security' },
      el('h2', {}, 'Security'),
      el('p', {}, 'Script tags, hostile links and forged receipts are shown as harmless words. The server keeps every record, and refuses anything that does not verify.'),
      el('p', {}, 'A player who guesses a thread id reads nothing.'),
    ),
  );
  container.append(hero);
  container.append(el('footer', { class: 'contentinfo', role: 'contentinfo' }, 'Fernwick Software. Hushline answers players from inside the game.'));
  root.append(container);
  void renderFormatted;
}
