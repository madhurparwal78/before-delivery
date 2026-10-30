import { el } from '../dom.js';

export type RegionName =
  | 'Session status'
  | 'Baton status'
  | 'Editor status'
  | 'Checkpoint status'
  | 'Restore status'
  | 'Share status'
  | 'Members status'
  | 'Import status'
  | 'Account status'
  | 'Review status'
  | 'Sign-in status';

/** The live regions named in the brief, each holding only its latest copy. */
export class StatusBoard {
  private readonly nodes = new Map<RegionName, HTMLElement>();

  create(name: RegionName, extraClass = ''): HTMLElement {
    const node = el('div', {
      role: 'status',
      'aria-live': 'polite',
      'aria-label': name,
      class: extraClass,
    });
    this.nodes.set(name, node);
    return node;
  }

  set(name: RegionName, ...content: (string | Node)[]): void {
    const node = this.nodes.get(name);
    if (node === undefined) return;
    node.replaceChildren(
      ...content.map((item) => (typeof item === 'string' ? document.createTextNode(item) : item)),
    );
  }

  clear(name: RegionName): void {
    this.nodes.get(name)?.replaceChildren();
  }

  pending(name: RegionName, text: string): void {
    this.set(name, text, el('span', { class: 'progress', 'aria-hidden': 'true' }));
  }

  /** Error copy, which the brief shows in the reserved red. */
  error(name: RegionName, ...content: (string | Node)[]): void {
    this.set(name, el('span', { class: 'error' }, content));
  }
}
