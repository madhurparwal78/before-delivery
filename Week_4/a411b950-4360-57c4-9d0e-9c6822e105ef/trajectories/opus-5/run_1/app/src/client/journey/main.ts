import { getJson } from '../shared/api.ts';
import { clear, el, prefersReducedMotion } from '../shared/dom.ts';
import { ICONS, icon } from '../shared/icons.ts';
import { formatDateTime } from '../../shared/dates.ts';
import { operatorTimeZone } from '../shared/timeZone.ts';
import { LAYERS, type Layer } from '../../shared/projectStatus.ts';
import { AudioEngine } from './audioEngine.ts';
import { createBriefForm } from './briefForm.ts';
import { createCorridor, type CorridorView } from './corridor.ts';
import { openSoundGate } from './soundGate.ts';
import { createStationView, type StationData, type StationView } from './stationView.ts';

const SCROLL_RANGE = 1600;
const PIXELS_PER_POINT = 16;
const DOLLY_MS = 950;
const SEARCH_DEBOUNCE_MS = 250;
const LIVE_LINK_CHECK_MS = 5_000;

const LINK_COPY = {
  gone: 'This listening link is not available.',
  expired: 'This listening link has expired. Ask Kettlehole Audio for a new one.',
} as const;

const INTRO_HEADING = 'Walk the corridor. Every station builds from silence.';

type JourneyMode =
  | { kind: 'public' }
  | { kind: 'private'; token: string; expiresAt: Date };

const reducedMotion = prefersReducedMotion();
const engine = new AudioEngine();

const app = document.getElementById('app') as HTMLElement;

const canvas = el('canvas', { class: 'corridor-canvas', 'aria-hidden': 'true' });
const readoutValue = el('span', { class: 'readout-value', text: '000' });
const readout = el(
  'div',
  {
    class: 'readout',
    role: 'meter',
    'aria-label': 'Intensity',
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': 0,
  },
  [el('span', { class: 'readout-label', text: 'INTENSITY' }), readoutValue],
);
const layerChanges = el('p', { class: 'layer-changes', role: 'status', 'aria-label': 'Layer changes' });
const main = el('main', { class: 'journey-main' });

const wordmark = el('span', { class: 'wordmark', text: 'Earshot' });
const soundToggle = el('button', { type: 'button', class: 'sound-toggle', 'aria-pressed': 'false' }, [
  icon(ICONS.soundOff),
  el('span', { text: 'Sound on' }),
]);
const topBarMiddle = el('div', { class: 'top-bar-middle' });
const topBar = el('header', { class: 'top-bar' }, [wordmark, topBarMiddle, soundToggle]);

app.append(canvas, topBar, readout, layerChanges, main);

let views: StationView[] = [];
let chapterTops: number[] = [];
let currentIndex: number | null = null;
let currentIntensity = 0;
let activeLayers: Layer[] = [];
let focusStation = 0;
let lastStationSlug: string | null = null;
let cameraProgress = 0;
let cameraFrom = 0;
let cameraTarget = 0;
let cameraStart = 0;
let cameraTimer: number | null = null;
let corridor: CorridorView | null = null;

function activeFor(view: StationView, intensity: number): Layer[] {
  return LAYERS.filter((layer) => intensity >= view.data.thresholds[layer]);
}

function announceRungChange(before: readonly Layer[], after: readonly Layer[], view: StationView, intensity: number): void {
  const coming = after.filter((layer) => !before.includes(layer));
  const going = before.filter((layer) => !after.includes(layer));
  coming.sort((left, right) => view.data.thresholds[left] - view.data.thresholds[right]);
  going.sort((left, right) => view.data.thresholds[right] - view.data.thresholds[left]);
  const sentences = [
    ...coming.map((layer) => `${layer[0]?.toUpperCase()}${layer.slice(1)} in at intensity ${intensity}.`),
    ...going.map((layer) => `${layer[0]?.toUpperCase()}${layer.slice(1)} out at intensity ${intensity}.`),
  ];
  if (sentences.length > 0) layerChanges.textContent = sentences.join(' ');
}

function writeUrl(slug: string | null, intensity: number): void {
  const url = new URL(window.location.href);
  if (slug === null) {
    url.searchParams.delete('station');
    url.searchParams.delete('i');
  } else {
    url.searchParams.set('station', slug);
    url.searchParams.set('i', String(intensity));
  }
  window.history.replaceState(null, '', `${url.pathname}${url.search}`);
}

