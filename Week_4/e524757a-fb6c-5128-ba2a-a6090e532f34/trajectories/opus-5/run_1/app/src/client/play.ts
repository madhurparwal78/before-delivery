import { copy, filmText, stampsText } from '../shared/copy.js';
import { framedCreatures } from '../shared/frame.js';
import { HEADING_ANGLE, isLand, SPOTS, islandName, type Heading, type Tile } from '../shared/islands.js';
import { shortestPath, Walker, type Gait } from '../shared/movement.js';
import { creatureById } from '../shared/creatures.js';
import {
  announce,
  api,
  bootstrap,
  byId,
  clearStatus,
  closePanel,
  need,
  openPanel,
  reducedMotion,
  setPressed,
  topPanel,
} from './dom.js';
import { countTo, setFigure } from './figures.js';
import { connectLive } from './live.js';
import { WorldScene, webglAvailable, type SceneCreature } from './scene.js';
import { Holds, startStepLoop } from './steps.js';
import { playEffect, setVolumes, wireSoundButton } from './sound.js';
import type { Album, PlayBootstrap, SafariSnapshot, WorldCreature } from './playTypes.js';
import { setupPanels } from './panels.js';

const DIRECTION_KEYS: Record<string, Heading> = {
  w: 'N',
  arrowup: 'N',
  a: 'W',
  arrowleft: 'W',
  s: 'S',
  arrowdown: 'S',
  d: 'E',
  arrowright: 'E',
};

const EXPLORE_ZOOMS = [1, 2, 3, 4];
const PHOTO_ZOOMS = [1, 2, 4];
const FOCUSES = [2, 4, 8, 16];
const MAX_CAPTURE_WIDTH = 960;
const SHUTTER_MS = 210;
const GUIDE_MS = 180;

