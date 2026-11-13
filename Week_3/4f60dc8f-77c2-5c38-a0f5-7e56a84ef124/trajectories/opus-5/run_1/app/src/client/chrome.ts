import { ERROR_COPY, BANNER_COPY, SEARCH_EMPTY_COPY } from '../shared/errors.js';
import { announce, api, focusables, onBreakpointChange, qs, qsa } from './core.js';

/** Below 768 the five links live behind Menu; above it the button is gone entirely. */
export const initNavigation = (): void => {
  const nav = qs<HTMLElement>('[data-nav]');
  const toggle = qs<HTMLButtonElement>('[data-nav-toggle]');
  const links = qs<HTMLElement>('[data-nav-links]');
  if (nav === null || toggle === null || links === null) return;

  let phoneLayout = false;

  const setOpen = (open: boolean): void => {
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    links.hidden = !open;
    if (open) focusables(links)[0]?.focus();
  };

  onBreakpointChange((phone) => {
    phoneLayout = phone;
    toggle.hidden = !phone;
    links.hidden = phone;
    toggle.setAttribute('aria-expanded', 'false');
  });

  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    if (open) {
      setOpen(false);
      toggle.focus();
      return;
    }
    setOpen(true);
  });

  nav.addEventListener('keydown', (event) => {
    if (!phoneLayout || toggle.getAttribute('aria-expanded') !== 'true') return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      toggle.focus();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables(links);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  links.addEventListener('click', (event) => {
    if (!phoneLayout) return;
    if ((event.target as HTMLElement).closest('a') === null) return;
    setOpen(false);
  });
};

type SearchHit = { kind: 'case_study' | 'service' | 'insight'; title: string; summary: string; url: string };

const GROUPS: { kind: SearchHit['kind']; heading: string }[] = [
  { kind: 'case_study', heading: 'Case studies' },
  { kind: 'service', heading: 'Services' },
  { kind: 'insight', heading: 'Insights' },
];

export const initSearch = (): void => {
  const root = qs<HTMLElement>('[data-search]');
  const input = qs<HTMLInputElement>('[data-search-input]');
  const panel = qs<HTMLElement>('[data-search-panel]');
  const status = qs<HTMLElement>('[data-search-status]');
  const form = qs<HTMLFormElement>('[data-search-form]');
  if (root === null || input === null || panel === null || form === null) return;

  let timer = 0;
  let latest = '';

  const render = (query: string, hits: SearchHit[]): void => {
    panel.innerHTML = '';
    if (hits.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = SEARCH_EMPTY_COPY;
      panel.append(empty);
    } else {
      const list = document.createElement('ul');
      list.setAttribute('aria-label', 'Search results');
      for (const group of GROUPS) {
        const matches = hits.filter((hit) => hit.kind === group.kind);
        if (matches.length === 0) continue;
        const item = document.createElement('li');
        const heading = document.createElement('h3');
        heading.textContent = group.heading;
        const inner = document.createElement('ul');
        for (const hit of matches) {
          const row = document.createElement('li');
          const link = document.createElement('a');
          link.href = hit.url;
          link.textContent = hit.title;
          row.append(link);
          inner.append(row);
        }
        item.append(heading, inner);
        list.append(item);
      }
      panel.append(list);
    }
    panel.hidden = false;
    announce(status, `Matches: ${hits.length}`);
    void query;
  };

  const run = async (query: string): Promise<void> => {
    latest = query;
    if (query === '') {
      panel.hidden = true;
      panel.innerHTML = '';
      return;
    }
    const result = await api<{ query: string; hits: SearchHit[] }>(
      `/api/search?q=${encodeURIComponent(query)}`,
    );
    if (input.value.trim() !== query || latest !== query) return;
    if (!result.ok) {
      panel.innerHTML = '';
      const message = document.createElement('p');
      message.textContent = result.body.message ?? ERROR_COPY.search_unavailable.message;
      panel.append(message);
      panel.hidden = false;
      return;
    }
    render(query, result.body.hits ?? []);
  };

  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void run(input.value.trim()), 250);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    window.clearTimeout(timer);
    void run(input.value.trim());
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      input.value = '';
      panel.hidden = true;
      panel.innerHTML = '';
      input.focus();
      return;
    }
    if (event.key === 'ArrowDown' && !panel.hidden) {
      const first = qs<HTMLAnchorElement>('a', panel);
      if (first !== null) {
        event.preventDefault();
        first.focus();
      }
    }
  });
};

export type OutagePage = 'rig' | 'engagement' | 'account' | 'public';

type StatusBody = {
  billing: 'up' | 'down';
  storage: 'up' | 'down';
  email: 'up' | 'down';
  measuring: 'up' | 'down';
  documents: 'up' | 'down';
};

