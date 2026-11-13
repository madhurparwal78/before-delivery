// The schedule grid: day stripes behind layer rows and the final row, all on ONE scale (a pixel is the same number of
// minutes everywhere, so a 23- or 25-hour day reads narrower or wider). Positions are percentages of the range; on a
// phone the same markup restyles into a stacked list of shifts.
import { html, useRef, useLayoutEffect } from '../../lib/html.js';
import { fmtLocal } from '../../lib/format.js';
import { MINUTE, iso, clockIn, weekdayShort } from './zonetime.js';
import { splitBlocks } from './cut.js';
import { motion, animate, STEP_MS, SETTLE_MS } from './motion.js';

function normalize(block) {
  return {
    startMs: Date.parse(block.start),
    endMs: Date.parse(block.end),
    minutes: block.minutes,
    person: block.person ? block.person.name : 'Nobody',
    source: block.source,
  };
}

// A narrow block names its person by first name, and a very narrow one by initials; the full name stays in the
// accessible text, so the shift is always named in text.
function BlockName({ person }) {
  if (person === 'Nobody') return html`<span class="b-name">Nobody</span>`;
  const parts = person.split(' ');
  const initials = parts.map((part) => part[0]).join('');
  return html`<span class="b-name"><span class="b-full">${person}</span><span class="b-first" aria-hidden="true">${parts[0]}</span><span class="b-initials" aria-hidden="true">${initials}</span></span>`;
}

function Block({ block, zone, place }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (motion.kind) animate(ref.current, [{ opacity: 0.6 }, { opacity: 1 }], motion.kind === 'settle' ? SETTLE_MS : STEP_MS);
  }, []);
  const minutes = block.preview ? Math.round((block.endMs - block.startMs) / MINUTE) : block.minutes;
  const start = iso(block.startMs);
  const end = iso(block.endMs);
  return html`<div ref=${ref} class=${`block block-${block.source}${block.under ? ' block-under' : ''}`} style=${place(block.startMs, block.endMs)}
    data-start=${start} data-end=${end} data-person=${block.person} data-source=${block.source} data-minutes=${minutes}
    data-preview=${block.preview ? 'true' : undefined}>
    <${BlockName} person=${block.person} />
    <span class="b-time">${clockIn(block.startMs, zone)}–${clockIn(block.endMs, zone)}</span>
    <span class="b-when">${fmtLocal(start, zone)} to ${fmtLocal(end, zone)}</span>
  </div>`;
}

function blockKey(b) {
  return `${b.startMs}-${b.endMs}-${b.person}-${b.source}-${b.preview ? 'p' : ''}${b.under ? 'u' : ''}`;
}

function dayLabel(date, count) {
  if (count <= 7) return `${weekdayShort(date)} ${date.slice(5)}`;
  if (count <= 14) return `${weekdayShort(date)} ${date.slice(8)}`;
  return date.slice(8);
}

function Stripes({ days, fromMs, span }) {
  return html`<div class="stripes">${days.map((day, index) => {
    const start = Date.parse(day.start);
    const end = Date.parse(day.end);
    return html`<div key=${day.date} class=${index % 2 ? 'stripe stripe-shaded' : 'stripe'} data-date=${day.date} data-minutes=${day.minutes}
      style=${{ '--l': `${((start - fromMs) / span) * 100}%`, '--w': `${((end - start) / span) * 100}%` }}>
      <span class="stripe-label">${dayLabel(day.date, days.length)}</span>
    </div>`;
  })}</div>`;
}

// The navy block of a cut in progress; its free edge slides to each step.
function CutBlock({ cut, label, pct }) {
  const ref = useRef(null);
  const last = useRef(null);
  const lo = Math.min(cut.anchor, cut.edge);
  const hi = Math.max(cut.anchor, cut.edge);
  const left = pct(lo);
  const width = pct(hi) - left;
  useLayoutEffect(() => {
    const from = last.current ?? { left: pct(cut.anchor), width: 0 };
    last.current = { left, width };
    animate(ref.current, [{ left: `${from.left}%`, width: `${from.width}%` }, { left: `${left}%`, width: `${width}%` }], STEP_MS);
  }, [left, width]);
  return html`<div ref=${ref} class="cut-block" style=${{ left: `${left}%`, width: `${width}%` }}><span>${label}</span></div>`;
}

