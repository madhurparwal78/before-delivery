import { call } from '../lib/api.js';
import { clear, el, focus } from '../lib/dom.js';
import { liveRegion } from '../lib/forms.js';
import { openDialog } from '../lib/dialog.js';
import { flyToTray, reducedMotion, DURATION } from '../lib/motion.js';
import { navigate, pageHeading, type RenderContext, type Screen, type ScreenResult } from '../lib/router.js';
import { refreshTrayCount, trayLinkNode } from '../lib/chrome.js';
import { copy } from '../lib/copy.js';
import { TRAY_LIMIT, trayAdd, trayHas, trayMove, trayRemove, tray } from '../lib/store.js';
import { BOARD_TITLES, formatCompactReach, formatHeight, formatHeightInchesOnly, formatMeasurement } from '../../shared/format.js';
import { BOARDS, type Board, type PublicCard, type PublicProfile } from '../../shared/types.js';

type BoardSummary = { board: Board; title: string; count: number; coverPhotoUrl: string | null };

const OFFICE_LABELS: Record<string, string> = { toronto: 'Toronto', vancouver: 'Vancouver' };

type Choices = { office: string; q: string; sort: string; unit: string; page: number };

function choicesFrom(query: URLSearchParams): Choices {
  return {
    office: query.get('office') ?? 'all',
    q: query.get('q') ?? '',
    sort: query.get('sort') ?? 'name',
    unit: query.get('unit') ?? 'cm',
    page: Math.max(1, Number.parseInt(query.get('page') ?? '1', 10) || 1),
  };
}

/** Every choice always travels in the address. */
function boardHref(board: string, choices: Choices): string {
  const params = new URLSearchParams({
    office: choices.office,
    q: choices.q,
    sort: choices.sort,
    unit: choices.unit,
    page: String(choices.page),
  });
  return `/boards/${board}?${params.toString()}`;
}

function heightText(card: PublicCard, unit: string): string {
  if (card.measurements.heightCm === null) return '';
  return unit === 'ft_in'
    ? formatHeightInchesOnly(card.measurements.heightCm)
    : `${card.measurements.heightCm} cm`;
}

const trayLive = liveRegion('Tray announcements');

function trayButton(card: PublicCard, portrait: HTMLElement | null): HTMLButtonElement {
  const inTray = trayHas(card.slug);
  const button = el('button', {
    type: 'button',
    class: 'button button-quiet tray-button',
    text: inTray ? 'Remove from tray' : 'Add to tray',
  });
  button.addEventListener('click', () => {
    if (trayHas(card.slug)) {
      trayRemove(card.slug);
      button.textContent = 'Add to tray';
      refreshTrayCount(true);
      trayLive.announce(`Removed ${card.displayName}. ${tray().length} in tray.`);
      return;
    }
    const outcome = trayAdd({ slug: card.slug, displayName: card.displayName });
    if (outcome === 'full') {
      trayLive.announce(copy.trayFull);
      return;
    }
    button.textContent = 'Remove from tray';
    const target = trayLinkNode();
    if (portrait && target) flyToTray(portrait, target);
    refreshTrayCount(true);
    trayLive.announce(`Added ${card.displayName} to your tray. ${tray().length} in tray.`);
  });
  return button;
}

function cardNode(card: PublicCard, choices: Choices): HTMLElement {
  const portrait = card.coverPhotoUrl
    ? el('img', { class: 'portrait', src: card.coverPhotoUrl, alt: `${card.displayName}, portfolio cover`, loading: 'lazy' })
    : el('div', { class: 'portrait portrait-empty', 'aria-hidden': 'true' });
  const article = el('article', { class: 'card', 'aria-label': card.displayName }, [
    el('a', { class: 'card-link', href: `/talent/${card.slug}?unit=${choices.unit}` }, [portrait]),
    el('h2', { class: 'card-name' }, [
      el('a', { class: 'card-name-link', href: `/talent/${card.slug}?unit=${choices.unit}`, text: card.displayName }),
    ]),
    el('p', { class: 'card-facts tabular' }, [
      el('span', { text: OFFICE_LABELS[card.office] ?? card.office }),
      el('span', { text: heightText(card, choices.unit) }),
      el('span', { text: `${formatCompactReach(card.reach.total)} reach` }),
    ]),
    trayButton(card, portrait),
  ]);
  return article;
}

