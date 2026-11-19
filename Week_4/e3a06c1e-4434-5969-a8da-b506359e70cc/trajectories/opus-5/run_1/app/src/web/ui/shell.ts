import { el } from '../dom.js';
import { may, serviceStatus, type Identity } from '../state.js';
import { openDialog } from './dialog.js';
import { SessionSearch } from './search.js';
import { StatusRegion } from './status.js';
import { serviceCopy } from '../../shared/copy.js';

const navItems = [
  { label: 'Projects', href: '/console/projects', action: 'projects' },
  { label: 'Usage', href: '/console/usage', action: 'usage' },
  { label: 'Members', href: '/console/org/members', action: 'members' },
  { label: 'Plan', href: '/console/org/plan', action: 'plan' },
];

/** The console shell: rail or top bar, Console navigation, session search and Service status. */
export class ConsoleShell {
  readonly node: HTMLElement;
  readonly workspace: HTMLElement;
  private readonly serviceRegion = new StatusRegion('Service status', 'service-status');
  private readonly navigation: HTMLElement;
  private readonly searchHolder: HTMLElement;
  private readonly search: SessionSearch | null;
  private readonly links: HTMLAnchorElement[] = [];
  private readonly unsubscribe: () => void;
  private route = '';
  private lastBanners = '';

  constructor(identity: Identity) {
    const role = identity.user.role;
    this.navigation = el('nav', { 'aria-label': 'Console', class: 'console-nav' });
    for (const item of navItems) {
      if (!may(role, item.action)) continue;
      const link = el('a', { href: item.href, class: 'nav-link', text: item.label });
      this.links.push(link);
      this.navigation.append(link);
    }
    this.search = may(role, 'search') ? new SessionSearch() : null;
    this.searchHolder = el('div', { class: 'search-holder' }, this.search === null ? [] : [this.search.node]);

    const menuButton = el('button', { type: 'button', class: 'button menu-button', text: 'Menu' });
    menuButton.addEventListener('click', () => this.openNavigationDialog());

    const rail = el('div', { class: 'rail' }, [
      el('a', { href: '/', class: 'wordmark', text: 'Lowfield Signal' }),
      this.navigation,
      this.searchHolder,
    ]);
    const topbar = el('div', { class: 'topbar' }, [
      el('a', { href: '/', class: 'wordmark', text: 'Lowfield Signal' }),
      menuButton,
    ]);

    this.workspace = el('div', { class: 'workspace-content' });
    this.node = el('div', { class: 'console-shell' }, [
      rail,
      topbar,
      el('main', { class: 'workspace' }, [this.serviceRegion.node, this.workspace]),
    ]);

    this.unsubscribe = serviceStatus.subscribe(() => this.renderService());
    this.renderService();
  }

  private openNavigationDialog(): void {
    openDialog(
      'Navigation',
      (handle) => {
        const nav = el('nav', { 'aria-label': 'Console', class: 'console-nav' });
        for (const link of this.links)
          nav.append(el('a', { href: link.getAttribute('href') ?? '/', class: 'nav-link', text: link.textContent ?? '' }));
        const close = el('button', { type: 'button', class: 'button', text: 'Close' });
        close.addEventListener('click', () => handle.close());
        handle.body.append(nav);
        if (this.search !== null) handle.body.append(this.search.node);
        handle.body.append(close);
      },
      {
        onClose: () => {
          if (this.search !== null) this.searchHolder.append(this.search.node);
        },
      },
    );
  }

  setRoute(path: string): void {
    this.route = path;
    for (const link of this.links) {
      const href = link.getAttribute('href') ?? '';
      const active = path === href || (href === '/console/projects' && path.startsWith('/console/projects'));
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    this.renderService();
  }

  private renderService(): void {
    const banners: HTMLElement[] = [];
    if (serviceStatus.storageDown)
      banners.push(el('p', { class: 'banner banner-caution', text: serviceCopy.storageOutage }));
    const billingScreen = this.route === '/console/usage' || this.route === '/console/org/plan';
    if (billingScreen && serviceStatus.billingDown)
      banners.push(el('p', { class: 'banner banner-caution', text: serviceCopy.billingOutage }));
    const next = banners.map((banner) => banner.textContent).join('\u0000');
    if (this.lastBanners === next) return;
    this.lastBanners = next;
    this.serviceRegion.node.textContent = '';
    for (const banner of banners) this.serviceRegion.node.append(banner);
  }

  destroy(): void {
    this.unsubscribe();
  }
}
