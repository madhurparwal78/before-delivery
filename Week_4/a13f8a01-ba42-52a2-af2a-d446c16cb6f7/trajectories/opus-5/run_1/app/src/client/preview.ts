import type { Files, PreviewMessage, RenderTicket } from '../shared/api';
import { entryText } from '../shared/console-format';
import { copy } from '../shared/copy';
import { api } from './api';
import { h, prefersReducedMotion, say } from './dom';

export const CROSSFADE_MS = 600;
export const LIFT_MS = 180;
export const REST_MS = 320;

export class ConsolePanel {
  readonly log: HTMLElement;
  readonly entries: HTMLElement;
  readonly toggle: HTMLButtonElement;
  readonly clearButton: HTMLButtonElement;
  readonly badges: HTMLElement[] = [];
  private count = 0;

  constructor() {
    this.entries = h('ul', { class: 'console-entries' });
    this.log = h('div', { role: 'log', 'aria-label': 'Console', 'data-count': '0', class: 'console-log' }, [
      this.entries,
    ]);
    const badge = h('span', { 'aria-hidden': 'true', class: 'badge', text: '0' });
    this.badges.push(badge);
    this.toggle = h('button', { type: 'button', class: 'console-toggle', 'aria-expanded': 'true' }, [
      'Console',
      badge,
    ]);
    this.clearButton = h('button', { type: 'button', class: 'ghost', text: 'Clear console' });
    this.clearButton.addEventListener('click', () => this.clear());
  }

  /** The count shows as a visible number that is hidden from the accessible name. */
  addBadge(): HTMLElement {
    const badge = h('span', { 'aria-hidden': 'true', class: 'badge', text: String(this.count) });
    this.badges.push(badge);
    return badge;
  }

  add(kind: PreviewMessage['kind'], text: string): void {
    if (kind === 'ready') return;
    this.entries.appendChild(h('li', { class: `entry entry-${kind}`, text: entryText(kind, text) }));
    while (this.entries.childElementCount > 500) this.entries.removeChild(this.entries.firstChild!);
    this.count += 1;
    this.setCount(this.count);
  }

  clear(): void {
    while (this.entries.firstChild) this.entries.removeChild(this.entries.firstChild);
    this.count = 0;
    this.setCount(0);
  }

  private setCount(value: number): void {
    this.log.dataset.count = String(value);
    for (const badge of this.badges) badge.textContent = String(value);
  }
}

export type RenderSource =
  | { files: Files; libraries: readonly string[] }
  | { penId: string; version?: number };

export interface PreviewOptions {
  region: HTMLElement;
  statusRegion?: HTMLElement | null;
  consolePanel?: ConsolePanel | null;
  crossfade?: boolean;
}

/** Pen code runs only inside a sandboxed iframe loaded from the app's own preview route. */
export class PreviewHost {
  private readonly region: HTMLElement;
  private readonly statusRegion: HTMLElement | null;
  private readonly consolePanel: ConsolePanel | null;
  private readonly crossfade: boolean;
  private frame: HTMLIFrameElement | null = null;
  private renderId: string | null = null;
  private nonce: string | null = null;
  private sequence = 0;

  constructor(options: PreviewOptions) {
    this.region = options.region;
    this.statusRegion = options.statusRegion ?? null;
    this.consolePanel = options.consolePanel ?? null;
    this.crossfade = options.crossfade ?? false;
    window.addEventListener('message', this.receive);
  }

  get renderSequence(): number {
    return this.sequence;
  }

  async show(source: RenderSource): Promise<void> {
    this.consolePanel?.clear();
    const body =
      'penId' in source
        ? { pen_id: source.penId, ...(source.version === undefined ? {} : { version: source.version }) }
        : { ...source.files, libraries: source.libraries };
    const ticket = await api.post<RenderTicket>('/api/renders', body);
    this.renderId = ticket.render;
    this.nonce = ticket.nonce;
    this.mount(ticket.url);
  }

  private mount(url: string): void {
    const frame = h('iframe', {
      title: 'Pen preview',
      class: 'preview-frame',
      sandbox: 'allow-scripts',
      src: url,
    });
    const previous = this.frame;
    this.frame = frame;
    if (previous && this.crossfade && !prefersReducedMotion()) {
      frame.style.opacity = '0';
      this.region.appendChild(frame);
      window.requestAnimationFrame(() => {
        frame.style.transition = `opacity ${CROSSFADE_MS}ms cubic-bezier(0.2, 0.9, 0.3, 1)`;
        frame.style.opacity = '1';
      });
      window.setTimeout(() => previous.remove(), CROSSFADE_MS);
      return;
    }
    previous?.remove();
    this.region.appendChild(frame);
  }

  /** A message counts only when it comes from the current render's frame with its nonce. */
  private receive = (event: MessageEvent<unknown>): void => {
    if (!this.frame || event.source !== this.frame.contentWindow) return;
    const message = event.data as PreviewMessage | null;
    if (!message || typeof message !== 'object') return;
    if (message.source !== 'ashlar-preview') return;
    if (message.render !== this.renderId || message.nonce !== this.nonce) return;

    if (message.kind === 'ready') {
      this.sequence += 1;
      this.region.dataset.renderSeq = String(this.sequence);
      this.region.dataset.previewTitle = message.title ?? '';
      this.region.dataset.previewText = message.text;
      say(this.statusRegion, copy.previewUpdated);
      return;
    }
    this.consolePanel?.add(message.kind, message.text);
  };
}
