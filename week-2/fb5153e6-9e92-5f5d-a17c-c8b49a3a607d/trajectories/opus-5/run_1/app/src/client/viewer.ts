import { announce, one, prefersReducedMotion, readState } from './dom.js';
import type { Locale } from '../shared/locale.js';
import { formatNumber, localeFromLang } from '../shared/locale.js';
import { hotspotAnnouncement } from '../shared/strings.js';
import type { Camera, Hotspot } from '../shared/viewer.js';
import {
  DRAG_PIXELS_PER_STEP,
  PINCH_PERCENT_PER_STEP,
  attrNum,
  azimuthForHotspot,
  cameraDistanceMm,
  cameraPosition,
  eyeHeightMm,
  initialHeading,
  projectHotspot,
  ringIndexPoint,
  ringRadius,
  round1,
  stepAzimuth,
  stepDistance,
  stepFov,
  stepHeading,
  stepPitch,
  stepTilt,
  stepsFromDrag,
} from '../shared/viewer.js';
import { readGlbMesh } from './glb.js';
import type { Mesh } from './glb.js';
import { createRenderer } from './renderer.js';
import type { Renderer } from './renderer.js';

interface ModelState {
  slug: string;
  locale: Locale;
  lang: string | null;
  camera: Camera;
  boundingRadiusMm: number;
  scaleDenominator: number;
  modelHeightMm: number;
  hotspots: Hotspot[];
  glbUrl: string;
  studio?: boolean;
}

const state = readState<ModelState>('model-state');
const root = one<HTMLElement>('[data-viewer-root]');
if (state !== null && root !== null) start(root, state);

const CAMERA_STEP_MS = 185;
const HOTSPOT_STEP_MS = 330;

