/** The league table grid and the Tally cascade. */

import type { LeagueTable, TableTeam } from '../shared/model.js';
import { DURATIONS, TILE_FLIP_STAGGER } from '../shared/motion.js';
import { COPY } from './copy.js';
import { el, reducedMotion, setText } from './dom.js';
import type { TableNews } from './messages.js';

interface Tile {
  item: HTMLElement;
  article: HTMLElement;
  face: HTMLElement;
  total: HTMLElement;
}

interface Face {
  position: HTMLElement;
  name: HTMLElement;
  total: HTMLElement;
  lastRound: HTMLElement;
}

function faceParts(face: HTMLElement): Face {
  const parts = face.querySelectorAll<HTMLElement>('[data-part]');
  const find = (part: string): HTMLElement => {
    for (const held of parts) if (held.dataset['part'] === part) return held;
    throw new Error(`tile face without ${part}`);
  };
  return { position: find('position'), name: find('name'), total: find('total'), lastRound: find('last-round') };
}

function buildFace(): HTMLElement {
  return el('div', { class: 'tile-face' }, [
    el('span', { class: 'tile-position tabular', 'data-part': 'position' }),
    el('span', { class: 'tile-name', 'data-part': 'name' }),
    el('span', { class: 'tile-total tabular', 'data-part': 'total' }),
    el('span', { class: 'tile-last-round tabular', 'data-part': 'last-round' }),
  ]);
}

function fill(face: HTMLElement, team: TableTeam, total: number): void {
  const parts = faceParts(face);
  setText(parts.position, String(team.position));
  setText(parts.name, team.name);
  setText(parts.total, `${total} pts`);
  setText(
    parts.lastRound,
    team.last_round === null ? '' : `Round ${team.last_round.round}: ${team.last_round.score}`,
  );
}

export class TileGrid {
  readonly region: HTMLElement;
  readonly list: HTMLElement;
  private readonly tiles = new Map<number, Tile>();
  private shown: LeagueTable | null = null;
  private timers: number[] = [];
  private running: (() => void) | null = null;

  constructor(private readonly news: TableNews) {
    this.list = el('ul', { class: 'tile-grid', 'aria-label': 'League table' });
    this.region = el('section', { class: 'tile-region' }, [
      el('h2', { class: 'tile-heading' }, ['League table']),
      this.news.region,
      this.list,
    ]);
  }

  apply(table: LeagueTable): void {
    if (this.shown === null) {
      for (const team of table.teams) this.list.append(this.build(team));
      this.shown = table;
      return;
    }
    const cascading = table.version > this.shown.version && table.last_published_round !== null;
    if (!cascading) {
      this.paint(table);
      this.shown = table;
      return;
    }
    if (this.running !== null) this.running();
    if (reducedMotion()) {
      this.paint(table);
      this.crossfade();
      this.shown = table;
      this.tellTheRoom(table);
      return;
    }
    this.cascade(table);
  }

  private build(team: TableTeam): HTMLElement {
    const face = buildFace();
    fill(face, team, team.total);
    const article = el('article', { class: 'tile', tabindex: '0', 'aria-label': team.name }, [face]);
    const item = el('li', { class: 'tile-item' }, [article]);
    article.classList.toggle('leader', team.position === 1);
    this.tiles.set(team.team_id, { item, article, face, total: faceParts(face).total });
    return item;
  }

  /** A change that is not a publish: new names and new totals in place. */
  private paint(table: LeagueTable): void {
    for (const team of table.teams) {
      const tile = this.tiles.get(team.team_id);
      if (tile === undefined) continue;
      fill(tile.face, team, team.total);
      tile.article.setAttribute('aria-label', team.name);
      tile.article.classList.toggle('leader', team.position === 1);
    }
  }

  private crossfade(): void {
    for (const tile of this.tiles.values()) {
      tile.face.classList.remove('crossfade');
      void tile.face.offsetWidth;
      tile.face.classList.add('crossfade');
    }
    this.order();
  }

  /** Put the tiles in the server's table order, keeping the focused tile focused. */
  private order(): void {
    const table = this.shown;
    if (table === null) return;
    const wanted = table.teams
      .map((team) => this.tiles.get(team.team_id)?.item)
      .filter((item): item is HTMLElement => item !== undefined);
    const shownNow = [...this.list.children];
    if (wanted.every((item, index) => shownNow[index] === item)) return;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    for (const item of wanted) this.list.append(item);
    if (focused !== null && focused.isConnected) focused.focus({ preventScroll: true });
  }

