/** The shared frame: header, navigation, phone menu, banner and live regions. */
import { formatHours } from '../shared/format.js';
import { monthLabel } from '../shared/calendar.js';
import { clear, el, on, replace } from './dom.js';
import { endSession, get } from './api.js';
import { navigationFor, screenTitles, type Role, type ScreenPath } from './routes.js';

export type SessionInfo = {
  user: { id: string; name: string; email: string; role: Role; memberId: string | null };
  kitchen: { id: string; name: string; slug: string; timeZone: string };
};

export type HourBank = {
  month: string;
  allowanceHours: number;
  usedHours: number;
  balanceHours: number;
};

export type ServiceStatus = {
  billing: 'up' | 'down';
  storage: 'up' | 'down';
  queued: { billing: number; storage: number };
};

const billingCopy =
  'Billing is unavailable. Confirmed bookings are saved and marked Pending billing; charges are recorded automatically when billing returns.';
const storageCopy =
  'Document storage is unavailable. Uploads and downloads are paused; monthly sanitation PDFs are queued.';

export class Shell {
  readonly root: HTMLElement;
  readonly main: HTMLElement;
  private readonly announcements: HTMLElement;
  private readonly alertRegion: HTMLElement;
  private readonly header: HTMLElement;
  private readonly bannerHolder: HTMLElement;
  private bannerRegion: HTMLElement | null = null;
  private bannerMessages: HTMLElement | null = null;
  private bannerCounts: HTMLElement | null = null;
  private hourBankGroup: HTMLElement | null = null;
  private menuButton: HTMLElement | null = null;
  private menuPanel: HTMLElement | null = null;
  private session: SessionInfo | null = null;
  private bank: HourBank | null = null;
  private pollTimer: number | null = null;
  private navigate: (href: string) => void = () => undefined;
  private outsideHandler: ((event: Event) => void) | null = null;

  constructor() {
    this.header = el('header', { class: 'frame-header' });
    this.bannerHolder = el('div', { class: 'banner-holder' });
    this.announcements = el('div', {
      role: 'status',
      'aria-live': 'polite',
      'aria-label': 'Announcements',
      class: 'live-region',
    });
    this.alertRegion = el('div', { role: 'alert', class: 'live-region alert-region' });
    this.main = el('main', { class: 'frame-main' });
    this.root = el('div', { class: 'frame' }, [
      this.header,
      this.bannerHolder,
      this.announcements,
      this.alertRegion,
      this.main,
    ]);
  }

  setNavigator(navigate: (href: string) => void): void {
    this.navigate = navigate;
  }

  announce(message: string): void {
    this.announcements.textContent = message;
  }

  announcementText(): string {
    return this.announcements.textContent ?? '';
  }

  showAlert(message: string): void {
    this.alertRegion.textContent = message;
  }

  clearAlert(): void {
    this.alertRegion.textContent = '';
  }

  reset(): void {
    this.announce('');
    this.clearAlert();
    this.bank = null;
    clear(this.main);
  }

  setSession(session: SessionInfo | null, activePath: string): void {
    this.session = session;
    this.drawHeader(activePath);
    if (session === null) {
      this.stopPolling();
      this.clearBanner();
    } else {
      this.startPolling();
    }
  }

  setHourBank(bank: HourBank | null): void {
    this.bank = bank;
    this.drawHourBank();
  }

  private drawHourBank(): void {
    if (!this.hourBankGroup) return;
    if (this.bank === null) {
      replace(this.hourBankGroup, null);
      return;
    }
    replace(this.hourBankGroup, [
      el('span', { class: 'bank-figure', text: `${formatHours(this.bank.balanceHours)} h left` }),
      el('span', { class: 'bank-month', text: monthLabel(this.bank.month) }),
    ]);
  }

  private drawHeader(activePath: string): void {
    clear(this.header);
    this.menuButton = null;
    this.menuPanel = null;
    if (this.outsideHandler) {
      document.removeEventListener('pointerdown', this.outsideHandler, true);
      this.outsideHandler = null;
    }
    if (this.session === null) {
      this.hourBankGroup = null;
      return;
    }

    const links = navigationFor(this.session.user.role).map((path) =>
      this.navLink(path, activePath),
    );
    const nav = el('nav', { 'aria-label': 'Main', class: 'main-nav' }, links);
    const signOut = el('button', { type: 'button', class: 'sign-out', text: 'Sign out' });
    on(signOut, 'click', () => {
      void this.handleSignOut();
    });

    this.hourBankGroup = el('div', {
      role: 'group',
      'aria-label': 'Hour bank',
      class: 'hour-bank',
    });

    const identity = el('div', { class: 'identity' }, [
      el('span', { class: 'person-name', text: this.session.user.name }),
    ]);

    const panel = el('div', { class: 'menu-panel', id: 'menu-panel', hidden: true }, [nav, signOut]);
    this.menuPanel = panel;
    const menu = el('button', {
      type: 'button',
      class: 'menu-button',
      text: 'Menu',
      'aria-expanded': 'false',
      'aria-controls': 'menu-panel',
    });
    this.menuButton = menu;
    on(menu, 'click', () => this.toggleMenu());

    this.header.append(
      el('div', { class: 'kitchen-name', text: this.session.kitchen.name }),
      panel,
      menu,
      identity,
      this.hourBankGroup,
    );
    this.applyLayout();
    this.drawHourBank();

    this.outsideHandler = (event: Event): void => {
      if (!this.menuPanel || this.menuPanel.hidden) return;
      const target = event.target as Node;
      if (this.menuPanel.contains(target) || this.menuButton?.contains(target)) return;
      this.foldMenu(true);
    };
    document.addEventListener('pointerdown', this.outsideHandler, true);
  }

