import { GRADES, SPECIES } from '../../shared/constants';
import { getJson } from '../api';
import { clear, el, labelled, openDialog, setText } from '../dom';
import { boardCountSentence, dimensions } from '../fmt';
import { formatAmount } from '../fmt';
import { navigate, replaceQuery } from '../router';
import { Page } from '../shell';
import { onUnitChange, unit } from '../store';
import { drawRackStrip } from '../strip';
import { BoardSummary, Lot } from '../types';

const WIDE = '(min-width: 768px)';
const FILTER_LIMIT = 12_000;

interface Filters {
  species: string[];
  grade: string[];
  minLength: string;
  minClear: string;
  lot: string;
}

function readInteger(raw: string | null): string {
  if (raw === null || raw === '') return '';
  if (!/^\d+$/.test(raw)) return '';
  return Number(raw) <= FILTER_LIMIT ? String(Number(raw)) : '';
}

function readFilters(search: URLSearchParams, lots: Lot[]): Filters {
  const lotId = search.get('lot');
  return {
    species: search.getAll('species').filter((value) => (SPECIES as readonly string[]).includes(value)),
    grade: search.getAll('grade').filter((value) => (GRADES as readonly string[]).includes(value)),
    minLength: readInteger(search.get('min_length_mm')),
    minClear: readInteger(search.get('min_clear_mm')),
    lot: lotId !== null && lots.some((lot) => lot.id === lotId) ? lotId : ''
  };
}

function queryFor(filters: Filters): string {
  const search = new URLSearchParams();
  for (const value of filters.species) search.append('species', value);
  for (const value of filters.grade) search.append('grade', value);
  if (filters.minLength !== '') search.set('min_length_mm', filters.minLength);
  if (filters.minClear !== '') search.set('min_clear_mm', filters.minClear);
  if (filters.lot !== '') search.set('lot', filters.lot);
  return search.toString();
}

