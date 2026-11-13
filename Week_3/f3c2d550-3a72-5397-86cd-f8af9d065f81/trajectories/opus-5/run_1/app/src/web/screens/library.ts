import {
  COLOUR_FAMILIES,
  DAILY_PULL_COPY,
  DECK_STATUS,
  SCREEN_STATES,
  formatPublishedDate,
  searchCountCopy,
  titleMakerYear,
} from '../../shared/copy.js';
import type { DailyPullJson, ReferenceJson } from '../../shared/types.js';
import { api } from '../api.js';
import { clear, element, setText } from '../dom.js';
import { startRefetch, stopFor, type Screen, type ScreenContext } from './screen.js';

/** The library: the Daily Pull card, the search controls and the reference rows. */

const SEARCH_PAUSE_MS = 250;

interface RowParts {
  row: HTMLLIElement;
  link: HTMLAnchorElement;
  maker: HTMLElement;
  size: HTMLElement;
}

export function renderLibrary({ shell }: ScreenContext): Screen {
  const heading = element('h1', {}, ['Library']);

  const pullRegion = element('section', {
    role: 'region',
    'aria-label': 'Daily Pull',
    class: 'daily-pull',
  });

  const searchBox = element('input', {
    type: 'search',
    role: 'searchbox',
    'aria-label': 'Search your deck',
    placeholder: 'kettle, Braunfeld, bead-blasted',
    class: 'search-box',
  });
  const colourFilter = element(
    'select',
    { 'aria-label': 'Colour family', class: 'colour-filter' },
    [
      element('option', { value: '' }, ['All colours']),
      ...COLOUR_FAMILIES.map((family) => element('option', { value: family }, [family])),
    ],
  );
  const controls = element('div', { class: 'library-controls' }, [
    element('label', { class: 'field-label' }, [
      element('span', {}, ['Search your deck']),
      searchBox,
    ]),
    element('label', { class: 'field-label' }, [
      element('span', {}, ['Colour family']),
      colourFilter,
    ]),
  ]);

  const todayHeading = element('h2', {}, ['Saved today']);
  const todayList = element('ul', { class: 'library-rows' });
  const earlierHeading = element('h2', {}, ['Earlier']);
  const earlierList = element('ul', { class: 'library-rows' });
  const resultsList = element('ul', { class: 'library-rows', hidden: true });
  const groups = element('div', { class: 'library-groups' }, [
    todayHeading,
    todayList,
    earlierHeading,
    earlierList,
  ]);

  shell.main.append(heading, pullRegion, controls, groups, resultsList);

  const rows = new Map<string, RowParts>();
  const references = new Map<string, ReferenceJson>();
  let tileId: string | null = null;
  let searching = false;
  let searchSequence = 0;
  let pause: number | null = null;
  let inFlight: AbortController | null = null;
  let destroyed = false;

  shell.field.showMessage(SCREEN_STATES.loading);

  function sizeLine(reference: ReferenceJson): string {
    return reference.size_text[shell.sizeUnit];
  }

  function buildRow(reference: ReferenceJson): RowParts {
    const link = element('a', { href: `/references/${reference.id}`, class: 'row-name' }, [
      reference.title,
    ]);
    const maker = element('p', { class: 'row-maker' }, [reference.maker ?? '']);
    const size = element('p', { class: 'row-size' }, [sizeLine(reference)]);
    const row = element('li', { class: 'library-row' }, [link, maker, size]);
    row.addEventListener('mouseenter', () => loadIntoTile(reference.id));
    link.addEventListener('focus', () => loadIntoTile(reference.id));
    return { row, link, maker, size };
  }

  function updateRow(parts: RowParts, reference: ReferenceJson): void {
    setText(parts.link, reference.title);
    parts.link.setAttribute('href', `/references/${reference.id}`);
    setText(parts.maker, reference.maker ?? '');
    setText(parts.size, sizeLine(reference));
  }

  function loadIntoTile(id: string): void {
    const reference = references.get(id);
    if (!reference || tileId === id) return;
    tileId = id;
    shell.field.swapSingle(stopFor(reference, shell.sizeUnit), 1);
  }

  /** Each refetch merges the answer into the rows already on screen. */
  function mergeList(list: HTMLUListElement, wanted: ReferenceJson[]): void {
    const wantedIds = new Set(wanted.map((reference) => reference.id));
    for (const child of [...list.children]) {
      const id = (child as HTMLElement).dataset.referenceId;
      if (id && !wantedIds.has(id)) removeRow(id);
    }
    let previous: Element | null = null;
    for (const reference of wanted) {
      let parts = rows.get(reference.id);
      if (!parts) {
        parts = buildRow(reference);
        parts.row.dataset.referenceId = reference.id;
        rows.set(reference.id, parts);
      } else {
        updateRow(parts, reference);
      }
      const expected: Element | null = previous ? previous.nextElementSibling : list.firstElementChild;
      if (expected !== parts.row) list.insertBefore(parts.row, expected);
      previous = parts.row;
    }
  }

  function orderedRows(): HTMLElement[] {
    return [
      ...todayList.querySelectorAll<HTMLElement>('.library-row'),
      ...earlierList.querySelectorAll<HTMLElement>('.library-row'),
      ...resultsList.querySelectorAll<HTMLElement>('.library-row'),
    ];
  }

  function removeRow(id: string): void {
    const parts = rows.get(id);
    if (!parts) return;
    const hadFocus = document.activeElement === parts.link;
    if (hadFocus) {
      const all = orderedRows();
      const position = all.indexOf(parts.row);
      const next = all[position + 1] ?? all[position - 1] ?? null;
      const link = next?.querySelector<HTMLAnchorElement>('.row-name');
      (link ?? searchBox).focus();
    }
    parts.row.remove();
    rows.delete(id);
    references.delete(id);
  }

  function showGroups(): void {
    groups.hidden = false;
    resultsList.hidden = true;
    todayHeading.hidden = false;
    earlierHeading.hidden = false;
  }

  /** The tile keeps the reference it shows; when that one has left, it falls back. */
  function settleTile(first: string | null): void {
    if (tileId && references.has(tileId)) return;
    if (!first) {
      tileId = null;
      shell.field.showMessage(SCREEN_STATES.libraryEmpty);
      return;
    }
    tileId = null;
    loadIntoTile(first);
  }

  async function refetchLibrary(): Promise<void> {
    if (searching) return;
    const library = await api.library().catch(() => null);
    if (!library || destroyed || searching) return;
    for (const reference of [...library.saved_today, ...library.earlier]) {
      references.set(reference.id, reference);
    }
    const keep = new Set([...library.saved_today, ...library.earlier].map((item) => item.id));
    for (const id of [...references.keys()]) if (!keep.has(id)) references.delete(id);
    mergeList(todayList, library.saved_today);
    mergeList(earlierList, library.earlier);
    showGroups();
    todayHeading.hidden = library.saved_today.length === 0;
    earlierHeading.hidden = library.earlier.length === 0;
    if (library.saved_today.length + library.earlier.length === 0) {
      tileId = null;
      shell.field.showMessage(SCREEN_STATES.libraryEmpty);
      return;
    }

    settleTile(library.saved_today[0]?.id ?? library.earlier[0]?.id ?? null);
  }

  function renderPull(pull: DailyPullJson): void {
    clear(pullRegion);
    const children: Array<Node | string> = [element('h2', {}, ['Daily Pull'])];
    if (pull.state === 'picked' && pull.reference) {
      const reference = pull.reference;
      const link = element('a', { href: `/references/${reference.id}` }, [reference.title]);
      const rest = titleMakerYear(reference.title, reference.maker, reference.year).slice(
        reference.title.length,
      );
      children.push(element('p', { class: 'pull-line' }, [link, rest]));
    } else {
      children.push(
        element('p', { class: 'pull-line' }, [
          pull.state === 'empty' ? DAILY_PULL_COPY.empty : DAILY_PULL_COPY.removed,
        ]),
      );
    }
    children.push(
      element('p', { class: 'pull-day' }, [`Pulled for ${formatPublishedDate(pull.pull_day)}`]),
      element('p', { class: 'pull-next' }, [`Next pull at 06:00, ${pull.zone}`]),
    );
    pullRegion.append(...children);
  }

  async function refetchPull(): Promise<void> {
    const pull = await api.dailyPull().catch(() => null);
    if (pull && !destroyed) renderPull(pull);
  }

  /** Only the results for the latest search text and filter are ever shown. */
  function runSearch(): void {
    searchSequence += 1;
    const sequence = searchSequence;
    const query = searchBox.value;
    const colour = colourFilter.value;
    if (query.trim() === '' && colour === '') {
      searching = false;
      inFlight?.abort();
      inFlight = null;
      clear(resultsList);
      void refetchLibrary();
      return;
    }
    searching = true;
    groups.hidden = true;
    resultsList.hidden = false;
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    void api
      .search(query, colour, controller.signal)
      .then((answer) => {
        if (sequence !== searchSequence || destroyed) return;
        for (const reference of answer.results) references.set(reference.id, reference);
        clear(resultsList);
        for (const reference of answer.results) {
          const parts = buildRow(reference);
          parts.row.dataset.referenceId = reference.id;
          rows.set(reference.id, parts);
          resultsList.append(parts.row);
        }
        shell.setDeckStatus(searchCountCopy(answer.results.length));
        if (answer.results.length === 0) {
          tileId = null;
          shell.field.showMessage(DECK_STATUS.searchZero);
        }
      })
      .catch(() => undefined);
  }

  searchBox.addEventListener('input', () => {
    if (pause !== null) window.clearTimeout(pause);
    pause = window.setTimeout(runSearch, SEARCH_PAUSE_MS);
  });
  colourFilter.addEventListener('change', () => {
    if (pause !== null) window.clearTimeout(pause);
    runSearch();
  });

  const stopUnitListener = shell.onUnitChange(() => {
    for (const [id, parts] of rows) {
      const reference = references.get(id);
      if (reference) setText(parts.size, sizeLine(reference));
    }
  });

  void refetchLibrary();
  void refetchPull();
  const stopRefetch = startRefetch(() => {
    void refetchLibrary();
    void refetchPull();
  });

  return {
    destroy() {
      destroyed = true;
      inFlight?.abort();
      if (pause !== null) window.clearTimeout(pause);
      stopRefetch();
      stopUnitListener();
    },
  };
}