async function fetchCards(board: string, choices: Choices): Promise<{
  total: number;
  totalPages: number;
  talent: PublicCard[];
}> {
  const params = new URLSearchParams({
    board,
    office: choices.office,
    q: choices.q,
    sort: choices.sort,
    page: String(choices.page),
  });
  const result = await call<{ total: number; totalPages: number; talent: PublicCard[] }>(
    'GET',
    `/api/public/talent?${params.toString()}`,
  );
  return result.body ?? { total: 0, totalPages: 1, talent: [] };
}

export const boardIndexScreen: Screen = {
  pattern: '/boards',
  async render(): Promise<ScreenResult> {
    const result = await call<{ boards: BoardSummary[] }>('GET', '/api/public/boards');
    const boards = result.body?.boards ?? [];
    const preview = el('div', { class: 'board-preview', 'aria-hidden': 'true', hidden: true });
    const previewImage = el('img', { class: 'board-preview-image', alt: '' });
    preview.append(previewImage);

    const rows = boards.map((summary) => {
      const link = el('a', {
        class: 'board-row-link display',
        href: boardHref(summary.board, { office: 'all', q: '', sort: 'name', unit: 'cm', page: 1 }),
        text: summary.title,
      });
      const row = el('li', { class: 'board-row' }, [
        link,
        el('span', { class: 'board-count tabular', text: `${summary.count} talent` }),
      ]);
      row.addEventListener('pointermove', (event) => {
        if (event.pointerType !== 'mouse' || !summary.coverPhotoUrl) return;
        previewImage.src = summary.coverPhotoUrl;
        preview.hidden = false;
        preview.style.transform = `translate(${event.clientX + 24}px, ${event.clientY + 24}px)`;
        if (!preview.classList.contains('is-visible')) {
          preview.classList.add('is-visible');
          if (!reducedMotion()) preview.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION.short });
        }
      });
      row.addEventListener('pointerleave', () => {
        preview.hidden = true;
        preview.classList.remove('is-visible');
      });
      return row;
    });

    const node = el('main', { class: 'page page-boards' }, [
      pageHeading('Boards'),
      el('p', { class: 'lede', text: 'Four boards of represented talent in Toronto and Vancouver.' }),
      el('nav', { 'aria-label': 'Boards' }, [el('ul', { class: 'board-index' }, rows)]),
      preview,
      trayLive.node,
    ]);
    return { node, chrome: 'public' };
  },
};

