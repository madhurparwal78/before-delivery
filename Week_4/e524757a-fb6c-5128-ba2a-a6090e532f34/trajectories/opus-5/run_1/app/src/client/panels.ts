import { albumPagesText, copy, likesText } from '../shared/copy.js';
import { GRID, isLand, ISLANDS, tileKind, type Tile } from '../shared/islands.js';
import { announce, api, appendLog, byId, closePanel, isOpen, need, openPanel } from './dom.js';
import { countTo, readFigure } from './figures.js';
import type { Album, SafariSnapshot, Sighting } from './playTypes.js';
import type { Settings } from './settingsTypes.js';

export type PanelHooks = {
  view: HTMLElement;
  islandOf: () => number;
  tileOf: () => Tile;
  filmOf: () => number;
  albumsOf: () => Album[];
  safariOf: () => SafariSnapshot | null;
  setSafari: (safari: SafariSnapshot | null) => void;
  walkTo: (tile: Tile) => void;
  sailTo: (island: number) => void;
  refillFilm: () => Promise<void>;
  onRestart: () => Promise<void>;
  onSettingsSaved: (settings: Settings) => void;
};

export type Panels = {
  openMap: (opener: HTMLElement | null) => void;
  openAlbum: (opener: HTMLElement | null) => void;
  renderAlbum: () => void;
  renderSafari: () => void;
  rebuild: () => void;
  updateMarkers: () => void;
  live: (message: Record<string, unknown> & { kind: string }) => void;
};

const DESKTOP = '(min-width: 1200px)';