const LINE_ORDER = ['billing', 'storage', 'email', 'measuring', 'documents', 'content'] as const;
type LineKey = (typeof LINE_ORDER)[number];

const LINE_COPY: Record<LineKey, string> = {
  billing: ERROR_COPY.billing_unavailable.message,
  storage: ERROR_COPY.storage_unavailable.message,
  email: ERROR_COPY.email_unavailable.message,
  measuring: BANNER_COPY.measuring,
  documents: BANNER_COPY.documents,
  content: ERROR_COPY.content_unavailable.message,
};

const VISIBLE_ON: Record<LineKey, OutagePage[]> = {
  billing: ['rig', 'engagement', 'account'],
  storage: ['rig', 'engagement', 'account'],
  email: ['rig'],
  measuring: ['rig'],
  documents: ['rig', 'engagement'],
  content: ['rig', 'engagement', 'account', 'public'],
};

export type Outage = {
  noteFromError: (code: string | undefined) => void;
  clear: (key: LineKey) => void;
  refresh: () => Promise<void>;
};

/**
 * The outage banner is rebuilt in place, so a refresh never closes a dialog, clears a typed
 * value, moves focus or re-announces text that has not changed.
 */
export const initOutage = (page: OutagePage): Outage => {
  const banner = qs<HTMLElement>('[data-outage]');
  const fromStatus = new Set<LineKey>();
  const fromActions = new Set<LineKey>();

  const paint = (): void => {
    if (banner === null) return;
    const keys = LINE_ORDER.filter(
      (key) => VISIBLE_ON[key].includes(page) && (fromStatus.has(key) || fromActions.has(key)),
    );
    const text = keys.map((key) => LINE_COPY[key]).join('\n');
    if ((banner.dataset.lines ?? '') === text) return;
    banner.dataset.lines = text;
    banner.innerHTML = '';
    for (const key of keys) {
      const line = document.createElement('p');
      line.textContent = LINE_COPY[key];
      line.dataset.outageLine = key;
      banner.append(line);
    }
    banner.hidden = keys.length === 0;
  };

  const refresh = async (): Promise<void> => {
    const result = await api<StatusBody>('/api/status');
    if (!result.ok) return;
    for (const key of ['billing', 'storage', 'email', 'measuring', 'documents'] as const) {
      if (result.body[key] === 'down') fromStatus.add(key);
      else {
        fromStatus.delete(key);
        fromActions.delete(key);
      }
    }
    paint();
  };

  const noteFromError = (code: string | undefined): void => {
    const map: Record<string, LineKey> = {
      billing_unavailable: 'billing',
      storage_unavailable: 'storage',
      email_unavailable: 'email',
      content_unavailable: 'content',
    };
    const key = code === undefined ? undefined : map[code];
    if (key === undefined) return;
    fromActions.add(key);
    paint();
  };

  if (page !== 'public') {
    void refresh();
    window.setInterval(() => void refresh(), 10_000);
  }

  return {
    noteFromError,
    clear: (key) => {
      fromActions.delete(key);
      fromStatus.delete(key);
      paint();
    },
    refresh,
  };
};

export const initMarquee = (): void => {
  const region = qs<HTMLElement>('[data-marquee]');
  const track = qs<HTMLElement>('[data-marquee-track]');
  const toggle = qs<HTMLButtonElement>('[data-marquee-toggle]');
  if (region === null || track === null || toggle === null) return;

  let pressed = false;
  let hovered = false;

  const apply = (): void => {
    track.dataset.paused = pressed || hovered ? 'true' : 'false';
  };

  toggle.addEventListener('click', () => {
    pressed = !pressed;
    toggle.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    toggle.textContent = pressed ? 'Play client names' : 'Pause client names';
    apply();
  });

  for (const event of ['pointerenter', 'focusin'] as const)
    region.addEventListener(event, () => {
      hovered = true;
      apply();
    });
  for (const event of ['pointerleave', 'focusout'] as const)
    region.addEventListener(event, () => {
      hovered = false;
      apply();
    });

  apply();
};

export const initStillZoom = (): void => {
  for (const image of qsa<HTMLImageElement>('[data-still]')) {
    image.addEventListener('click', () => {
      image.dataset.zoomed = 'true';
      image.tabIndex = 0;
      image.focus();
    });
    image.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        delete image.dataset.zoomed;
        image.removeAttribute('tabindex');
      }
    });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    for (const image of qsa<HTMLImageElement>('[data-still][data-zoomed="true"]')) {
      delete image.dataset.zoomed;
      image.removeAttribute('tabindex');
    }
  });
};
