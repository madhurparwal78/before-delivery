import { el } from './dom.js';
import { session } from './session.js';
import { api } from './api.js';
import { announce } from './dom.js';
import { LEVELS, LEVEL_NAMES, PUZZLES, type Level } from '../shared/puzzles.js';
import { countGivens } from '../shared/board.js';
import { m46, m49, m59Room, m59Signin, m56 } from '../shared/messages.js';

// Home: the wordmark large at the top left, the name list of the four levels,
// the specimen tile beside it (below it under 768 px), the fact line under
// the tile, and the Main navigation links at the bottom left. Every time Home
// opens, Easy is previewed; hovering or focusing a level button previews that
// level, and the preview stays until another level button is hovered or
// focused.

export async function renderHome(): Promise<HTMLElement> {
  const page = el('div', { class: 'home-hero' });

  const wordmark = el('h1', { class: 'wordmark' }, ['Seam']);

  const listWrap = el('div', { class: 'home-list' });
  const buttons = new Map<Level, HTMLButtonElement>();

  const specimenTile = el('div', { class: 'specimen-tile', id: 'specimen', role: 'img', 'aria-label': 'Specimen: Easy puzzle', 'data-level': 'easy' });
  const factLine = el('p', { class: 'fact-line', id: 'specimen-clues' }, ['']);

  function specimenOf(level: Level): void {
    const fixture = PUZZLES.find((p) => p.id === `${level}-1`);
    if (!fixture) return;
    specimenTile.replaceChildren();
    const mini = el('div', { class: 'specimen-grid' });
    for (const ch of fixture.puzzle) {
      if (ch === '0') {
        mini.append(el('span', { class: 'empty' }, [' ']));
      } else {
        mini.append(el('span', {}, [ch]));
      }
    }
    specimenTile.setAttribute('data-level', level);
    specimenTile.setAttribute('aria-label', `Specimen: ${LEVEL_NAMES[level]} puzzle`);
    specimenTile.append(mini);
    factLine.textContent = `${countGivens(fixture.puzzle)} clues`;
    for (const lvl of LEVELS) {
      buttons.get(lvl)?.setAttribute('data-preview', String(lvl === level));
    }
  }

  let previewed: Level = 'easy';

  for (const level of LEVELS) {
    const btn = el('button', {
      class: 'level-button',
      type: 'button',
      'aria-label': `New ${LEVEL_NAMES[level]} game`,
    }, [
      el('span', { class: 'level-name' }, [LEVEL_NAMES[level]]),
      el('span', { class: 'new-game-caption' }, ['New game']),
    ]);
    btn.addEventListener('mouseenter', () => {
      previewed = level;
      specimenOf(level);
    });
    btn.addEventListener('focus', () => {
      previewed = level;
      specimenOf(level);
    });
    btn.addEventListener('click', async () => {
      // A level button sends a signed-out visitor to /signin.
      if (!session.player) {
        window.location.href = `/signin?return=${encodeURIComponent('/')}`;
        return;
      }
      btn.setAttribute('aria-disabled', 'true');
      announce(m59Room());
      try {
        const created = await api.post<{ game: { id: string } }>('/api/games', { level });
        window.location.href = `/play/${created.game.id}`;
      } catch (err) {
        btn.setAttribute('aria-disabled', 'false');
        announce(m56());
      }
    });
    buttons.set(level, btn);
    listWrap.append(btn);
  }

  const links = el('nav', { class: 'footer-nav home-links', 'aria-label': 'Main' });
  const navHome = el('a', { href: '/daily' }, ['Daily']);
  const navDuel = el('a', { href: '/duel' }, ['Duel']);
  const navBoard = el('a', { href: '/leaderboard' }, ['Leaderboard']);
  const navProfile = el('a', { href: '/profile' }, ['Profile']);
  links.append(navHome, navDuel, navBoard, navProfile);
  if (session.player) {
    const out = el('button', { class: 'link-button', type: 'button' }, ['Sign out']);
    out.addEventListener('click', async () => {
      await session.signOut();
      window.location.href = '/';
    });
    links.append(out);
  } else {
    links.append(
      el('a', { href: '/signin' }, ['Sign in']),
      el('a', { href: '/signup' }, ['Create account']),
    );
  }

  specimenOf('easy');
  void previewed;

  page.append(
    wordmark,
    el('div', { class: 'home-left' }, [listWrap]),
    el('div', { class: 'home-right' }, [specimenTile, factLine]),
    links,
  );

  void m49;
  void m46;
  void m59Signin;
  return page;
}
