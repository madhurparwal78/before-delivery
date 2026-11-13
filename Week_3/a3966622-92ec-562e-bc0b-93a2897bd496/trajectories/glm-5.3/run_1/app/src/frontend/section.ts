// The Keel Section: a to-scale long section from boarding ground to berth,
// with the seabed line, the hull at draught plus squat, the water line at each
// waypoint's arrival height, and the Pinch marker.

import { clear, reducedMotion } from './dom.js';
import { marginMetres, mmToMetres, type Plan, type PlanWaypoint, type PortInfo } from './domain.js';

export interface SectionState {
  plan: Plan | null;
  hullProgress: number; // whole percent 0 to 100
  animated: boolean;
}

export const HULL_MS = 900;

// The vertical scale: the drawing runs from 0 to the deepest bed plus tide.
function verticalRange(plan: Plan, info: PortInfo): { minMm: number; maxMm: number } {
  let maxMm = 0;
  for (let i = 0; i < info.waypoints.length; i++) {
    const seed = info.waypoints[i]!;
    const wp = plan.waypoints[i];
    const water = seed.sounded_depth_mm + (wp ? wp.tide_mm : 0);
    maxMm = Math.max(maxMm, water);
  }
  const deepestBed = Math.max(...info.waypoints.map((w) => w.sounded_depth_mm));
  // Top of the drawing: the deepest water plus headroom for the hull.
  return { minMm: 0, maxMm: Math.max(maxMm, deepestBed + 2000, 12_000) };
}

