/**
 * The header: brand, navigation, the outage banner and the hold countdown.
 *
 * Below 768 px the links move into a navigation drawer opened from `Menu`.
 * Crossing the breakpoint with the drawer open closes it at once and moves
 * focus to its opener, or to `Story` when the opener is hidden.
 */

import { api } from '../api.js';
import { el, setTextIfChanged } from '../dom.js';
import { store } from '../state.js';
import { Panel } from './dialog.js';

export const DRAWER_BREAKPOINT = 768;

const KILLBILL_BANNER = 'Payments are paused. Nothing has been charged.';
const REGISTRY_BANNER = 'Plate registry unreachable. Your fit stays unconfirmed until it answers.';

interface Link {
  href: string;
  label: string;
  fitterOnly?: boolean;
}

const LINKS: Link[] = [
  { href: '/', label: 'Story' },
  { href: '/configure', label: 'Configure' },
  { href: '/bikes', label: 'Bikes' },
  { href: '/orders', label: 'My orders' },
  { href: '/rides', label: 'My rides' },
  { href: '/desk', label: 'Desk', fitterOnly: true },
];

export class Header {
  readonly element: HTMLElement;
  readonly banner: HTMLElement;
  readonly drawer: Panel;

  private readonly navList: HTMLElement;
  private readonly drawerList: HTMLElement;
  private readonly menuButton: HTMLButtonElement;
  private readonly account: HTMLElement;
  private readonly holdStatus: HTMLElement;
  private holdTimer: HTMLElement | null = null;
  private countdownHandle: number | null = null;
  private lastAnnouncedMinutes: number | null = null;

  constructor(private readonly navigate: (href: string) => void) {
    this.navList = el('ul', { class: 'nav-list' });
    this.drawerList = el('ul', { class: 'nav-list nav-list--drawer' });

    this.menuButton = el(
      'button',
      { type: 'button', class: 'menu-button', 'aria-expanded': 'false' },
      ['Menu'],
    );

    this.drawer = new Panel({ name: 'Navigation', variant: 'drawer' });
    this.drawer.content.append(this.drawerList);
    this.menuButton.addEventListener('click', () => this.drawer.open(this.menuButton));

    this.account = el('div', { class: 'account-slot' });

    // The status region is always present and empty when there is nothing to report.
    this.holdStatus = el('div', {
      class: 'hold-status',
      role: 'status',
      'aria-live': 'polite',
      'aria-label': 'Test-ride hold',
    });

    this.banner = el('div', { class: 'outage', role: 'alert', 'aria-label': 'Provider outage', hidden: true });

    this.element = el('header', { class: 'site-header' }, [
      el('a', { class: 'brand', href: '/' }, ['Ommezwaai Feeler']),
      this.menuButton,
      el('nav', { class: 'site-nav', 'aria-label': 'Main' }, [this.navList]),
      el('div', { class: 'header-right' }, [this.holdStatus, this.account]),
      this.drawer.root,
    ]);

    this.renderLinks();
    this.renderAccount();
  }

  private link(target: Link): HTMLElement {
    const anchor = el('a', { href: target.href, class: 'nav-link' }, [target.label]);
    anchor.addEventListener('click', (event) => {
      event.preventDefault();
      if (this.drawer.isOpen) this.drawer.close();
      this.navigate(target.href);
    });
    return anchor;
  }

  private renderLinks(): void {
    const visible = LINKS.filter((item) => !item.fitterOnly || store.user?.role === 'fitter');
    for (const list of [this.navList, this.drawerList]) {
      while (list.firstChild) list.firstChild.remove();
      for (const item of visible) list.append(el('li', {}, [this.link(item)]));
    }
  }

  private renderAccount(): void {
    while (this.account.firstChild) this.account.firstChild.remove();

    if (store.user) {
      const out = el('button', { type: 'button', class: 'nav-link' }, ['Sign out']);
      out.addEventListener('click', () => {
        void api.signOut().then(async () => {
          store.user = null;
          store.hold = null;
          this.update();
          this.navigate('/');
          await store.loadUser();
        });
      });
      this.account.append(out);
      return;
    }

    const anchor = el('a', { href: '/sign-in', class: 'nav-link' }, ['Sign in']);
    anchor.addEventListener('click', (event) => {
      event.preventDefault();
      this.navigate('/sign-in');
    });
    this.account.append(anchor);
  }

  /** Both banners show together when both providers are down. */
  update(): void {
    this.renderLinks();
    this.renderAccount();

    const messages: string[] = [];
    if (store.status.killbill === 'down') messages.push(KILLBILL_BANNER);
    if (store.status.registry === 'down') messages.push(REGISTRY_BANNER);

    if (messages.length === 0) {
      if (!this.banner.hidden) {
        this.banner.hidden = true;
        while (this.banner.firstChild) this.banner.firstChild.remove();
      }
    } else {
      const wanted = messages.join('\n');
      if (this.banner.dataset.messages !== wanted) {
        this.banner.dataset.messages = wanted;
        while (this.banner.firstChild) this.banner.firstChild.remove();
        for (const message of messages) this.banner.append(el('p', { class: 'outage-line' }, [message]));
      }
      this.banner.hidden = false;
    }

    this.updateHold();
  }

  /**
   * The timer takes each new server value and ticks down by one each second
   * between them, with live announcements off.
   */
  private updateHold(): void {
    const hold = store.hold;

    if (!hold || hold.remainingSeconds === null) {
      if (this.holdTimer) {
        this.holdTimer.remove();
        this.holdTimer = null;
      }
      if (this.countdownHandle !== null) {
        window.clearInterval(this.countdownHandle);
        this.countdownHandle = null;
      }
      this.lastAnnouncedMinutes = null;
      setTextIfChanged(this.holdStatus, '');
      return;
    }

    if (!this.holdTimer) {
      this.holdTimer = el('span', {
        class: 'hold-timer',
        role: 'timer',
        'aria-label': 'Hold countdown',
        'aria-live': 'off',
      });
      this.holdStatus.before(this.holdTimer);
    }

    let remaining = hold.remainingSeconds;
    const paint = (): void => {
      const minutes = Math.floor(remaining / 60);
      const seconds = remaining % 60;
      setTextIfChanged(
        this.holdTimer as HTMLElement,
        `Hold ends in ${minutes}:${String(seconds).padStart(2, '0')}`,
      );
      const announced = Math.ceil(remaining / 60);
      if (announced !== this.lastAnnouncedMinutes) {
        this.lastAnnouncedMinutes = announced;
        setTextIfChanged(this.holdStatus, `Hold ends in ${announced} min.`);
      }
    };
    paint();

    if (this.countdownHandle !== null) window.clearInterval(this.countdownHandle);
    this.countdownHandle = window.setInterval(() => {
      remaining = Math.max(0, remaining - 1);
      paint();
    }, 1000);
  }

  /** The drawer closes at once when the viewport crosses the breakpoint. */
  handleBreakpointCross(): void {
    if (!this.drawer.isOpen) return;
    const openerVisible = this.menuButton.offsetParent !== null;
    this.drawer.closeWithoutFocus();
    const fallback = this.navList.querySelector<HTMLElement>('a');
    (openerVisible ? this.menuButton : fallback)?.focus();
  }

  announceHold(message: string): void {
    setTextIfChanged(this.holdStatus, message);
  }
}