  private navLink(path: ScreenPath, activePath: string): HTMLElement {
    const link = el('a', {
      href: path,
      text: screenTitles[path],
      class: 'nav-link',
      'aria-current': path === activePath ? 'page' : null,
    });
    on(link, 'click', (event) => {
      event.preventDefault();
      if (this.menuPanel && !this.menuPanel.hidden) {
        this.foldMenu(false);
        this.main.setAttribute('tabindex', '-1');
        this.main.focus();
      }
      this.navigate(path);
    });
    return link;
  }

  /** Folded means absent from the accessibility tree, Tab order and touch. */
  applyLayout(): void {
    if (!this.menuButton || !this.menuPanel) return;
    const phone = window.innerWidth < 768;
    this.menuButton.hidden = !phone;
    if (!phone) {
      this.menuPanel.hidden = false;
      this.menuPanel.classList.remove('folded');
      this.menuButton.setAttribute('aria-expanded', 'false');
      return;
    }
    this.menuPanel.classList.add('folded');
    if (this.menuButton.getAttribute('aria-expanded') !== 'true') {
      this.menuPanel.hidden = true;
    }
  }

  private toggleMenu(): void {
    if (!this.menuButton || !this.menuPanel) return;
    const open = this.menuButton.getAttribute('aria-expanded') === 'true';
    if (open) {
      this.foldMenu(true);
      return;
    }
    this.menuPanel.hidden = false;
    this.menuButton.setAttribute('aria-expanded', 'true');
    const first = this.menuPanel.querySelector<HTMLElement>('a.nav-link');
    first?.focus();
  }

  foldMenu(returnFocus: boolean): void {
    if (!this.menuButton || !this.menuPanel) return;
    this.menuButton.setAttribute('aria-expanded', 'false');
    if (window.innerWidth < 768) this.menuPanel.hidden = true;
    if (returnFocus) this.menuButton.focus();
  }

  menuIsOpen(): boolean {
    return this.menuButton?.getAttribute('aria-expanded') === 'true';
  }

  private async handleSignOut(): Promise<void> {
    await fetch('/api/session', { method: 'DELETE', credentials: 'same-origin' }).catch(
      () => undefined,
    );
    endSession();
    this.navigate('/');
  }

  private startPolling(): void {
    if (this.pollTimer !== null) return;
    const poll = async (): Promise<void> => {
      try {
        const result = await get<ServiceStatus>('/api/service-status');
        this.drawBanner(result.body);
      } catch {
        // The next poll tries again.
      }
    };
    void poll();
    this.pollTimer = window.setInterval(() => void poll(), 8000);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) window.clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  /** Re-read at once after the person's own action while a service is down. */
  async refreshBanner(): Promise<void> {
    try {
      const result = await get<ServiceStatus>('/api/service-status');
      this.drawBanner(result.body);
    } catch {
      // Left to the next poll.
    }
  }

  private clearBanner(): void {
    clear(this.bannerHolder);
    this.bannerRegion = null;
    this.bannerMessages = null;
    this.bannerCounts = null;
  }

  /** Updates only the text inside the region; the region is never re-inserted. */
  private drawBanner(status: ServiceStatus): void {
    const down = status.billing === 'down' || status.storage === 'down';
    if (!down) {
      this.clearBanner();
      return;
    }
    if (this.bannerRegion === null) {
      this.bannerMessages = el('div', { class: 'banner-messages' });
      this.bannerCounts = el('p', { class: 'banner-counts' });
      this.bannerRegion = el('div', { role: 'region', 'aria-label': 'Service status', class: 'banner' }, [
        this.bannerMessages,
        this.bannerCounts,
      ]);
      this.bannerHolder.appendChild(this.bannerRegion);
    }
    const messages: HTMLElement[] = [];
    if (status.billing === 'down') messages.push(el('p', { text: billingCopy }));
    if (status.storage === 'down') messages.push(el('p', { text: storageCopy }));
    replace(this.bannerMessages!, messages);
    this.bannerCounts!.textContent =
      `${status.queued.billing} billing items waiting \u00b7 ${status.queued.storage} storage items waiting`;
  }
}
