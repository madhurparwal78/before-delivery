import { el, ensureOrder, on, svg } from '../lib/dom.js';
import { loadCoastline } from '../lib/coastline.js';
import type { Ring } from '../lib/coastline.js';
import {
  ARRIVAL_DROP_MILLIS,
  ARRIVAL_PULSE_MILLIS,
  CLUSTER_MAX_STAGGER_STEPS,
  CLUSTER_MILLIS,
  CLUSTER_STAGGER_MILLIS,
  DRAG_HALF_LIFE_MILLIS,
  SELECTION_MILLIS,
  quinticEaseOut,
  reducedMotion,
  setFigure,
} from '../lib/motion.js';
import { STATE_STYLES, hatchDefinition } from '../lib/shopState.js';
import { wholeNumber } from '../lib/copy.js';
import type { Store } from '../lib/types.js';

const DEGREES_PER_LON_PIXEL = 31;
const DEGREES_PER_LAT_PIXEL = 40;
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const MIN_LON = -31.5;
const MAX_LON = -6.0;
const MIN_LAT = 36.8;
const MAX_LAT = 42.2;
const CLUSTER_ZOOM = 3;
const SELECTION_ZOOM = 6;
const KEY_PAN_PIXELS = 40;
const WHEEL_STEP = 0.25;

const REGION_NAMES: Record<string, string> = {
  norte: 'Norte',
  centro: 'Centro',
  sul: 'Sul',
  sao_miguel: 'São Miguel',
  terceira: 'Terceira',
};

type Viewport = { lon: number; lat: number; zoom: number };

export type EstateMap = {
  region: HTMLElement;
  legend: HTMLElement;
  update: (stores: Store[], count: number) => void;
  select: (storeId: string, opener: HTMLElement | null) => void;
  setPanelOpen: (open: boolean) => void;
  setReviewProgress: (progress: number) => void;
  setBadges: (counts: Map<string, number>) => void;
  showArrival: (storeId: string) => void;
  markerOf: (storeId: string) => HTMLElement | null;
  destroy: () => void;
};

export type MapHandlers = {
  onSelect: (storeId: string, opener: HTMLElement) => void;
};

function markerName(store: Store): string {
  return `Open ${store.name}, ${STATE_STYLES[store.display_state].lowercase}, critical lines: ${store.critical_lines}`;
}