export function renderSection(
  container: HTMLElement,
  info: PortInfo,
  plan: Plan,
  state: SectionState,
): void {
  clear(container);
  const range = verticalRange(plan, info);
  const routeNm = 23;
  const waypoints = info.waypoints;

  const svg = elNS('svg', {
    viewBox: `0 0 1000 320`,
    preserveAspectRatio: 'none',
    class: 'section-svg',
    'aria-hidden': 'true',
  });

  // Seabed: steps up at each controlling depth.
  let bedPath = `M 0 ${depthY(waypoints[0]!.sounded_depth_mm)}`;
  let cursorX = xOf(waypoints[0]!.distance_nm);
  bedPath += ` L ${cursorX} ${depthY(waypoints[0]!.sounded_depth_mm)}`;
  for (const wp of waypoints.slice(1)) {
    const x = xOf(wp.distance_nm);
    bedPath += ` L ${x} ${depthY(previousDepth(wp))}`;
    bedPath += ` L ${x} ${depthY(wp.sounded_depth_mm)}`;
    cursorX = x;
  }
  void cursorX;
  bedPath += ` L 1000 ${depthY(waypoints[waypoints.length - 1]!.sounded_depth_mm)}`;
  bedPath += ` L 1000 320 L 0 320 Z`;

  const waterHeights = plan.waypoints.map((wp, i) => waypoints[i]!.sounded_depth_mm + wp.tide_mm);
  let waterPath = `M 0 ${depthY(waterHeights[0]!)}`;
  for (let i = 0; i < waterHeights.length; i++) {
    const x = xOf(waypoints[i]!.distance_nm);
    waterPath += ` L ${x} ${depthY(waterHeights[i]!)}`;
  }
  waterPath += ` L 1000 ${depthY(waterHeights[waterHeights.length - 1]!)} L 1000 0 L 0 0 Z`;

  svg.append(elNS('path', { d: bedPath, class: 'seabed-fill' }));
  const waterLine = elNS('path', {
    d: waterPath,
    class: 'water-fill',
    'data-testid': 'water-line',
    'data-heights-mm': waterHeights.join(','),
  });
  svg.append(waterLine);
  svg.append(elNS('path', { d: bedPathWithoutClose(bedPath), class: 'seabed-line' }));

  // Hull at draught plus squat, standing visibly lower than the water line.
  const hullY = depthY(plan.draught_mm + maxSquat(plan));
  const hullX = (state.hullProgress / 100) * 940;
  const hull = elNS('path', {
    d: `M ${hullX} ${hullY} q 30 -18 60 0 l 0 46 L ${hullX} ${hullY + 46} Z`,
    class: 'hull',
    'data-testid': 'hull',
    'data-progress': String(state.hullProgress),
  });
  svg.append(hull);

  // Waypoint bars and numerals.
  for (let i = 0; i < waypoints.length; i++) {
    const seed = waypoints[i]!;
    const wp = plan.waypoints[i]!;
    const x = xOf(seed.distance_nm);
    const bar = elNS('rect', {
      x: String(x - 8), y: String(depthY(waterHeights[i]!)),
      width: '16', height: '10',
      class: wp.margin_mm < 0 ? 'wp-bar negative' : 'wp-bar',
      'data-testid': `bar-${seed.id}`,
    });
    svg.append(bar);
    svg.append(elNS('text', {
      x: String(x), y: '300', class: 'wp-name',
    }, seed.name));
    svg.append(elNS('text', {
      x: String(x), y: '285', class: 'wp-numeral num',
    }, `${mmToMetres(wp.clearance_mm)} m`));
    if (wp.pinch) {
      const marker = elNS('text', {
        x: String(x), y: String(Math.max(depthY(waterHeights[i]!) - 18, 24)),
        class: 'pinch-marker num',
      }, `Pinch ${marginMetres(wp.margin_mm)}`);
      svg.append(marker);
    }
    if (seed.speed_limit_kn !== null) {
      svg.append(elNS('text', {
        x: String((x + xOf(waypoints[i + 1 < waypoints.length ? i + 1 : i]!.distance_nm)) / 2),
        y: String(depthY(Math.max(seed.sounded_depth_mm, 0)) - 8),
        class: 'speed-limit num',
      }, `${seed.speed_limit_kn} kn`));
    }
  }

  // Gate ribbon.
  const gateOpen = plan.window_state === 'open';
  const ribbon = elNS('rect', {
    x: '0', y: '0', width: '1000', height: '10',
    class: gateOpen ? 'gate open' : 'gate closed',
    'data-testid': 'gate-ribbon',
    'data-state': gateOpen ? 'open' : 'closed',
  });
  if (!reducedMotion()) ribbon.setAttribute('class', `${gateOpen ? 'gate open' : 'gate closed'} ribbon-slide`);
  svg.append(ribbon);

  container.append(svg);

  function xOf(nm: number): number {
    return (nm / routeNm) * 1000;
  }
  function depthY(mm: number): number {
    const clamped = Math.min(Math.max(mm, range.minMm), range.maxMm);
    return 30 + ((range.maxMm - clamped) / (range.maxMm - range.minMm)) * 240;
  }
  function previousDepth(wp: PortInfo['waypoints'][number]): number {
    const index = waypoints.indexOf(wp);
    return waypoints[Math.max(0, index - 1)]!.sounded_depth_mm;
  }
  function bedPathWithoutClose(path: string): string {
    return path.replace(/ L 1000 320 L 0 320 Z$/, '');
  }
}

function maxSquat(plan: Plan): number {
  return Math.max(...plan.waypoints.map((w: PlanWaypoint) => w.squat_mm), 0);
}

function elNS(tag: string, attrs: Record<string, string>, ...children: (Node | string)[]): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value);
  }
  for (const child of children) {
    if (typeof child === 'string') node.append(document.createTextNode(child));
    else node.append(child);
  }
  return node;
}

// The hull travels once from boarding ground to berth after an accepted
// commit, in 0.7 to 1.1 seconds.
export function animateHull(
  container: HTMLElement,
  onSettled: (progress: number) => void,
): void {
  const hull = container.querySelector('[data-testid="hull"]');
  if (!hull) return;
  if (reducedMotion()) {
    onSettled(100);
    return;
  }
  const started = performance.now();
  const duration = HULL_MS;
  const tick = (now: number): void => {
    const t = Math.min(1, (now - started) / duration);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    hull.setAttribute('data-progress', String(Math.round(eased * 100)));
    if (t < 1) requestAnimationFrame(tick);
    else onSettled(100);
  };
  requestAnimationFrame(tick);
}
