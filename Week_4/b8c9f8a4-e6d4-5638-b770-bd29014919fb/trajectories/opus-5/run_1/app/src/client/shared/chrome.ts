import { el, focusTarget, onPress } from './dom';
import { announce } from './live';
import { focusFirstControl, openOverlay, type Overlay } from './overlay';
import { unitsBar, unitsToggle } from './units';

const FOOTER_COLUMNS: readonly { head: string; links: readonly string[] }[] = [
  { head: 'The car file', links: ['Walkround', 'Panels and readings', 'Test record', 'Condition report'] },
  { head: 'Viewing', links: ['Viewing area', 'Viewing slots', 'What to bring', 'Getting here'] },
  { head: 'Buying privately', links: ['As described', 'Paint gauge bands', 'Advisories explained', 'Offers'] },
  { head: 'Ostler Lane', links: ['About Open Bonnet', 'One owner, one car file', 'Honest selling', 'Contact'] },
];

/** The car file link footer closes every screen. */
export const carFileFooter = (): HTMLElement => {
  const footer = el('footer', { class: 'file-footer', role: 'contentinfo' });
  const columns = el('div', { class: 'file-footer-columns' });

  for (const column of FOOTER_COLUMNS) {
    const list = el(
      'ul',
      { class: 'file-footer-links' },
      column.links.map((label) => el('li', {}, [el('a', { href: '#', class: 'footer-link', text: label })])),
    );
    const head = el('button', {
      type: 'button',
      class: 'file-footer-head',
      'aria-expanded': 'false',
      text: column.head,
    });
    const group = el('div', { class: 'file-footer-column' }, [head, list]);
    onPress(head, () => {
      const open = head.getAttribute('aria-expanded') === 'true';
      head.setAttribute('aria-expanded', open ? 'false' : 'true');
      group.classList.toggle('file-footer-column-open', !open);
    });
    columns.append(group);
  }

  footer.append(
    columns,
    el('div', { class: 'file-footer-legal' }, [
      el('span', { text: 'Ostler Lane Open Bonnet' }),
      el('span', { text: 'One owner, one car, one honest file.' }),
    ]),
  );
  return footer;
};

export interface HeaderOptions {
  /** `navigation "Car file"` links and where each one goes. */
  sections: readonly { label: string; go: () => void }[];
  onMenuOpened?: (overlay: Overlay) => void;
}

/** The walkround overlay header, a fixed black bar with a Menu button on phones. */
export const walkroundHeader = (options: HeaderOptions): HTMLElement => {
  const header = el('header', { class: 'walkround-header' });
  const nav = el('nav', { class: 'walkround-nav', 'aria-label': 'Car file' });

  for (const section of options.sections) {
    const link = el('a', { href: '#', class: 'walkround-nav-link', text: section.label });
    link.addEventListener('click', (event) => {
      event.preventDefault();
      section.go();
    });
    nav.append(link);
  }

  const mark = el('span', { class: 'open-bonnet-mark', 'aria-hidden': 'true' });
  mark.innerHTML =
    '<svg viewBox="0 0 48 32" width="48" height="32" focusable="false"><path d="M3 24 L17 9 L31 15 L45 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M3 29 H45" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="17" cy="9" r="3.1" fill="currentColor"/></svg>';

  let menu: Overlay | null = null;
  const menuButton = el('button', { type: 'button', class: 'menu-button' }, [
    el('span', { class: 'menu-line', 'aria-hidden': 'true' }),
    el('span', { class: 'menu-line', 'aria-hidden': 'true' }),
    el('span', { class: 'menu-label', text: 'Menu' }),
  ]);
  menuButton.setAttribute('aria-label', 'Menu');

  onPress(menuButton, () => {
    if (menu !== null && menu.exiting) {
      menu.cancelExit();
      menu = null;
    }
    if (menu !== null && menu.open) return;
    const overlay = openOverlay({
      name: 'Menu',
      variant: 'menu',
      opener: menuButton,
      scrimCloses: true,
    });
    menu = overlay;
    const close = el('button', { type: 'button', class: 'pill-outline', text: 'Close' });
    onPress(close, () => overlay.close());
    const links = el('nav', { class: 'menu-links', 'aria-label': 'Car file' });
    for (const section of options.sections) {
      const link = el('a', { href: '#', class: 'menu-link', text: section.label });
      link.addEventListener('click', (event) => {
        event.preventDefault();
        overlay.close();
        section.go();
      });
      links.append(link);
    }
    overlay.body.append(
      el('div', { class: 'menu-units' }, [el('span', { class: 'menu-units-label', text: 'Units' }), unitsToggle()]),
      links,
      close,
    );
    focusFirstControl(overlay);
    options.onMenuOpened?.(overlay);
  });

  header.append(
    el('span', { class: 'wordmark', text: 'Ostler Lane' }),
    nav,
    el('div', { class: 'header-right' }, [mark, menuButton]),
  );
  return header;
};

export const serviceNotice = (): HTMLElement =>
  el('div', { class: 'service-notice notice-panel', role: 'alert', 'aria-label': 'Service notice' });

export const showNotice = (notice: HTMLElement, text: string): void => {
  notice.hidden = false;
  announce(notice, text);
};

export const clearNotice = (notice: HTMLElement): void => {
  notice.hidden = true;
  notice.replaceChildren();
};

export const statusRegion = (name: string): HTMLElement =>
  el('div', {
    class: 'status-region',
    role: 'status',
    'aria-live': 'polite',
    'aria-atomic': 'false',
    'aria-label': name,
  });

export { unitsBar, focusTarget };
