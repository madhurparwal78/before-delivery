import { chime, rememberedChoice, setSound, startAmbient } from './modules/audio.js';
import { ritualCards } from './modules/cards.js';
import { breathingGuide } from './modules/breathing.js';
import { create, el } from './modules/dom.js';
import { filmPlayer } from './modules/film.js';
import { openGate } from './modules/gate.js';
import { revealTitle, settleLine } from './modules/letters.js';
import { prefersReducedMotion } from './modules/motion.js';
import { rollNumerals, watchLiveCount } from './modules/numbers.js';
import {
  browserZone,
  buildRitualRows,
  fillBedtimes,
  fillZones,
  refreshSummary,
  syncRitualRows,
  type PlanFieldRefs,
} from './modules/planFields.js';
import { planner } from './modules/planner.js';
import {
  brightnessValue,
  cityCaption,
  litWindows,
  paintDial,
  storyClockText,
  windowsText,
} from './modules/readouts.js';
import { buildEvening } from './modules/scenes/index.js';
import { onScreenShare, pageFraction, passProgress, windowProgress } from './modules/scroll.js';
import {
  chosenRituals,
  loadRituals,
  readRitualsParameter,
  ritualsParameter,
  subscribe,
  totalMinutes,
} from './modules/store.js';
import { findRitual } from '../shared/rituals.js';

const fields: PlanFieldRefs = {
  form: el<HTMLFormElement>('plan-form'),
  alertHost: el('plan-alert'),
  email: el<HTMLInputElement>('plan-email'),
  bedtime: el<HTMLSelectElement>('plan-bedtime'),
  zone: el<HTMLSelectElement>('plan-zone'),
  note: el<HTMLTextAreaElement>('plan-note'),
  noteCounter: el('plan-note-counter'),
  ritualHost: el('plan-rituals'),
  errors: {
    email: el('plan-email-error'),
    bedtime: el('plan-bedtime-error'),
    time_zone: el('plan-zone-error'),
    rituals: el('plan-rituals-error'),
    note: el('plan-note-error'),
  },
  summaryHour: el('plan-summary-hour'),
  summaryTotal: el('plan-summary-total'),
  headingLevel: 'h3',
};

const ritualStatus = el('ritual-status');
const announceChange = (id: string, change: 'added' | 'removed'): void => {
  ritualStatus.textContent = `${findRitual(id)!.title} ${change}. ${totalMinutes()} of 60 minutes planned.`;
};
const announceRefusal = (id: string): void => {
  ritualStatus.textContent = `There is no room for ${findRitual(id)!.title}. Your hour already has ${totalMinutes()} of 60 minutes.`;
};

fillBedtimes(fields.bedtime, '23:00');
fillZones(fields.zone, browserZone());
const ritualRows = buildRitualRows(fields.ritualHost, 'plan', announceRefusal);

const chapterRituals = el('chapter-rituals');
const cards = ritualCards(el('ritual-track'), chapterRituals, announceRefusal);

/** Every ritual change replaces the address, without adding a history entry. */
function writeAddress(): void {
  const list = chosenRituals();
  const url = new URL(window.location.href);
  if (list.length > 0) url.searchParams.set('rituals', ritualsParameter(list));
  else url.searchParams.delete('rituals');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

subscribe((_, change) => {
  cards.sync();
  syncRitualRows(ritualRows);
  refreshSummary(fields);
  writeAddress();
  if (change.id && (change.reason === 'added' || change.reason === 'removed')) {
    announceChange(change.id, change.reason);
    if (change.reason === 'added') chime('ritual');
  }
});

loadRituals(readRitualsParameter(new URL(window.location.href).searchParams.get('rituals')));
cards.sync();
syncRitualRows(ritualRows);
refreshSummary(fields);

planner(fields);
filmPlayer();
breathingGuide({
  button: el<HTMLButtonElement>('breathe-button'),
  status: el('breath-status'),
  round: el('breath-round'),
  seconds: el('breath-seconds'),
  circle: el('breath-circle'),
});

const clockNode = el('story-clock');
const cityCount = el('city-count');
const cityCaptionNode = el('city-caption');
const dial = el('brightness-dial');
const dialValue = el('dial-value');
const dialSweep = document.getElementById('dial-sweep') as unknown as SVGCircleElement;
const settleSection = el('settle');
const settle = settleLine(el('settle-letters'));
const sceneWindows: { name: string; element: HTMLElement }[] = [
  { name: 'hero', element: el('scene-hero') },
  { name: 'city', element: el('scene-city') },
  { name: 'water', element: el('scene-water') },
  { name: 'flowers', element: el('scene-flowers') },
  { name: 'moon', element: chapterRituals },
  { name: 'lantern', element: el('scene-lantern') },
];

const evening = buildEvening(el<HTMLCanvasElement>('stage'));
evening.resize();

const hits = el('flower-hits');
function layOutFlowerHits(): void {
  hits.replaceChildren();
  for (const [index, point] of evening.flowerHits().entries()) {
    if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) continue;
    const spot = create('span', { style: `left:${(point.x * 100).toFixed(2)}%; top:${(point.y * 100).toFixed(2)}%` });
    spot.addEventListener('pointerenter', () => evening.closeFlower(index));
    spot.addEventListener('pointerdown', () => evening.closeFlower(index));
    hits.append(spot);
  }
}
layOutFlowerHits();

