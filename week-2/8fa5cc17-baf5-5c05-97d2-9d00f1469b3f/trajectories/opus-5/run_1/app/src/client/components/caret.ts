import { el } from '../dom';

export type PresenceState = { sessionId: string; label: string; anchor: number; head: number };

const MIRROR_PROPERTIES = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'textTransform',
  'wordSpacing',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'boxSizing',
  'whiteSpace',
  'wordWrap',
] as const;

/** The caret's position for an offset in the block's edit text. */
export function caretPosition(
  textarea: HTMLTextAreaElement,
  offset: number,
): { left: number; top: number; height: number } {
  const mirror = el('div', { className: 'caret-mirror' });
  const computed = getComputedStyle(textarea);
  for (const property of MIRROR_PROPERTIES) {
    mirror.style.setProperty(
      property.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`),
      computed.getPropertyValue(property.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)),
    );
  }
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordWrap = 'break-word';
  const before = document.createTextNode(textarea.value.slice(0, offset));
  const marker = el('span', { text: '\u200b' });
  mirror.append(before, marker);
  textarea.parentElement?.append(mirror);
  const left = marker.offsetLeft;
  const top = marker.offsetTop;
  const height = marker.offsetHeight || Number.parseFloat(computed.lineHeight) || 16;
  mirror.remove();
  return { left, top: top - textarea.scrollTop, height };
}

/** A labelled caret marks another device's position in the block. */
export class RemoteCarets {
  private readonly nodes = new Map<string, HTMLElement>();

  constructor(private readonly host: HTMLElement) {}

  render(textarea: HTMLTextAreaElement, presences: PresenceState[]): void {
    const wanted = new Set(presences.map((presence) => presence.sessionId));
    for (const [id, node] of [...this.nodes]) {
      if (wanted.has(id)) continue;
      node.remove();
      this.nodes.delete(id);
    }
    for (const presence of presences) {
      let node = this.nodes.get(presence.sessionId);
      if (node === undefined) {
        node = el('span', {
          className: 'remote-caret',
          attrs: { 'data-remote-caret': presence.sessionId, 'aria-hidden': 'true' },
        });
        node.append(el('span', { className: 'remote-caret-chip', text: presence.label }));
        this.nodes.set(presence.sessionId, node);
        this.host.append(node);
      }
      const chip = node.querySelector('.remote-caret-chip');
      if (chip !== null) chip.textContent = presence.label;
      const where = caretPosition(textarea, presence.head);
      node.style.left = `${where.left + textarea.offsetLeft}px`;
      node.style.top = `${where.top + textarea.offsetTop}px`;
      node.style.height = `${where.height}px`;
    }
  }

  clear(): void {
    for (const node of this.nodes.values()) node.remove();
    this.nodes.clear();
  }
}