export function setupPanels(hooks: PanelHooks): Panels {
  const panel = need('side-panel');
  const mapPanel = need('map-panel');
  const albumPanel = need('album-panel');
  const separator = need('panel-separator');
  const map = need('island-map');
  let selectedIsland = hooks.islandOf();
  let cursor: Tile = { ...hooks.tileOf() };
  let mapOpener: HTMLElement | null = null;

  function desktop(): boolean {
    return window.matchMedia(DESKTOP).matches;
  }

  function applyRoles(): void {
    if (desktop()) {
      panel.setAttribute('role', 'complementary');
      panel.setAttribute('aria-label', 'Map and album');
      for (const section of [mapPanel, albumPanel]) {
        section.setAttribute('role', 'group');
        section.removeAttribute('aria-modal');
      }
      return;
    }
    panel.removeAttribute('role');
    panel.removeAttribute('aria-label');
    mapPanel.setAttribute('role', 'dialog');
    mapPanel.setAttribute('aria-modal', 'true');
    albumPanel.setAttribute('role', 'dialog');
    albumPanel.setAttribute('aria-modal', 'true');
  }

  function openSide(which: 'map' | 'album', opener: HTMLElement | null): void {
    applyRoles();
    mapOpener = opener;
    panel.hidden = false;
    if (desktop()) {
      mapPanel.hidden = false;
      albumPanel.hidden = false;
      separator.hidden = false;
      layoutMap();
      renderAlbum();
      (which === 'map' ? map : tablist()).focus();
      return;
    }
    separator.hidden = true;
    mapPanel.hidden = which !== 'map';
    albumPanel.hidden = which !== 'album';
    if (which === 'map') {
      layoutMap();
      openPanel(mapPanel, opener, map);
    } else {
      renderAlbum();
      openPanel(albumPanel, opener, tablist());
    }
  }

  function closeSide(): void {
    if (isOpen(mapPanel)) closePanel(mapPanel);
    else if (isOpen(albumPanel)) closePanel(albumPanel);
    else mapOpener?.focus();
    mapPanel.hidden = true;
    albumPanel.hidden = true;
    separator.hidden = true;
    panel.hidden = true;
  }

  function buildMap(): void {
    map.replaceChildren();
    const island = hooks.islandOf();
    for (let y = 0; y < GRID; y += 1)
      for (let x = 0; x < GRID; x += 1) {
        const tile = document.createElement('span');
        tile.className = `map-tile ${tileKind(island, x, y)}`;
        tile.dataset.x = String(x);
        tile.dataset.y = String(y);
        map.append(tile);
      }
    const marker = document.createElement('span');
    marker.className = 'map-explorer';
    marker.id = 'map-explorer';
    const cursorNode = document.createElement('span');
    cursorNode.className = 'map-cursor';
    cursorNode.id = 'map-cursor';
    map.append(marker, cursorNode);
    layoutMap();
  }

  function layoutMap(): void {
    const available = map.parentElement?.clientWidth ?? 320;
    const size = Math.max(8, Math.floor(Math.min(available, 520) / GRID));
    map.dataset.tileSize = String(size);
    map.style.width = `${size * GRID}px`;
    map.style.height = `${size * GRID}px`;
    map.style.setProperty('--tile-size', `${size}px`);
    updateMarkers();
  }

  function updateMarkers(): void {
    const size = Number(map.dataset.tileSize ?? 20);
    const explorer = byId('map-explorer');
    const cursorNode = byId('map-cursor');
    const tile = hooks.tileOf();
    if (explorer) {
      explorer.style.left = `${tile.x * size}px`;
      explorer.style.top = `${tile.y * size}px`;
    }
    if (cursorNode) {
      cursorNode.style.left = `${cursor.x * size}px`;
      cursorNode.style.top = `${cursor.y * size}px`;
    }
    map.dataset.cursor = `${cursor.x},${cursor.y}`;
  }

  function tablist(): HTMLElement {
    return need('album-tablist');
  }

  function renderAlbum(): void {
    const album = hooks.albumsOf().find((entry) => entry.island === selectedIsland);
    if (!album) return;
    for (const tab of ISLANDS) {
      const node = byId(`album-tab-${tab.id}`);
      if (!node) continue;
      const chosen = tab.id === selectedIsland;
      node.setAttribute('aria-selected', chosen ? 'true' : 'false');
      node.tabIndex = chosen ? 0 : -1;
    }
    const list = need('album-pages');
    list.replaceChildren(...album.pages.map(pageItem));
    for (const element of document.querySelectorAll<HTMLElement>('[data-figure="album-pages"]'))
      countTo(element, readFigure(element), album.pages_filled, albumPagesText);
    const refill = byId<HTMLButtonElement>('refill-film');
    if (refill) refill.disabled = !(hooks.islandOf() === 1 && hooks.filmOf() < 36);
    const link = byId<HTMLAnchorElement>('album-board-link');
    if (link) link.href = `/boards/${hooks.islandOf()}`;
  }

  function pageItem(page: Album['pages'][number]): HTMLLIElement {
    const item = document.createElement('li');
    item.className = 'album-page';
    item.dataset.creature = page.creature;
    const heading = document.createElement('h3');
    heading.textContent = page.creature_name;
    item.append(heading);
    if (page.filled && page.photo_id) {
      const image = document.createElement('img');
      image.src = `/api/photos/${page.photo_id}/image`;
      image.alt = `${page.creature_name} photo`;
      image.width = 240;
      image.height = 135;
      const total = document.createElement('p');
      total.className = 'album-total';
      total.textContent = `${page.total} / 100`;
      const send = document.createElement('button');
      send.type = 'button';
      send.className = 'send-postcard';
      send.dataset.photo = page.photo_id;
      send.dataset.creature = page.creature_name;
      send.textContent = `Send ${page.creature_name} photo as a postcard`;
      item.append(image, total, send);
      return item;
    }
    const frame = document.createElement('div');
    frame.className = 'empty-frame';
    for (const corner of ['tl', 'tr', 'bl', 'br']) {
      const node = document.createElement('span');
      node.className = `frame-corner ${corner}`;
      frame.append(node);
    }
    const empty = document.createElement('p');
    empty.className = 'album-empty';
    empty.textContent = copy.notPhotographedYet;
    item.append(frame, empty);
    return item;
  }

  function renderSafari(): void {
    const region = need('safari-region');
    const safari = hooks.safariOf();
    if (!safari) {
      region.hidden = true;
      return;
    }
    region.hidden = false;
    need('safari-code').textContent = `Safari code ${safari.code}`;
    need('end-safari').hidden = safari.role !== 'host';
    need('leave-safari').hidden = safari.role !== 'guest';
    const list = need('sightings');
    list.replaceChildren();
    for (const sighting of safari.sightings) addSighting(copy.sighting(sighting.x, sighting.y, sighting.by));
  }

  function addSighting(text: string): void {
    const item = document.createElement('li');
    item.textContent = text;
    need('sightings').append(item);
  }

  map.addEventListener('keydown', (event) => {
    const key = event.key;
    const island = hooks.islandOf();
    if (key === 'ArrowUp') cursor = { x: cursor.x, y: Math.max(0, cursor.y - 1) };
    else if (key === 'ArrowDown') cursor = { x: cursor.x, y: Math.min(GRID - 1, cursor.y + 1) };
    else if (key === 'ArrowLeft') cursor = { x: Math.max(0, cursor.x - 1), y: cursor.y };
    else if (key === 'ArrowRight') cursor = { x: Math.min(GRID - 1, cursor.x + 1), y: cursor.y };
    else if (key === 'Enter') {
      if (isLand(island, cursor.x, cursor.y)) hooks.walkTo(cursor);
      else announce('world-status', copy.noPath);
      event.preventDefault();
      return;
    } else if (key === 's' || key === 'S') {
      const safari = hooks.safariOf();
      if (safari && safari.role === 'host') void markSighting(safari.code, island, cursor);
      event.preventDefault();
      return;
    } else if (key === 'Escape') {
      closeSide();
      event.preventDefault();
      return;
    } else return;
    updateMarkers();
    event.preventDefault();
  });

  map.addEventListener('click', (event) => {
    const size = Number(map.dataset.tileSize ?? 20);
    const box = map.getBoundingClientRect();
    const x = Math.floor((event.clientX - box.left) / size);
    const y = Math.floor((event.clientY - box.top) / size);
    if (x < 0 || y < 0 || x >= GRID || y >= GRID) return;
    cursor = { x, y };
    updateMarkers();
    if (isLand(hooks.islandOf(), x, y)) hooks.walkTo(cursor);
    else announce('world-status', copy.noPath);
  });

  async function markSighting(code: string, island: number, tile: Tile): Promise<void> {
    const answer = await api(`/api/safaris/${code}/sightings`, { method: 'POST', body: { island, tile: [tile.x, tile.y] } });
    if (!answer.ok) announce('safari-status', answer.body.message ?? copy.photoNetwork);
  }

  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeSide();
    event.preventDefault();
  });

  need('close-map').addEventListener('click', closeSide);
  need('close-album').addEventListener('click', closeSide);
  need('refill-film').addEventListener('click', () => void hooks.refillFilm());

  for (const button of document.querySelectorAll<HTMLElement>('.sail'))
    button.addEventListener('click', () => hooks.sailTo(Number(button.dataset.island)));

  tablist().addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const order = ISLANDS.map((entry) => entry.id);
    const index = order.indexOf(selectedIsland);
    selectedIsland = order[(index + (event.key === 'ArrowRight' ? 1 : order.length - 1)) % order.length];
    renderAlbum();
    event.preventDefault();
  });

  tablist().addEventListener('click', (event) => {
    const tab = (event.target as HTMLElement).closest('[role="tab"]') as HTMLElement | null;
    if (!tab) return;
    selectedIsland = Number(tab.dataset.island);
    renderAlbum();
  });

  separator.addEventListener('keydown', (event) => {
    const now = Number(separator.getAttribute('aria-valuenow') ?? '50');
    let next = now;
    if (event.key === 'ArrowLeft') next = Math.max(30, now - 5);
    else if (event.key === 'ArrowRight') next = Math.min(70, now + 5);
    else if (event.key === 'Home') next = 30;
    else if (event.key === 'End') next = 70;
    else return;
    separator.setAttribute('aria-valuenow', String(next));
    panel.style.setProperty('--map-share', `${next}%`);
    event.preventDefault();
  });

  need('open-settings').addEventListener('click', (event) =>
    openPanel(need('settings-dialog'), event.currentTarget as HTMLElement),
  );
  need('save-settings').addEventListener('click', () => void saveSettings());

  async function saveSettings(): Promise<void> {
    const music = Number(need<HTMLInputElement>('music-volume').value);
    const effects = Number(need<HTMLInputElement>('effects-volume').value);
    const graphics = (document.querySelector('input[name="graphics"]:checked') as HTMLInputElement | null)?.value ?? 'full';
    const answer = await api<{ settings: Settings }>('/api/me/settings', {
      method: 'PUT',
      body: { music, effects, graphics },
    });
    if (!answer.ok) {
      announce('settings-status', copy.settingsFailed);
      return;
    }
    announce('settings-status', copy.settingsSaved);
    hooks.view.dataset.preset = answer.body.settings.graphics;
    hooks.onSettingsSaved(answer.body.settings);
  }

  need('open-restart').addEventListener('click', (event) =>
    openPanel(need('restart-dialog'), event.currentTarget as HTMLElement),
  );
  need('restart-cancel').addEventListener('click', () => closePanel(need('restart-dialog')));
  need('restart-confirm').addEventListener('click', () => {
    closePanel(need('restart-dialog'));
    void hooks.onRestart();
  });

  need('start-safari').addEventListener('click', () => void startSafari());
  need('join-safari').addEventListener('click', (event) =>
    openPanel(need('join-safari-dialog'), event.currentTarget as HTMLElement, need('safari-code-input')),
  );
  need('join-safari-submit').addEventListener('click', () => void joinSafari());
  need('safari-code-input').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void joinSafari();
  });
  need('end-safari').addEventListener('click', () => void endSafari());
  need('leave-safari').addEventListener('click', () => void leaveSafari());

  async function startSafari(): Promise<void> {
    const answer = await api<{ safari: { code: string; status: string; host: string; guest: string | null } }>('/api/safaris', {
      method: 'POST',
      body: {},
    });
    if (!answer.ok) {
      announce('safari-status', answer.body.message ?? copy.photoNetwork);
      return;
    }
    hooks.setSafari({ ...answer.body.safari, role: 'host', sightings: [] });
    announce('safari-status', copy.safariStarted);
  }

  async function joinSafari(): Promise<void> {
    const field = need<HTMLInputElement>('safari-code-input');
    const code = field.value.trim().toUpperCase();
    field.value = code;
    const answer = await api<{ safari: { code: string; status: string; host: string; guest: string | null } }>(
      `/api/safaris/${encodeURIComponent(code)}/join`,
      { method: 'POST', body: {} },
    );
    if (!answer.ok) {
      announce('safari-status', answer.body.message ?? copy.photoNetwork);
      field.focus();
      return;
    }
    hooks.setSafari({ ...answer.body.safari, role: 'guest', sightings: [] });
    announce('safari-status', copy.safariJoined(answer.body.safari.host));
    closePanel(need('join-safari-dialog'));
  }

  async function endSafari(): Promise<void> {
    const safari = hooks.safariOf();
    if (!safari) return;
    const answer = await api(`/api/safaris/${safari.code}/end`, { method: 'POST', body: {} });
    if (!answer.ok) {
      announce('safari-status', answer.body.message ?? copy.photoNetwork);
      return;
    }
    hooks.setSafari(null);
    announce('safari-status', copy.safariEnded);
  }

  async function leaveSafari(): Promise<void> {
    const safari = hooks.safariOf();
    if (!safari) return;
    const answer = await api(`/api/safaris/${safari.code}/leave`, { method: 'POST', body: {} });
    if (!answer.ok) {
      announce('safari-status', answer.body.message ?? copy.photoNetwork);
      return;
    }
    hooks.setSafari(null);
    hooks.view.dataset.hostIsland = '';
    hooks.view.dataset.hostTile = '';
  }

  document.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('.send-postcard') as HTMLElement | null;
    if (!button) return;
    const dialog = need('postcard-dialog');
    dialog.dataset.photo = button.dataset.photo ?? '';
    dialog.dataset.creature = button.dataset.creature ?? '';
    openPanel(dialog, button, need('postcard-recipient'));
  });

  need('photo-result-postcard').addEventListener('click', (event) => {
    const button = event.currentTarget as HTMLElement;
    const dialog = need('postcard-dialog');
    dialog.dataset.photo = button.dataset.photo ?? '';
    dialog.dataset.creature = button.dataset.creature ?? '';
    openPanel(dialog, button, need('postcard-recipient'));
  });

  let posting = false;
  let postcardKey = crypto.randomUUID();
  need('postcard-post').addEventListener('click', () => void postPostcard());

  async function postPostcard(): Promise<void> {
    if (posting) return;
    posting = true;
    const dialog = need('postcard-dialog');
    announce('postcard-status', copy.postcardPosting);
    const answer = await api(`/api/postcards`, {
      method: 'POST',
      body: {
        photo: dialog.dataset.photo,
        recipient: need<HTMLInputElement>('postcard-recipient').value,
        line: need<HTMLInputElement>('postcard-line').value,
      },
      headers: { 'Request-Key': postcardKey },
    });
    posting = false;
    if (!answer.ok) {
      announce('postcard-status', answer.body.message ?? copy.photoNetwork);
      return;
    }
    announce('postcard-status', copy.postcardPosted);
    postcardKey = crypto.randomUUID();
    closePanel(dialog);
  }

  buildMap();
  renderAlbum();
  renderSafari();
  window.addEventListener('resize', () => {
    if (!panel.hidden) layoutMap();
  });

  return {
    openMap: (opener) => openSide('map', opener),
    openAlbum: (opener) => openSide('album', opener),
    renderAlbum,
    renderSafari,
    updateMarkers,
    rebuild: () => {
      selectedIsland = hooks.islandOf();
      cursor = { ...hooks.tileOf() };
      buildMap();
      renderAlbum();
      renderSafari();
      for (const button of document.querySelectorAll<HTMLElement>('.sail'))
        button.hidden = Number(button.dataset.island) === hooks.islandOf();
    },
    live: (message) => {
      if (message.kind === 'sighting') {
        const sighting = message.sighting as Sighting;
        const line = copy.sighting(sighting.x, sighting.y, sighting.by);
        addSighting(line);
        announce('safari-status', line);
        return;
      }
      if (message.kind === 'safari_photo') {
        appendLog('safari-feed', copy.safariFeed(String(message.host_name), String(message.creature_name), Number(message.total)), {
          src: String(message.image_url),
          alt: `${String(message.creature_name)} photo by ${String(message.host_name)}`,
        });
        return;
      }
      if (message.kind === 'safari') {
        const event = String(message.event);
        if (event === 'guest_joined') {
          announce('safari-status', copy.safariGuestJoined(String(message.guest_name)));
          const safari = hooks.safariOf();
          if (safari) hooks.setSafari({ ...safari, guest: String(message.guest_name), status: 'joined' });
        } else if (event === 'guest_left') {
          announce('safari-status', copy.safariGuestLeft(String(message.guest_name)));
          const safari = hooks.safariOf();
          if (safari) hooks.setSafari({ ...safari, guest: null, status: 'open' });
        } else if (event === 'ended') {
          announce('safari-status', copy.safariEnded);
          hooks.setSafari(null);
        }
        return;
      }
      if (message.kind === 'like') {
        for (const element of document.querySelectorAll<HTMLElement>(`[data-figure="likes"]`))
          countTo(element, readFigure(element), Number(message.likes), likesText);
      }
    },
  };
}