function startDolly(target: number): void {
  if (reducedMotion) {
    cameraProgress = target;
    cameraFrom = target;
    cameraTarget = target;
    return;
  }
  cameraFrom = cameraProgress;
  cameraTarget = target;
  cameraStart = performance.now();
}

function setCameraAttributes(index: number | null): void {
  if (cameraTimer !== null) {
    window.clearTimeout(cameraTimer);
    cameraTimer = null;
  }
  views.forEach((view, position) => {
    if (position === index) return;
    view.setCamera('wide');
  });
  if (index === null) return;
  const view = views[index] as StationView;
  if (reducedMotion) {
    view.setCamera('close');
    return;
  }
  view.setCamera('moving');
  cameraTimer = window.setTimeout(() => {
    view.setCamera(currentIndex === index ? 'close' : 'wide');
    cameraTimer = null;
  }, DOLLY_MS);
}

function leaveStation(index: number): void {
  const view = views[index] as StationView;
  const before = activeLayers;
  activeLayers = [];
  view.setIntensity(0);
  view.setActiveLayers([]);
  announceRungChange(before, [], view, 0);
  if (reducedMotion) view.setCamera('wide');
  else {
    view.setCamera('moving');
    if (cameraTimer !== null) window.clearTimeout(cameraTimer);
    cameraTimer = window.setTimeout(() => {
      view.setCamera('wide');
      cameraTimer = null;
    }, DOLLY_MS);
  }
  engine.fadeToSilence();
}

function apply(index: number | null, intensity: number): void {
  if (index !== currentIndex) {
    if (currentIndex !== null) leaveStation(currentIndex);
    currentIndex = index;
    currentIntensity = -1;
    if (index === null) {
      writeUrl(null, 0);
      readoutValue.textContent = '000';
      readout.setAttribute('aria-valuenow', '0');
      startDolly(0);
      return;
    }
    focusStation = index;
    lastStationSlug = (views[index] as StationView).data.slug;
    setCameraAttributes(index);
    startDolly(1);
    const view = views[index] as StationView;
    if (view.data.playable) {
      void engine.playStation({ slug: view.data.slug, stems: view.data.stems }).then(
        () => engine.setActiveLayers(activeFor(view, Math.max(0, currentIntensity))),
        () => onStemFailure(),
      );
    }
  }
  if (index === null) return;

  const view = views[index] as StationView;
  if (intensity === currentIntensity) return;
  currentIntensity = intensity;
  view.setIntensity(intensity);
  readoutValue.textContent = String(intensity).padStart(3, '0');
  readout.setAttribute('aria-valuenow', String(intensity));

  const next = activeFor(view, intensity);
  if (next.join(',') !== activeLayers.join(',')) {
    const before = activeLayers;
    activeLayers = next;
    view.setActiveLayers(next);
    writeUrl(view.data.slug, intensity);
    announceRungChange(before, next, view, intensity);
    engine.setActiveLayers(next);
  } else {
    writeUrl(view.data.slug, intensity);
  }
}

function measure(): void {
  chapterTops = views.map((view) => view.chapter.getBoundingClientRect().top + window.scrollY);
  corridor?.resize();
}

function readScroll(): void {
  const scrollY = window.scrollY;
  for (let index = 0; index < views.length; index += 1) {
    const offset = scrollY - (chapterTops[index] as number);
    if (offset >= 0 && offset <= SCROLL_RANGE) {
      apply(index, Math.floor(offset / PIXELS_PER_POINT + 0.5));
      return;
    }
  }
  apply(null, 0);
}

function readVisibleStage(): void {
  const height = window.innerHeight;
  let best: { index: number; visible: number } | null = null;
  views.forEach((view, index) => {
    const rect = view.region.getBoundingClientRect();
    const visible = Math.min(rect.bottom, height) - Math.max(rect.top, 0);
    if (visible <= 0) return;
    if (view.region.contains(document.activeElement)) {
      best = { index, visible: Number.POSITIVE_INFINITY };
      return;
    }
    if (best === null || visible > (best as { visible: number }).visible) best = { index, visible };
  });
  if (best === null) {
    apply(null, 0);
    return;
  }
  const chosen = best as { index: number };
  if (chosen.index !== currentIndex) apply(chosen.index, 0);
}

