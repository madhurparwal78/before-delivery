import type { LevelStatsShape, ProfileShape } from '../../shared/api';
import { M } from '../../shared/messages';
import { LEVELS, LEVEL_NAMES, type Level } from '../../shared/puzzles';
import { formatTime } from '../../shared/score';
import { api } from '../api';
import { announce } from '../announcer';
import { apply, el, text } from '../dom';
import type { PageContext } from '../main';
import { noticeFor } from '../main';

const TERMS = [
  'Games started',
  'Games won',
  'Win rate',
  'Best time',
  'Average time',
  'Best score',
] as const;

function values(stats: LevelStatsShape): string[] {
  return [
    String(stats.started),
    String(stats.won),
    stats.win_rate === null ? '-' : `${stats.win_rate}%`,
    stats.best_seconds === null ? '-' : formatTime(stats.best_seconds),
    stats.average_seconds === null ? '-' : formatTime(stats.average_seconds),
    stats.best_score === null ? '-' : String(stats.best_score),
  ];
}

export async function renderProfile(context: PageContext): Promise<void> {
  const { main } = context;
  main.append(text('h1', 'Profile'));
  const loading = text('p', M.preparing, { class: 'serif-sentence' });
  main.append(loading);

  let profile: ProfileShape;
  try {
    profile = await api.get<ProfileShape>('/api/profile');
  } catch (cause) {
    loading.textContent = noticeFor(cause);
    announce(noticeFor(cause));
    return;
  }
  loading.remove();

  const tabs = el('div', { role: 'tablist', 'aria-label': 'Levels', class: 'tablist' });
  const panels = new Map<Level, HTMLElement>();
  const tabButtons = new Map<Level, HTMLElement>();

  for (const level of LEVELS) {
    const tab = el(
      'button',
      {
        type: 'button',
        role: 'tab',
        id: `tab-${level}`,
        'aria-controls': `panel-${level}`,
        'aria-selected': level === 'easy' ? 'true' : 'false',
        tabindex: level === 'easy' ? '0' : '-1',
        class: 'tab',
      },
      [LEVEL_NAMES[level]],
    );
    tab.addEventListener('click', () => choose(level, true));
    tabButtons.set(level, tab);
    tabs.append(tab);

    const list = el('dl', { class: 'stats' });
    const stats = values(profile.levels[level]);
    TERMS.forEach((term, index) => {
      list.append(el('dt', {}, [term]), el('dd', {}, [stats[index] as string]));
    });
    const panel = el(
      'div',
      {
        role: 'tabpanel',
        id: `panel-${level}`,
        'aria-labelledby': `tab-${level}`,
        class: 'tabpanel',
        hidden: level !== 'easy',
      },
      [list],
    );
    panels.set(level, panel);
  }

  function choose(level: Level, focus: boolean): void {
    for (const name of LEVELS) {
      const tab = tabButtons.get(name) as HTMLElement;
      apply(tab, {
        'aria-selected': name === level ? 'true' : 'false',
        tabindex: name === level ? '0' : '-1',
      });
      (panels.get(name) as HTMLElement).hidden = name !== level;
    }
    if (focus) (tabButtons.get(level) as HTMLElement).focus();
  }

  tabs.addEventListener('keydown', (event) => {
    const index = LEVELS.findIndex(
      (level) => tabButtons.get(level)?.getAttribute('aria-selected') === 'true',
    );
    const pick = (next: number): void => choose(LEVELS[next] as Level, true);
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        pick((index - 1 + LEVELS.length) % LEVELS.length);
        return;
      case 'ArrowRight':
        event.preventDefault();
        pick((index + 1) % LEVELS.length);
        return;
      case 'Home':
        event.preventDefault();
        pick(0);
        return;
      case 'End':
        event.preventDefault();
        pick(LEVELS.length - 1);
        return;
      default:
        return;
    }
  });

  main.append(tabs, ...panels.values());

  if (profile.finished_games.length === 0) {
    main.append(text('p', M.noFinishedGames, { class: 'serif-sentence' }));
    return;
  }

  const body = el('tbody');
  for (const game of profile.finished_games) {
    body.append(
      el('tr', {}, [
        el('td', {}, [game.date]),
        el('td', {}, [LEVEL_NAMES[game.level]]),
        el('td', {}, [game.result === 'won' ? 'Won' : 'Lost']),
        el('td', {}, [formatTime(game.seconds)]),
        el('td', {}, [game.score === null ? '-' : String(game.score)]),
      ]),
    );
  }
  const head = el('tr');
  for (const column of ['Date', 'Level', 'Result', 'Time', 'Score']) {
    head.append(el('th', { scope: 'col' }, [column]));
  }
  const table = el(
    'table',
    { id: 'finished-games', 'aria-label': 'Finished games', class: 'rows-table' },
    [el('thead', {}, [head]), body],
  );
  main.append(el('div', { class: 'table-tile' }, [table]));
}