export const boardListingScreen: Screen = {
  pattern: '/boards/:board',
  async render(ctx: RenderContext): Promise<ScreenResult> {
    const board = ctx.params.board as Board;
    if (!BOARDS.includes(board)) {
      return {
        node: el('main', { class: 'page' }, [pageHeading('Board not found')]),
        chrome: 'public',
      };
    }
    const choices = choicesFrom(ctx.query);
    const data = await fetchCards(board, choices);

    const grid = el('div', { class: 'card-grid' }, data.talent.map((card) => cardNode(card, choices)));
    const count = el('p', {
      class: 'result-count tabular',
      text: `${data.total} talent`,
    });

    const commit = (next: Partial<Choices>, resetPage = true): void => {
      const merged: Choices = { ...choices, ...next, page: next.page ?? (resetPage ? 1 : choices.page) };
      navigate(boardHref(board, merged));
    };

    const search = el('input', { type: 'search', class: 'input', id: 'board-search', value: choices.q });
    let searchTimer = 0;
    const commitSearch = (): void => {
      if (search.value === choices.q) return;
      window.clearTimeout(searchTimer);
      commit({ q: search.value });
    };
    search.addEventListener('change', commitSearch);
    search.addEventListener('input', () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(commitSearch, 400);
    });
    search.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitSearch();
      }
    });

    const officeGroup = el('div', { role: 'radiogroup', 'aria-label': 'Office', class: 'radiogroup inline' });
    for (const option of [
      { value: 'all', label: 'All offices' },
      { value: 'toronto', label: 'Toronto' },
      { value: 'vancouver', label: 'Vancouver' },
    ]) {
      const id = `office-${option.value}`;
      const input = el('input', { type: 'radio', name: 'office', id, class: 'radio' });
      input.checked = choices.office === option.value;
      input.addEventListener('change', () => {
        if (input.checked) commit({ office: option.value });
      });
      officeGroup.append(el('div', { class: 'radio-row' }, [input, el('label', { for: id, text: option.label })]));
    }

    const sort = el('select', { class: 'input', id: 'board-sort' });
    for (const option of [
      { value: 'name', label: 'Name' },
      { value: 'height', label: 'Height' },
      { value: 'reach', label: 'Reach' },
    ]) {
      const node = el('option', { value: option.value, text: option.label });
      if (option.value === choices.sort) node.selected = true;
      sort.append(node);
    }
    sort.addEventListener('change', () => commit({ sort: sort.value }));

    const unitGroup = el('div', { role: 'radiogroup', 'aria-label': 'Units', class: 'radiogroup inline' });
    for (const option of [
      { value: 'cm', label: 'cm' },
      { value: 'ft_in', label: 'ft and in' },
    ]) {
      const id = `unit-${option.value}`;
      const input = el('input', { type: 'radio', name: 'unit', id, class: 'radio' });
      input.checked = choices.unit === option.value;
      input.addEventListener('change', () => {
        if (input.checked) commit({ unit: option.value });
      });
      unitGroup.append(el('div', { class: 'radio-row' }, [input, el('label', { for: id, text: option.label })]));
    }

    const controls = el('div', { class: 'board-controls' }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'field-label', for: 'board-search', text: 'Search talent' }),
        search,
      ]),
      el('div', { class: 'field' }, [el('span', { class: 'field-label', text: 'Office' }), officeGroup]),
      el('div', { class: 'field' }, [
        el('label', { class: 'field-label', for: 'board-sort', text: 'Sort by' }),
        sort,
      ]),
      el('div', { class: 'field' }, [el('span', { class: 'field-label', text: 'Units' }), unitGroup]),
    ]);

    const filtersButton = el('button', { type: 'button', class: 'button filters-button', text: 'Filters' });
    filtersButton.addEventListener('click', () => {
      const dialog = openDialog({ title: 'Filters', sheet: true, returnFocusTo: filtersButton });
      const sheetChoices: Choices = { ...choices };
      const sheetCount = el('button', {
        type: 'button',
        class: 'button',
        text: `Show ${data.total} talent`,
      });
      const refreshCount = async (): Promise<void> => {
        const next = await fetchCards(board, { ...sheetChoices, page: 1 });
        sheetCount.textContent = `Show ${next.total} talent`;
      };
      const sheetOffice = el('div', { role: 'radiogroup', 'aria-label': 'Office', class: 'radiogroup' });
      for (const option of [
        { value: 'all', label: 'All offices' },
        { value: 'toronto', label: 'Toronto' },
        { value: 'vancouver', label: 'Vancouver' },
      ]) {
        const id = `sheet-office-${option.value}`;
        const input = el('input', { type: 'radio', name: 'sheet-office', id, class: 'radio' });
        input.checked = sheetChoices.office === option.value;
        input.addEventListener('change', () => {
          if (!input.checked) return;
          sheetChoices.office = option.value;
          void refreshCount();
        });
        sheetOffice.append(el('div', { class: 'radio-row' }, [input, el('label', { for: id, text: option.label })]));
      }
      const sheetUnit = el('div', { role: 'radiogroup', 'aria-label': 'Units', class: 'radiogroup' });
      for (const option of [
        { value: 'cm', label: 'cm' },
        { value: 'ft_in', label: 'ft and in' },
      ]) {
        const id = `sheet-unit-${option.value}`;
        const input = el('input', { type: 'radio', name: 'sheet-unit', id, class: 'radio' });
        input.checked = sheetChoices.unit === option.value;
        input.addEventListener('change', () => {
          if (input.checked) sheetChoices.unit = option.value;
        });
        sheetUnit.append(el('div', { class: 'radio-row' }, [input, el('label', { for: id, text: option.label })]));
      }
      sheetCount.addEventListener('click', () => {
        dialog.close();
        commit({ office: sheetChoices.office, unit: sheetChoices.unit });
      });
      dialog.body.append(
        el('div', { class: 'field' }, [el('span', { class: 'field-label', text: 'Office' }), sheetOffice]),
        el('div', { class: 'field' }, [el('span', { class: 'field-label', text: 'Units' }), sheetUnit]),
        el('div', { class: 'sticky-bar' }, [sheetCount]),
      );
      focus(dialog.body.querySelector<HTMLElement>('input'));
    });

    const previous = el('a', {
      class: 'nav-link',
      href: boardHref(board, { ...choices, page: Math.max(1, choices.page - 1) }),
      text: 'Previous page',
      'aria-disabled': choices.page <= 1 ? 'true' : null,
    });
    const next = el('a', {
      class: 'nav-link',
      href: boardHref(board, { ...choices, page: Math.min(data.totalPages, choices.page + 1) }),
      text: 'Next page',
      'aria-disabled': choices.page >= data.totalPages ? 'true' : null,
    });

    const node = el('main', { class: 'page page-board' }, [
      el('nav', { 'aria-label': 'Boards', class: 'board-nav' }, [
        el('ul', { class: 'board-nav-list' }, BOARDS.map((entry) =>
          el('li', {}, [
            el('a', {
              class: 'nav-link',
              href: boardHref(entry, { ...choices, page: 1 }),
              text: BOARD_TITLES[entry],
              'aria-current': entry === board ? 'page' : null,
            }),
          ]))),
      ]),
      pageHeading(BOARD_TITLES[board]),
      filtersButton,
      controls,
      count,
      grid,
      el('nav', { 'aria-label': 'Pages', class: 'pagination' }, [
        el('p', { class: 'tabular', text: `Page ${choices.page} of ${data.totalPages}` }),
        previous,
        next,
      ]),
      trayLive.node,
    ]);

    return { node, chrome: 'public' };
  },
};

