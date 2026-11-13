import { el } from './dom.js';

export const REGION_NAMES = [
  'Entry',
  'Sync queue',
  'Holds',
  'Score changes',
  'Team',
  'Parts',
  'Sample banks',
  'Playback',
  'History',
  'Layout',
  'Text',
  'View',
] as const;

export type RegionName = (typeof REGION_NAMES)[number];

/** The visually hidden polite regions that announce every change. */
export class Regions {
  private readonly nodes = new Map<RegionName, HTMLElement>();
  readonly root = el('div', { class: 'live-regions' });

  constructor(visible: RegionName[]) {
    for (const name of REGION_NAMES) {
      const node = el('div', {
        role: 'status',
        'aria-live': 'polite',
        'aria-label': name,
        class: visible.includes(name) ? 'notice' : 'visually-hidden',
      });
      if (visible.includes(name)) node.hidden = true;
      this.nodes.set(name, node);
      this.root.append(node);
    }
  }

  say(name: RegionName, message: string): void {
    const node = this.nodes.get(name)!;
    node.textContent = message;
    node.hidden = message === '';
  }
}
