import { el } from './dom.js';
import { api } from './api.js';
import type { FinishedGame, ProfileShape } from '../shared/api.js';
import { LEVELS, LEVEL_NAMES, type Level } from '../shared/puzzles.js';
import { formatClock } from '../shared/score.js';
import * as M from '../shared/messages.js';

// The Profile page: the level tabs above their statistics panel, and the
// finished-games table below. Left and Right move between tabs; Home and End
// go to the first and last; only the selected tab is in the Tab order.

export async function renderProfilePage(): Promise<HTMLElement> {
  const h1 = el('h1', {}, ['Profile']);
  const page = el('div', {});

  let profile: ProfileShape;
  try {
    profile = await api.get<ProfileShape>('/api/profile');
  } catch {
    profile = { levels: emptyLevels(), finished_games: [] };
  }

  const tablist = el('div', { class: 'tablist', role: 'tablist', 'aria-label': 'Levels' });
  const panels = new Map<Level, HTMLElement>();
  const tabs = new Map<Level, HTMLButtonElement>();
  let selected: Level = 'easy';

  for (const level of LEVELS) {
    const tab = el('button', {
      class: 'button',
      type: 'button',
      role: 'tab',
      id: `tab-${level}`,
      'aria-selected': String(level === selected),
      'aria-controls': `panel-${level}`,
      tabindex: level === selected ? '0' : '-1',
    }, [LEVEL_NAMES[level]]);
    tabs.set(level, tab);
    tablist.append(tab);
  }

  function panelOf(level: Level): HTMLElement {
    const stats = profile.levels[level];
    const panel = el('div', { class: 'tile', role: 'tabpanel', id: `panel-${level}`, 'aria-labelledby': `tab-${level}` });
    const dl = el('dl', { class: 'stats-list' });
    dl.append(
      el('dt', {}, ['Games started']),
      el('dd', {}, [String(stats.started)]),
      el('dt', {}, ['Games won']),
      el('dd', {}, [String(stats.won)]),
      el('dt', {}, ['Win rate']),
      el('dd', {}, [stats.win_rate === null ? '-' : `${stats.win_rate}%`]),
      el('dt', {}, ['Best time']),
      el('dd', {}, [stats.best_seconds === null ? '-' : formatClock(stats.best_seconds * 1000)]),
      el('dt', {}, ['Average time']),
      el('dd', {}, [stats.average_seconds === null ? '-' : formatClock(stats.average_seconds * 1000)]),
      el('dt', {}, ['Best score']),
      el('dd', {}, [stats.best_score === null ? '-' : String(stats.best_score)]),
    );
    panel.append(dl);
    return panel;
  }

  const panelHost = el('div', {});
  panels.set('easy', panelOf('easy'));

  function selectTab(level: Level): void {
    selected = level;
    for (const lvl of LEVELS) {
      const tab = tabs.get(lvl);
      if (!tab) continue;
      tab.setAttribute('aria-selected', String(lvl === level));
      tab.setAttribute('tabindex', lvl === level ? '0' : '-1');
    }
    panelHost.replaceChildren(panelOf(level));
    tabs.get(level)?.focus();
  }

  for (const level of LEVELS) {
    tabs.get(level)?.addEventListener('click', () => selectTab(level));
  }

  tablist.addEventListener('keydown', (event) => {
    const idx = LEVELS.indexOf(selected);
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      selectTab(LEVELS[(idx + 1) % LEVELS.length]);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      selectTab(LEVELS[(idx - 1 + LEVELS.length) % LEVELS.length]);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      selectTab(LEVELS[0]);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      selectTab(LEVELS[LEVELS.length - 1]);
      return;
    }
  });

  selectTab('easy');

  // The finished-games table, newest first, at most 20 rows.
  const finishedHost = el('div', {});
  if (profile.finished_games.length === 0) {
    finishedHost.append(el('p', { class: 'form-result' }, [M.m58()]));
  } else {
    const tile = el('div', { class: 'tile table-tile' });
    const table = el('table', { id: 'finished-games', 'aria-label': 'Finished games' });
    const thead = el('thead');
    const headRow = el('tr');
    for (const name of ['Date', 'Level', 'Result', 'Time', 'Score']) {
      headRow.append(el('th', { scope: 'col' }, [name]));
    }
    thead.append(headRow);
    table.append(thead);
    const tbody = el('tbody');
    for (const finished of profile.finished_games as FinishedGame[]) {
      const tr = el('tr', { 'data-level': finished.level });
      tr.append(
        el('td', {}, [finished.date]),
        el('td', {}, [LEVEL_NAMES[finished.level]]),
        el('td', {}, [finished.result === 'won' ? 'Won' : 'Lost']),
        el('td', {}, [formatClock(finished.seconds * 1000)]),
        el('td', {}, [finished.score === null ? '-' : String(finished.score)]),
      );
      tbody.append(tr);
    }
    table.append(tbody);
    tile.append(table);
    finishedHost.append(tile);
  }

  page.append(h1, tablist, panelHost, el('h2', { class: 'visually-hidden-h2' }, ['Finished games']), finishedHost);
  return page;
}

function emptyLevels(): ProfileShape['levels'] {
  const out = {} as ProfileShape['levels'];
  for (const level of LEVELS) {
    out[level] = { started: 0, won: 0, win_rate: null, best_seconds: null, average_seconds: null, best_score: null };
  }
  return out;
}