export const profileScreen: Screen = {
  pattern: '/talent/:slug',
  async render(ctx: RenderContext): Promise<ScreenResult> {
    const unit = ctx.query.get('unit') ?? 'cm';
    const result = await call<PublicProfile>('GET', `/api/public/talent/${ctx.params.slug}`);
    if (result.status === 410) {
      return {
        node: el('main', { class: 'page page-gone' }, [
          pageHeading(copy.goneProfileHeading),
          el('p', { class: 'lede', text: copy.goneProfileBody }),
        ]),
        chrome: 'public',
      };
    }
    const profile = result.body;
    if (!profile) {
      return {
        node: el('main', { class: 'page page-gone' }, [pageHeading('Not found')]),
        chrome: 'public',
      };
    }
    const cover = profile.portfolio[0];
    const portrait = cover
      ? el('img', { class: 'portrait', src: cover.url, alt: `${profile.displayName}, portfolio cover` })
      : el('div', { class: 'portrait portrait-empty', 'aria-hidden': 'true' });

    const facts = el('dl', { class: 'facts tabular' }, [
      el('dt', { text: 'Office' }),
      el('dd', { text: OFFICE_LABELS[profile.office] ?? profile.office }),
      el('dt', { text: 'Board' }),
      el('dd', { text: BOARD_TITLES[profile.board] }),
      el('dt', { text: 'Height' }),
      el('dd', {
        text: profile.measurements.heightCm === null
          ? '—'
          : unit === 'ft_in'
            ? formatHeightInchesOnly(profile.measurements.heightCm)
            : formatHeight(profile.measurements.heightCm),
      }),
      el('dt', { text: 'Chest' }),
      el('dd', { text: profile.measurements.chestCm === null ? '—' : formatMeasurement(profile.measurements.chestCm) }),
      el('dt', { text: 'Waist' }),
      el('dd', { text: profile.measurements.waistCm === null ? '—' : formatMeasurement(profile.measurements.waistCm) }),
      el('dt', { text: 'Hips' }),
      el('dd', { text: profile.measurements.hipsCm === null ? '—' : formatMeasurement(profile.measurements.hipsCm) }),
      el('dt', { text: 'Instagram' }),
      el('dd', { text: formatCompactReach(profile.reach.instagram) }),
      el('dt', { text: 'TikTok' }),
      el('dd', { text: formatCompactReach(profile.reach.tiktok) }),
      el('dt', { text: 'YouTube' }),
      el('dd', { text: formatCompactReach(profile.reach.youtube) }),
      el('dt', { text: 'Total reach' }),
      el('dd', { text: formatCompactReach(profile.reach.total) }),
    ]);

    const article = el('article', { class: 'profile', 'aria-label': profile.displayName }, [
      el('div', { class: 'profile-facts' }, [facts, trayButton(profile, portrait)]),
      el('ul', { class: 'portfolio-grid', 'aria-label': 'Portfolio' }, profile.portfolio.map((photo, index) =>
        el('li', {}, [
          el('img', {
            class: 'portfolio-photo',
            src: photo.url,
            alt: `${profile.displayName}, photo ${index + 1} of ${profile.portfolio.length}`,
            loading: 'lazy',
          }),
        ]))),
    ]);

    const node = el('main', { class: 'page page-profile' }, [
      pageHeading(profile.displayName),
      article,
      trayLive.node,
    ]);
    return { node, chrome: 'public' };
  },
};