// What is left of a finished cut: it fades out when the server answered, or folds back to its anchor when refused.
function CutGhost({ ghost, label, pct, done }) {
  const ref = useRef(null);
  const lo = Math.min(ghost.anchor, ghost.edge);
  const hi = Math.max(ghost.anchor, ghost.edge);
  useLayoutEffect(() => {
    const frames = ghost.kind === 'refused'
      ? [{ left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` }, { left: `${pct(ghost.anchor)}%`, width: '0%' }]
      : [{ opacity: 1 }, { opacity: 0 }];
    const run = animate(ref.current, frames, SETTLE_MS);
    if (run) run.finished.then(done, done);
    else done();
  }, []);
  return html`<div ref=${ref} class="cut-block" style=${{ left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` }}><span>${label}</span></div>`;
}

function CutTab({ tab, pct }) {
  const ref = useRef(null);
  const last = useRef(null);
  const place = (value) => `clamp(var(--half), ${value}%, calc(100% - var(--half)))`;
  const at = tab ? pct(tab.at) : null;
  useLayoutEffect(() => {
    if (tab && tab.riding && last.current !== null && last.current !== at) {
      animate(ref.current, [{ left: place(last.current) }, { left: place(at) }], STEP_MS);
    }
    last.current = at;
  }, [at, tab?.riding]);
  if (!tab) return null;
  return html`<div ref=${ref} class=${tab.riding ? 'cut-tab riding' : 'cut-tab'} style=${{ left: place(at) }}>${tab.text}</div>`;
}

export function Grid({ data, zone, cut, cutLabel }) {
  const fromMs = Date.parse(data.from);
  const span = Date.parse(data.to) - fromMs;
  const pct = (ms) => ((ms - fromMs) / span) * 100;
  const place = (a, b) => ({ '--l': `${pct(a)}%`, '--w': `${((b - a) / span) * 100}%` });
  const layers = [...data.layers].sort((a, b) => b.order - a.order);
  const finalBlocks = data.blocks.map(normalize);
  const shown = cut.active ? splitBlocks(finalBlocks, cut.active.lo, cut.active.hi) : finalBlocks;
  return html`<div class="plot" data-zone=${zone}>
    <${Stripes} days=${data.days} fromMs=${fromMs} span=${span} />
    <div class="rows">
      ${layers.map((layer) => html`<div class="row" key=${layer.id}>
        <p class="row-label" aria-hidden="true">Layer ${layer.name}</p>
        <div role="group" aria-label=${`Layer ${layer.name}`} class="track">
          ${layer.blocks.filter((b) => !b.gap).map(normalize).map((b) => html`<${Block} key=${blockKey(b)} block=${b} zone=${zone} place=${place} />`)}
        </div>
      </div>`)}
      <div class="row row-final">
        <p class="row-label" aria-hidden="true">Final schedule</p>
        <div class="track-wrap">
          <div role="group" aria-label="Final schedule" aria-describedby="cut-help" tabindex="0" class="track track-final"
            ref=${cut.trackRef} ...${cut.handlers}>
            ${shown.map((b) => html`<${Block} key=${blockKey(b)} block=${b} zone=${zone} place=${place} />`)}
            ${cut.cut ? html`<${CutBlock} cut=${cut.cut} label=${cutLabel} pct=${pct} />` : null}
            ${cut.ghost ? html`<${CutGhost} key=${`${cut.ghost.anchor}-${cut.ghost.edge}-${cut.ghost.kind}`} ghost=${cut.ghost} label=${cutLabel} pct=${pct} done=${cut.clearGhost} />` : null}
          </div>
          <${CutTab} tab=${cut.tab} pct=${pct} />
        </div>
      </div>
    </div>
  </div>`;
}
