import { ISLANDS } from '../../shared/islands.js';
import { creaturesOfIsland } from '../../shared/creatures.js';
import type { PlayerRow } from '../domain/players.js';
import { header, statusRegion } from './chrome.js';
import { escape, page } from './html.js';

export function titlePage(player: PlayerRow | null, film: number): string {
  const islands = ISLANDS.map(
    (island) => `<li class="island-card">
<h3>${escape(island.name)}</h3>
<ul class="island-creatures">${creaturesOfIsland(island.id)
      .map((creature) => `<li>${escape(creature.name)}</li>`)
      .join('')}</ul>
</li>`,
  ).join('');

  return page(
    { title: 'Hushfoot', bodyClass: 'title', bootstrap: { page: 'title' } },
    `${header(player, film)}
<main id="main">
<section class="hero" aria-labelledby="hero-title">
<h1 id="hero-title" class="hero-title"><span class="hero-title-left">Walk softly</span><span class="hero-title-right">and bring film.</span></h1>
<div class="hero-frame" data-ui="viewfinder">
<div id="guide-creature" role="application" aria-label="Guide creature" tabindex="0"
  data-spin="0" data-zoom="1.00" data-stretch="0.00" data-nudges="0" data-state="ready">
<canvas id="guide-canvas" width="640" height="360" aria-hidden="true"></canvas>
<span class="frame-corner tl"></span><span class="frame-corner tr"></span>
<span class="frame-corner bl"></span><span class="frame-corner br"></span>
</div>
</div>
<div class="hero-controls">
<button type="button" id="reset-view">Reset view</button>
<button type="button" id="sound" aria-pressed="false">Sound</button>
<label class="slider"><span>Demo zoom</span><input type="range" id="demo-zoom" aria-label="Demo zoom" min="50" max="200" step="25" value="100"></label>
<label class="slider"><span>Demo focus</span><input type="range" id="demo-focus" aria-label="Demo focus" min="2" max="16" step="2" value="4"></label>
</div>
${statusRegion('Guide status', 'guide-status')}
</section>

<section class="reel" id="reel" aria-label="What the camera does">
<div class="reel-pin">
<div class="reel-frame" data-ui="camera-readout" id="reel-frame">
<div class="reel-viewfinder">
<span class="frame-corner tl"></span><span class="frame-corner tr"></span>
<span class="frame-corner bl"></span><span class="frame-corner br"></span>
<p class="reel-label" id="reel-label">Mossback newt in frame</p>
</div>
<div class="readouts">
<span class="readout" data-ui="zoom-readout">ZOOM <b id="reel-zoom">1</b></span>
<span class="readout" data-ui="focus-readout">FOCUS <b id="reel-focus">4</b></span>
<span class="readout" data-ui="score-readout">SCORE <b id="reel-score">—</b></span>
</div>
</div>
</div>
<ol class="reel-steps">
<li data-ui="statement">Zoom until the newt fills the frame.</li>
<li data-ui="statement">Pull focus to the distance the server measures.</li>
<li data-ui="statement">The server scores size, centring, facing and sharpness.</li>
</ol>
<div class="reel-fragments">
<div class="fragment" data-ui="score-breakdown">
<table class="score-table"><caption>Score</caption>
<tbody>
<tr><th scope="row">Size</th><td>30</td></tr>
<tr><th scope="row">Centring</th><td>25</td></tr>
<tr><th scope="row">Facing</th><td>25</td></tr>
<tr><th scope="row">Sharpness</th><td>20</td></tr>
<tr><th scope="row">Total</th><td>100 / 100</td></tr>
</tbody></table>
</div>
<div class="fragment" data-ui="album-page">
<p class="fragment-title">Saltmarsh Harbour</p>
<p class="album-fragment-page">Mossback newt</p>
<p class="album-fragment-empty">Not photographed yet.</p>
</div>
</div>
</section>

<section class="islands" id="islands" aria-labelledby="islands-title">
<h2 id="islands-title">Islands</h2>
<ul class="island-list">${islands}</ul>
</section>
</main>`,
  );
}
