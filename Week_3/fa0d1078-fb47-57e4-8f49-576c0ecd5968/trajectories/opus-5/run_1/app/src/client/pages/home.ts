import type { GameShape } from '../../shared/api';
import { LEVELS, LEVEL_NAMES, levelPuzzle, type Level } from '../../shared/puzzles';
import { api } from '../api';
import { announce } from '../announcer';
import { apply, button, el, text } from '../dom';
import type { PageContext } from '../main';
import { navigate, noticeFor } from '../main';
import { pending } from '../pending';

/** The specimen tile holds a real mini-grid of the previewed level's first fixture. */
function miniGrid(level: Level): HTMLElement {
  const fixture = levelPuzzle(level, 1);
  const grid = el('span', { class: 'mini-grid' });
  for (const character of fixture.puzzle) {
    grid.append(el('span', { class: 'mini-cell' }, [character === '0' ? '' : character]));
  }
  return grid;
}

export function renderHome(context: PageContext): void {
  const { main } = context;
  main.append(text('h1', 'Seam', { class: 'wordmark' }));

  const specimen = el('span', { role: 'img', id: 'specimen', class: 'specimen' });
  const clues = el('p', { id: 'specimen-clues', class: 'fact-line' });
  const list = el('ul', { class: 'name-list' });
  const caption = text('span', 'New game', { class: 'new-game-caption' });
  const notice = el('p', { class: 'notice' });

  function preview(level: Level): void {
    const fixture = levelPuzzle(level, 1);
    apply(specimen, {
      'data-level': level,
      'aria-label': `Specimen: ${LEVEL_NAMES[level]} puzzle`,
    });
    specimen.replaceChildren(miniGrid(level));
    clues.textContent = `${fixture.givens} clues`;
    const item = list.querySelector(`[data-level-item="${level}"]`);
    item?.append(caption);
  }

  for (const level of LEVELS) {
    const start = button(LEVEL_NAMES[level], {
      'aria-label': `New ${LEVEL_NAMES[level]} game`,
      class: 'level-button',
    });
    start.addEventListener('mouseenter', () => preview(level));
    start.addEventListener('focus', () => preview(level));
    start.addEventListener('click', () => {
      if (!context.player) {
        navigate('/signin?next=%2F');
        return;
      }
      void pending(start, null, async () => {
        try {
          const created = await api.post<{ game: GameShape }>('/api/games', { level });
          navigate(`/play/${created.game.id}`);
        } catch (cause) {
          notice.textContent = noticeFor(cause);
          announce(noticeFor(cause));
        }
      });
    });
    list.append(el('li', { 'data-level-item': level, class: 'name-item' }, [start]));
  }

  main.append(list, el('div', { class: 'specimen-tile' }, [specimen]), clues, notice);
  preview('easy');
}
