import { copy } from '../../shared/copy.js';
import { ApiError } from '../../shared/errors.js';
import { GRID, islandName, SPOTS, tileKind } from '../../shared/islands.js';
import { albums, lighthouseState, stampCount } from '../domain/albums.js';
import { board } from '../domain/boards.js';
import { filmCount } from '../domain/film.js';
import { ownHall, visibleHall } from '../domain/halls.js';
import { pendingNotes, visibleNotes } from '../domain/notes.js';
import { photoAnswer, type PhotoRow } from '../domain/photos.js';
import { savePosition, settingsOf, type PlayerRow, type Settings } from '../domain/players.js';
import { publicPostcard } from '../domain/postcards.js';
import { currentSafari } from '../domain/safaris.js';
import { worldState } from '../domain/world.js';
import { query } from '../db.js';
import { redirect, sendHtml, type Ctx, type Router } from '../http.js';
import { viewerOf } from '../session.js';
import { escape, page } from '../views/html.js';
import {
  boardPage,
  boardsPage,
  confirmPage,
  hallEditorPage,
  hallVisitPage,
  noGalleryPage,
  noPostcardPage,
  postcardPage,
  rangerPage,
  signInPage,
  signUpPage,
} from '../views/misc.js';
import { playPage } from '../views/play.js';
import { titlePage } from '../views/title.js';
import { textWorldData, textWorldPage } from '../views/textWorld.js';

function notFoundPage(): string {
  return page({ title: 'Nothing here — Hushfoot', bootstrap: { page: 'not-found' } }, `<main id="main"><h1>Nothing here</h1></main>`);
}

async function signedIn(ctx: Ctx): Promise<PlayerRow> {
  const viewer = await viewerOf(ctx);
  if (!viewer.player) {
    redirect(ctx, `/signin?next=${encodeURIComponent(ctx.url.pathname + ctx.url.search)}`);
    throw new Redirected();
  }
  return viewer.player;
}

export class Redirected extends Error {}

function presetFor(ctx: Ctx, settings: Settings): Settings['graphics'] {
  const override = ctx.url.searchParams.get('gfx');
  if (override === 'full' || override === 'balanced' || override === 'light') return override;
  return settings.graphics;
}

