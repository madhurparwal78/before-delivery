import { SERVICE_BANNERS } from '../shared/copy.js';
import type { ServiceState, Unit } from '../shared/types.js';
import { api } from './api.js';
import { element, setText } from './dom.js';
import { Field } from './field.js';

/** The frame every screen shares: the navigation, the text column, the field and the regions. */

export const NAV_LINKS = [
  { label: 'Library', href: '/library' },
  { label: 'Capture', href: '/capture' },
  { label: 'Reels', href: '/reels' },
  { label: 'Trash', href: '/trash' },
  { label: 'Settings', href: '/settings' },
] as const;

export interface Services {
  search: ServiceState;
  storage: ServiceState;
  printing: ServiceState;
}

export class Shell {
  readonly nav: HTMLElement;
  readonly main: HTMLElement;
  readonly field: Field;
  readonly column: HTMLElement;
  private readonly deckStatusRegion: HTMLElement;
  private readonly serviceRegion: HTMLElement;
  private readonly announcerRegion: HTMLElement;
  private unit: Unit = 'mm';
  private services: Services = { search: 'up', storage: 'up', printing: 'up' };
  private readonly unitListeners = new Set<(unit: Unit) => void>();

  constructor(root: HTMLElement) {
    this.announcerRegion = element('div', {
      role: 'status',
      'aria-live': 'polite',
      'aria-label': 'Reel announcer',
      class: 'live-region',
    });
    this.deckStatusRegion = element('div', {
      role: 'status',
      'aria-live': 'polite',
      'aria-label': 'Deck status',
      class: 'deck-status',
    });
    this.serviceRegion = element('div', {
      role: 'status',
      'aria-live': 'polite',
      'aria-label': 'Service notices',
      class: 'service-notices',
    });

    this.nav = element('nav', { 'aria-label': 'Deck', class: 'deck-nav' }, [
      element(
        'ul',
        {},
        NAV_LINKS.map((link) =>
          element('li', {}, [element('a', { href: link.href }, [link.label])]),
        ),
      ),
    ]);
    this.main = element('main', { class: 'text-main' });
    this.column = element('div', { class: 'text-column' }, [
      this.serviceRegion,
      this.nav,
      this.deckStatusRegion,
      this.main,
    ]);
    this.field = new Field((text) => this.announce(text));
    root.append(this.column, this.field.root, this.announcerRegion);
  }

  setDeckStatus(text: string): void {
    setText(this.deckStatusRegion, text);
  }

  clearDeckStatus(): void {
    setText(this.deckStatusRegion, '');
  }

  announce(text: string): void {
    setText(this.announcerRegion, text);
  }

  clearAnnouncer(): void {
    setText(this.announcerRegion, '');
  }

  setServices(services: Services): void {
    this.services = services;
    const banners: string[] = [];
    if (services.search === 'down') banners.push(SERVICE_BANNERS.search);
    if (services.storage === 'down') banners.push(SERVICE_BANNERS.storage);
    if (services.printing === 'down') banners.push(SERVICE_BANNERS.printing);
    const wanted = banners.join('\n');
    if (this.serviceRegion.textContent === wanted) return;
    this.serviceRegion.replaceChildren(
      ...banners.map((line) => element('p', { class: 'banner' }, [line])),
    );
  }

  get currentServices(): Services {
    return this.services;
  }

  get sizeUnit(): Unit {
    return this.unit;
  }

  setUnit(unit: Unit): void {
    if (this.unit === unit) return;
    this.unit = unit;
    for (const listener of this.unitListeners) listener(unit);
  }

  onUnitChange(listener: (unit: Unit) => void): () => void {
    this.unitListeners.add(listener);
    return () => this.unitListeners.delete(listener);
  }

  showNavigation(visible: boolean): void {
    this.nav.hidden = !visible;
  }

  /** The browser never computes a service state: it polls the server for them. */
  startStatusPolling(): void {
    const poll = async (): Promise<void> => {
      const status = await api.status().catch(() => null);
      if (status) this.setServices(status.services);
    };
    void poll();
    window.setInterval(() => void poll(), 5_000);
  }
}