function onStemFailure(): void {
  if (mode.kind === 'private') void recheckLink();
}

let mode: JourneyMode = { kind: 'public' };
let linkStatus: HTMLElement | null = null;
let lastLinkCheck = 0;
let linkChecking = false;

async function recheckLink(): Promise<void> {
  if (mode.kind !== 'private' || linkChecking) return;
  linkChecking = true;
  lastLinkCheck = Date.now();
  const result = await getJson<unknown>(`/api/listen/${mode.token}`);
  linkChecking = false;
  if (result.ok) return;
  if (result.status === 410 || result.status === 404) {
    endLink(result.status === 410 ? LINK_COPY.expired : LINK_COPY.gone);
  }
}

function endLink(copy: string): void {
  engine.fadeToSilence();
  for (const view of views) view.chapter.remove();
  views = [];
  currentIndex = null;
  activeLayers = [];
  readoutValue.textContent = '000';
  readout.setAttribute('aria-valuenow', '0');
  if (linkStatus !== null) linkStatus.textContent = copy;
  mode = { kind: 'public' };
}

function frame(time: number): void {
  if (reducedMotion) readVisibleStage();
  else readScroll();

  if (!reducedMotion && cameraProgress !== cameraTarget) {
    const progress = Math.min(1, (time - cameraStart) / DOLLY_MS);
    const eased = 1 - Math.pow(1 - progress, 3);
    cameraProgress = cameraFrom + (cameraTarget - cameraFrom) * eased;
  }
  corridor?.render({
    focusStation,
    cameraProgress,
    glow: activeLayers.length / LAYERS.length,
  });
  window.requestAnimationFrame(frame);
}