export async function rackPage(search: URLSearchParams): Promise<Page> {
  const lotsResult = await getJson<{ lots: Lot[] }>('/api/lots');
  const lots = lotsResult.data?.lots ?? [];
  const filters = readFilters(search, lots);

  const count = el('p', { class: 'rack-count mono', attrs: { role: 'status', 'aria-label': 'Rack count' } });
  const list = el('ul', { class: 'rack-list', attrs: { role: 'list', 'aria-label': 'Rack' } });
  const filterHolder = el('div', { class: 'filter-holder' });
  const filtersButton = el('button', {
    class: 'filters-button',
    text: 'Filters',
    attrs: { type: 'button' },
    on: { click: () => openFilterSheet() }
  });

  const speciesBoxes = new Map<string, HTMLInputElement>();
  const gradeBoxes = new Map<string, HTMLInputElement>();

  function checkbox(value: string, into: Map<string, HTMLInputElement>): HTMLElement {
    const input = el('input', { attrs: { type: 'checkbox', value } });
    input.checked = into === speciesBoxes ? filters.species.includes(value) : filters.grade.includes(value);
    input.addEventListener('change', () => {
      const chosen = [...into.entries()].filter(([, box]) => box.checked).map(([name]) => name);
      if (into === speciesBoxes) filters.species = chosen;
      else filters.grade = chosen;
      schedule();
    });
    into.set(value, input);
    return labelled(value, input, 'check');
  }

  const speciesGroup = el('fieldset', { class: 'filter-group', attrs: { 'aria-label': 'Species' } }, [
    el('legend', { text: 'Species' }),
    ...SPECIES.map((name) => checkbox(name, speciesBoxes))
  ]);
  const gradeGroup = el('fieldset', { class: 'filter-group', attrs: { 'aria-label': 'Grade' } }, [
    el('legend', { text: 'Grade' }),
    ...GRADES.map((name) => checkbox(name, gradeBoxes))
  ]);

  const minLength = el('input', { attrs: { type: 'text', inputmode: 'numeric', value: filters.minLength } });
  const minClear = el('input', { attrs: { type: 'text', inputmode: 'numeric', value: filters.minClear } });
  minLength.addEventListener('input', () => {
    filters.minLength = minLength.value.trim();
    schedule();
  });
  minClear.addEventListener('input', () => {
    filters.minClear = minClear.value.trim();
    schedule();
  });

  const lotSelect = el('select', {}, [
    el('option', { text: 'All lots', attrs: { value: '' } }),
    ...lots.map((lot) => el('option', { text: lot.name, attrs: { value: lot.id } }))
  ]);
  lotSelect.value = filters.lot;
  lotSelect.addEventListener('change', () => {
    filters.lot = lotSelect.value;
    schedule();
  });

  const controls: HTMLElement[] = [
    speciesGroup,
    gradeGroup,
    labelled('Minimum length (mm)', minLength),
    labelled('Minimum clear run (mm)', minClear),
    labelled('Salvage lot', lotSelect)
  ];

  let sheet: { close(): void } | null = null;

  function openFilterSheet(): void {
    sheet = openDialog({
      name: 'Filters',
      sheet: true,
      opener: filtersButton,
      build: (handle) => [
        el('h2', { class: 'dialog-title', text: 'Filters' }),
        el('div', { class: 'filter-bar in-sheet' }, controls),
        el('button', { class: 'primary', text: 'Done', attrs: { type: 'button' }, on: { click: () => handle.close() } })
      ],
      onClose: () => {
        sheet = null;
        placeFilters();
      }
    });
  }

  function placeFilters(): void {
    if (sheet !== null) return;
    clear(filterHolder);
    if (window.matchMedia(WIDE).matches) {
      filterHolder.appendChild(el('div', { class: 'filter-bar' }, controls));
      return;
    }
    filterHolder.appendChild(filtersButton);
  }

  let sequence = 0;
  let timer = 0;
  let boards: BoardSummary[] = [];

  function schedule(): void {
    replaceQuery(queryFor(filters));
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void run();
    }, 120);
  }

  async function run(): Promise<void> {
    const mine = sequence + 1;
    sequence = mine;
    const query = queryFor(filters);
    const result = await getJson<{ count: number; boards: BoardSummary[] }>(`/api/boards${query === '' ? '' : `?${query}`}`);
    if (mine !== sequence || !result.ok || result.data === null) return;
    boards = result.data.boards;
    setText(count, boardCountSentence(result.data.count));
    renderList();
  }

  function renderList(): void {
    clear(list);
    const longest = boards.reduce((most, board) => Math.max(most, board.length_mm), 1);
    const holders: Array<{ holder: HTMLElement; board: BoardSummary }> = [];
    for (const board of boards) {
      const holder = el('div', { class: 'strip-holder' });
      const text = el('div', { class: 'rack-text' }, [
        el('a', {
          class: 'tag mono',
          text: board.tag,
          attrs: { href: `/boards/${board.tag}` },
          on: {
            click: (event) => {
              event.preventDefault();
              navigate(`/boards/${board.tag}`);
            }
          }
        }),
        el('span', { class: 'rack-species', text: `${board.species} · ${board.lot.name}` }),
        el('span', { class: 'mono rack-dims', text: dimensions(board.length_mm, board.width_mm, board.thickness_mm, unit()) }),
        el('span', {
          class: 'mono rack-money',
          text: `${board.board_feet} bd ft · ${board.price_cents === null ? 'no price' : `$${formatAmount(board.price_cents)}`}`
        }),
        board.status === 'held' ? el('span', { class: 'badge', text: 'Held' }) : null
      ]);
      const item = el('li', { class: 'rack-item', attrs: { role: 'listitem' } }, [holder, text]);
      list.appendChild(item);
      holders.push({ holder, board });
    }
    const width = holders[0]?.holder.clientWidth ?? 0;
    if (width <= 0) {
      window.requestAnimationFrame(() => drawStrips(holders, longest));
      return;
    }
    drawStrips(holders, longest);
  }

  function drawStrips(holders: Array<{ holder: HTMLElement; board: BoardSummary }>, longest: number): void {
    const width = holders[0]?.holder.clientWidth ?? 0;
    if (width <= 0) return;
    for (const { holder, board } of holders) {
      clear(holder);
      holder.appendChild(
        drawRackStrip({
          tag: board.tag,
          widthPx: width,
          lengthMm: board.length_mm,
          scaleLengthMm: longest,
          defects: board.defects,
          grade: board.grade
        })
      );
    }
  }

  const element = el('section', { class: 'page rack' }, [
    el('h1', { class: 'page-title', text: 'The rack' }),
    filterHolder,
    count,
    list
  ]);

  placeFilters();
  void run();

  let resizeTimer = 0;
  const onResize = (): void => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      placeFilters();
      renderList();
    }, 120);
  };
  window.addEventListener('resize', onResize);
  const stopUnits = onUnitChange(() => renderList());

  return {
    element,
    banners: ['billing'],
    destroy: () => {
      window.removeEventListener('resize', onResize);
      stopUnits();
      window.clearTimeout(timer);
    }
  };
}
