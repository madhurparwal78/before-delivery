import { EDITION_SIZE, errorCopy, plateFor } from '../../shared/copy.js';
import type { SearchHit } from '../../shared/types.js';
import { ApiCallFailed, call } from '../api.js';
import type { CellRect, ShelfCellState } from '../scene/scene.js';
import { shelfModel } from '../store.js';
import { clear, el } from './dom.js';
import { heldBox } from './hold.js';
import { markMotion } from '../motion.js';

export interface ShelfOptions {
  onChoose: (boxNumber: number) => void;
  onPassage: (chapter: string) => void;
  onBox: (boxNumber: number) => void;
}

export interface ShelfView {
  element: HTMLElement;
  refresh(): void;
  cells(): CellRect[];
  states(): ShelfCellState[];
  focusCell(boxNumber: number): void;
  searchBox: HTMLInputElement;
}

const shapes: Record<ShelfCellState, string> = {
  available: '\u25ad',
  held: '\u2577',
  yours: '\u2726',
  taken: '\u25e3',
};

export function columnsForWidth(width: number): number {
  if (width >= 1280) return 20;
  if (width >= 768) return 12;
  return 6;
}

export function buildShelf(options: ShelfOptions): ShelfView {
  const searchBox = el('input', {
    type: 'search',
    'aria-label': 'Search the tale and the shelf',
    autocomplete: 'off',
  });
  const results = el('ul', { class: 'search-results', role: 'list', 'aria-label': 'Search results' });
  const searchStatus = el('div', {
    class: 'visually-hidden',
    role: 'status',
    'aria-label': 'Search status',
  });
  const search = el('div', { class: 'shelf-search' }, [
    el('label', { class: 'field' }, [el('span', { text: 'Search the tale and the shelf' }), searchBox]),
    results,
    searchStatus,
  ]);

  markMotion(searchBox, 'focus');
  const grid = el('div', { class: 'grid', role: 'grid', 'aria-label': 'Box shelf' });
  const element = el('div', { class: 'shelf-layer' }, [search, grid]);

  const cellNodes = new Map<number, HTMLElement>();
  let columns = columnsForWidth(window.innerWidth);
  let active = 1;

  function stateOf(boxNumber: number): ShelfCellState {
    const hold = heldBox();
    if (hold !== null && hold.number === boxNumber) return 'yours';
    const published = shelfModel.states.get(boxNumber) ?? 'available';
    return published;
  }

  function nameOf(boxNumber: number): string {
    return `Box ${boxNumber}, ${plateFor(boxNumber)}, ${stateOf(boxNumber)}`;
  }

  function build(): void {
    clear(grid);
    cellNodes.clear();
    let row: HTMLElement = grid;
    for (let boxNumber = 1; boxNumber <= EDITION_SIZE; boxNumber += 1) {
      if ((boxNumber - 1) % columns === 0) {
        row = el('div', { role: 'row', style: 'display:contents' });
        grid.append(row);
      }
      const cell = el('div', {
        role: 'gridcell',
        class: 'cell',
        tabindex: boxNumber === active ? 0 : -1,
        'aria-label': nameOf(boxNumber),
        'data-number': boxNumber,
      });
      cell.append(el('span', { text: String(boxNumber) }));
      cell.append(el('span', { class: 'shape', 'aria-hidden': 'true' }));
      cell.addEventListener('click', () => choose(boxNumber));
      cell.addEventListener('focus', () => {
        if (active === boxNumber) return;
        active = boxNumber;
        paint();
      });
      cellNodes.set(boxNumber, cell);
      row.append(cell);
    }
    paint();
  }

  function paint(): void {
    for (const [boxNumber, cell] of cellNodes) {
      const state = stateOf(boxNumber);
      cell.setAttribute('data-state', state);
      cell.setAttribute('aria-label', nameOf(boxNumber));
      const shape = cell.querySelector('.shape');
      if (shape !== null) shape.textContent = shapes[state];
      cell.setAttribute('tabindex', boxNumber === active ? '0' : '-1');
    }
  }

  function choose(boxNumber: number): void {
    active = boxNumber;
    paint();
    options.onChoose(boxNumber);
  }

  function moveTo(boxNumber: number): void {
    active = Math.min(EDITION_SIZE, Math.max(1, boxNumber));
    paint();
    cellNodes.get(active)?.focus();
  }

  let typed = '';
  let typedTimer = 0;

  grid.addEventListener('keydown', (event) => {
    const key = event.key;
    if (key === 'ArrowRight' && active % columns !== 0) {
      event.preventDefault();
      moveTo(active + 1);
      return;
    }
    if (key === 'ArrowLeft' && (active - 1) % columns !== 0) {
      event.preventDefault();
      moveTo(active - 1);
      return;
    }
    if (key === 'ArrowDown' && active + columns <= EDITION_SIZE) {
      event.preventDefault();
      moveTo(active + columns);
      return;
    }
    if (key === 'ArrowUp' && active - columns >= 1) {
      event.preventDefault();
      moveTo(active - columns);
      return;
    }
    if (key === 'Home') {
      event.preventDefault();
      moveTo(1);
      return;
    }
    if (key === 'End') {
      event.preventDefault();
      moveTo(EDITION_SIZE);
      return;
    }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      choose(active);
      return;
    }
    if (/^\d$/.test(key)) {
      event.preventDefault();
      typed += key;
      window.clearTimeout(typedTimer);
      typedTimer = window.setTimeout(() => {
        const wanted = Number.parseInt(typed, 10);
        typed = '';
        if (wanted >= 1 && wanted <= EDITION_SIZE) moveTo(wanted);
      }, 500);
    }
  });

  let searchTimer = 0;

  function renderHits(hits: SearchHit[]): void {
    clear(results);
    for (const hit of hits) {
      const link =
        hit.kind === 'passage'
          ? el('a', { href: `#${hit.chapter}`, text: hit.excerpt })
          : el('a', { href: `/box/${hit.number}`, text: `Box ${hit.number}, ${hit.plate}, ${hit.state}` });
      link.addEventListener('click', (event) => {
        event.preventDefault();
        if (hit.kind === 'passage') options.onPassage(hit.chapter);
        else options.onBox(hit.number);
      });
      results.append(el('li', {}, [link]));
    }
    searchStatus.textContent = `${hits.length} results`;
  }

  searchBox.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    const text = searchBox.value.trim();
    searchTimer = window.setTimeout(() => {
      if (text === '') {
        renderHits([]);
        return;
      }
      void call<{ hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(text)}`)
        .then((reply) => renderHits(reply.hits))
        .catch((error: unknown) => {
          clear(results);
          searchStatus.textContent =
            error instanceof ApiCallFailed ? error.failure.message : errorCopy.search_unreachable;
        });
    }, 150);
  });

  searchBox.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown') return;
    const first = results.querySelector<HTMLElement>('a');
    if (first === null) return;
    event.preventDefault();
    first.focus();
  });

  window.addEventListener('resize', () => {
    const next = columnsForWidth(window.innerWidth);
    if (next === columns) return;
    columns = next;
    build();
  });

  build();

  return {
    element,
    refresh: paint,
    cells() {
      const rects: CellRect[] = [];
      for (let boxNumber = 1; boxNumber <= EDITION_SIZE; boxNumber += 1) {
        const node = cellNodes.get(boxNumber);
        if (node === undefined) continue;
        const box = node.getBoundingClientRect();
        rects.push({ left: box.left, top: box.top, width: box.width, height: box.height });
      }
      return rects;
    },
    states() {
      const list: ShelfCellState[] = [];
      for (let boxNumber = 1; boxNumber <= EDITION_SIZE; boxNumber += 1) list.push(stateOf(boxNumber));
      return list;
    },
    focusCell(boxNumber) {
      moveTo(boxNumber);
    },
    searchBox,
  };
}
