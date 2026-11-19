import { albumPagesText, copy, filmText, stampsText } from '../../shared/copy.js';
import { HEADING_ANGLE, ISLANDS, islandName } from '../../shared/islands.js';
import type { Album } from '../domain/albums.js';
import type { PlayerRow, Settings } from '../domain/players.js';
import type { WorldState } from '../domain/world.js';
import { figure, logRegion, statusRegion } from './chrome.js';
import { escape, page } from './html.js';
import { textWorldBody, type TextWorldData } from './textWorld.js';

export type PlayData = {
  player: PlayerRow;
  film: number;
  stamps: number;
  lighthouse: 'open' | 'closed';
  albums: Album[];
  settings: Settings;
  world: WorldState;
  preset: Settings['graphics'];
  notice: string | null;
  textWorld: TextWorldData;
  safari: {
    code: string;
    status: string;
    host: string;
    guest: string | null;
    role: 'host' | 'guest';
    sightings: { island: number; x: number; y: number; by: string }[];
  } | null;
};

function albumPanel(data: PlayData): string {
  const tabs = ISLANDS.map(
    (island) =>
      `<button type="button" role="tab" id="album-tab-${island.id}" aria-controls="album-pages" aria-selected="${
        island.id === data.player.island ? 'true' : 'false'
      }" tabindex="${island.id === data.player.island ? '0' : '-1'}" data-island="${island.id}">${escape(island.name)}</button>`,
  ).join('');
  const shown = data.albums.find((album) => album.island === data.player.island)!;
  return `<section id="album-panel" class="panel album-panel" role="dialog" aria-label="Album" aria-modal="true" hidden>
<div class="panel-head"><h2>Album</h2><button type="button" id="close-album">Close album</button></div>
<div role="tablist" aria-label="Islands" id="album-tablist" tabindex="0">${tabs}</div>
<p class="panel-figure">${figure('album-pages', albumPagesText(shown.pages_filled))}</p>
<ul role="list" aria-label="Album pages" id="album-pages" class="album-pages">${albumPages(shown)}</ul>
<div class="panel-actions">
<button type="button" id="refill-film">Refill film</button>
<a href="/hall">Your hall</a>
<a href="/boards/${data.player.island}" id="album-board-link">Challenge board</a>
</div>
</section>`;
}

export function albumPages(album: Album): string {
  return album.pages
    .map(
      (entry) => `<li class="album-page" data-creature="${escape(entry.creature)}">
<h3>${escape(entry.creature_name)}</h3>
${
  entry.filled
    ? `<img src="/api/photos/${escape(entry.photo_id)}/image" alt="${escape(entry.creature_name)} photo" width="240" height="135">
<p class="album-total">${entry.total} / 100</p>
<button type="button" class="send-postcard" data-photo="${escape(entry.photo_id)}" data-creature="${escape(entry.creature_name)}">Send ${escape(entry.creature_name)} photo as a postcard</button>`
    : `<div class="empty-frame"><span class="frame-corner tl"></span><span class="frame-corner tr"></span><span class="frame-corner bl"></span><span class="frame-corner br"></span></div>
<p class="album-empty">${escape(copy.notPhotographedYet)}</p>`
}
</li>`,
    )
    .join('');
}

function mapPanel(data: PlayData): string {
  const sails = ISLANDS.filter((island) => island.id !== data.player.island)
    .map(
      (island) =>
        `<button type="button" class="sail" data-island="${island.id}">Sail to ${escape(island.name)}</button>`,
    )
    .join('');
  return `<section id="map-panel" class="panel map-panel" role="dialog" aria-label="Map" aria-modal="true" hidden>
<div class="panel-head"><h2>Map</h2><button type="button" id="close-map">Close map</button></div>
<div id="island-map" role="application" aria-label="Island map" tabindex="0"
  data-cursor="${data.player.tile_x},${data.player.tile_y}" data-tile-size="20"></div>
<div class="panel-actions">
${sails}
<button type="button" id="start-safari">Start a shared safari</button>
<button type="button" id="join-safari">Join a safari</button>
<a href="/board">Notice board</a>
</div>
</section>`;
}