export function registerPages(router: Router): void {
  router.get('/', async (ctx) => {
    const viewer = await viewerOf(ctx);
    const film = viewer.player ? await filmCount({ query }, viewer.player.id) : 0;
    sendHtml(ctx, 200, titlePage(viewer.player, film));
  });

  router.get('/signup', async (ctx) => {
    sendHtml(ctx, 200, signUpPage());
  });

  router.get('/signin', async (ctx) => {
    const next = ctx.url.searchParams.get('next') ?? '';
    const local = /^\/(?!\/)/.test(next) ? next : '/play';
    sendHtml(ctx, 200, signInPage(local));
  });

  router.get('/confirm', async (ctx) => {
    const me = await signedIn(ctx);
    sendHtml(ctx, 200, confirmPage(me, await filmCount({ query }, me.id)));
  });

  router.get('/play', async (ctx) => {
    const me = await signedIn(ctx);
    const islandParam = ctx.url.searchParams.get('island');
    const spotParam = ctx.url.searchParams.get('spot');
    let notice: string | null = null;
    let current = me;
    if (islandParam !== null || spotParam !== null) {
      const island = Number.parseInt(islandParam ?? '', 10);
      const spot = Number.parseInt(spotParam ?? '', 10);
      const known = island >= 1 && island <= 5 && spot >= 1 && spot <= 4;
      const place = known ? { island, spot } : { island: 1, spot: 1 };
      if (!known) notice = copy.unknownSpot;
      const target = SPOTS[place.spot - 1];
      await savePosition({ query }, me.id, place.island, target.tile.x, target.tile.y, target.heading);
      current = {
        ...me,
        island: place.island,
        tile_x: target.tile.x,
        tile_y: target.tile.y,
        heading: target.heading,
      };
    }
    const settings = settingsOf(current);
    const stamps = await stampCount({ query }, current.id);
    const safari = await currentSafari(current.id);
    sendHtml(
      ctx,
      200,
      playPage({
        player: current,
        film: await filmCount({ query }, current.id),
        stamps,
        lighthouse: lighthouseState(stamps),
        albums: await albums({ query }, current.id),
        settings,
        world: await worldState(current.world_id),
        preset: presetFor(ctx, settings),
        notice,
        textWorld: await textWorldData(current),
        safari: safari
          ? {
              code: safari.code,
              status: safari.status,
              host: safari.host,
              guest: safari.guest,
              role: safari.host_id === current.id ? 'host' : 'guest',
              sightings: safari.sightings ?? [],
            }
          : null,
      }),
    );
  });

  router.get('/text-world', async (ctx) => {
    const viewer = await viewerOf(ctx);
    sendHtml(ctx, 200, textWorldPage(viewer.player, await textWorldData(viewer.player)));
  });

  router.get('/hall', async (ctx) => {
    const me = await signedIn(ctx);
    const photos = await query<PhotoRow>('SELECT * FROM photos WHERE player_id = $1 ORDER BY total DESC', [me.id]);
    sendHtml(
      ctx,
      200,
      hallEditorPage(me, await filmCount({ query }, me.id), await ownHall({ query }, me), photos.rows.map(photoAnswer)),
    );
  });

  router.get('/hall/:handle', async (ctx) => {
    const viewer = await viewerOf(ctx);
    const film = viewer.player ? await filmCount({ query }, viewer.player.id) : 0;
    try {
      const hall = await visibleHall(ctx.params.handle, viewer.player?.id ?? null);
      sendHtml(ctx, 200, hallVisitPage(viewer.player, film, hall, presetFor(ctx, { music: 0, effects: 0, graphics: 'full' })));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'not_found') {
        sendHtml(ctx, 404, noGalleryPage(viewer.player, film));
        return;
      }
      throw error;
    }
  });

  router.get('/board', async (ctx) => {
    const me = await signedIn(ctx);
    const notes = await visibleNotes(me.world_id, me.id);
    const owned = await query<{ id: string }>('SELECT id FROM notes WHERE author_id = $1', [me.id]);
    const mine = new Set(owned.rows.map((row) => row.id));
    sendHtml(
      ctx,
      200,
      boardPage(
        me,
        await filmCount({ query }, me.id),
        notes.map((note) => ({ ...note, author_id: mine.has(note.id) ? me.id : undefined })),
      ),
    );
  });

  router.get('/ranger', async (ctx) => {
    const me = await signedIn(ctx);
    const notes = me.ranger ? await pendingNotes(me.world_id) : [];
    sendHtml(ctx, 200, rangerPage(me, await filmCount({ query }, me.id), notes));
  });

  router.get('/boards/:island', async (ctx) => {
    const me = await signedIn(ctx);
    const island = Number.parseInt(ctx.params.island, 10);
    if (!(island >= 1 && island <= 5)) {
      sendHtml(ctx, 404, notFoundPage());
      return;
    }
    const listed = await board(me.world_id, island, null);
    const photos = await query<PhotoRow>(
      'SELECT * FROM photos WHERE player_id = $1 AND island = $2 ORDER BY total DESC, created_at ASC',
      [me.id, island],
    );
    sendHtml(
      ctx,
      200,
      boardsPage(
        me,
        await filmCount({ query }, me.id),
        island,
        listed.entries,
        listed.total,
        photos.rows.map(photoAnswer),
      ),
    );
  });

  router.get('/postcards/:id', async (ctx) => {
    try {
      sendHtml(ctx, 200, postcardPage(await publicPostcard(ctx.params.id)));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'not_found') {
        sendHtml(ctx, 404, noPostcardPage());
        return;
      }
      throw error;
    }
  });

  router.get('/islands/:island/map.svg', async (ctx) => {
    const island = Number.parseInt(ctx.params.island, 10);
    if (!(island >= 1 && island <= 5)) throw new ApiError('not_found');
    ctx.res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-store' });
    ctx.res.end(ctx.method === 'HEAD' ? undefined : stillMap(island));
  });
}

const TILE_FILL: Record<string, string> = { water: '#cfd8dc', rock: '#7b7b7b', land: '#dfe6d5' };

function stillMap(island: number): string {
  const size = 20;
  const tiles: string[] = [];
  for (let y = 0; y < GRID; y += 1)
    for (let x = 0; x < GRID; x += 1)
      tiles.push(
        `<rect x="${x * size}" y="${y * size}" width="${size}" height="${size}" fill="${TILE_FILL[tileKind(island, x, y)]}"/>`,
      );
  const spots = SPOTS.map(
    (spot, index) =>
      `<circle cx="${spot.tile.x * size + size / 2}" cy="${spot.tile.y * size + size / 2}" r="6" fill="#111"/>` +
      `<text x="${spot.tile.x * size + size / 2}" y="${spot.tile.y * size + size / 2 + 4}" font-size="9" fill="#fff" text-anchor="middle">${index + 1}</text>`,
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID * size} ${GRID * size}" width="${GRID * size}" height="${GRID * size}" role="img" aria-label="Still map of ${escape(islandName(island))}">
<title>Still map of ${escape(islandName(island))}</title>
${tiles.join('')}
${spots}
</svg>`;
}
