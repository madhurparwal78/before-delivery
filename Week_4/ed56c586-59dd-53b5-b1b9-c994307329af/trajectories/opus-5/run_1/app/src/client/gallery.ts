/** The project gallery: discipline filtering, the address, card reveal and return. */

import {
  filterProjects,
  formatCategoryParam,
  parseCategoryParam,
  projectHref,
  resultLineText,
} from '../shared/rules.js';
import { DISCIPLINES, PROJECTS, type DisciplineId } from '../shared/seed.js';
import {
  announce,
  focusWithRule,
  isNarrow,
  need,
  query,
  queryAll,
  reducedMotion,
  runScrollRules,
} from './dom.js';
import { currentUrl, historyState, replaceAddress } from './jumps.js';

const isDiscipline = (value: string): value is DisciplineId =>
  DISCIPLINES.some((discipline) => discipline.id === value);

export interface Gallery {
  readonly pressed: () => readonly DisciplineId[];
  readonly applyFromAddress: (options: { readonly rewrite: boolean }) => void;
  readonly returnFocus: () => boolean;
}

export const setUpGallery = (): Gallery => {
  const filters = queryAll<HTMLButtonElement>('[data-filter]');
  const results = need<HTMLElement>('[data-results]');
  const cards = queryAll<HTMLElement>('[data-project]');
  let pressed: DisciplineId[] = [];

  const paint = (next: readonly DisciplineId[], withAnnouncement: boolean): void => {
    const shown = filterProjects(next).map((project) => project.slug);
    for (const button of filters) {
      const value = button.dataset.filter ?? '';
      const isPressed = value === 'all' ? next.length === 0 : next.some((id) => id === value);
      button.setAttribute('aria-pressed', isPressed ? 'true' : 'false');
    }
    for (const card of cards) {
      const slug = card.dataset.project ?? '';
      const index = shown.indexOf(slug);
      const wasHidden = card.hidden;
      card.hidden = index === -1;
      if (index === -1) {
        delete card.dataset.col;
        delete card.dataset.filterEntered;
        continue;
      }
      card.dataset.col = String((index % 3) + 1);
      const link = need<HTMLAnchorElement>('[data-card-link]', card);
      link.href = projectHref(slug, next);
      if (wasHidden && !reducedMotion()) {
        delete card.dataset.filterEntered;
        void card.offsetWidth;
        card.dataset.filterEntered = 'true';
      }
    }
    results.textContent = resultLineText(shown.length);
    if (withAnnouncement) announce(resultLineText(shown.length));
    runScrollRules();
  };

  const writeAddress = (next: readonly DisciplineId[]): void => {
    const url = currentUrl();
    const value = formatCategoryParam(next);
    if (value === null) url.searchParams.delete('category');
    else url.searchParams.set('category', value);
    replaceAddress(url);
  };

  const toggle = (value: string): void => {
    if (value === 'all') pressed = [];
    else if (isDiscipline(value)) {
      pressed = pressed.includes(value)
        ? pressed.filter((id) => id !== value)
        : parseCategoryParam([...pressed, value].join(','));
    }
    paint(pressed, true);
    writeAddress(pressed);
  };

  for (const button of filters) {
    button.addEventListener('click', () => toggle(button.dataset.filter ?? ''));
  }

  const applyReveal = (card: HTMLElement, revealed: boolean): void => {
    card.dataset.revealed = isNarrow() || revealed ? 'true' : 'false';
  };

  for (const card of cards) {
    card.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse') applyReveal(card, true);
    });
    card.addEventListener('pointerleave', () => applyReveal(card, false));
    card.addEventListener('focusin', () => applyReveal(card, true));
    card.addEventListener('focusout', (event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && card.contains(next)) return;
      applyReveal(card, false);
    });
    // Leaving for a case study marks the gallery entry, so the return knows it.
    need<HTMLAnchorElement>('[data-card-link]', card).addEventListener('click', () => {
      replaceAddress(currentUrl(), { returnSlug: card.dataset.project ?? '' });
    });
  }

  const paintNarrow = (): void => {
    for (const card of cards) card.dataset.revealed = isNarrow() ? 'true' : 'false';
  };
  window.matchMedia('(max-width: 767px)').addEventListener('change', paintNarrow);
  paintNarrow();

  const applyFromAddress = (options: { readonly rewrite: boolean }): void => {
    const url = currentUrl();
    const raw = url.searchParams.get('category');
    pressed = parseCategoryParam(raw);
    paint(pressed, false);
    if (options.rewrite && raw !== formatCategoryParam(pressed)) writeAddress(pressed);
  };

  /** The gallery return: focus the card link of the project just read. */
  const returnFocus = (): boolean => {
    const slug = historyState().returnSlug ?? slugFromReferrer();
    if (slug === undefined) return false;
    const card = query<HTMLElement>(`[data-project="${slug}"]`);
    if (card === null || card.hidden) return false;
    focusWithRule(need<HTMLAnchorElement>('[data-card-link]', card));
    return true;
  };

  return { pressed: () => pressed, applyFromAddress, returnFocus };
};

const slugFromReferrer = (): string | undefined => {
  if (document.referrer === '') return undefined;
  const referrer = new URL(document.referrer);
  if (referrer.origin !== window.location.origin) return undefined;
  const match = /^\/work\/([^/]+)$/.exec(referrer.pathname);
  const slug = match?.[1];
  return slug !== undefined && PROJECTS.some((project) => project.slug === slug)
    ? slug
    : undefined;
};