function buildSearch(): void {
  const input = el('input', {
    type: 'search',
    class: 'search-box',
    'aria-label': 'Search projects',
    placeholder: 'Search projects',
    autocomplete: 'off',
  });
  const results = el('ul', { class: 'search-results', role: 'list', 'aria-label': 'Search results' });
  const status = el('p', { class: 'status-line search-status', role: 'status', 'aria-label': 'Search status' });
  const expand = el('button', { type: 'button', class: 'search-expand' }, [
    icon(ICONS.search),
    el('span', { text: 'Search' }),
  ]);
  const panel = el('div', { class: 'search-panel' }, [input, results, status]);
  topBarMiddle.append(expand, panel);

  expand.addEventListener('click', () => {
    topBarMiddle.classList.add('search-open');
    input.focus();
  });

  let timer: number | null = null;
  input.addEventListener('input', () => {
    if (timer !== null) window.clearTimeout(timer);
    const term = input.value.trim();
    if (term === '') {
      clear(results);
      status.textContent = '';
      return;
    }
    status.textContent = 'Searching\u2026';
    timer = window.setTimeout(() => {
      void (async () => {
        const result = await getJson<{ results: Array<{ slug: string; title: string; credit_label: string }> }>(
          `/api/search?q=${encodeURIComponent(term)}`,
        );
        clear(results);
        if (!result.ok) {
          status.textContent = 'No projects match \u201c' + term + '\u201d.';
          return;
        }
        if (result.data.results.length === 0) {
          status.textContent = `No projects match \u201c${term}\u201d.`;
          return;
        }
        status.textContent = `${result.data.results.length} projects found.`;
        for (const entry of result.data.results) {
          const link = el('a', { href: `?station=${entry.slug}`, text: entry.title });
          link.addEventListener('click', (event) => {
            event.preventDefault();
            goToStation(entry.slug);
          });
          results.append(el('li', {}, [link]));
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
  });
}

function goToStation(slug: string): void {
  const index = views.findIndex((view) => view.data.slug === slug);
  if (index < 0) return;
  const view = views[index] as StationView;
  if (!reducedMotion) {
    window.scrollTo({ top: chapterTops[index] as number, behavior: 'auto' });
    readScroll();
  } else {
    view.region.scrollIntoView();
    apply(index, 0);
  }
  view.heading.focus();
}

function onRung(index: number, layer: Layer): void {
  const view = views[index] as StationView;
  const threshold = view.data.thresholds[layer];
  if (reducedMotion) {
    apply(index, threshold);
    return;
  }
  window.scrollTo({ top: (chapterTops[index] as number) + threshold * PIXELS_PER_POINT, behavior: 'auto' });
  readScroll();
}

function renderStations(stations: readonly StationData[]): void {
  views = stations.map((station, index) =>
    createStationView(station, index, {
      reducedMotion,
      onRung: (layer) => onRung(index, layer),
      onSlider: (intensity) => apply(index, intensity),
    }),
  );
  for (const view of views) main.append(view.chapter);
}

async function boot(): Promise<void> {
  const path = window.location.pathname;
  const listenMatch = /^\/listen\/([^/]+)$/.exec(path);

  const intro = el('div', { class: 'chapter intro-chapter' }, [
    el('h1', { class: 'intro-heading', id: 'intro-heading', tabindex: -1, text: INTRO_HEADING }),
    el('p', {
      class: 'intro-copy',
      text: 'Scroll to walk between stations. Each one builds layer by layer as the game gets more intense.',
    }),
  ]);
  main.append(intro);

  let stations: StationData[] = [];
  if (listenMatch !== null) {
    const token = listenMatch[1] as string;
    const result = await getJson<{ station: StationData; expires_at: string; nda: boolean }>(
      `/api/listen/${token}`,
    );
    linkStatus = el('p', { class: 'status-line link-status', role: 'status', 'aria-label': 'Link status' });
    const notice = el('div', { class: 'nda-notice', role: 'region', 'aria-label': 'NDA notice' });
    topBarMiddle.append(notice, linkStatus);
    if (result.ok) {
      mode = { kind: 'private', token, expiresAt: new Date(result.data.expires_at) };
      notice.textContent = `Private listening under NDA. This link stops working on ${formatDateTime(
        new Date(result.data.expires_at),
        operatorTimeZone(),
      )}.`;
      stations = [result.data.station];
    } else {
      notice.textContent = 'Private listening under NDA.';
      linkStatus.textContent = result.status === 410 ? LINK_COPY.expired : LINK_COPY.gone;
    }
    renderStations(stations);
    const form = createBriefForm({ listenToken: token, currentStationSlug: () => null });
    main.append(el('div', { class: 'chapter brief-chapter' }, [form.element]));
    window.setInterval(() => {
      if (mode.kind !== 'private') return;
      const now = Date.now();
      if (now >= mode.expiresAt.getTime() || now - lastLinkCheck >= LIVE_LINK_CHECK_MS) void recheckLink();
    }, 1_000);
  } else {
    buildSearch();
    const result = await getJson<{ stations: StationData[] }>('/api/journey');
    if (result.ok) stations = result.data.stations;
    else layerChanges.textContent = 'The corridor could not load. Refresh to try again.';
    renderStations(stations);
    const form = createBriefForm({
      listenToken: null,
      currentStationSlug: () => lastStationSlug,
    });
    main.append(el('div', { class: 'chapter brief-chapter' }, [form.element]));
  }

  corridor = createCorridor(canvas, stations.map((station) => station.slug));
  measure();
  window.addEventListener('resize', measure);
  window.requestAnimationFrame(frame);

  openSoundGate(main, (withSound) => {
    soundToggle.setAttribute('aria-pressed', withSound ? 'true' : 'false');
    soundToggle.replaceChild(icon(withSound ? ICONS.soundOn : ICONS.soundOff), soundToggle.firstChild as Node);
    engine.setAudible(withSound);
    (document.getElementById('intro-heading') as HTMLElement).focus();
    if (currentIndex !== null) {
      const view = views[currentIndex] as StationView;
      if (view.data.playable) {
        void engine.playStation({ slug: view.data.slug, stems: view.data.stems }).then(
          () => engine.setActiveLayers(activeLayers),
          () => onStemFailure(),
        );
      }
    }
  });

  soundToggle.addEventListener('click', () => {
    const next = soundToggle.getAttribute('aria-pressed') !== 'true';
    soundToggle.setAttribute('aria-pressed', next ? 'true' : 'false');
    soundToggle.replaceChild(icon(next ? ICONS.soundOn : ICONS.soundOff), soundToggle.firstChild as Node);
    engine.setAudible(next);
    if (next && currentIndex !== null) {
      const view = views[currentIndex] as StationView;
      if (view.data.playable) {
        void engine.playStation({ slug: view.data.slug, stems: view.data.stems }).then(
          () => engine.setActiveLayers(activeLayers),
          () => onStemFailure(),
        );
      }
    }
  });
}

void boot();