export const trayScreen: Screen = {
  pattern: '/tray',
  async render(): Promise<ScreenResult> {
    const list = el('ul', { class: 'tray-list', 'aria-label': 'Tray' });
    const start = el('button', { type: 'button', class: 'button', text: 'Start cast request' });
    start.addEventListener('click', () => navigate('/cast-request?step=1'));

    const draw = (focusSlug: string | null, focusKind: 'up' | 'down' | 'remove' | null): void => {
      clear(list);
      const entries = tray();
      for (const [index, entry] of entries.entries()) {
        const up = el('button', { type: 'button', class: 'button button-quiet', text: 'Up' });
        const down = el('button', { type: 'button', class: 'button button-quiet', text: 'Down' });
        const remove = el('button', { type: 'button', class: 'button button-quiet', text: 'Remove' });
        const item = el('li', { class: 'tray-item', 'aria-label': entry.displayName }, [
          el('span', { class: 'tray-name', text: entry.displayName }),
          el('div', { class: 'tray-actions' }, [up, down, remove]),
        ]);
        up.addEventListener('click', () => {
          const position = trayMove(entry.slug, -1);
          draw(entry.slug, 'up');
          trayLive.announce(`Moved ${entry.displayName} to position ${position + 1} of ${tray().length}.`);
        });
        down.addEventListener('click', () => {
          const position = trayMove(entry.slug, 1);
          draw(entry.slug, 'down');
          trayLive.announce(`Moved ${entry.displayName} to position ${position + 1} of ${tray().length}.`);
        });
        remove.addEventListener('click', () => {
          trayRemove(entry.slug);
          const remaining = tray();
          const nextSlug = remaining[index]?.slug ?? null;
          draw(nextSlug, nextSlug ? 'remove' : null);
          refreshTrayCount(true);
          trayLive.announce(`Removed ${entry.displayName}. ${remaining.length} in tray.`);
          if (!nextSlug) focus(start);
        });
        list.append(item);
      }
      if (entries.length === 0) {
        list.append(el('li', { class: 'tray-empty', text: 'Your tray is empty.' }));
      }
      if (focusSlug && focusKind) {
        const items = [...list.querySelectorAll<HTMLElement>('.tray-item')];
        const target = items.find((item) => item.getAttribute('aria-label') === tray().find((entry) => entry.slug === focusSlug)?.displayName);
        const label = focusKind === 'up' ? 'Up' : focusKind === 'down' ? 'Down' : 'Remove';
        const button = [...(target?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
          (candidate) => candidate.textContent === label,
        );
        focus(button ?? null);
      }
    };
    draw(null, null);

    const node = el('main', { class: 'page page-tray' }, [
      pageHeading('Your tray'),
      el('p', { class: 'lede', text: `Up to ${TRAY_LIMIT} talent travel with a cast request.` }),
      list,
      el('div', { class: 'sticky-bar' }, [start]),
      trayLive.node,
    ]);
    return { node, chrome: 'public' };
  },
};
