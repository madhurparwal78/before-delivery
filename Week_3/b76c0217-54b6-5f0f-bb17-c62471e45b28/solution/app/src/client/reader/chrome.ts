import { copy } from '../../shared/copy';
import type { ReaderBoot } from '../../shared/types';
import { announce, must } from '../shared/dom';
import { createDrawer, type Drawer } from '../shared/drawer';
import { bindThemeSwitch } from '../shared/theme';

/** On a phone the sections and the version switcher live in the drawer; the sidebar itself becomes the drawer. */
function initDrawer(): void {
  const sidebar = must<HTMLElement>('#site-nav');
  const backdrop = must<HTMLElement>('#backdrop');
  const menu = must<HTMLButtonElement>('#menu-button');
  const headerTabs = must<HTMLElement>('#slot-tabs');
  const headerVersion = must<HTMLElement>('#slot-version');
  const drawerSlot = must<HTMLElement>('#slot-drawer');
  const sections = must<HTMLElement>('.sections');
  const phone = window.matchMedia('(max-width: 767.98px)');
  let drawer: Drawer | null = null;

  const place = (): void => {
    const switcher = document.querySelector<HTMLElement>('.version-switcher');
    if (phone.matches) {
      drawerSlot.append(sections);
      if (switcher) {
        drawerSlot.append(switcher);
      }
      drawer ??= createDrawer({ panel: sidebar, backdrop, opener: menu, label: 'Site navigation' });
    } else {
      drawer?.dispose();
      drawer = null;
      headerTabs.append(sections);
      if (switcher) {
        headerVersion.append(switcher);
      }
      menu.setAttribute('aria-expanded', 'false');
    }
  };
  menu.addEventListener('click', () => {
    if (sidebar.dataset.motion === 'open' || sidebar.dataset.motion === 'opening') {
      drawer?.close();
    } else {
      drawer?.open();
    }
  });
  phone.addEventListener('change', place);
  place();
}

function initContents(): void {
  const wrap = document.querySelector<HTMLElement>('.toc-wrap');
  if (wrap === null) {
    return;
  }
  const toggle = must<HTMLButtonElement>('.toc-toggle', wrap);
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    wrap.dataset.open = String(open);
  });
  // The link of the heading at the top of the viewport carries aria-current="location".
  const update = (): void => {
    const links = [...wrap.querySelectorAll<HTMLAnchorElement>('.toc a')];
    let current = -1;
    links.forEach((link, index) => {
      const heading = document.getElementById(decodeURIComponent(link.hash.slice(1)));
      if (heading !== null && heading.getBoundingClientRect().top <= 120) {
        current = index;
      }
    });
    links.forEach((link, index) => (index === current ? link.setAttribute('aria-current', 'location') : link.removeAttribute('aria-current')));
  };
  window.addEventListener('scroll', update, { passive: true });
  update();
}

const FALLBACK_KEY = 'galley-version-fallback';

function initVersions(boot: ReaderBoot): void {
  const button = document.querySelector<HTMLButtonElement>('.version-button');
  const list = document.querySelector<HTMLElement>('#version-list');
  if (button === null || list === null) {
    return;
  }
  const options = [...list.querySelectorAll<HTMLElement>('[role="option"]')];
  let active = 0;
  const mark = (index: number): void => {
    active = (index + options.length) % options.length;
    options.forEach((option, at) => option.classList.toggle('active', at === active));
    list.setAttribute('aria-activedescendant', options[active]?.id ?? '');
  };
  const open = (): void => {
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    mark(Math.max(0, options.findIndex((option) => option.getAttribute('aria-selected') === 'true')));
    list.focus();
  };
  const close = (): void => {
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };
  const choose = (option: HTMLElement | undefined): void => {
    close();
    if (option === undefined || option.getAttribute('aria-selected') === 'true') {
      button.focus();
      return;
    }
    if (option.dataset.fallback === 'true' && boot.pageTitle !== '') {
      sessionStorage.setItem(FALLBACK_KEY, JSON.stringify({ page: boot.pageTitle, version: option.textContent?.trim() ?? '' }));
    }
    location.href = option.dataset.href ?? '/';
  };
  button.addEventListener('click', () => (list.hidden ? open() : close()));
  button.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && list.hidden) {
      event.preventDefault();
      open();
    }
  });
  list.addEventListener('keydown', (event) => {
    const keys: Record<string, () => void> = {
      ArrowDown: () => mark(active + 1),
      ArrowUp: () => mark(active - 1),
      Home: () => mark(0),
      End: () => mark(options.length - 1),
      Enter: () => choose(options[active]),
      ' ': () => choose(options[active]),
      Escape: () => {
        close();
        button.focus();
      },
      Tab: close,
    };
    const run = keys[event.key];
    if (run) {
      if (event.key !== 'Tab') {
        event.preventDefault();
        event.stopPropagation();
      }
      run();
    }
  });
  for (const option of options) {
    option.addEventListener('click', () => choose(option));
  }
  document.addEventListener('click', (event) => {
    if (!list.hidden && event.target instanceof Node && !list.contains(event.target) && !button.contains(event.target)) {
      close();
    }
  });
}

/** After the version switcher sent the reader to another version's first page, say why. */
function showFallbackNotice(boot: ReaderBoot): void {
  const stored = sessionStorage.getItem(FALLBACK_KEY);
  if (stored === null) {
    return;
  }
  sessionStorage.removeItem(FALLBACK_KEY);
  const { page, version } = JSON.parse(stored) as { page: string; version: string };
  const message = copy.versionFallback(page, version);
  const target = document.getElementById('fallback-notice');
  if (target !== null && boot.pageId !== null) {
    target.textContent = message;
    target.hidden = false;
  }
  announce(message);
  document.getElementById('page-title')?.focus();
}

export function initChrome(boot: ReaderBoot): void {
  bindThemeSwitch(must('.theme-switch'));
  initDrawer();
  initContents();
  initVersions(boot);
  showFallbackNotice(boot);
}