export function startPlay(): void {
  const data = bootstrap<PlayBootstrap>();
  const view = need('world-view');
  const canvas = need<HTMLCanvasElement>('scene');
  const stillFallback = need('still-fallback');

  let island = data.position.island;
  let albums: Album[] = data.albums;
  let film = data.film;
  let stamps = data.stamps;
  let lighthouse = data.lighthouse;
  let tick = data.world.tick;
  let hour = data.world.hour;
  let weather = data.world.weather;
  let dusk = data.world.dusk;
  let creatures: WorldCreature[] = data.world.creatures;
  let safari: SafariSnapshot | null = data.safari;
  let mode: 'explore' | 'photo' = 'explore';
  let exploreYaw = HEADING_ANGLE[data.position.heading];
  let exploreZoom = 2;
  let yaw = exploreYaw;
  let zoom = 2;
  let focus = 0;
  let runToggle = false;
  let shooting = false;
  let spotted = new Set<string>();
  let lastFrameMessage = '';
  let guideTimer: number | null = null;

  const walker = new Walker((x, y) => isLand(island, x, y), { x: data.position.tile[0], y: data.position.tile[1] }, data.position.heading);
  const holds = new Holds();
  const scene3d = webglAvailable() ? new WorldScene(canvas, data.preset, reducedMotion()) : null;

  setVolumes(data.settings.music, data.settings.effects);
  wireSoundButton();

  const panels = setupPanels({
    view,
    islandOf: () => island,
    tileOf: () => walker.tile,
    filmOf: () => film,
    albumsOf: () => albums,
    safariOf: () => safari,
    setSafari: (next) => {
      safari = next;
      panels.renderSafari();
    },
    walkTo: (target) => walkTo(target),
    sailTo: (target) => void sailTo(target),
    refillFilm: () => refillFilm(),
    onRestart: async () => {
      const answer = await api('/api/me/restart', { method: 'POST', body: {} });
      if (answer.ok) history.replaceState(null, '', '/play');
    },
    onSettingsSaved: (settings) => setVolumes(settings.music, settings.effects),
  });

  function islandCreatures(): WorldCreature[] {
    return creatures.filter((creature) => creature.island === island);
  }

  function sceneCreatures(): SceneCreature[] {
    return islandCreatures().map((creature) => ({ id: creature.id, x: creature.x, y: creature.y, heading: creature.heading }));
  }

  function inViewIds(): string[] {
    if (mode !== 'photo') return [];
    return framedCreatures(walker.tile, walker.heading, zoom, islandCreatures()).map((entry) => entry.creature.id);
  }

  function syncHooks(): void {
    view.dataset.step = String(walker.step);
    view.dataset.tick = String(tick);
    view.dataset.island = String(island);
    view.dataset.tile = `${walker.tile.x},${walker.tile.y}`;
    view.dataset.heading = walker.heading;
    view.dataset.gait = walker.gait as Gait;
    view.dataset.mode = mode;
    view.dataset.yaw = String(((yaw % 360) + 360) % 360);
    view.dataset.zoom = String(zoom);
    view.dataset.focus = mode === 'photo' ? String(focus) : '';
    const ids = inViewIds();
    view.dataset.inView = ids.join(',');
    view.dataset.creatures = islandCreatures()
      .map((creature) => `${creature.id}@${creature.x},${creature.y},${creature.heading}`)
      .join(';');
    view.dataset.worldHour = String(hour);
    view.dataset.weather = weather;
    view.dataset.lighthouse = lighthouse;
    byId('frame-guide-overlay')?.classList.toggle('on-creature', ids.length > 0);
    const message = ids.length > 0 ? copy.creatureInFrame(creatureById(ids[0])?.name ?? ids[0]) : copy.noCreatureInFrame;
    if (mode === 'photo' || lastFrameMessage !== '') {
      if (message !== lastFrameMessage) {
        lastFrameMessage = message;
        announce('frame-guide', message);
      }
    }
    const zoomReadout = byId('readout-zoom');
    const focusReadout = byId('readout-focus');
    if (zoomReadout) zoomReadout.textContent = String(zoom);
    if (focusReadout) focusReadout.textContent = String(focus);
  }

  function applyScene(): void {
    if (!scene3d) return;
    scene3d.setIsland(island);
    scene3d.setExplorer(walker.tile, walker.heading);
    scene3d.setCreatures(sceneCreatures());
    scene3d.setWorld(hour, weather, dusk);
    scene3d.setLighthouse(lighthouse === 'open');
    scene3d.setCamera(mode, yaw, zoom, focus);
  }

  function savePosition(): void {
    void api('/api/me/position', {
      method: 'PUT',
      body: { island, tile: [walker.tile.x, walker.tile.y], heading: walker.heading },
    });
  }

  function noteSightings(): void {
    for (const creature of islandCreatures()) {
      if (spotted.has(creature.id)) continue;
      if (Math.abs(creature.x - walker.tile.x) <= 6 && Math.abs(creature.y - walker.tile.y) <= 6) {
        spotted.add(creature.id);
        announce('world-status', copy.spotted(creature.name));
      }
    }
  }

  function walkTo(target: Tile): void {
    const path = shortestPath((x, y) => isLand(island, x, y), walker.tile, target, 24);
    if (!path) {
      announce('world-status', copy.noPath);
      return;
    }
    walker.requestPath(path);
  }

  async function sailTo(target: number): Promise<void> {
    history.replaceState({ island, tile: [walker.tile.x, walker.tile.y], heading: walker.heading }, '', location.pathname + location.search);
    island = target;
    const spot = SPOTS[0];
    walker.teleport({ x: spot.tile.x, y: spot.tile.y }, spot.heading);
    exploreYaw = HEADING_ANGLE[spot.heading];
    if (mode === 'explore') yaw = exploreYaw;
    spotted = new Set();
    history.pushState({ island: target, tile: [spot.tile.x, spot.tile.y], heading: spot.heading }, '', `/play?island=${target}&spot=1`);
    savePosition();
    await refreshAlbums();
    panels.rebuild();
    applyScene();
    syncHooks();
    announceArrival();
  }

  function announceArrival(): void {
    const album = albums.find((entry) => entry.island === island);
    announce('world-status', copy.worldArrival(islandName(island), album ? album.pages_filled : 0));
  }

  async function refreshAlbums(): Promise<void> {
    const answer = await api<{ albums: Album[]; stamps: number; lighthouse: 'open' | 'closed'; film: number }>('/api/me/albums');
    if (!answer.ok) return;
    albums = answer.body.albums;
    panels.renderAlbum();
  }

  async function refillFilm(): Promise<void> {
    const answer = await api<{ film: number }>('/api/me/refill', { method: 'POST', body: {} });
    if (!answer.ok) {
      announce('world-status', answer.body.message ?? copy.photoNetwork);
      return;
    }
    setFilm(answer.body.film);
    announce('world-status', copy.filmRefilled);
  }

  function setFilm(value: number): void {
    film = value;
    setFigure('film', value, filmText);
    panels.renderAlbum();
  }

  function setStamps(value: number): void {
    stamps = value;
    setFigure('stamps', value, stampsText);
  }

  function enterPhotoMode(): void {
    mode = 'photo';
    exploreYaw = yaw;
    exploreZoom = zoom;
    yaw = HEADING_ANGLE[walker.heading];
    zoom = 1;
    focus = 4;
    setPressed(need('camera'), true);
    for (const id of ['zoom-in', 'zoom-out', 'focus-button', 'take-photo']) need(id).hidden = false;
    need('photo-readouts').hidden = false;
    drawGuide();
    applyScene();
    if (reducedMotion()) scene3d?.cutCamera();
    syncHooks();
  }

  function leavePhotoMode(): void {
    mode = 'explore';
    yaw = exploreYaw;
    zoom = exploreZoom;
    focus = 0;
    setPressed(need('camera'), false);
    for (const id of ['zoom-in', 'zoom-out', 'focus-button', 'take-photo']) need(id).hidden = true;
    need('photo-readouts').hidden = true;
    view.dataset.guide = 'hidden';
    if (guideTimer !== null) window.clearTimeout(guideTimer);
    applyScene();
    if (reducedMotion()) scene3d?.cutCamera();
    syncHooks();
  }

  function drawGuide(): void {
    if (reducedMotion()) {
      view.dataset.guide = 'drawn';
      return;
    }
    view.dataset.guide = 'drawing';
    if (guideTimer !== null) window.clearTimeout(guideTimer);
    guideTimer = window.setTimeout(() => {
      view.dataset.guide = 'drawn';
    }, GUIDE_MS);
  }

  function stepZoom(direction: number): void {
    const list = mode === 'photo' ? PHOTO_ZOOMS : EXPLORE_ZOOMS;
    const index = Math.max(0, Math.min(list.length - 1, list.indexOf(zoom) + direction));
    zoom = list[index];
    applyScene();
    syncHooks();
  }

  function cycleFocus(): void {
    focus = FOCUSES[(FOCUSES.indexOf(focus) + 1) % FOCUSES.length];
    applyScene();
    syncHooks();
  }

  function turn(heading: Heading): void {
    walker.heading = heading;
    yaw = HEADING_ANGLE[heading];
    applyScene();
    syncHooks();
  }

  function orbit(degrees: number): void {
    yaw = ((yaw + degrees) % 360 + 360) % 360;
    applyScene();
    syncHooks();
  }

  async function takePhoto(): Promise<void> {
    if (shooting || mode !== 'photo' || !scene3d) return;
    shooting = true;
    const opener = (document.activeElement as HTMLElement | null) ?? view;
    clearStatus('photo-status');
    announce('photo-status', copy.photoScoring);
    scene3d.render(performance.now());
    const blob = await scene3d.capture(MAX_CAPTURE_WIDTH);
    if (!blob) {
      shooting = false;
      return;
    }
    playEffect(1200);
    if (!reducedMotion()) {
      view.dataset.shutter = 'moving';
      window.setTimeout(() => {
        view.dataset.shutter = 'idle';
      }, SHUTTER_MS);
    }
    const thumbnail = byId<HTMLImageElement>('pinned-shot-image');
    const pinned = byId('pinned-shot');
    const url = URL.createObjectURL(blob);
    if (thumbnail && pinned) {
      thumbnail.src = url;
      pinned.hidden = false;
    }
    const body = new FormData();
    body.append(
      'pose',
      JSON.stringify({
        island,
        tile: [walker.tile.x, walker.tile.y],
        camera: [walker.tile.x, walker.tile.y],
        heading: walker.heading,
        zoom,
        focus,
        tick,
      }),
    );
    body.append('image', blob, 'photo.png');
    const answer = await api<{ photo: PhotoAnswerBody }>('/api/photos', {
      method: 'POST',
      raw: body,
      headers: { 'Shot-Key': crypto.randomUUID() },
    }).catch(() => null);
    if (pinned) pinned.hidden = true;
    shooting = false;
    clearStatus('photo-status');
    if (!answer) {
      announce('photo-status', copy.photoNetwork);
      return;
    }
    if (!answer.ok) {
      announce('photo-status', answer.body.message ?? copy.photoNetwork);
      return;
    }
    showResult(answer.body.photo, url, opener);
  }

  type PhotoAnswerBody = {
    id: string;
    creature: string;
    creature_name: string;
    island: number;
    score: { size: number; centring: number; facing: number; sharpness: number; total: number };
    measures: { distance: number; best_distance: number; offset: number; focus_error: number; creature_facing: string };
    album: { page_filled: boolean; pages_filled: number; stamp_earned: boolean };
    film: number;
    image_url: string;
  };

  function showResult(photo: PhotoAnswerBody, objectUrl: string, opener: HTMLElement): void {
    announce(
      'photo-status',
      copy.photoSuccess(
        photo.creature_name,
        photo.score.total,
        photo.score.size,
        photo.score.centring,
        photo.score.facing,
        photo.score.sharpness,
      ),
    );
    if (photo.album.page_filled) announce('photo-status', copy.albumPageFilled(photo.creature_name));
    const image = byId<HTMLImageElement>('photo-result-image');
    if (image) {
      image.src = objectUrl;
      image.alt = `${photo.creature_name} photo`;
    }
    byId('row-size-measure')!.textContent = `${photo.measures.distance} of ${photo.measures.best_distance} tiles`;
    byId('row-centring-measure')!.textContent = `off centre by ${photo.measures.offset}`;
    byId('row-facing-measure')!.textContent = photo.measures.creature_facing;
    byId('row-sharpness-measure')!.textContent = `focus off by ${photo.measures.focus_error}`;
    const dialog = need('photo-result');
    openPanel(dialog, opener, need('photo-result-close'));
    for (const [name, value] of [
      ['score-size', photo.score.size],
      ['score-centring', photo.score.centring],
      ['score-facing', photo.score.facing],
      ['score-sharpness', photo.score.sharpness],
    ] as const)
      for (const element of document.querySelectorAll<HTMLElement>(`[data-figure="${name}"]`))
        countTo(element, 0, value, (number) => String(number));
    for (const element of document.querySelectorAll<HTMLElement>('[data-figure="score-total"]'))
      countTo(element, 0, photo.score.total, (number) => `${number} / 100`);
    need('photo-result-postcard').dataset.photo = photo.id;
    need('photo-result-postcard').dataset.creature = photo.creature_name;
    setFilm(photo.film);
    void refreshAlbums();
  }

  function heldDirection(moment: number): Heading | null {
    const key = holds.latestHeld(Object.keys(DIRECTION_KEYS).concat(['joy-N', 'joy-E', 'joy-S', 'joy-W']), moment);
    if (!key) return null;
    if (key.startsWith('joy-')) return key.slice(4) as Heading;
    return DIRECTION_KEYS[key];
  }

  function simulate(moment: number): void {
    const direction = mode === 'photo' ? null : heldDirection(moment);
    const running = runToggle || holds.heldAt('shift', moment);
    const moved = walker.advance({ direction, running });
    if (moved) {
      if (scene3d) scene3d.setExplorer(walker.tile, walker.heading);
      savePosition();
      noteSightings();
      panels.updateMarkers();
    }
    holds.prune(moment - 2000);
    syncHooks();
  }

  function render(now: number): void {
    if (!scene3d) return;
    const tuple = scene3d.render(now);
    view.dataset.camera = tuple.map((value) => value.toFixed(2)).join(',');
  }

  function resize(): void {
    if (!scene3d) return;
    const width = view.clientWidth || 640;
    const height = view.clientHeight || 360;
    scene3d.resize(width, height);
  }

  view.addEventListener('keydown', (event) => {
    if (document.activeElement !== view) return;
    const key = event.key.toLowerCase();
    if (key === 'shift') {
      holds.down('shift');
      return;
    }
    if (mode === 'explore') {
      if (key in DIRECTION_KEYS) {
        holds.down(key);
        event.preventDefault();
        return;
      }
      if (key === 'r') {
        runToggle = !runToggle;
        setPressed(need('run'), runToggle);
      } else if (key === ' ') walker.requestJump();
      else if (key === 'q') orbit(-90);
      else if (key === 'e') orbit(90);
      else if (key === '+' || key === '=') stepZoom(1);
      else if (key === '-' || key === '_') stepZoom(-1);
      else if (key === 'home') {
        yaw = HEADING_ANGLE[walker.heading];
        zoom = 2;
        applyScene();
        if (reducedMotion()) scene3d?.cutCamera();
        syncHooks();
      } else if (key === 'c') enterPhotoMode();
      else if (key === 'm') panels.openMap(view);
      else if (key === 'j') panels.openAlbum(view);
      else return;
      event.preventDefault();
      return;
    }
    if (key in DIRECTION_KEYS) turn(DIRECTION_KEYS[key]);
    else if (key === 'q') turn(leftOf(walker.heading));
    else if (key === 'e') turn(rightOf(walker.heading));
    else if (key === '+' || key === '=') stepZoom(1);
    else if (key === '-' || key === '_') stepZoom(-1);
    else if (key === 'f') cycleFocus();
    else if (key === 'enter') void takePhoto();
    else if (key === 'c' || (key === 'escape' && topPanel() === null)) leavePhotoMode();
    else if (key === 'm') panels.openMap(view);
    else if (key === 'j') panels.openAlbum(view);
    else return;
    event.preventDefault();
  });

  window.addEventListener('keyup', (event) => {
    const key = event.key.toLowerCase();
    if (key === 'shift') holds.up('shift');
    else if (key in DIRECTION_KEYS) holds.up(key);
  });

  view.addEventListener('blur', () => {
    for (const key of Object.keys(DIRECTION_KEYS)) holds.up(key);
    holds.up('shift');
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const top = topPanel();
    if (!top) return;
    closePanel(top);
    event.preventDefault();
  });

  need('camera').addEventListener('click', () => (mode === 'photo' ? leavePhotoMode() : enterPhotoMode()));
  view.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (mode === 'explore') enterPhotoMode();
  });
  need('zoom-in').addEventListener('click', () => stepZoom(1));
  need('zoom-out').addEventListener('click', () => stepZoom(-1));
  need('focus-button').addEventListener('click', () => cycleFocus());
  need('take-photo').addEventListener('click', () => void takePhoto());
  need('open-map').addEventListener('click', (event) => panels.openMap(event.currentTarget as HTMLElement));
  need('open-album').addEventListener('click', (event) => panels.openAlbum(event.currentTarget as HTMLElement));
  need('run').addEventListener('click', () => {
    runToggle = !runToggle;
    setPressed(need('run'), runToggle);
  });
  need('jump').addEventListener('click', () => walker.requestJump());
  need('photo-result-close').addEventListener('click', () => closePanel(need('photo-result')));

  wireJoystick(need('joystick'), holds, () => mode, turn);
  wireWorldPointer(view, {
    mode: () => mode,
    yawNow: () => yaw,
    setYaw: (next) => {
      yaw = next;
      applyScene();
      syncHooks();
    },
    zoomNow: () => zoom,
    setZoom: (next) => {
      zoom = next;
      applyScene();
      syncHooks();
    },
    tap: (clientX, clientY) => {
      if (!scene3d) return;
      const box = view.getBoundingClientRect();
      const target = scene3d.tileAt(((clientX - box.left) / box.width) * 2 - 1, -(((clientY - box.top) / box.height) * 2 - 1));
      if (target && isLand(island, target.x, target.y)) walkTo(target);
    },
  });

  window.addEventListener('popstate', (event) => {
    const state = event.state as { island: number; tile: [number, number]; heading: Heading } | null;
    if (!state) return;
    island = state.island;
    walker.teleport({ x: state.tile[0], y: state.tile[1] }, state.heading);
    exploreYaw = HEADING_ANGLE[state.heading];
    if (mode === 'explore') yaw = exploreYaw;
    savePosition();
    panels.rebuild();
    applyScene();
    syncHooks();
  });

  connectLive((message) => {
    if (message.kind === 'world') {
      const world = message.world as PlayBootstrap['world'];
      const wasRaining = weather === 'rain';
      const wasDusk = dusk;
      tick = world.tick;
      hour = world.hour;
      weather = world.weather;
      dusk = world.dusk;
      creatures = world.creatures;
      const timer = byId('world-time');
      if (timer) timer.textContent = world.time;
      if (weather === 'rain' && !wasRaining) announce('world-status', copy.rainBegins);
      if (weather !== 'rain' && wasRaining) announce('world-status', copy.rainStops);
      if (dusk && !wasDusk) announce('world-status', copy.duskFalls);
      if (!dusk && wasDusk) announce('world-status', copy.duskOver);
      applyScene();
      noteSightings();
      panels.updateMarkers();
      syncHooks();
      return;
    }
    if (message.kind === 'progress') {
      if (typeof message.film === 'number') setFilm(message.film);
      if (typeof message.stamps === 'number') {
        if (message.stamps > stamps) {
          announce('world-status', copy.stampEarned(islandName(Number(message.island ?? island)), Number(message.stamps)));
        }
        setStamps(Number(message.stamps));
      }
      if (message.lighthouse === 'open' || message.lighthouse === 'closed') {
        const was = lighthouse;
        lighthouse = message.lighthouse;
        if (was !== 'open' && lighthouse === 'open') announce('world-status', copy.lighthouseOpen);
        scene3d?.setLighthouse(lighthouse === 'open');
      }
      if (message.restarted === true) {
        island = 1;
        const spot = SPOTS[0];
        walker.teleport({ x: spot.tile.x, y: spot.tile.y }, spot.heading);
        exploreYaw = HEADING_ANGLE[spot.heading];
        yaw = mode === 'photo' ? yaw : exploreYaw;
        spotted = new Set();
        announce('world-status', copy.restarted);
        history.replaceState(null, '', '/play');
      }
      void refreshAlbums().then(() => {
        panels.rebuild();
        applyScene();
        syncHooks();
      });
      return;
    }
    if (message.kind === 'position' && message.host === true) {
      const tile = message.tile as [number, number];
      view.dataset.hostIsland = String(message.island);
      view.dataset.hostTile = `${tile[0]},${tile[1]}`;
      return;
    }
    panels.live(message);
  });

  if (!scene3d) {
    view.dataset.state = 'still';
    stillFallback.hidden = false;
    canvas.hidden = true;
  } else {
    resize();
    window.addEventListener('resize', resize);
    applyScene();
    view.dataset.state = 'ready';
  }

  syncHooks();
  panels.rebuild();
  announceArrival();
  if (data.notice) {
    announce('world-status', data.notice);
    history.replaceState(null, '', '/play?island=1&spot=1');
  }
  history.replaceState({ island, tile: [walker.tile.x, walker.tile.y], heading: walker.heading }, '', location.pathname + location.search);
  noteSightings();
  startStepLoop(simulate, render);
}