function clusterName(count: number, region: string): string {
  return `Cluster of ${count} shops in ${REGION_NAMES[region] ?? region}, zoom in`;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function createEstateMap(handlers: MapHandlers): EstateMap {
  let viewport: Viewport = { lon: -18.75, lat: 39.5, zoom: 1 };
  let stores: Store[] = [];
  let rings: Ring[] = [];
  let glideFrame: number | null = null;
  let driftFrame: number | null = null;
  let lastClustered = true;
  const clusterTimers: number[] = [];

  const land = svg('g', { class: 'map-land' });
  const sheet = svg(
    'svg',
    { class: 'map-sheet', 'aria-hidden': 'true', focusable: 'false' },
    [hatchDefinition(), land],
  );
  const markerLayer = el('div', { class: 'marker-layer' });

  const zoomIn = el(
    'button',
    { type: 'button', class: 'block-button zoom-button', 'data-focus-id': 'zoom-in' },
    '+',
  );
  zoomIn.setAttribute('aria-label', 'Zoom in');
  const zoomOut = el(
    'button',
    { type: 'button', class: 'block-button zoom-button', 'data-focus-id': 'zoom-out' },
    '−',
  );
  zoomOut.setAttribute('aria-label', 'Zoom out');

  const region = el(
    'div',
    {
      class: 'estate-map charcoal-panel',
      role: 'region',
      'aria-label': 'Estate map',
      tabindex: '0',
      'data-focus-id': 'estate-map',
      'data-store-count': '0',
      'data-viewport': '-18.7500,39.5000,1.00',
      'data-phase': 'idle',
      'data-panel': 'closed',
      'data-motion': reducedMotion() ? 'reduced' : 'full',
      'data-review-progress': '1.000',
    },
    [sheet, markerLayer, el('div', { class: 'zoom-controls' }, [zoomIn, zoomOut])],
  );

  const legend = el('ul', { class: 'map-legend', 'aria-label': 'Map legend' });
  const legendCounts = new Map<string, HTMLElement>();
  for (const state of Object.keys(STATE_STYLES) as (keyof typeof STATE_STYLES)[]) {
    const style = STATE_STYLES[state];
    const count = el('span', { class: 'figure legend-count' });
    legendCounts.set(state, count);
    legend.appendChild(
      el('li', { class: 'legend-item', 'data-legend-state': state }, [
        legendSwatch(state),
        el('span', { class: 'legend-label' }, style.label),
        count,
      ]),
    );
  }

  const markers = new Map<string, HTMLElement>();
  const markerDots = new Map<string, SVGElement>();
  const markerBadges = new Map<string, HTMLElement>();
  const openers = new Map<string, HTMLElement>();
  const clusterNodes = new Map<string, HTMLElement>();
  const clusterGroups = new Map<string, Group>();

  function legendSwatch(state: keyof typeof STATE_STYLES): SVGElement {
    const style = STATE_STYLES[state];
    return svg(
      'svg',
      { class: 'state-swatch', width: 22, height: 22, viewBox: '0 0 22 22', 'aria-hidden': 'true' },
      [
        hatchDefinition(),
        svg('circle', {
          cx: 11,
          cy: 11,
          r: 11 - style.ringWidth,
          fill: style.hatched ? 'url(#tramela-hatch)' : style.fill,
          stroke: 'var(--ink)',
          'stroke-width': style.ringWidth,
          'stroke-dasharray': style.dash === 'none' ? null : style.dash,
        }),
      ],
    );
  }

  function size(): { width: number; height: number } {
    const box = region.getBoundingClientRect();
    return { width: box.width || 600, height: box.height || 520 };
  }

  function project(lon: number, lat: number): { x: number; y: number } {
    const { width, height } = size();
    return {
      x: width / 2 + (lon - viewport.lon) * DEGREES_PER_LON_PIXEL * viewport.zoom,
      y: height / 2 - (lat - viewport.lat) * DEGREES_PER_LAT_PIXEL * viewport.zoom,
    };
  }

  function writeViewport(): void {
    region.dataset['viewport'] =
      `${viewport.lon.toFixed(4)},${viewport.lat.toFixed(4)},${viewport.zoom.toFixed(2)}`;
  }

  function setViewport(next: Partial<Viewport>): void {
    viewport = {
      lon: clamp(next.lon ?? viewport.lon, MIN_LON, MAX_LON),
      lat: clamp(next.lat ?? viewport.lat, MIN_LAT, MAX_LAT),
      zoom: clamp(next.zoom ?? viewport.zoom, MIN_ZOOM, MAX_ZOOM),
    };
    writeViewport();
    draw();
  }

  function drawLand(): void {
    const { width, height } = size();
    sheet.setAttribute('viewBox', `0 0 ${width} ${height}`);
    sheet.setAttribute('width', String(width));
    sheet.setAttribute('height', String(height));
    while (land.firstChild) land.removeChild(land.firstChild);
    for (const ring of rings) {
      const points = ring.map(([lon, lat]) => {
        const point = project(lon, lat);
        return `${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
      });
      land.appendChild(svg('path', { class: 'map-shape', d: `M${points.join('L')}Z` }));
    }
  }

  type Group = { region: string; stores: Store[]; lon: number; lat: number };

  function groups(): Group[] {
    const byRegion = new Map<string, Store[]>();
    for (const store of stores) {
      const list = byRegion.get(store.region) ?? [];
      list.push(store);
      byRegion.set(store.region, list);
    }
    return [...byRegion.entries()]
      .filter(([, list]) => list.length >= 2)
      .map(([name, list]) => ({
        region: name,
        stores: [...list].sort((a, b) => (a.id < b.id ? -1 : 1)),
        lon: list.reduce((sum, store) => sum + store.lon, 0) / list.length,
        lat: list.reduce((sum, store) => sum + store.lat, 0) / list.length,
      }));
  }

  function clusteredNow(): boolean {
    return viewport.zoom < CLUSTER_ZOOM;
  }

  function place(node: HTMLElement, x: number, y: number): void {
    node.style.transform = `translate(${x - 22}px, ${y - 22}px)`;
  }

  const MIN_SEPARATION = 46;

  /**
   * Keeps every marker's 44-pixel target reachable: shops in the same city project within a
   * few pixels of each other, so overlapping targets are pushed apart in store code order.
   */
  function spread(points: { id: string; x: number; y: number }[]): Map<string, { x: number; y: number }> {
    const placed = points
      .map((point) => ({ ...point }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    for (let pass = 0; pass < 12; pass += 1) {
      let moved = false;
      for (let i = 0; i < placed.length; i += 1) {
        for (let j = i + 1; j < placed.length; j += 1) {
          const a = placed[i]!;
          const b = placed[j]!;
          let deltaX = b.x - a.x;
          let deltaY = b.y - a.y;
          let apart = Math.hypot(deltaX, deltaY);
          if (apart >= MIN_SEPARATION) continue;
          if (apart < 0.001) {
            deltaX = 1;
            deltaY = 0;
            apart = 1;
          }
          const push = (MIN_SEPARATION - apart) / 2;
          a.x -= (deltaX / apart) * push;
          a.y -= (deltaY / apart) * push;
          b.x += (deltaX / apart) * push;
          b.y += (deltaY / apart) * push;
          moved = true;
        }
      }
      if (!moved) break;
    }
    return new Map(placed.map((point) => [point.id, { x: point.x, y: point.y }]));
  }

  function draw(): void {
    drawLand();
    const grouping = groups();
    const grouped = clusteredNow();
    const insideCluster = new Map<string, Group>();
    if (grouped) {
      for (const group of grouping) {
        for (const store of group.stores) insideCluster.set(store.id, group);
      }
    }

    for (const [regionName, node] of clusterNodes) {
      if (!grouped || !grouping.some((group) => group.region === regionName)) node.remove();
    }

    const spots = spread([
      ...stores
        .filter((store) => !insideCluster.has(store.id))
        .map((store) => ({ id: store.id, ...project(store.lon, store.lat) })),
      ...(grouped
        ? grouping.map((group) => ({ id: `cluster:${group.region}`, ...project(group.lon, group.lat) }))
        : []),
    ]);

    if (grouped) {
      for (const group of grouping) {
        const node = clusterNodeFor(group);
        const point = spots.get(`cluster:${group.region}`) as { x: number; y: number };
        place(node, point.x, point.y);
      }
    }

    stores.forEach((store, index) => {
      const marker = markers.get(store.id);
      if (!marker) return;
      marker.style.zIndex = String(stores.length - index);
      const home = insideCluster.get(store.id);
      if (home) {
        const point = spots.get(`cluster:${home.region}`) ?? project(home.lon, home.lat);
        place(marker, point.x, point.y);
        marker.dataset['clusterPhase'] = 'clustered';
        marker.classList.add('inside-cluster');
        marker.tabIndex = -1;
        return;
      }
      const point = spots.get(store.id) as { x: number; y: number };
      place(marker, point.x, point.y);
      marker.classList.remove('inside-cluster');
      marker.tabIndex = 0;
      if (marker.dataset['clusterPhase'] !== 'separating') marker.dataset['clusterPhase'] = 'placed';
    });

    if (lastClustered && !grouped) separate(grouping);
    lastClustered = grouped;
    orderTabbing();
  }

  /** One cluster node per region, kept across draws so a focused cluster stays focused. */
  function clusterNodeFor(group: Group): HTMLElement {
    clusterGroups.set(group.region, group);
    let node = clusterNodes.get(group.region);
    if (!node) {
      node = el(
        'button',
        {
          type: 'button',
          class: 'map-cluster',
          'data-region': group.region,
          'data-focus-id': `cluster-${group.region}`,
        },
        el('span', { class: 'cluster-count' }),
      );
      on(node, 'click', () => {
        const current = clusterGroups.get(group.region);
        if (!current) return;
        setViewport({ lon: current.lon, lat: current.lat, zoom: CLUSTER_ZOOM });
        region.dataset['phase'] = 'settled';
      });
      clusterNodes.set(group.region, node);
    }
    if (!node.isConnected) markerLayer.appendChild(node);
    node.tabIndex = 0;
    node.dataset['clusterCount'] = String(group.stores.length);
    node.setAttribute('aria-label', clusterName(group.stores.length, group.region));
    (node.querySelector('.cluster-count') as HTMLElement).textContent = String(group.stores.length);
    return node;
  }

  function currentSpot(marker: HTMLElement): { x: number; y: number } {
    const match = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(marker.style.transform);
    return match
      ? { x: Number(match[1]) + 22, y: Number(match[2]) + 22 }
      : { x: 0, y: 0 };
  }

  /** Clustered markers travel out in ascending store code order, 0.04 seconds apart. */
  function separate(grouping: Group[]): void {
    for (const timer of clusterTimers) window.clearTimeout(timer);
    clusterTimers.length = 0;
    if (reducedMotion()) return;

    for (const group of grouping) {
      const from = project(group.lon, group.lat);
      group.stores.forEach((store, index) => {
        const marker = markers.get(store.id);
        if (!marker) return;
        const to = currentSpot(marker);
        marker.dataset['clusterPhase'] = 'separating';
        place(marker, from.x, from.y);
        const delay = Math.min(index, CLUSTER_MAX_STAGGER_STEPS - 1) * CLUSTER_STAGGER_MILLIS;
        clusterTimers.push(
          window.setTimeout(() => {
            marker.style.transition = `transform ${CLUSTER_MILLIS}ms cubic-bezier(0.2,0.8,0.2,1)`;
            place(marker, to.x, to.y);
            clusterTimers.push(
              window.setTimeout(() => {
                marker.style.transition = '';
                marker.dataset['clusterPhase'] = 'placed';
              }, CLUSTER_MILLIS),
            );
          }, delay),
        );
      });
    }
  }

  /** Markers and clusters tab in ascending store code order, a cluster at its lowest code. */
  function orderTabbing(): void {
    const tabbable: { key: string; node: HTMLElement }[] = [];
    const hidden: HTMLElement[] = [];
    const clusteredIds = new Set<string>();

    if (clusteredNow()) {
      for (const group of groups()) {
        for (const store of group.stores) clusteredIds.add(store.id);
        const node = clusterNodes.get(group.region);
        if (node) tabbable.push({ key: group.stores[0]?.id ?? group.region, node });
      }
    }
    for (const store of stores) {
      const marker = markers.get(store.id);
      if (!marker) continue;
      if (clusteredIds.has(store.id)) hidden.push(marker);
      else tabbable.push({ key: store.id, node: marker });
    }

    tabbable.sort((a, b) => (a.key < b.key ? -1 : 1));
    const held = document.activeElement as HTMLElement | null;
    ensureOrder(markerLayer, [...tabbable.map((entry) => entry.node), ...hidden]);
    if (held && markerLayer.contains(held) && document.activeElement !== held) held.focus();
  }

  function buildMarker(store: Store): HTMLElement {
    const dot = svg('svg', { class: 'marker-dot', viewBox: '0 0 22 22', 'aria-hidden': 'true' }, [
      hatchDefinition(),
      svg('circle', { cx: 11, cy: 11, r: 9, class: 'marker-circle' }),
    ]);
    const badge = el('span', { class: 'marker-badge figure', hidden: true });
    const node = el(
      'button',
      {
        type: 'button',
        class: 'map-marker',
        'data-store-id': store.id,
        'data-marker-state': store.display_state,
        'data-arrival': 'none',
        'data-cluster-phase': 'placed',
        'data-focus-id': `marker-${store.id}`,
        'aria-label': markerName(store),
      },
      [dot, badge],
    );
    markerDots.set(store.id, dot);
    markerBadges.set(store.id, badge);
    on(node, 'click', () => {
      openers.set(store.id, node);
      handlers.onSelect(store.id, node);
    });
    return node;
  }

  function paintMarker(store: Store): void {
    const marker = markers.get(store.id);
    const dot = markerDots.get(store.id);
    if (!marker || !dot) return;
    const style = STATE_STYLES[store.display_state];
    marker.dataset['markerState'] = store.display_state;
    marker.setAttribute('aria-label', markerName(store));
    const circle = dot.querySelector('circle.marker-circle');
    circle?.setAttribute('fill', style.hatched ? 'url(#tramela-hatch)' : style.fill);
    circle?.setAttribute('stroke-width', String(style.ringWidth));
    if (style.dash === 'none') circle?.removeAttribute('stroke-dasharray');
    else circle?.setAttribute('stroke-dasharray', style.dash);
  }

  function update(nextStores: Store[], count: number): void {
    stores = nextStores;
    region.dataset['storeCount'] = String(count);
    region.dataset['motion'] = reducedMotion() ? 'reduced' : 'full';

    const wanted = new Set(nextStores.map((store) => store.id));
    for (const [storeId, marker] of markers) {
      if (!wanted.has(storeId)) {
        marker.remove();
        markers.delete(storeId);
        markerDots.delete(storeId);
        markerBadges.delete(storeId);
      }
    }
    for (const store of nextStores) {
      if (!markers.has(store.id)) {
        const marker = buildMarker(store);
        markers.set(store.id, marker);
        markerLayer.appendChild(marker);
      }
      paintMarker(store);
    }

    const tally = new Map<string, number>();
    for (const store of nextStores) {
      tally.set(store.display_state, (tally.get(store.display_state) ?? 0) + 1);
    }
    for (const [state, node] of legendCounts) {
      setFigure(node, 'legend-count', tally.get(state) ?? 0, wholeNumber);
    }

    draw();
  }

  /** The selection glide: quintic ease-out to the shop at zoom 6, then the panel opens. */
  function select(storeId: string, opener: HTMLElement | null): void {
    const store = stores.find((candidate) => candidate.id === storeId);
    if (!store) return;
    if (opener) openers.set(storeId, opener);
    stopDrift();
    if (glideFrame !== null) cancelAnimationFrame(glideFrame);

    if (reducedMotion()) {
      setViewport({ lon: store.lon, lat: store.lat, zoom: SELECTION_ZOOM });
      region.dataset['phase'] = 'settled';
      return;
    }

    const from = { ...viewport };
    const to = {
      lon: clamp(store.lon, MIN_LON, MAX_LON),
      lat: clamp(store.lat, MIN_LAT, MAX_LAT),
      zoom: SELECTION_ZOOM,
    };
    const startedAt = performance.now();
    region.dataset['phase'] = 'moving';
    const step = (nowMillis: number): void => {
      const progress = Math.min(1, (nowMillis - startedAt) / SELECTION_MILLIS);
      const eased = quinticEaseOut(progress);
      setViewport({
        lon: from.lon + (to.lon - from.lon) * eased,
        lat: from.lat + (to.lat - from.lat) * eased,
        zoom: from.zoom + (to.zoom - from.zoom) * eased,
      });
      if (progress < 1) {
        glideFrame = requestAnimationFrame(step);
      } else {
        glideFrame = null;
        region.dataset['phase'] = 'settled';
      }
    };
    glideFrame = requestAnimationFrame(step);
  }

  function stopDrift(): void {
    if (driftFrame !== null) cancelAnimationFrame(driftFrame);
    driftFrame = null;
  }

  /** After a release the map glides on, its speed halving every 0.24 seconds. */
  function startDrift(speedX: number, speedY: number): void {
    if (reducedMotion() || (Math.abs(speedX) < 0.5 && Math.abs(speedY) < 0.5)) {
      region.dataset['phase'] = 'settled';
      return;
    }
    region.dataset['phase'] = 'moving';
    let last = performance.now();
    let currentX = speedX;
    let currentY = speedY;
    const step = (nowMillis: number): void => {
      const elapsed = nowMillis - last;
      last = nowMillis;
      const decay = 0.5 ** (elapsed / DRAG_HALF_LIFE_MILLIS);
      const moveX = (currentX * elapsed) / 1000;
      const moveY = (currentY * elapsed) / 1000;
      currentX *= decay;
      currentY *= decay;
      setViewport({
        lon: viewport.lon - moveX / (DEGREES_PER_LON_PIXEL * viewport.zoom),
        lat: viewport.lat + moveY / (DEGREES_PER_LAT_PIXEL * viewport.zoom),
      });
      if (Math.hypot(currentX, currentY) < 0.5) {
        stopDrift();
        region.dataset['phase'] = 'settled';
        return;
      }
      driftFrame = requestAnimationFrame(step);
    };
    driftFrame = requestAnimationFrame(step);
  }

  let dragging = false;
  let lastPointer = { x: 0, y: 0, at: 0 };
  let velocity = { x: 0, y: 0 };

  on(region, 'pointerdown', (event) => {
    const pointer = event as PointerEvent;
    if ((pointer.target as HTMLElement).closest('button')) return;
    dragging = true;
    stopDrift();
    region.setPointerCapture?.(pointer.pointerId);
    lastPointer = { x: pointer.clientX, y: pointer.clientY, at: performance.now() };
    velocity = { x: 0, y: 0 };
    region.dataset['phase'] = 'dragging';
  });

  on(region, 'pointermove', (event) => {
    if (!dragging) return;
    const pointer = event as PointerEvent;
    const deltaX = pointer.clientX - lastPointer.x;
    const deltaY = pointer.clientY - lastPointer.y;
    const elapsed = Math.max(1, performance.now() - lastPointer.at);
    velocity = { x: (deltaX / elapsed) * 1000, y: (deltaY / elapsed) * 1000 };
    lastPointer = { x: pointer.clientX, y: pointer.clientY, at: performance.now() };
    setViewport({
      lon: viewport.lon - deltaX / (DEGREES_PER_LON_PIXEL * viewport.zoom),
      lat: viewport.lat + deltaY / (DEGREES_PER_LAT_PIXEL * viewport.zoom),
    });
  });

  const endDrag = (): void => {
    if (!dragging) return;
    dragging = false;
    startDrift(velocity.x, velocity.y);
  };
  on(region, 'pointerup', endDrag);
  on(region, 'pointercancel', endDrag);

  let pinchStart: { distance: number; zoom: number } | null = null;
  on(region, 'touchstart', (event) => {
    const touch = event as TouchEvent;
    if (touch.touches.length === 2) {
      const [first, second] = [touch.touches[0] as Touch, touch.touches[1] as Touch];
      pinchStart = {
        distance: Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY),
        zoom: viewport.zoom,
      };
    }
    event.preventDefault();
  });
  on(region, 'touchmove', (event) => {
    const touch = event as TouchEvent;
    event.preventDefault();
    if (touch.touches.length !== 2 || !pinchStart) return;
    const [first, second] = [touch.touches[0] as Touch, touch.touches[1] as Touch];
    const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
    setViewport({ zoom: pinchStart.zoom * (distance / pinchStart.distance) });
    region.dataset['phase'] = 'settled';
  });
  on(region, 'touchend', () => {
    pinchStart = null;
  });

  on(region, 'wheel', (event) => {
    const wheel = event as WheelEvent;
    wheel.preventDefault();
    setViewport({ zoom: viewport.zoom + (wheel.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP) });
    region.dataset['phase'] = 'settled';
  });

  on(zoomIn, 'click', () => {
    setViewport({ zoom: viewport.zoom + 1 });
    region.dataset['phase'] = 'settled';
  });
  on(zoomOut, 'click', () => {
    setViewport({ zoom: viewport.zoom - 1 });
    region.dataset['phase'] = 'settled';
  });

  on(region, 'keydown', (event) => {
    const key = (event as KeyboardEvent).key;
    const target = event.target as HTMLElement;
    const onMapControl =
      target === region || target.classList.contains('map-marker') || target.classList.contains('map-cluster');
    if (!onMapControl) return;

    const panLon = KEY_PAN_PIXELS / (DEGREES_PER_LON_PIXEL * viewport.zoom);
    const panLat = KEY_PAN_PIXELS / (DEGREES_PER_LAT_PIXEL * viewport.zoom);
    switch (key) {
      case 'ArrowRight':
        setViewport({ lon: viewport.lon + panLon });
        break;
      case 'ArrowLeft':
        setViewport({ lon: viewport.lon - panLon });
        break;
      case 'ArrowUp':
        setViewport({ lat: viewport.lat + panLat });
        break;
      case 'ArrowDown':
        setViewport({ lat: viewport.lat - panLat });
        break;
      case '+':
      case '=':
        setViewport({ zoom: viewport.zoom + 1 });
        break;
      case '-':
        setViewport({ zoom: viewport.zoom - 1 });
        break;
      default:
        return;
    }
    event.preventDefault();
    stopDrift();
    region.dataset['phase'] = 'settled';
  });

  void loadCoastline().then((loaded) => {
    rings = loaded;
    drawLand();
  });

  const resize = (): void => draw();
  window.addEventListener('resize', resize);

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motionChanged = (): void => {
    region.dataset['motion'] = reducedMotion() ? 'reduced' : 'full';
  };
  motionQuery.addEventListener('change', motionChanged);

  return {
    region,
    legend,
    update,
    select,
    setPanelOpen: (open) => {
      region.dataset['panel'] = open ? 'open' : 'closed';
      draw();
    },
    setReviewProgress: (progress) => {
      region.dataset['reviewProgress'] = progress.toFixed(3);
    },
    setBadges: (counts) => {
      for (const [storeId, badge] of markerBadges) {
        const value = counts.get(storeId) ?? 0;
        if (value <= 0) {
          badge.hidden = true;
          delete badge.dataset['value'];
          badge.textContent = '';
          continue;
        }
        badge.hidden = false;
        setFigure(badge, 'review-badge', value, wholeNumber);
      }
    },
    showArrival: (storeId) => {
      const marker = markers.get(storeId);
      if (!marker) return;
      marker.dataset['arrival'] = 'dropping';
      window.setTimeout(() => {
        marker.dataset['arrival'] = 'pulsing';
        window.setTimeout(() => {
          marker.dataset['arrival'] = 'none';
        }, ARRIVAL_PULSE_MILLIS);
      }, ARRIVAL_DROP_MILLIS);
    },
    markerOf: (storeId) => markers.get(storeId) ?? null,
    destroy: () => {
      stopDrift();
      if (glideFrame !== null) cancelAnimationFrame(glideFrame);
      for (const timer of clusterTimers) window.clearTimeout(timer);
      window.removeEventListener('resize', resize);
      motionQuery.removeEventListener('change', motionChanged);
    },
  };
}