/** The readouts follow scroll on the scroll event itself, so they never lag a frame. */
function readScroll(): void {
  clockNode.textContent = storyClockText(pageFraction());

  const cityProgress = windowProgress(sceneWindows[1]!.element);
  const lit = litWindows(cityProgress);
  cityCount.textContent = windowsText(lit);
  cityCaptionNode.textContent = cityCaption(cityProgress);
  evening.setLitWindows(lit);

  paintDial(dial, dialValue, dialSweep, brightnessValue(passProgress(dial)));
  settle.update(windowProgress(settleSection));
  cards.travel(windowProgress(chapterRituals));
}

/** Only these three keep moving on their own; the rest change with scroll alone. */
const LOOPING_SCENES = new Set(['water', 'flowers', 'lantern']);
let lastFrame = '';

function renderScene(elapsed: number): void {
  let best = sceneWindows[0]!;
  let bestShare = -1;
  for (const scene of sceneWindows) {
    const share = onScreenShare(scene.element);
    if (share > bestShare) {
      bestShare = share;
      best = scene;
    }
  }
  // Nothing is drawn while an opaque chapter covers the canvas.
  if (bestShare <= 0.02) return;
  const progress = windowProgress(best.element);
  const frame = `${best.name}:${progress.toFixed(4)}`;
  if (!LOOPING_SCENES.has(best.name) && frame === lastFrame) return;
  lastFrame = frame;
  evening.render(best.name, progress, elapsed);
}

let queued = false;
function requestRender(): void {
  if (queued) return;
  queued = true;
  requestAnimationFrame((at) => {
    queued = false;
    renderScene(at / 1000);
  });
}

function loop(at: number): void {
  renderScene(at / 1000);
  requestAnimationFrame(loop);
}

window.addEventListener('scroll', readScroll, { passive: true });
window.addEventListener('resize', () => {
  evening.resize();
  layOutFlowerHits();
  readScroll();
  requestRender();
});

const soundSwitch = el<HTMLButtonElement>('sound-switch');
soundSwitch.addEventListener('click', () => {
  const next = soundSwitch.getAttribute('aria-checked') !== 'true';
  soundSwitch.setAttribute('aria-checked', String(next));
  setSound(next);
});

async function start(): Promise<void> {
  const soundChosen = await openGate();
  soundSwitch.setAttribute('aria-checked', String(soundChosen));
  setSound(soundChosen);
  startAmbient();

  const title = el('hero-title');
  title.setAttribute('tabindex', '-1');
  title.focus();
  revealTitle(el('hero-letters'));
  rollNumerals(el('numbers-band'));
  watchLiveCount(el('live-count'), el('numbers-band'));

  evening.resize();
  layOutFlowerHits();
  readScroll();
  if (prefersReducedMotion()) {
    // Each scene is one still picture, redrawn to match the current scroll position.
    window.addEventListener('scroll', requestRender, { passive: true });
    requestRender();
  } else {
    requestAnimationFrame(loop);
  }
}

if (rememberedChoice() !== null) soundSwitch.setAttribute('aria-checked', String(rememberedChoice() === 'on'));
void start();
