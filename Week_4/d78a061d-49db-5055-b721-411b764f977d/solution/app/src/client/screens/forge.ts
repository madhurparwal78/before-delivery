import { ApiFailure, api } from '../api.js';
import { el, prefersReducedMotion } from '../dom.js';
import { HeroPreview } from '../scene/preview.js';
import { DEFAULT_LOOK, lookFrom, withPending, type AppContext, type Screen } from './shared.js';
import { fmtCount, fmtFixed } from '../../shared/i18n/index.js';
import {
  DRAWING_PLANE_CSS_PX,
  MAX_POINTS,
  MAX_VERTICES,
  THICKNESS_MAX,
  THICKNESS_MIN,
} from '../../shared/constants.js';
import { isInsidePlane, planeMetresToPixels, planePixelsToMetres } from '../../shared/plane.js';
import type { Character, PreviewResult, Stats, Stroke, Weapon } from '../../shared/types.js';

const POINT_GAP_METRES = 0.02;
const CURSOR_STEP_METRES = 0.05;
const ZERO_STATS: Stats = { reach_m: 0, weight_kg: 0, swing_per_s: 0 };
const STAT_COUNT_MS = 300;

type LiftPhase = 'idle' | 'inflating' | 'flying' | 'catching' | 'crossfading' | 'socketed';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function renderForge(ctx: AppContext, host: HTMLElement): Promise<Screen> {
  const { characters } = await api.get<{ characters: Character[] }>('/api/characters');
  const hero = characters.find((entry) => entry.equipped) ?? characters[0] ?? null;

  const preview = new HeroPreview({ label: ctx.t('app.heroPreview'), turntable: false });
  preview.setHero(hero === null ? DEFAULT_LOOK : lookFrom(hero));

  const strokes: Stroke[] = [];
  let inProgress: [number, number][] = [];
  let thickness = 0.04;
  let drawingRevision = 0;
  let latestSent = 0;
  let cursor = { x: 0, y: 0 };
  let announcedOverStrokes = false;
  let announcedOverVertices = false;
  let equippedWeaponId = hero?.weapon_id ?? '';

  const canvas = el('canvas', { class: 'plane-canvas' }) as HTMLCanvasElement;
  const cursorMarker = el('div', { class: 'plane-cursor' });
  const plane = el(
    'div',
    {
      class: 'drawing-plane',
      role: 'application',
      'aria-label': ctx.t('app.drawingPlane'),
      tabindex: '0',
      'data-cursor-x': '0.00',
      'data-cursor-y': '0.00',
      'data-stroke-points': '0',
      'data-strokes': '0',
      'data-lift': 'idle',
      'data-tube-radius': '0.000',
      'data-plane-yaw': '0',
      'data-plane-opacity': '1.00',
      'data-arc-height': '0.00',
      'data-grip-gap': '0.000',
      'data-equipped-weapon': equippedWeaponId,
    },
    [canvas, cursorMarker],
  );

  const statsList = el('dl', { class: 'stats' });
  const statsRegion = el('section', { class: 'stats-region', 'aria-label': ctx.t('region.weaponStats') }, [
    statsList,
  ]);
  const reachValue = el('dd');
  const weightValue = el('dd');
  const swingValue = el('dd');
  statsList.append(
    el('dt', { text: ctx.t('stat.reach') }),
    reachValue,
    el('dt', { text: ctx.t('stat.weight') }),
    weightValue,
    el('dt', { text: ctx.t('stat.swing') }),
    swingValue,
  );

  const meterText = el('span', { class: 'meter-text' });
  const meter = el('div', {
    class: 'meter',
    role: 'meter',
    'aria-label': ctx.t('meter.vertexBudget'),
    'aria-valuemin': '0',
    'aria-valuemax': String(MAX_VERTICES),
    'aria-valuenow': '0',
  }, [meterText]);
  const overVertexMarker = el('p', { class: 'marker over-limit', text: ctx.t('marker.overVertex') });
  const overStrokesMarker = el('p', {
    class: 'marker over-limit',
    text: ctx.t('marker.tooManyStrokes'),
  });
  const markers = el('div', { class: 'markers' });

  const forgeStats = el('div', {
    class: 'live-region',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': ctx.t('status.forgeStats'),
  });

  const thicknessSlider = el('input', {
    type: 'range',
    min: String(THICKNESS_MIN),
    max: String(THICKNESS_MAX),
    step: '0.01',
    value: '0.04',
    'aria-label': ctx.t('slider.strokeThickness'),
  }) as HTMLInputElement;
  const thicknessValue = el('span', { class: 'slider-value' });

  const undoStroke = el('button', { type: 'button', class: 'button' }, [
    ctx.t('btn.undoStroke'),
  ]) as HTMLButtonElement;
  const clearPlane = el('button', { type: 'button', class: 'button' }, [
    ctx.t('btn.clearPlane'),
  ]) as HTMLButtonElement;
  const forgeButton = el('button', { type: 'button', class: 'button primary' }, [
    ctx.t('btn.forge'),
  ]) as HTMLButtonElement;

  const inspector = el('div', { class: 'paper-card inspector' }, [
    el('label', { class: 'field slider-field' }, [
      el('span', { text: ctx.t('slider.strokeThickness') }),
      thicknessSlider,
      thicknessValue,
    ]),
    statsRegion,
    meter,
    markers,
    el('div', { class: 'inspector-actions' }, [undoStroke, clearPlane, forgeButton]),
    forgeStats,
  ]);

  host.append(
    el('div', { class: 'forge-layout' }, [
      el('div', { class: 'scene-pane' }, [
        preview.element,
        preview.webglAvailable ? null : el('p', { class: 'notice', text: ctx.t('scene.noWebgl') }),
      ]),
      el('div', { class: 'plane-pane' }, [plane]),
      inspector,
    ]),
  );

  // --- drawing ---------------------------------------------------------------
  const setPhase = (phase: LiftPhase): void => {
    plane.dataset.lift = phase;
  };

  const redraw = (tubeRadius: number): void => {
    const ratio = Math.min(window.devicePixelRatio, 2);
    canvas.width = DRAWING_PLANE_CSS_PX * ratio;
    canvas.height = DRAWING_PLANE_CSS_PX * ratio;
    const context = canvas.getContext('2d');
    if (context === null) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, DRAWING_PLANE_CSS_PX, DRAWING_PLANE_CSS_PX);
    context.lineCap = 'round';
    context.lineJoin = 'round';

    const drawStroke = (stroke: Stroke, radius: number): void => {
      const pixels = stroke.points.map(([x, y]) => planeMetresToPixels(x, y));
      if (pixels.length === 0) return;
      const widthPx = Math.max(1, radius * 2 * (DRAWING_PLANE_CSS_PX / 2));
      context.beginPath();
      context.moveTo(pixels[0].cssX, pixels[0].cssY);
      for (const point of pixels.slice(1)) context.lineTo(point.cssX, point.cssY);
      context.strokeStyle = '#1d1d1f';
      context.lineWidth = widthPx + 3;
      context.stroke();
      context.strokeStyle = '#55585e';
      context.lineWidth = widthPx;
      context.stroke();
    };

    strokes.forEach((stroke, index) => {
      const radius =
        index === strokes.length - 1 ? tubeRadius : stroke.thickness / 2;
      drawStroke(stroke, radius);
    });
    if (inProgress.length > 0) {
      drawStroke({ thickness, points: inProgress }, 0.002);
    }
  };

  const showCursor = (): void => {
    plane.dataset.cursorX = cursor.x.toFixed(2);
    plane.dataset.cursorY = cursor.y.toFixed(2);
    const { cssX, cssY } = planeMetresToPixels(cursor.x, cursor.y);
    cursorMarker.style.left = `${cssX}px`;
    cursorMarker.style.top = `${cssY}px`;
  };

  const showCounts = (): void => {
    plane.dataset.strokePoints = String(inProgress.length);
    plane.dataset.strokes = String(strokes.length);
    undoStroke.disabled = strokes.length === 0;
  };

  let shownStats: Stats = ZERO_STATS;
  let countFrame = 0;
  const showStats = (stats: Stats): void => {
    reachValue.textContent = ctx.t('stat.reachValue', { v: fmtFixed(ctx.locale, stats.reach_m, 2) });
    weightValue.textContent = ctx.t('stat.weightValue', { v: fmtFixed(ctx.locale, stats.weight_kg, 2) });
    swingValue.textContent = ctx.t('stat.swingValue', { v: fmtFixed(ctx.locale, stats.swing_per_s, 2) });
  };
  /** The numerals count from their old values to the server's over the inflate span. */
  const countStatsTo = (target: Stats): void => {
    cancelAnimationFrame(countFrame);
    const from = shownStats;
    shownStats = target;
    if (prefersReducedMotion()) {
      showStats(target);
      return;
    }
    const start = performance.now();
    const step = (): void => {
      const ratio = Math.min(1, (performance.now() - start) / STAT_COUNT_MS);
      const eased = 1 - (1 - ratio) ** 3;
      const mix = (a: number, b: number): number => (ratio === 1 ? b : a + (b - a) * eased);
      showStats({
        reach_m: mix(from.reach_m, target.reach_m),
        weight_kg: mix(from.weight_kg, target.weight_kg),
        swing_per_s: mix(from.swing_per_s, target.swing_per_s),
      });
      if (ratio < 1) countFrame = requestAnimationFrame(step);
    };
    step();
  };

  const applyPreview = (result: PreviewResult): void => {
    countStatsTo(result.stats);
    meter.setAttribute('aria-valuenow', String(result.vertices));
    meterText.textContent = ctx.t('meter.vertexText', {
      used: fmtCount(ctx.locale, result.vertices),
      limit: fmtCount(ctx.locale, MAX_VERTICES),
    });
    markers.replaceChildren(
      ...(result.over.includes('vertices') ? [overVertexMarker] : []),
      ...(result.over.includes('strokes') ? [overStrokesMarker] : []),
    );
    forgeButton.disabled = result.strokes === 0 || !result.within_limits;

    forgeStats.textContent = ctx.t('fb.forgeStats', {
      reach: fmtFixed(ctx.locale, result.stats.reach_m, 2),
      weight: fmtFixed(ctx.locale, result.stats.weight_kg, 2),
      swing: fmtFixed(ctx.locale, result.stats.swing_per_s, 2),
      used: fmtCount(ctx.locale, result.vertices),
      limit: fmtCount(ctx.locale, MAX_VERTICES),
    });

    if (result.over.includes('vertices') && !announcedOverVertices) {
      announcedOverVertices = true;
      ctx.announce(ctx.t('fb.vertexLimit', { limit: MAX_VERTICES }));
    }
    if (!result.over.includes('vertices')) announcedOverVertices = false;
    if (result.over.includes('strokes') && !announcedOverStrokes) {
      announcedOverStrokes = true;
      ctx.announce(ctx.t('fb.strokeCount'));
    }
    if (!result.over.includes('strokes')) announcedOverStrokes = false;
  };

  /** Only the newest drawing's answer updates the stats, meter, markers and announcement. */
  const requestPreview = (): void => {
    // Forge waits for the newest drawing's answer.
    forgeButton.disabled = true;
    drawingRevision += 1;
    const revision = drawingRevision;
    latestSent = revision;
    void (async () => {
      try {
        const result = await api.post<PreviewResult>('/api/weapons/preview', {
          strokes,
          drawing_revision: revision,
        });
        if (result.drawing_revision !== latestSent) return;
        applyPreview(result);
      } catch (failure) {
        if (failure instanceof ApiFailure) {
          ctx.announce(
            failure.fieldMessage('strokes') ??
              failure.fieldMessage('thickness') ??
              failure.localisedMessage,
          );
        }
      }
    })();
  };

  const inflate = async (): Promise<void> => {
    const target = thickness / 2;
    if (prefersReducedMotion()) {
      plane.dataset.tubeRadius = target.toFixed(3);
      redraw(target);
      setPhase('idle');
      return;
    }
    setPhase('inflating');
    const duration = 320;
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const step = (): void => {
        const ratio = Math.min(1, (performance.now() - start) / duration);
        const eased = 1 - (1 - ratio) ** 3;
        const radius = target * eased;
        plane.dataset.tubeRadius = radius.toFixed(3);
        redraw(radius);
        if (ratio < 1) {
          requestAnimationFrame(step);
          return;
        }
        resolve();
      };
      requestAnimationFrame(step);
    });
    plane.dataset.tubeRadius = target.toFixed(3);
    setPhase('idle');
  };

  const commitStroke = (): void => {
    if (inProgress.length < 2) {
      inProgress = [];
      showCounts();
      redraw(Number(plane.dataset.tubeRadius ?? '0'));
      ctx.announce(ctx.t('fb.strokeShape'));
      return;
    }
    strokes.push({ thickness, points: inProgress });
    inProgress = [];
    showCounts();
    void inflate();
    requestPreview();
  };

  const addPoint = (x: number, y: number): void => {
    if (!isInsidePlane(x, y)) return;
    if (inProgress.length >= MAX_POINTS) return;
    const last = inProgress[inProgress.length - 1];
    if (last !== undefined && Math.hypot(x - last[0], y - last[1]) < POINT_GAP_METRES) return;
    inProgress.push([x, y]);
    showCounts();
    redraw(Number(plane.dataset.tubeRadius ?? '0'));
  };

  const pointFromEvent = (event: PointerEvent): { x: number; y: number } => {
    const rect = plane.getBoundingClientRect();
    return planePixelsToMetres(event.clientX - rect.left, event.clientY - rect.top);
  };

  let drawingPointer: number | null = null;

  plane.addEventListener('pointerdown', (event) => {
    if (plane.dataset.lift === 'socketed') return;
    if (drawingPointer !== null) {
      inProgress = [];
      showCounts();
      redraw(Number(plane.dataset.tubeRadius ?? '0'));
      drawingPointer = null;
      return;
    }
    drawingPointer = event.pointerId;
    plane.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    inProgress = [];
    addPoint(point.x, point.y);
  });

  plane.addEventListener('pointermove', (event) => {
    if (drawingPointer !== event.pointerId) return;
    const point = pointFromEvent(event);
    addPoint(point.x, point.y);
  });

  const endPointer = (event: PointerEvent): void => {
    if (drawingPointer !== event.pointerId) return;
    drawingPointer = null;
    commitStroke();
  };
  plane.addEventListener('pointerup', endPointer);
  plane.addEventListener('pointercancel', (event) => {
    if (drawingPointer !== event.pointerId) return;
    drawingPointer = null;
    inProgress = [];
    showCounts();
  });

  plane.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length > 1) {
        inProgress = [];
        drawingPointer = null;
        showCounts();
        redraw(Number(plane.dataset.tubeRadius ?? '0'));
      }
      event.preventDefault();
    },
    { passive: false },
  );

  plane.addEventListener('keydown', (event) => {
    const moves: Record<string, [number, number]> = {
      ArrowUp: [0, CURSOR_STEP_METRES],
      ArrowDown: [0, -CURSOR_STEP_METRES],
      ArrowRight: [CURSOR_STEP_METRES, 0],
      ArrowLeft: [-CURSOR_STEP_METRES, 0],
    };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      cursor = {
        x: Math.min(1, Math.max(-1, Number((cursor.x + move[0]).toFixed(2)))),
        y: Math.min(1, Math.max(-1, Number((cursor.y + move[1]).toFixed(2)))),
      };
      showCursor();
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      addPoint(cursor.x, cursor.y);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      commitStroke();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      inProgress = [];
      showCounts();
      redraw(Number(plane.dataset.tubeRadius ?? '0'));
    }
  });

  thicknessSlider.addEventListener('input', () => {
    thickness = Number(thicknessSlider.value);
    thicknessValue.textContent = fmtFixed(ctx.locale, thickness, 2);
  });
  thicknessValue.textContent = fmtFixed(ctx.locale, thickness, 2);

  undoStroke.addEventListener('click', () => {
    strokes.pop();
    showCounts();
    plane.dataset.tubeRadius = strokes.length === 0 ? '0.000' : (thickness / 2).toFixed(3);
    redraw(strokes.length === 0 ? 0 : thickness / 2);
    requestPreview();
  });

  clearPlane.addEventListener('click', () => {
    strokes.length = 0;
    inProgress = [];
    showCounts();
    plane.dataset.tubeRadius = '0.000';
    plane.dataset.planeYaw = '0';
    plane.dataset.planeOpacity = '1.00';
    plane.dataset.arcHeight = '0.00';
    plane.style.transform = '';
    plane.style.opacity = '1';
    plane.style.pointerEvents = '';
    setPhase('idle');
    redraw(0);
    requestPreview();
  });

  // --- the ink-to-steel lift -------------------------------------------------
  /**
   * The drawn weapon's ink leaves the plane's centre and travels along a curved arc to the hero's
   * posed right hand, grip first. Arc height and grip gap are measured on that path in plane metres.
   */
  const startFlight = (
    weaponStrokes: readonly Stroke[],
  ): { at(ratio: number): { arcMetres: number; gapMetres: number }; land(): void } => {
    const metresPerPx = 2 / DRAWING_PLANE_CSS_PX;
    const planeBox = plane.getBoundingClientRect();
    const from = { x: planeBox.left + planeBox.width / 2, y: planeBox.top + planeBox.height / 2 };
    const handOnScreen = (): { x: number; y: number } => {
      const box = preview.element.getBoundingClientRect();
      const [hx, hy] = (preview.element.dataset.handPx ?? '0,0').split(',').map(Number);
      return { x: box.left + hx, y: box.top + hy };
    };
    const to = handOnScreen();
    const lift = Math.max(80, Math.hypot(to.x - from.x, to.y - from.y) * 0.45);
    const control = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - lift };

    const flyer = el('canvas', { class: 'weapon-flyer', 'aria-hidden': 'true' }) as HTMLCanvasElement;
    const scale = 0.5;
    flyer.width = DRAWING_PLANE_CSS_PX;
    flyer.height = DRAWING_PLANE_CSS_PX;
    flyer.style.width = `${DRAWING_PLANE_CSS_PX * scale}px`;
    flyer.style.height = `${DRAWING_PLANE_CSS_PX * scale}px`;
    flyer.getContext('2d')?.drawImage(canvas, 0, 0, DRAWING_PLANE_CSS_PX, DRAWING_PLANE_CSS_PX);
    const grip = weaponStrokes[0].points[0];
    const gripPx = planeMetresToPixels(grip[0], grip[1]);
    document.body.append(flyer);

    return {
      at(ratio) {
        const inv = 1 - ratio;
        const point = {
          x: inv * inv * from.x + 2 * inv * ratio * control.x + ratio * ratio * to.x,
          y: inv * inv * from.y + 2 * inv * ratio * control.y + ratio * ratio * to.y,
        };
        flyer.style.transform = `translate(${point.x - gripPx.cssX * scale}px, ${point.y - gripPx.cssY * scale}px)`;
        const chord = Math.hypot(to.x - from.x, to.y - from.y);
        // Height above the straight line from the plane's centre to the hand (screen y grows downward).
        const above =
          chord === 0
            ? from.y - point.y
            : ((to.x - from.x) * (from.y - point.y) - (to.y - from.y) * (from.x - point.x)) / chord;
        const target = handOnScreen();
        return {
          arcMetres: Math.max(0, Math.abs(above)) * metresPerPx,
          gapMetres: Math.hypot(target.x - point.x, target.y - point.y) * metresPerPx,
        };
      },
      land() {
        flyer.remove();
      },
    };
  };

  const runLift = async (weapon: Weapon): Promise<void> => {
    equippedWeaponId = weapon.id;
    if (prefersReducedMotion()) {
      setPhase('crossfading');
      plane.dataset.planeOpacity = '0.00';
      plane.style.opacity = '0';
      await sleep(120);
      preview.setWeapon(weapon.strokes);
      plane.dataset.gripGap = '0.000';
      plane.dataset.equippedWeapon = weapon.id;
      plane.style.pointerEvents = 'none';
      setPhase('socketed');
      return;
    }

    setPhase('flying');
    const flight = startFlight(weapon.strokes);
    const flightMs = 500;
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const step = (): void => {
        const ratio = Math.min(1, (performance.now() - start) / flightMs);
        const yaw = -35 * ratio;
        const opacity = 1 - ratio;
        const { arcMetres, gapMetres } = flight.at(ratio);
        plane.dataset.planeYaw = String(Math.round(yaw));
        plane.dataset.planeOpacity = opacity.toFixed(2);
        plane.dataset.arcHeight = arcMetres.toFixed(2);
        plane.dataset.gripGap = gapMetres.toFixed(3);
        plane.style.transform = `perspective(900px) rotateY(${yaw}deg)`;
        plane.style.opacity = String(opacity);
        if (ratio < 1) {
          requestAnimationFrame(step);
          return;
        }
        resolve();
      };
      requestAnimationFrame(step);
    });
    flight.land();

    plane.dataset.arcHeight = '0.00';
    setPhase('catching');
    preview.setWeapon(weapon.strokes);
    await sleep(600);
    plane.dataset.gripGap = '0.000';
    plane.dataset.equippedWeapon = weapon.id;
    plane.style.pointerEvents = 'none';
    setPhase('socketed');
  };

  forgeButton.addEventListener('click', () => {
    if (hero === null) return;
    void withPending(ctx, forgeButton, async () => {
      try {
        const response = await api.post<{ weapon: Weapon }>('/api/weapons', {
          character_id: hero.id,
          strokes,
        });
        ctx.announce(ctx.t('fb.weaponForged'));
        await runLift(response.weapon);
      } catch (failure) {
        if (failure instanceof ApiFailure) {
          ctx.announce(
            failure.fieldMessage('strokes') ??
              failure.fieldMessage('vertices') ??
              failure.fieldMessage('thickness') ??
              failure.localisedMessage,
          );
          return;
        }
        ctx.announce(ctx.t('fb.generic'));
      }
    });
  });

  showCursor();
  showCounts();
  redraw(0);
  applyPreview({
    drawing_revision: 0,
    stats: ZERO_STATS,
    strokes: 0,
    vertices: 0,
    within_limits: true,
    over: [],
  });
  plane.dataset.equippedWeapon = equippedWeaponId;
  if (hero?.weapon_id != null) {
    try {
      const { weapon } = await api.get<{ weapon: Weapon }>(`/api/weapons/${hero.weapon_id}`);
      preview.setWeapon(weapon.strokes);
    } catch {
      preview.setWeapon(null);
    }
  }

  return { destroy: () => preview.destroy() };
}
