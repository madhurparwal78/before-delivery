import { escapeHtml, page } from './layout.js';

const SAMPLE_STACK = [
  ['harbor-ledger', 'Round totals to cents'],
  ['harbor-ledger', 'Use fixed rate'],
  ['tidepool-api', 'Split the tide table'],
  ['tidepool-api', 'Name the gauges'],
  ['harbor-ledger', 'Settle in batches'],
];

function heroSlabs(): string {
  const slabs = SAMPLE_STACK.map(
    (_entry, index) =>
      `<g transform="translate(${10 + index * 6} ${200 - index * 38}) rotate(${-4 + index * 1.5})" class="slab" style="--slab:${index}">
<rect x="0" y="0" width="300" height="52" rx="12" fill="none" stroke="url(#slabstroke)" stroke-width="1.5" />
<rect x="16" y="22" width="150" height="6" rx="3" fill="#1d4ed8" opacity="0.5" />
<rect x="180" y="22" width="60" height="6" rx="3" fill="#f59e0b" opacity="0.5" />
</g>`,
  ).join('');
  return `<svg class="heroslabs" viewBox="0 0 360 280" width="360" height="280" role="img" aria-label="Five stacked changes">
<defs>
<linearGradient id="slabstroke" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="#60a5fa" /><stop offset="100%" stop-color="#fbbf24" />
</linearGradient>
<filter id="bloom"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
</defs>
<g filter="url(#bloom)">${slabs}</g>
</svg>`;
}

function revisionPlayer(): string {
  const panels = SAMPLE_STACK.map(
    (_entry, index) => `<div class="revisionpanel" data-revision-panel="${index + 1}"${index === 0 ? '' : ' hidden'}>
<ol class="samplestack">${SAMPLE_STACK.map(
      (row, rowIndex) =>
        `<li class="${rowIndex <= index ? 'done' : 'waiting'}"><span class="mono">${escapeHtml(row[0])}</span> ${escapeHtml(
          row[1],
        )} <span class="railresult">${rowIndex <= index ? 'Approvals kept' : 'Waiting'}</span></li>`,
    ).join('')}</ol>
</div>`,
  ).join('');
  const tabs = SAMPLE_STACK.map(
    (_entry, index) =>
      `<button type="button" role="tab" aria-selected="${index === 0 ? 'true' : 'false'}" data-revision-tab="${
        index + 1
      }" class="revisiontile">Revision ${index + 1}</button>`,
  ).join('');
  return `<section class="player" role="region" aria-label="Revision player">
<div class="playerscreen">${panels}</div>
<div role="tablist" aria-label="Revisions" class="revisiontiles">${tabs}</div>
<button type="button" class="flat" data-revision-play>Play</button>
</section>`;
}

function bentoCards(): string {
  return `<section class="bento">
<article class="card mock-pushlog">
<h3>Pushes land as revisions</h3>
<p class="muted">Every push on <span class="mono">harbor-ledger</span> becomes one revision, stored byte for byte.</p>
<a href="/signup" class="arrow">See the push log →</a>
<div class="window" aria-hidden="true"><div class="windowbar"><span></span><span></span><span></span><p class="mono">harbor-ledger — push log</p></div>
<pre class="mono">a91f2c4d8e01 Round totals to cents
4c7d10b3aa52 Use fixed rate
7f01bb92cd34 Take a from #1
2b94ee57aa10 Restack onto #1</pre></div>
</article>
<article class="card mock-toasts">
<h3>Review updates arrive live</h3>
<p class="muted">Approvals, checks and restacks reach every open page.</p>
<a href="/signup" class="arrow">Watch the review rail →</a>
<div class="toaststack" aria-hidden="true"><div class="toast">#2: restacked onto #1, approvals kept</div><div class="toast behind">#1: new revision 7f01bb92cd34</div><div class="toast behind2">#1: check unit Passed</div></div>
</article>
<article class="card mock-checks">
<h3>Checks report from outside</h3>
<p class="muted">Runners post to the checks API; Ridgestack never runs code.</p>
<a href="#push-api" class="arrow">See the checks API →</a>
<div class="checkpanel" aria-hidden="true"><div class="checkrow"><span class="tick">✓</span><span class="mono">lint</span><span class="note">(required)</span></div><div class="checkrow big"><span class="spinner"></span><span class="mono">unit</span><span class="note">(required)</span></div><div class="checkrow"><span class="tick">✓</span><span class="mono">typecheck</span></div></div>
</article>
<article class="card mock-chips">
<h3>Merge rules are plain sentences</h3>
<p class="muted">Each rule in the merge box says what is missing.</p>
<a href="/signup" class="arrow">Set your merge rules →</a>
<div class="chipcolumn" aria-hidden="true"><span class="chip">Approvals</span><span class="chip">Code owners</span><span class="chip">Required checks</span><span class="chip">Merge queue</span><span class="chip">Restack</span></div>
</article>
<article class="card mock-suggestion">
<h3>Suggestions become revisions</h3>
<p class="muted">On <span class="mono">tidepool-api</span> a suggested line applies as one revision.</p>
<a href="/signup" class="arrow">Try a suggested line →</a>
<div class="suggestionmock" aria-hidden="true"><div class="threadhead">src/rates.ts line 1</div><p class="author">Tomas Varga</p><pre class="mono diffexcerpt"><span class="added">+ export const rate = 1.02;</span></pre><p>Use <span class="codechip mono">rate</span> from the table.</p></div>
</article>
</section>`;
}

export function homePage(serviceStatusOk: boolean): string {
  const main = `<section class="hero">
<div class="herotext">
<h1>Stacks that keep their approvals</h1>
<p class="subhead muted">Ridgestack reviews piles of small changes. When the bottom moves, every change above it is restacked file by file, and an approval survives while its own diff stands still.</p>
<div class="herobuttons"><a class="primary" href="/signup">Open a workspace</a><a class="ghost" href="#push-api">Read the push API</a></div>
</div>
<div class="heroart">${heroSlabs()}${revisionPlayer()}</div>
</section>
${bentoCards()}
<section class="runners">
<h2>Check runners report from outside</h2>
<p class="muted">Ridgestack never runs your code. Your own runners push revisions and report check results through the push and checks APIs, so the state you see is the state they sent.</p>
</section>
<section class="pushapi" id="push-api">
<h2>Push API</h2>
<pre class="mono">POST /api/repos/harbor/harbor-ledger/push
Authorization: Bearer rgs_...
{"branch":"round-totals","expected_head":"a91f2c4d8e01","message":"Round totals to cents",
 "files":[{"path":"src/ledger.ts","content":"export function total(a: number[]): number {\\n"}]}</pre>
</section>
<section class="closing">
<a class="pill" href="/signup">Start a stack</a>
</section>`;
  return page({ title: 'Stacks that keep their approvals', user: null, serviceStatusOk, statusRegions: false }, main);
}
