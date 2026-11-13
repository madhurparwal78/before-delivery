import { h } from './dom.js';

export type Surface = 'board' | 'manifest' | 'crew' | 'actions' | 'leaderboard' | 'summary';

const DESKTOP_REFERENCE = 1280;
const TABLET_REFERENCE = 768;

const WIDE_WITH_BOARD: Surface[] = ['board', 'manifest', 'crew', 'actions', 'summary', 'leaderboard'];
const WIDE_COMPARISON: Surface[] = [
  'leaderboard',
  'board',
  'summary',
  'manifest',
  'crew',
  'actions',
];
const MEDIUM: Surface[] = ['board', 'crew', 'leaderboard', 'manifest', 'summary', 'actions'];
const NARROW: Surface[] = ['board', 'manifest', 'crew', 'actions', 'summary', 'leaderboard'];

function orderFor(width: number, present: Surface[]): Surface[] {
  if (width >= DESKTOP_REFERENCE) {
    const order = present.includes('leaderboard') ? WIDE_COMPARISON : WIDE_WITH_BOARD;
    return order.filter((surface) => present.includes(surface));
  }
  const order = width >= TABLET_REFERENCE ? MEDIUM : NARROW;
  return order.filter((surface) => present.includes(surface));
}

/**
 * Keeps the working surface's reading order identical to its visual order at each reference
 * viewport by reordering the document itself.
 */
export class WorkingSurface {
  readonly element: HTMLElement;
  private panels: { name: Surface; node: HTMLElement }[] = [];

  constructor() {
    this.element = h('div', { class: 'working-surface' });
    window.addEventListener('resize', () => this.arrange());
  }

  set(panels: { name: Surface; node: HTMLElement }[]): void {
    this.panels = panels;
    this.arrange();
  }

  private arrange(): void {
    while (this.element.firstChild !== null) this.element.firstChild.remove();
    const present = this.panels.map((panel) => panel.name);
    const order = orderFor(window.innerWidth, present);
    const byName = new Map(this.panels.map((panel) => [panel.name, panel.node]));
    for (const name of order) {
      const node = byName.get(name);
      if (node === undefined) continue;
      node.classList.add('surface');
      node.setAttribute('data-surface', name);
      this.element.append(node);
    }
    this.element.setAttribute(
      'data-arrangement',
      window.innerWidth >= DESKTOP_REFERENCE ? 'wide' : window.innerWidth >= TABLET_REFERENCE ? 'medium' : 'narrow',
    );
  }
}