function start(root: HTMLElement, state: ModelState): void {
  const locale: Locale = state.locale ?? localeFromLang(state.lang);
  const statusNode = one('[data-viewer-status]');
  const ring = one<SVGSVGElement>('[data-ring]', root);
  const defaults: Camera = { ...state.camera };

  let camera: Camera = { ...state.camera };
  let drawn: Camera = { ...state.camera };
  let activeHotspot: number | null = null;
  let firstPerson = false;
  let heading = initialHeading(camera.azimuth);
  let pitch = 0;
  let orbitBeforeFirstPerson: Camera = { ...camera };
  let renderer: Renderer | null = null;
  let mesh: Mesh | null = null;
  let placing = false;

  const canvasSize = (): { width: number; height: number } => ({
    width: Math.max(1, root.clientWidth),
    height: Math.max(1, root.clientHeight),
  });

  /* ---- published attributes, which hold end values at once ---- */

  function writeAttributes(): void {
    const { width, height } = canvasSize();
    if (firstPerson) {
      root.dataset.mode = 'first-person';
      root.dataset.heading = attrNum(heading);
      root.dataset.pitch = attrNum(pitch);
      root.dataset.eyeHeight = attrNum(eyeHeightMm(state.scaleDenominator));
      delete root.dataset.hotspotIndex;
      delete root.dataset.hotspotX;
      delete root.dataset.hotspotY;
    } else {
      root.dataset.mode = 'orbit';
      delete root.dataset.heading;
      delete root.dataset.pitch;
      delete root.dataset.eyeHeight;
      if (activeHotspot === null) {
        delete root.dataset.hotspotIndex;
        delete root.dataset.hotspotX;
        delete root.dataset.hotspotY;
      } else {
        const hotspot = state.hotspots[activeHotspot - 1];
        if (hotspot !== undefined) {
          const point = projectHotspot(
            { x: hotspot.x_mm, y: hotspot.y_mm, z: hotspot.z_mm },
            camera,
            state.boundingRadiusMm,
            width,
            height,
          );
          root.dataset.hotspotIndex = String(activeHotspot);
          root.dataset.hotspotX = attrNum(point.x);
          root.dataset.hotspotY = attrNum(point.y);
        }
      }
    }
    root.dataset.cameraDistance = attrNum(
      cameraDistanceMm(camera.distance, state.boundingRadiusMm),
    );
    root.dataset.fov = attrNum(camera.fov);
    root.dataset.tilt = attrNum(camera.tilt);
    root.dataset.azimuth = attrNum(camera.azimuth);
    root.dataset.distanceFactor = attrNum(camera.distance);
  }

  /* ---- the Survey Ring ---- */

  function drawRing(shown: Camera): void {
    if (ring === null) return;
    const { width, height } = canvasSize();
    ring.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const r = ringRadius(width, height);
    const cx = width / 2;
    const cy = height / 2;

    const circle = ring.querySelector('.ring-circle');
    circle?.setAttribute('cx', String(cx));
    circle?.setAttribute('cy', String(cy));
    circle?.setAttribute('r', r.toFixed(1));

    for (const tick of ring.querySelectorAll<SVGLineElement>('[data-azimuth-tick]')) {
      const degrees = Number(tick.dataset.azimuthTick ?? '0');
      const major = tick.classList.contains('ring-tick-major');
      const length = major ? 12 : 6;
      const a = (degrees * Math.PI) / 180;
      tick.setAttribute('x1', (cx + r * Math.sin(a)).toFixed(1));
      tick.setAttribute('y1', (cy - r * Math.cos(a)).toFixed(1));
      tick.setAttribute('x2', (cx + (r - length) * Math.sin(a)).toFixed(1));
      tick.setAttribute('y2', (cy - (r - length) * Math.cos(a)).toFixed(1));
    }
    const labels = ring.querySelectorAll<SVGTextElement>('.tick-label');
    let labelIndex = 0;
    for (const label of labels) {
      const degrees = labelIndex * 30;
      labelIndex += 1;
      const a = (degrees * Math.PI) / 180;
      label.setAttribute('x', (cx + (r - 24) * Math.sin(a)).toFixed(1));
      label.setAttribute('y', (cy - (r - 24) * Math.cos(a)).toFixed(1));
    }

    const hidden = firstPerson;
    for (const part of ['index-mark', 'tilt-marker', 'caliper', 'hotspot-dot']) {
      for (const node of ring.querySelectorAll<SVGElement>(`[data-part="${part}"]`)) {
        node.style.display = hidden ? 'none' : '';
      }
    }
    for (const node of ring.querySelectorAll<SVGElement>('.ring-circle, .ring-tick, .tilt-arc, .tick-label')) {
      node.style.display = hidden ? 'none' : '';
    }
    ring.setAttribute('aria-label', hidden ? headingStripLabel : surveyRingLabel);
    if (hidden) return;

    const index = ringIndexPoint(shown.azimuth, width, height);
    const mark = ring.querySelector<SVGLineElement>('[data-part="index-mark"]');
    if (mark !== null) {
      const a = (shown.azimuth * Math.PI) / 180;
      mark.dataset.angle = attrNum(camera.azimuth);
      mark.setAttribute('x1', (cx + (r - 16) * Math.sin(a)).toFixed(1));
      mark.setAttribute('y1', (cy - (r - 16) * Math.cos(a)).toFixed(1));
      mark.setAttribute('x2', String(index.x));
      mark.setAttribute('y2', String(index.y));
    }

    const marker = ring.querySelector<SVGLineElement>('[data-part="tilt-marker"]');
    if (marker !== null) {
      const fraction = (shown.tilt + 10) / 90;
      const x = cx + r + 10 + 6 * Math.sin(Math.PI * fraction);
      const y = cy + r * 0.62 - fraction * r * 1.24;
      marker.dataset.angle = attrNum(camera.tilt);
      marker.setAttribute('x1', (x - 7).toFixed(1));
      marker.setAttribute('y1', y.toFixed(1));
      marker.setAttribute('x2', (x + 7).toFixed(1));
      marker.setAttribute('y2', y.toFixed(1));
    }

    const arc = ring.querySelector<SVGPathElement>('.tilt-arc');
    if (arc !== null) {
      const at = (tilt: number): { x: number; y: number } => {
        const fraction = (tilt + 10) / 90;
        return {
          x: cx + r + 10 + 6 * Math.sin(Math.PI * fraction),
          y: cy + r * 0.62 - fraction * r * 1.24,
        };
      };
      const bottom = at(-10);
      const top = at(80);
      arc.setAttribute(
        'd',
        `M ${bottom.x.toFixed(1)} ${bottom.y.toFixed(1)} Q ${(cx + r + 22).toFixed(1)} ${cy.toFixed(1)} ${top.x.toFixed(1)} ${top.y.toFixed(1)}`,
      );
    }

    state.hotspots.forEach((hotspot, i) => {
      const dot = ring.querySelector<SVGCircleElement>(`[data-part="hotspot-dot"][data-index="${i + 1}"]`);
      if (dot === null) return;
      const point = projectHotspot(
        { x: hotspot.x_mm, y: hotspot.y_mm, z: hotspot.z_mm },
        shown,
        state.boundingRadiusMm,
        width,
        height,
      );
      dot.setAttribute('cx', String(point.x));
      dot.setAttribute('cy', String(point.y));
      dot.dataset.active = activeHotspot === i + 1 ? 'true' : 'false';
    });

    let caliper = ring.querySelector<SVGLineElement>('[data-part="caliper"]');
    if (activeHotspot === null) {
      caliper?.remove();
      return;
    }
    const hotspot = state.hotspots[activeHotspot - 1];
    if (hotspot === undefined) return;
    if (caliper === null) {
      caliper = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      caliper.setAttribute('class', 'caliper-line');
      caliper.dataset.part = 'caliper';
      ring.append(caliper);
    }
    const end = projectHotspot(
      { x: hotspot.x_mm, y: hotspot.y_mm, z: hotspot.z_mm },
      camera,
      state.boundingRadiusMm,
      canvasSize().width,
      canvasSize().height,
    );
    const shownEnd = projectHotspot(
      { x: hotspot.x_mm, y: hotspot.y_mm, z: hotspot.z_mm },
      shown,
      state.boundingRadiusMm,
      canvasSize().width,
      canvasSize().height,
    );
    const shownIndex = ringIndexPoint(shown.azimuth, width, height);
    const endIndex = ringIndexPoint(camera.azimuth, width, height);
    caliper.dataset.x1 = String(endIndex.x);
    caliper.dataset.y1 = String(endIndex.y);
    caliper.dataset.x2 = String(end.x);
    caliper.dataset.y2 = String(end.y);
    caliper.setAttribute('x1', String(shownIndex.x));
    caliper.setAttribute('y1', String(shownIndex.y));
    caliper.setAttribute('x2', String(shownEnd.x));
    caliper.setAttribute('y2', String(shownEnd.y));
  }

  const surveyRingLabel = ring?.getAttribute('aria-label') ?? 'Survey Ring';
  const headingStripLabel = locale === 'de' ? 'Kursleiste' : 'Heading strip';

  /* ---- the mono readout ---- */

  const readoutNodes = {
    distance: one('[data-readout="distance"]'),
    fov: one('[data-readout="fov"]'),
    tilt: one('[data-readout="tilt"]'),
    azimuth: one('[data-readout="azimuth"]'),
  };
  const readoutLabels = {
    distance: readoutNodes.distance?.textContent?.split(' ')[0] ?? 'Distance',
    fov: readoutNodes.fov?.textContent?.split(' ')[0] ?? 'FOV',
    tilt: readoutNodes.tilt?.textContent?.split(' ')[0] ?? 'Tilt',
    azimuth: readoutNodes.azimuth?.textContent?.split(' ')[0] ?? 'Azimuth',
  };

  function drawReadout(shown: Camera): void {
    const distance = cameraDistanceMm(shown.distance, state.boundingRadiusMm);
    if (readoutNodes.distance !== null) {
      readoutNodes.distance.textContent = `${readoutLabels.distance} ${formatNumber(round1(distance), locale)} mm`;
    }
    if (readoutNodes.fov !== null) {
      readoutNodes.fov.textContent = `${readoutLabels.fov} ${formatNumber(round1(shown.fov), locale)}°`;
    }
    if (readoutNodes.tilt !== null) {
      readoutNodes.tilt.textContent = `${readoutLabels.tilt} ${formatNumber(round1(shown.tilt), locale)}°`;
    }
    if (readoutNodes.azimuth !== null) {
      readoutNodes.azimuth.textContent = `${readoutLabels.azimuth} ${formatNumber(round1(shown.azimuth), locale)}°`;
    }
  }

  /* ---- drawing the scene ---- */

  function sceneEye(shown: Camera): { eye: [number, number, number]; target: [number, number, number] } {
    const centre = meshCentre();
    if (firstPerson) {
      const d = cameraDistanceMm(shown.distance, state.boundingRadiusMm) / 1000;
      const a = (shown.azimuth * Math.PI) / 180;
      const lowest = mesh?.min[1] ?? centre[1];
      const eyeHeight = eyeHeightMm(state.scaleDenominator) / 1000;
      const eye: [number, number, number] = [
        centre[0] + d * Math.sin(a),
        lowest + eyeHeight,
        centre[2] + d * Math.cos(a),
      ];
      const h = (heading * Math.PI) / 180;
      const p = (pitch * Math.PI) / 180;
      return {
        eye,
        target: [
          eye[0] + Math.cos(p) * Math.sin(h),
          eye[1] + Math.sin(p),
          eye[2] + Math.cos(p) * Math.cos(h),
        ],
      };
    }
    const position = cameraPosition(shown, state.boundingRadiusMm);
    return {
      eye: [centre[0] + position.x / 1000, centre[1] + position.y / 1000, centre[2] + position.z / 1000],
      target: [...centre],
    };
  }

  function meshCentre(): [number, number, number] {
    if (mesh === null) return [0, 0, 0];
    return [
      (mesh.min[0] + mesh.max[0]) / 2,
      (mesh.min[1] + mesh.max[1]) / 2,
      (mesh.min[2] + mesh.max[2]) / 2,
    ];
  }

  function paint(shown: Camera): void {
    drawn = { ...shown };
    drawRing(shown);
    drawReadout(shown);
    if (renderer !== null) {
      const { eye, target } = sceneEye(shown);
      renderer.draw(eye, target, shown.fov);
    }
  }

  /* ---- motion ---- */

  let animation = 0;

  function settle(durationMs: number): void {
    writeAttributes();
    window.cancelAnimationFrame(animation);
    if (prefersReducedMotion()) {
      root.dataset.animating = 'false';
      paint(camera);
      return;
    }
    const from = { ...drawn };
    const to = { ...camera };
    // Azimuth tweens the short way around the ring.
    let delta = to.azimuth - from.azimuth;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    const start = performance.now();
    root.dataset.animating = 'true';
    const frame = (now: number): void => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - t) * (1 - t) * (1 - t);
      paint({
        azimuth: (from.azimuth + delta * eased + 360) % 360,
        tilt: from.tilt + (to.tilt - from.tilt) * eased,
        distance: from.distance + (to.distance - from.distance) * eased,
        fov: from.fov + (to.fov - from.fov) * eased,
      });
      if (t < 1) animation = window.requestAnimationFrame(frame);
      else {
        root.dataset.animating = 'false';
        paint(to);
      }
    };
    animation = window.requestAnimationFrame(frame);
  }

  /* ---- hotspots ---- */

  function selectHotspot(index: number | null): void {
    activeHotspot = index;
    if (index !== null) {
      const hotspot = state.hotspots[index - 1];
      if (hotspot !== undefined) {
        camera = {
          ...camera,
          azimuth: azimuthForHotspot({ x: hotspot.x_mm, y: hotspot.y_mm, z: hotspot.z_mm }),
        };
        announce(
          statusNode,
          hotspotAnnouncement(index, state.hotspots.length, hotspot.label, locale),
        );
      }
    }
    settle(HOTSPOT_STEP_MS);
  }

  function stepHotspot(direction: 1 | -1): void {
    const total = state.hotspots.length;
    if (total === 0) return;
    const current = activeHotspot ?? (direction === 1 ? 0 : 1);
    let next = current + direction;
    if (next > total) next = 1;
    if (next < 1) next = total;
    selectHotspot(next);
  }

  function resetView(): void {
    camera = { ...defaults };
    activeHotspot = null;
    firstPerson = false;
    heading = initialHeading(camera.azimuth);
    pitch = 0;
    updateFirstPersonButton();
    settle(HOTSPOT_STEP_MS);
  }

  function toggleFirstPerson(on: boolean): void {
    if (on === firstPerson) return;
    firstPerson = on;
    if (on) {
      orbitBeforeFirstPerson = { ...camera };
      heading = initialHeading(camera.azimuth);
      pitch = 0;
      activeHotspot = null;
    } else {
      camera = { ...orbitBeforeFirstPerson };
    }
    updateFirstPersonButton();
    settle(HOTSPOT_STEP_MS);
  }

  function updateFirstPersonButton(): void {
    one<HTMLButtonElement>('[data-viewer-action="first-person"]')?.setAttribute(
      'aria-pressed',
      String(firstPerson),
    );
  }

  /* ---- input ---- */

  function orbitStep(change: Partial<Camera>): void {
    camera = { ...camera, ...change };
    settle(CAMERA_STEP_MS);
  }

  /** The keys act on the viewer root and on any of its controls. */
  function keysApplyTo(target: HTMLElement | null): boolean {
    if (target === null || target === document.body) return true;
    if (target === root || root.contains(target)) return true;
    return target.closest('[data-viewer-action]') !== null;
  }

  function handleKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (target !== null && target.isContentEditable) return;
    if (!keysApplyTo(target)) return;

    if (firstPerson) {
      switch (event.key) {
        case 'ArrowRight':
          heading = stepHeading(heading, 1);
          break;
        case 'ArrowLeft':
          heading = stepHeading(heading, -1);
          break;
        case 'ArrowUp':
          pitch = stepPitch(pitch, 1);
          break;
        case 'ArrowDown':
          pitch = stepPitch(pitch, -1);
          break;
        case 'Escape':
          toggleFirstPerson(false);
          event.preventDefault();
          return;
        case 'f':
        case 'F':
          toggleFirstPerson(false);
          event.preventDefault();
          return;
        default:
          return;
      }
      event.preventDefault();
      settle(CAMERA_STEP_MS);
      return;
    }

    switch (event.key) {
      case 'ArrowRight':
        orbitStep({ azimuth: stepAzimuth(camera.azimuth, 1) });
        break;
      case 'ArrowLeft':
        orbitStep({ azimuth: stepAzimuth(camera.azimuth, -1) });
        break;
      case 'ArrowUp':
        orbitStep({ tilt: stepTilt(camera.tilt, 1) });
        break;
      case 'ArrowDown':
        orbitStep({ tilt: stepTilt(camera.tilt, -1) });
        break;
      case '+':
      case '=':
        orbitStep({ distance: stepDistance(camera.distance, -1) });
        break;
      case '-':
        orbitStep({ distance: stepDistance(camera.distance, 1) });
        break;
      case ']':
        orbitStep({ fov: stepFov(camera.fov, 1) });
        break;
      case '[':
        orbitStep({ fov: stepFov(camera.fov, -1) });
        break;
      case 'h':
        stepHotspot(1);
        break;
      case 'H':
        stepHotspot(event.shiftKey ? -1 : 1);
        break;
      case 'f':
      case 'F':
        toggleFirstPerson(true);
        break;
      case '0':
        resetView();
        break;
      case 'Enter':
        if (placing) placeHotspotAtCentre();
        else return;
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  document.addEventListener('keydown', handleKey);

  one<HTMLButtonElement>('[data-viewer-action="previous-hotspot"]')?.addEventListener('click', () =>
    stepHotspot(-1),
  );
  one<HTMLButtonElement>('[data-viewer-action="next-hotspot"]')?.addEventListener('click', () =>
    stepHotspot(1),
  );
  one<HTMLButtonElement>('[data-viewer-action="first-person"]')?.addEventListener('click', () =>
    toggleFirstPerson(!firstPerson),
  );
  one<HTMLButtonElement>('[data-viewer-action="reset"]')?.addEventListener('click', resetView);

  /* Drag: one step for every whole 24 pixels of travel, accumulated. */
  let dragging = false;
  let dragX = 0;
  let dragY = 0;
  let travelX = 0;
  let travelY = 0;

  function beginDrag(x: number, y: number): void {
    dragging = true;
    dragX = x;
    dragY = y;
    travelX = 0;
    travelY = 0;
  }

  function moveDrag(x: number, y: number): void {
    if (!dragging) return;
    travelX += x - dragX;
    travelY += y - dragY;
    dragX = x;
    dragY = y;
    const stepsX = stepsFromDrag(travelX);
    const stepsY = stepsFromDrag(travelY);
    if (stepsX === 0 && stepsY === 0) return;
    travelX -= stepsX * DRAG_PIXELS_PER_STEP;
    travelY -= stepsY * DRAG_PIXELS_PER_STEP;
    if (firstPerson) {
      if (stepsX !== 0) heading = stepHeading(heading, stepsX);
      if (stepsY !== 0) pitch = stepPitch(pitch, -stepsY);
    } else {
      const next = { ...camera };
      if (stepsX !== 0) next.azimuth = stepAzimuth(next.azimuth, stepsX);
      // Dragging up adds tilt.
      if (stepsY !== 0) next.tilt = stepTilt(next.tilt, -stepsY);
      camera = next;
    }
    settle(CAMERA_STEP_MS);
  }

  root.addEventListener('pointerdown', (event) => {
    if (placing) return;
    root.setPointerCapture(event.pointerId);
    beginDrag(event.clientX, event.clientY);
  });
  root.addEventListener('pointermove', (event) => moveDrag(event.clientX, event.clientY));
  const endDrag = (): void => {
    dragging = false;
  };
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);

  root.addEventListener(
    'wheel',
    (event) => {
      if (firstPerson) return;
      event.preventDefault();
      // Scrolling up moves closer, scrolling down moves away.
      orbitStep({ distance: stepDistance(camera.distance, event.deltaY > 0 ? 1 : -1) });
    },
    { passive: false },
  );

  /* Pinch: one step for every whole 10 percent change in finger spread. */
  const touches = new Map<number, { x: number; y: number }>();
  let pinchBase: number | null = null;

  root.addEventListener('touchstart', (event) => {
    for (const touch of event.changedTouches) {
      touches.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
    }
    if (touches.size === 2) pinchBase = spread();
  });

  function spread(): number {
    const points = [...touches.values()];
    const a = points[0];
    const b = points[1];
    if (a === undefined || b === undefined) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  root.addEventListener(
    'touchmove',
    (event) => {
      for (const touch of event.changedTouches) {
        touches.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
      }
      if (touches.size !== 2 || pinchBase === null || pinchBase === 0) return;
      event.preventDefault();
      const now = spread();
      const change = ((now - pinchBase) / pinchBase) * 100;
      const steps = Math.trunc(change / PINCH_PERCENT_PER_STEP);
      if (steps === 0) return;
      pinchBase = now;
      // Spreading the fingers apart moves closer.
      orbitStep({ distance: stepDistance(camera.distance, -steps) });
    },
    { passive: false },
  );

  const dropTouch = (event: TouchEvent): void => {
    for (const touch of event.changedTouches) touches.delete(touch.identifier);
    if (touches.size < 2) pinchBase = null;
  };
  root.addEventListener('touchend', dropTouch);
  root.addEventListener('touchcancel', dropTouch);

  /* ---- studio hotspot placing ---- */

  function placeHotspotAtCentre(): void {
    const hit = raycast(0.5, 0.5);
    if (hit !== null) addHotspot(hit);
  }

  function raycast(u: number, v: number): [number, number, number] | null {
    if (mesh === null) return null;
    const { eye, target } = sceneEye(camera);
    const forward: [number, number, number] = [
      target[0] - eye[0],
      target[1] - eye[1],
      target[2] - eye[2],
    ];
    const fl = Math.hypot(...forward) || 1;
    const f: [number, number, number] = [forward[0] / fl, forward[1] / fl, forward[2] / fl];
    const rl = Math.hypot(f[2], f[0]) || 1;
    const right: [number, number, number] = [-f[2] / rl, 0, f[0] / rl];
    const up: [number, number, number] = [
      right[1] * f[2] - right[2] * f[1],
      right[2] * f[0] - right[0] * f[2],
      right[0] * f[1] - right[1] * f[0],
    ];
    const { width, height } = canvasSize();
    const halfFov = Math.tan((camera.fov * Math.PI) / 360);
    const ndcX = (u * 2 - 1) * halfFov * (width / height);
    const ndcY = (1 - v * 2) * halfFov;
    const direction: [number, number, number] = [
      f[0] + right[0] * ndcX + up[0] * ndcY,
      f[1] + right[1] * ndcX + up[1] * ndcY,
      f[2] + right[2] * ndcX + up[2] * ndcY,
    ];

    let nearest: number | null = null;
    const positions = mesh.positions;
    for (let i = 0; i + 8 < positions.length; i += 9) {
      const t = intersect(eye, direction, positions, i);
      if (t !== null && (nearest === null || t < nearest)) nearest = t;
    }
    if (nearest === null) return null;
    return [
      eye[0] + direction[0] * nearest,
      eye[1] + direction[1] * nearest,
      eye[2] + direction[2] * nearest,
    ];
  }

  function intersect(
    origin: readonly [number, number, number],
    direction: readonly [number, number, number],
    positions: Float32Array,
    base: number,
  ): number | null {
    const ax = positions[base] ?? 0;
    const ay = positions[base + 1] ?? 0;
    const az = positions[base + 2] ?? 0;
    const e1x = (positions[base + 3] ?? 0) - ax;
    const e1y = (positions[base + 4] ?? 0) - ay;
    const e1z = (positions[base + 5] ?? 0) - az;
    const e2x = (positions[base + 6] ?? 0) - ax;
    const e2y = (positions[base + 7] ?? 0) - ay;
    const e2z = (positions[base + 8] ?? 0) - az;
    const px = direction[1] * e2z - direction[2] * e2y;
    const py = direction[2] * e2x - direction[0] * e2z;
    const pz = direction[0] * e2y - direction[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) return null;
    const inv = 1 / det;
    const tx = origin[0] - ax;
    const ty = origin[1] - ay;
    const tz = origin[2] - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) return null;
    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = (direction[0] * qx + direction[1] * qy + direction[2] * qz) * inv;
    if (v < 0 || u + v > 1) return null;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return t > 1e-6 ? t : null;
  }

  function addHotspot(point: readonly [number, number, number]): void {
    const centre = meshCentre();
    state.hotspots.push({
      label: '',
      x_mm: round1((point[0] - centre[0]) * 1000),
      y_mm: round1((point[1] - centre[1]) * 1000),
      z_mm: round1((point[2] - centre[2]) * 1000),
    });
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('class', 'hotspot-dot');
    dot.setAttribute('r', '5');
    dot.dataset.part = 'hotspot-dot';
    dot.dataset.index = String(state.hotspots.length);
    dot.dataset.active = 'false';
    ring?.append(dot);
    placing = false;
    root.dataset.placing = 'false';
    paint(camera);
    one<HTMLInputElement>('[data-hotspot-label]')?.focus();
  }

  root.addEventListener('click', (event) => {
    if (!placing) return;
    const rect = root.getBoundingClientRect();
    const hit = raycast(
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
    );
    if (hit !== null) addHotspot(hit);
  });

  /* ---- loading ---- */

  async function load(): Promise<void> {
    const response = await fetch(state.glbUrl, { credentials: 'same-origin' });
    if (!response.ok) return;
    mesh = readGlbMesh(await response.arrayBuffer());
    const canvas = document.createElement('canvas');
    canvas.className = 'viewer-canvas';
    const created = createRenderer(canvas, mesh);
    if (created === null) return;
    root.prepend(canvas);
    renderer = created;
    root.dataset.render = 'webgl';
    paint(camera);
  }

  writeAttributes();
  paint(camera);
  updateFirstPersonButton();
  window.addEventListener('resize', () => {
    writeAttributes();
    paint(camera);
  });
  void load();

  Object.defineProperty(window, 'turnstoneViewer', {
    value: {
      camera: (): Camera => camera,
      hotspots: (): Hotspot[] => state.hotspots,
      beginPlacing: (): void => {
        placing = true;
        root.dataset.placing = 'true';
      },
      labelLast: (label: string): void => {
        const last = state.hotspots[state.hotspots.length - 1];
        if (last !== undefined) state.hotspots[state.hotspots.length - 1] = { ...last, label };
      },
    },
    configurable: true,
  });
}