  private cascade(table: LeagueTable): void {
    const before = this.shown;
    if (before === null) return;
    const oldTotals = new Map(before.teams.map((team) => [team.team_id, team.total]));
    const turning = before.teams
      .map((team) => this.tiles.get(team.team_id))
      .filter((tile): tile is Tile => tile !== undefined);

    const finish = (): void => {
      for (const timer of this.timers) window.clearTimeout(timer);
      this.timers = [];
      this.running = null;
      for (const tile of this.tiles.values()) {
        tile.article.classList.remove('flipping');
        tile.article.style.transition = '';
        tile.article.style.transform = '';
        tile.item.style.transition = '';
        tile.item.style.transform = '';
        for (const extra of tile.article.querySelectorAll('.tile-face-back')) extra.remove();
      }
      this.shown = table;
      this.paint(table);
      this.order();
      this.tellTheRoom(table);
    };
    this.running = finish;

    turning.forEach((tile, index) => {
      this.timers.push(
        window.setTimeout(() => {
          const team = table.teams.find((held) => this.tiles.get(held.team_id) === tile);
          if (team === undefined) return;
          this.turn(tile, team, oldTotals.get(team.team_id) ?? team.total);
        }, index * TILE_FLIP_STAGGER),
      );
    });

    const flipsDone = Math.max(0, turning.length - 1) * TILE_FLIP_STAGGER + DURATIONS.tileFlip;
    this.timers.push(
      window.setTimeout(() => {
        this.slide(table, oldTotals, finish);
      }, flipsDone),
    );
  }

  /** One half turn, revealing the tile's new content. */
  private turn(tile: Tile, team: TableTeam, oldTotal: number): void {
    const back = buildFace();
    back.classList.add('tile-face-back');
    back.setAttribute('aria-hidden', 'true');
    fill(back, team, oldTotal);
    tile.article.append(back);
    tile.article.classList.add('flipping');
    this.timers.push(
      window.setTimeout(() => {
        fill(tile.face, team, oldTotal);
        tile.article.setAttribute('aria-label', team.name);
        tile.article.classList.toggle('leader', team.position === 1);
        back.remove();
        tile.article.style.transition = 'none';
        tile.article.classList.remove('flipping');
        requestAnimationFrame(() => {
          tile.article.style.transition = '';
        });
      }, DURATIONS.tileFlip),
    );
  }

  /** Every tile slides to its new place while its total counts up. */
  private slide(table: LeagueTable, oldTotals: Map<number, number>, finish: () => void): void {
    const from = new Map<number, DOMRect>();
    for (const [teamId, tile] of this.tiles) from.set(teamId, tile.item.getBoundingClientRect());
    this.shown = table;
    this.order();
    for (const [teamId, tile] of this.tiles) {
      const was = from.get(teamId);
      if (was === undefined) continue;
      const now = tile.item.getBoundingClientRect();
      const dx = was.left - now.left;
      const dy = was.top - now.top;
      tile.item.style.transition = 'none';
      tile.item.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    requestAnimationFrame(() => {
      for (const tile of this.tiles.values()) {
        tile.item.style.transition = '';
        tile.item.classList.add('sliding');
        tile.item.style.transform = 'translate(0px, 0px)';
      }
    });
    const started = performance.now();
    const countUp = (): void => {
      const through = Math.min(1, (performance.now() - started) / DURATIONS.tileSlide);
      for (const team of table.teams) {
        const tile = this.tiles.get(team.team_id);
        if (tile === undefined) continue;
        const was = oldTotals.get(team.team_id) ?? team.total;
        const shown = Math.round(was + (team.total - was) * through);
        setText(tile.total, `${shown} pts`);
      }
      if (through < 1) requestAnimationFrame(countUp);
    };
    requestAnimationFrame(countUp);
    this.timers.push(
      window.setTimeout(() => {
        for (const tile of this.tiles.values()) tile.item.classList.remove('sliding');
        finish();
      }, DURATIONS.tileSlide),
    );
  }

  private tellTheRoom(table: LeagueTable): void {
    const leader = table.teams[0];
    if (table.last_published_round === null || leader === undefined) return;
    this.news.announce(COPY.published(table.last_published_round, leader.name, leader.total));
  }
}
