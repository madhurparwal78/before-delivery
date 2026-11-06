import { ERROR_COPY } from '../../shared/copy';
import { element } from '../dom';

/**
 * A named live region whose message stays on the page until the member's next
 * action on the same screen: a later poll or repaint never replaces it.
 */
export class StatusRegion {
  readonly node: HTMLElement;
  private readonly text: HTMLElement;

  constructor(name: string) {
    this.text = element('p', { className: 'status-text' });
    this.node = element('div', {
      className: 'status-region',
      attributes: { role: 'status', 'aria-label': name, 'aria-live': 'polite' },
      children: [this.text],
    });
  }

  say(copy: string): void {
    this.text.textContent = copy;
  }

  clear(): void {
    this.text.textContent = '';
  }
}

/** The copy an action shows next to its control, mirroring the live region. */
export class ActionNote {
  readonly node: HTMLElement;
  private readonly text: HTMLElement;

  constructor(private readonly region: StatusRegion) {
    this.text = element('p', { className: 'action-note' });
    this.node = element('div', { className: 'action-note-host', children: [this.text] });
  }

  say(copy: string, tone: 'pending' | 'done' | 'refused' = 'done'): void {
    this.text.textContent = copy;
    this.text.dataset.tone = tone;
    this.region.say(copy);
    this.node.querySelector('.again-link')?.remove();
    if (copy === ERROR_COPY.session_ended) this.offer('Sign in again');
    else if (copy === ERROR_COPY.access_removed) this.offer('Sign in');
  }

  private offer(label: string): void {
    this.node.append(
      element('a', {
        text: label,
        className: 'control link again-link',
        attributes: { href: '/sign-in' },
      }),
    );
  }

  clear(): void {
    this.text.textContent = '';
    delete this.text.dataset.tone;
    this.node.querySelector('.again-link')?.remove();
    this.region.clear();
  }
}
