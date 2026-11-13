import { copy } from '../../shared/copy';
import type { PuzzleTile } from '../../shared/types';
import { api } from '../api';
import { el, replace } from '../dom';
import { navigate, sentenceTile } from '../main';
import { pageInterval } from '../state';
import { openUploadDialog } from '../ui/uploadDialog';

type Band = 'small' | 'medium' | 'large';

function tileSize(puzzle: PuzzleTile): string {
  const side = Math.max(puzzle.cols, puzzle.rows);
  if (side <= 7) return 'tile-3x2';
  return side <= 12 ? 'tile-3x4' : 'tile-6x4';
}

async function startGame(puzzleId: string, mode: 'shared' | 'race'): Promise<void> {
  const game = await api.createGame(puzzleId, mode);
  navigate(`/games/${game.id}`);
}

function puzzleTile(puzzle: PuzzleTile): HTMLElement {
  return el('div', { class: `tile puzzle-tile ${tileSize(puzzle)}` }, [
    el('h3', { text: puzzle.title }),
    el('p', { class: 'muted', text: `${puzzle.cols}x${puzzle.rows}` }),
    el('p', { class: 'muted', text: `By ${puzzle.author}` }),
    puzzle.in_progress >= 1
      ? el('p', { class: 'in-progress', text: copy.inProgress(puzzle.in_progress) })
      : null,
    el('div', { class: 'tile-actions' }, [
      el('button', {
        type: 'button',
        class: 'button',
        'aria-label': `Start ${puzzle.title}`,
        text: 'Start',
        onclick: () => void startGame(puzzle.id, 'shared'),
      }),
      el('button', {
        type: 'button',
        class: 'button',
        'aria-label': `Race ${puzzle.title}`,
        text: 'Race',
        onclick: () => void startGame(puzzle.id, 'race'),
      }),
    ]),
  ]);
}

export async function mountBoard(container: HTMLElement): Promise<void> {
  const tiles = el('div', { class: 'board-tiles' });
  const filters = el('div', { class: 'tile filter-tile' });

  const read = (): { size: Band | null; source: 'library' | 'mine' | null } => {
    const params = new URLSearchParams(location.search);
    const size = params.get('size');
    const source = params.get('source');
    return {
      size: size === 'small' || size === 'medium' || size === 'large' ? size : null,
      source: source === 'library' || source === 'mine' ? source : null,
    };
  };

  async function refresh(): Promise<void> {
    const params = new URLSearchParams();
    const state = read();
    if (state.size) params.set('size', state.size);
    if (state.source) params.set('source', state.source);
    const search = params.toString();
    const result = await api.puzzles(search === '' ? '' : `?${search}`);
    replace(
      tiles,
      result.puzzles.length === 0
        ? [sentenceTile(copy.noPuzzlesMatch)]
        : result.puzzles.map(puzzleTile),
    );
    drawFilters();
  }

  function setFilter(key: 'size' | 'source', value: string): void {
    const params = new URLSearchParams(location.search);
    if (params.get(key) === value) params.delete(key);
    else params.set(key, value);
    const search = params.toString();
    history.pushState({}, '', `/puzzles${search === '' ? '' : `?${search}`}`);
    void refresh();
  }

  function chip(label: string, key: 'size' | 'source', value: string): HTMLElement {
    const state = read();
    const pressed = key === 'size' ? state.size === value : state.source === value;
    return el('button', {
      type: 'button',
      class: `chip${pressed ? ' pressed' : ''}`,
      'aria-pressed': pressed ? 'true' : 'false',
      text: label,
      onclick: () => setFilter(key, value),
    });
  }

  function drawFilters(): void {
    replace(filters, [
      chip('Small', 'size', 'small'),
      chip('Medium', 'size', 'medium'),
      chip('Large', 'size', 'large'),
      chip('Library', 'source', 'library'),
      chip('Mine', 'source', 'mine'),
      el('button', {
        type: 'button',
        class: 'button',
        text: 'Upload puzzle',
        onclick: () => openUploadDialog(() => void refresh()),
      }),
    ]);
  }

  container.append(el('div', { class: 'board board-page' }, [filters, tiles]));
  drawFilters();
  await refresh();
  pageInterval(() => void refresh(), 10000);
}
