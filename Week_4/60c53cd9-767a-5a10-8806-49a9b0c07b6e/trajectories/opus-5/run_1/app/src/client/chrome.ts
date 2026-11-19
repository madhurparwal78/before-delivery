/** The header bar every page but the shared hold page carries. */

import { el } from './dom';
import { navigate } from './router';
import { currentAccount, onAccountChange, openSignInDialog, signOut } from './session';
import type { Hold } from '../shared/types';

export interface HeaderOptions {
  onFiltersPress?: () => void;
}

export class Header {
  readonly node: HTMLElement;
  readonly filtersButton: HTMLButtonElement | null;
  private readonly accountButton: HTMLButtonElement;
  private readonly myHold: HTMLAnchorElement;

  constructor(options: HeaderOptions = {}) {
    this.accountButton = el('button', {
      type: 'button',
      class: 'action action-quiet',
      text: 'Sign in',
      onclick: () => this.onAccountPress(),
    }) as HTMLButtonElement;
    this.myHold = el('a', { class: 'action action-quiet', href: '/finder', text: 'My hold', hidden: true }) as HTMLAnchorElement;
    this.filtersButton = options.onFiltersPress
      ? (el('button', {
          type: 'button',
          class: 'action action-quiet filters-button',
          text: 'Filters',
          onclick: options.onFiltersPress,
        }) as HTMLButtonElement)
      : null;
    this.node = el('header', { class: 'app-header' }, [
      el('a', { class: 'brand', href: '/', text: 'Highwater' }),
      el('nav', { class: 'header-actions' }, [this.myHold, this.filtersButton, this.accountButton]),
    ]);
    onAccountChange(() => this.paint());
    this.paint();
  }

  private onAccountPress(): void {
    if (currentAccount()) {
      const path = window.location.pathname;
      void signOut().then(() => {
        if (path.startsWith('/holds/') || path === '/console') navigate('/finder');
      });
      return;
    }
    openSignInDialog({
      returnFocus: this.accountButton,
      onSignedIn: (account) => {
        if (account.role === 'coordinator') navigate('/console');
      },
    });
  }

  private paint(): void {
    this.accountButton.textContent = currentAccount() ? 'Sign out' : 'Sign in';
  }

  setMyHold(hold: Hold | null): void {
    this.myHold.hidden = hold === null;
    if (hold) this.myHold.href = `/holds/${hold.id}`;
  }
}