export function playPage(data: PlayData): string {
  const yaw = HEADING_ANGLE[data.player.heading];
  const creatures = data.world.creatures
    .filter((creature) => creature.island === data.player.island)
    .map((creature) => `${creature.id}@${creature.x},${creature.y},${creature.heading}`)
    .join(';');

  return page(
    {
      title: 'Play — Hushfoot',
      bodyClass: 'play',
      bootstrap: {
        page: 'play',
        player: { id: data.player.id, name: data.player.name, handle: data.player.handle },
        position: { island: data.player.island, tile: [data.player.tile_x, data.player.tile_y], heading: data.player.heading },
        film: data.film,
        stamps: data.stamps,
        lighthouse: data.lighthouse,
        albums: data.albums,
        settings: data.settings,
        preset: data.preset,
        world: data.world,
        notice: data.notice,
        safari: data.safari,
      },
    },
    `<main id="main" class="play-main">
<a class="skip-link" href="/text-world">Skip to the text world</a>
<h1 class="visually-hidden">${escape(islandName(data.player.island))}</h1>
<div class="world-wrap">
<div id="world-view" role="application" aria-label="World view" tabindex="0"
  data-step="0" data-tick="${data.world.tick}" data-island="${data.player.island}"
  data-tile="${data.player.tile_x},${data.player.tile_y}" data-heading="${data.player.heading}"
  data-gait="idle" data-mode="explore" data-yaw="${yaw}" data-zoom="2" data-focus=""
  data-in-view="" data-creatures="${escape(creatures)}" data-world-hour="${data.world.hour}"
  data-weather="${data.world.weather}" data-lighthouse="${data.lighthouse}" data-preset="${data.preset}"
  data-state="loading" data-camera="0.00,0.00,0.00,0.00,0.00,0.00" data-guide="hidden" data-shutter="idle"
  data-host-island="" data-host-tile="">
<canvas id="scene" aria-hidden="true"></canvas>
<div class="frame-guide" id="frame-guide-overlay" aria-hidden="true">
<span class="frame-corner tl"></span><span class="frame-corner tr"></span>
<span class="frame-corner bl"></span><span class="frame-corner br"></span>
<span class="frame-centre"></span>
</div>
<div class="shutter-bars" id="shutter-bars" aria-hidden="true"><span></span><span></span></div>
<div class="pinned-shot" id="pinned-shot" hidden><img alt="" id="pinned-shot-image"><span>Scoring</span></div>
</div>
<div class="still-fallback" id="still-fallback" hidden>
<img id="still-map" src="/islands/${data.player.island}/map.svg" alt="Still map of ${escape(islandName(data.player.island))}" width="480" height="480">
<p class="notice" id="no-webgl-notice">${escape(copy.noWebgl)}</p>
<div id="play-text-world">${textWorldBody(data.textWorld)}</div>
</div>
<div class="hud">
<div class="hud-readouts">
<div role="timer" aria-label="World time" id="world-time">${escape(data.world.time)}</div>
<p class="hud-figure">${figure('film', filmText(data.film))}</p>
<p class="hud-figure">${figure('stamps', stampsText(data.stamps))}</p>
</div>
</div>
<div class="photo-readouts" id="photo-readouts" hidden aria-hidden="true">
<span class="readout">ZOOM <b id="readout-zoom">1</b></span>
<span class="readout">FOCUS <b id="readout-focus">4</b></span>
</div>
</div>

<div class="controls">
<button type="button" id="camera" aria-pressed="false">Camera</button>
<button type="button" id="zoom-in" hidden>Zoom in</button>
<button type="button" id="zoom-out" hidden>Zoom out</button>
<button type="button" id="focus-button" hidden>Focus</button>
<button type="button" id="take-photo" hidden>Take photo</button>
<button type="button" id="open-map">Map</button>
<button type="button" id="open-album">Album</button>
<button type="button" id="sound" aria-pressed="false">Sound</button>
<button type="button" id="open-settings">Settings</button>
<button type="button" id="open-restart">Restart expedition</button>
<button type="button" id="run" aria-pressed="false">Run</button>
<button type="button" id="jump">Jump</button>
</div>
<div id="joystick" role="group" aria-label="Joystick"><span class="joystick-knob"></span></div>

<div class="side-panel" id="side-panel" hidden>
${mapPanel(data)}
<div id="panel-separator" role="separator" aria-label="Resize map and album" tabindex="0"
  aria-valuenow="50" aria-valuemin="30" aria-valuemax="70" hidden></div>
${albumPanel(data)}
</div>

<section id="safari-region" class="safari" role="region" aria-label="Safari" hidden>
<p id="safari-code"></p>
<h2>Sightings</h2>
<ul role="list" aria-label="Sightings" id="sightings"></ul>
<h2>Safari feed</h2>
${logRegion('Safari feed', 'safari-feed')}
<button type="button" id="end-safari" hidden>End safari</button>
<button type="button" id="leave-safari" hidden>Leave safari</button>
</section>

<div class="statuses">
${statusRegion('World status', 'world-status')}
${statusRegion('Photo status', 'photo-status')}
${statusRegion('Frame guide', 'frame-guide')}
${statusRegion('Settings status', 'settings-status')}
${statusRegion('Safari status', 'safari-status')}
${statusRegion('Postcard status', 'postcard-status')}
${statusRegion('Gallery status', 'gallery-status')}
</div>

<div id="photo-result" class="dialog photo-result" role="dialog" aria-label="Photo result" aria-modal="true" hidden>
<h2>Photo result</h2>
<img id="photo-result-image" alt="" width="320" height="180">
<table class="score-table">
<tbody>
<tr><th scope="row">Size</th><td id="row-size-measure"></td><td>${figure('score-size', '0')}</td></tr>
<tr><th scope="row">Centring</th><td id="row-centring-measure"></td><td>${figure('score-centring', '0')}</td></tr>
<tr><th scope="row">Facing</th><td id="row-facing-measure"></td><td>${figure('score-facing', '0')}</td></tr>
<tr><th scope="row">Sharpness</th><td id="row-sharpness-measure"></td><td>${figure('score-sharpness', '0')}</td></tr>
<tr><th scope="row">Total</th><td></td><td>${figure('score-total', '0 / 100')}</td></tr>
</tbody>
</table>
<div class="dialog-actions">
<button type="button" id="photo-result-close">Close</button>
<button type="button" id="photo-result-postcard">Send as postcard</button>
</div>
</div>

<div id="settings-dialog" class="dialog" role="dialog" aria-label="Settings" aria-modal="true" hidden>
<h2>Settings</h2>
<label class="slider"><span>Music volume</span><input type="range" id="music-volume" aria-label="Music volume" min="0" max="100" step="5" value="${data.settings.music}"></label>
<label class="slider"><span>Effects volume</span><input type="range" id="effects-volume" aria-label="Effects volume" min="0" max="100" step="5" value="${data.settings.effects}"></label>
<fieldset role="radiogroup" aria-label="Graphics" id="graphics-group">
<legend>Graphics</legend>
<label><input type="radio" name="graphics" value="full"${data.settings.graphics === 'full' ? ' checked' : ''}> Full</label>
<label><input type="radio" name="graphics" value="balanced"${data.settings.graphics === 'balanced' ? ' checked' : ''}> Balanced</label>
<label><input type="radio" name="graphics" value="light"${data.settings.graphics === 'light' ? ' checked' : ''}> Light</label>
</fieldset>
<div class="dialog-actions"><button type="button" id="save-settings">Save settings</button></div>
</div>

<div id="restart-dialog" class="dialog" role="alertdialog" aria-label="Restart the expedition?" aria-modal="true" aria-describedby="restart-sentence" hidden>
<h2>Restart the expedition?</h2>
<p id="restart-sentence">${escape(copy.restartSentence)}</p>
<div class="dialog-actions">
<button type="button" id="restart-confirm">Restart</button>
<button type="button" id="restart-cancel">Keep playing</button>
</div>
</div>

<div id="join-safari-dialog" class="dialog" role="dialog" aria-label="Join a safari" aria-modal="true" hidden>
<h2>Join a safari</h2>
<label class="field"><span>Safari code</span><input type="text" id="safari-code-input" aria-label="Safari code" autocomplete="off"></label>
<div class="dialog-actions"><button type="button" id="join-safari-submit">Join</button></div>
</div>

<div id="postcard-dialog" class="dialog" role="dialog" aria-label="Send postcard" aria-modal="true" hidden>
<h2>Send postcard</h2>
<label class="field"><span>Recipient email</span><input type="email" id="postcard-recipient" aria-label="Recipient email" autocomplete="off"></label>
<label class="field"><span>Your line</span><input type="text" id="postcard-line" aria-label="Your line" autocomplete="off"></label>
<div class="dialog-actions"><button type="button" id="postcard-post">Post</button></div>
</div>
</main>`,
  );
}