function leftOf(heading: Heading): Heading {
  const order: Heading[] = ['N', 'W', 'S', 'E'];
  return order[(order.indexOf(heading) + 1) % 4];
}

function rightOf(heading: Heading): Heading {
  const order: Heading[] = ['N', 'E', 'S', 'W'];
  return order[(order.indexOf(heading) + 1) % 4];
}

function wireJoystick(
  joystick: HTMLElement,
  holds: Holds,
  mode: () => 'explore' | 'photo',
  turn: (heading: Heading) => void,
): void {
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let current: Heading | null = null;
  const release = (): void => {
    if (current) holds.up(`joy-${current}`);
    current = null;
    pointerId = null;
  };
  joystick.addEventListener('pointerdown', (event) => {
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    joystick.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  joystick.addEventListener('pointermove', (event) => {
    if (pointerId !== event.pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.hypot(dx, dy) < 16) return;
    const heading: Heading = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : dy > 0 ? 'S' : 'N';
    if (heading === current) return;
    if (current) holds.up(`joy-${current}`);
    current = heading;
    if (mode() === 'photo') {
      turn(heading);
      return;
    }
    holds.down(`joy-${heading}`);
  });
  joystick.addEventListener('pointerup', release);
  joystick.addEventListener('pointercancel', release);
}

type WorldPointer = {
  mode: () => 'explore' | 'photo';
  yawNow: () => number;
  setYaw: (value: number) => void;
  zoomNow: () => number;
  setZoom: (value: number) => void;
  tap: (clientX: number, clientY: number) => void;
};

function wireWorldPointer(view: HTMLElement, hooks: WorldPointer): void {
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let startYaw = 0;
  let moved = 0;
  let touches = 0;
  view.addEventListener('touchstart', (event) => (touches = event.touches.length), { passive: true });
  view.addEventListener('touchend', (event) => (touches = event.touches.length), { passive: true });
  view.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch' && event.isPrimary === false) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startYaw = hooks.yawNow();
    moved = 0;
  });
  view.addEventListener('pointermove', (event) => {
    if (pointerId !== event.pointerId || touches > 1) return;
    const dx = event.clientX - startX;
    moved = Math.max(moved, Math.hypot(dx, event.clientY - startY));
    if (hooks.mode() === 'photo') return;
    hooks.setYaw(orbitFrom(startYaw, dx));
  });
  const finish = (event: PointerEvent): void => {
    if (pointerId !== event.pointerId) return;
    pointerId = null;
    if (moved < 6 && touches < 2) hooks.tap(event.clientX, event.clientY);
  };
  view.addEventListener('pointerup', finish);
  view.addEventListener('pointercancel', () => {
    pointerId = null;
  });

  let pinchStart: number | null = null;
  let pinchZoom = 1;
  let twoFingerMidpoint: number | null = null;
  let twoFingerYaw = 0;
  view.addEventListener(
    'touchmove',
    (event) => {
      if (event.touches.length !== 2) return;
      const first = event.touches[0];
      const second = event.touches[1];
      const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
      const midpoint = (first.clientX + second.clientX) / 2;
      if (pinchStart === null) {
        pinchStart = distance;
        pinchZoom = hooks.zoomNow();
        twoFingerMidpoint = midpoint;
        twoFingerYaw = hooks.yawNow();
        return;
      }
      const list = hooks.mode() === 'photo' ? PHOTO_ZOOMS : EXPLORE_ZOOMS;
      const steps = Math.trunc((distance - pinchStart) / 40);
      const index = Math.max(0, Math.min(list.length - 1, list.indexOf(pinchZoom) + steps));
      hooks.setZoom(list[index]);
      if (hooks.mode() === 'explore' && twoFingerMidpoint !== null)
        hooks.setYaw(orbitFrom(twoFingerYaw, midpoint - twoFingerMidpoint));
    },
    { passive: true },
  );
  view.addEventListener('touchend', () => {
    pinchStart = null;
    twoFingerMidpoint = null;
  });
}

/** One degree per two pixels sideways, halves rounded up, right adding and left subtracting. */
function orbitFrom(startYaw: number, sidewaysPx: number): number {
  const degrees = Math.sign(sidewaysPx) * Math.round(Math.abs(sidewaysPx) / 2);
  return ((startYaw + degrees) % 360 + 360) % 360;
}
