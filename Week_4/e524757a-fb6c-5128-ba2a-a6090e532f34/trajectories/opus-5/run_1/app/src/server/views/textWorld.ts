import { creaturesOfIsland } from '../../shared/creatures.js';
import { copy, filmText } from '../../shared/copy.js';
import { ISLANDS, islandName } from '../../shared/islands.js';
import { query } from '../db.js';
import { albums, lighthouseState, stampCount } from '../domain/albums.js';
import { filmCount } from '../domain/film.js';
import type { PlayerRow } from '../domain/players.js';
import { header, statusRegion } from './chrome.js';
import { escape, page } from './html.js';

export type TextIslandCreature = { name: string; present: string; photographed: boolean; best: number | null };
export type TextIsland = { id: number; name: string; creatures: TextIslandCreature[]; pagesFilled: number };
export type TextWorldData = {
  signedIn: boolean;
  islands: TextIsland[];
  stamps: number;
  lighthouse: 'open' | 'closed';
  film: number;
  currentIsland: number;
  tile: [number, number];
};

export async function textWorldData(player: PlayerRow | null): Promise<TextWorldData> {
  if (!player) {
    return {
      signedIn: false,
      islands: ISLANDS.map((island) => ({
        id: island.id,
        name: island.name,
        creatures: creaturesOfIsland(island.id).map((creature) => ({
          name: creature.name,
          present: creature.present,
          photographed: false,
          best: null,
        })),
        pagesFilled: 0,
      })),
      stamps: 0,
      lighthouse: 'closed',
      film: 0,
      currentIsland: 1,
      tile: [3, 12],
    };
  }
  const bests = await query<{ creature_id: string; best: number }>(
    'SELECT creature_id, max(total) AS best FROM photos WHERE player_id = $1 GROUP BY creature_id',
    [player.id],
  );
  const bestByCreature = new Map(bests.rows.map((row) => [row.creature_id, row.best]));
  const list = await albums({ query }, player.id);
  return {
    signedIn: true,
    islands: list.map((album) => ({
      id: album.island,
      name: album.island_name,
      creatures: creaturesOfIsland(album.island).map((creature) => {
        const best = bestByCreature.get(creature.id);
        return {
          name: creature.name,
          present: creature.present,
          photographed: best !== undefined,
          best: best ?? null,
        };
      }),
      pagesFilled: album.pages_filled,
    })),
    stamps: await stampCount({ query }, player.id),
    lighthouse: lighthouseState(await stampCount({ query }, player.id)),
    film: await filmCount({ query }, player.id),
    currentIsland: player.island,
    tile: [player.tile_x, player.tile_y],
  };
}

export function creatureLine(creature: TextIslandCreature, signedIn: boolean): string {
  if (!signedIn) return `${creature.name}: ${creature.present}`;
  if (creature.photographed) return `${creature.name}: ${creature.present}, photographed, best ${creature.best} points`;
  return `${creature.name}: ${creature.present}, not photographed yet`;
}

export function textWorldBody(data: TextWorldData): string {
  const islands = data.islands
    .map(
      (island) => `<section class="text-island" data-island="${island.id}">
<h2>${escape(island.name)}</h2>
<ul class="text-creatures">${island.creatures
        .map((creature) => `<li>${escape(creatureLine(creature, data.signedIn))}</li>`)
        .join('')}</ul>
${
  data.signedIn
    ? `<p class="text-pages" data-text="pages">${escape(`${island.pagesFilled} of 4 album pages`)}</p>`
    : `<p class="text-pages">${escape(copy.signedOutProgress)}</p>`
}
${
  data.signedIn
    ? `<p><button type="button" class="text-sail" data-island="${island.id}"${
        island.id === data.currentIsland ? ' hidden' : ''
      }>Sail to ${escape(island.name)}</button></p>`
    : ''
}
</section>`,
    )
    .join('');

  const progress = data.signedIn
    ? `<ul class="text-progress">
<li data-text="stamps">Stamps: ${data.stamps}</li>
<li data-text="lighthouse">Lighthouse: ${data.lighthouse}</li>
<li data-text="film">Film: ${escape(filmText(data.film))}</li>
<li data-text="location">${escape(copy.textLocation(islandName(data.currentIsland), data.tile[0], data.tile[1]))}</li>
</ul>
<p><button type="button" id="text-refill"${data.currentIsland === 1 && data.film < 36 ? '' : ' disabled'}>Refill film</button></p>`
    : `<p>${escape(copy.signedOutProgress)}</p>`;

  return `${islands}
<section class="text-your-progress">
<h2>Your progress</h2>
${progress}
</section>`;
}

export function textWorldPage(player: PlayerRow | null, data: TextWorldData): string {
  return page(
    { title: 'Text world — Hushfoot', bodyClass: 'text-world', bootstrap: { page: 'text-world' } },
    `${header(player, data.film)}
<main id="main" class="text-world-main">
<h1>Text world</h1>
${statusRegion('Text world status', 'text-world-status')}
<div id="text-world-content">${textWorldBody(data)}</div>
</main>`,
  );
}
