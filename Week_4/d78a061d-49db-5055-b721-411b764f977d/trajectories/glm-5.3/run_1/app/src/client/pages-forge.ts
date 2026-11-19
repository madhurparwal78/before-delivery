import { el, t } from './ui.js';
import { api, getJson, type Character, type Weapon, type Stats } from './api-client.js';
import { store, notify, loadMe } from './store.js';
import { languagePickerHtml } from './language.js';
import { navTabs, heroDataOf, weaponById, signOutButton } from './pages-hangar.js';
import { createHeroPreview, reducedMotion } from './scene.js';
import { PLANE_CSS_PX, planePxToMetres, formatNumber, clamp, countChars, type Stroke } from '../shared/domain.js';
import type { Locale } from '../shared/domain.js';
import { locale } from './ui.js';

/**
 * The forge (DP-18 to DP-22, DP-61, DP-68): the 320 CSS-pixel drawing plane,
 * the keyboard cursor, live stats and the ink-to-steel lift.
 */

type LiftState = 'idle' | 'inflating' | 'flying' | 'catching' | 'crossfading' | 'socketed';

export async function mountForge(): Promise<void> {
  await loadMe();
  const root = document.getElementById('root');
  if (!root) return;
  root.replaceChildren();
  const layout = el('div', { class: 'screen-layout forge-layout' });
  layout.append(navTabs('/forge'));
  const scene = el('div', { class: 'scene-hold forge-scene' });
  const inspector = el('aside', { class: 'inspector-card', role: 'region', 'aria-label': t('copy', 'forge-heading') });

  const character = store.equippedCharacter;
  const hero = heroDataOf(character);
  const equippedWeapon = await weaponById(character?.weapon_id ?? null);
  const preview = createHeroPreview(hero, equippedWeapon ? { strokes: equippedWeapon.strokes, stats: equippedWeapon.stats } : null, { reduced: reducedMotion() });
  scene.append(preview.element);

  // Drawing plane
  const plane = el('div', {
    class: 'drawing-plane',
    role: 'application',
    'aria-label': t('controls', 'drawing-plane'),
    tabindex: '0',
    style: `width:${PLANE_CSS_PX}px;height:${PLANE_CSS_PX}px`,
  });
  const planeCanvas = el('canvas', { class: 'plane-canvas', width: String(PLANE_CSS_PX), height: String(PLANE_CSS_PX) }) as HTMLCanvasElement;
  plane.append(planeCanvas);
  const cursor = el('div', { class: 'keyboard-cursor' });
  plane.append(cursor);

  const state = {
    strokes: [] as Stroke[],
    inProgress: null as Stroke | null,
    cursorX: 0,
    cursorY: 0,
    thickness: 0.04,
    drawingRevision: 0,
    lift: 'idle' as LiftState,
    tubeRadius: 0,
    planeYaw: 0,
    planeOpacity: 1,
    arcHeight: 0,
    gripGap: 0,
    equippedWeaponId: character?.weapon_id ?? '',
  };

  const planeCtx = planeCanvas.getContext('2d');

  const renderPlane = () => {
    const ctx = planeCtx;
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    planeCanvas.width = Math.round(PLANE_CSS_PX * dpr);
    planeCanvas.height = Math.round(PLANE_CSS_PX * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, PLANE_CSS_PX, PLANE_CSS_PX);
    ctx.save();
    ctx.globalAlpha = state.planeOpacity;
    // The 2 by 2 metre square seen square-on: x -1 to 1, y 1 to -1.
    ctx.strokeStyle = '#242120';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, PLANE_CSS_PX - 2, PLANE_CSS_PX - 2);
    ctx.beginPath();
    ctx.moveTo(PLANE_CSS_PX / 2, 0);
    ctx.lineTo(PLANE_CSS_PX / 2, PLANE_CSS_PX);
    ctx.moveTo(0, PLANE_CSS_PX / 2);
    ctx.lineTo(PLANE_CSS_PX, PLANE_CSS_PX / 2);
    ctx.stroke();
    const toPx = (x: number, y: number) => ({
      px: (x + 1) * (PLANE_CSS_PX / 2),
      py: (1 - y) * (PLANE_CSS_PX / 2),
    });
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of state.strokes) {
      if (stroke.points.length === 0) continue;
      ctx.strokeStyle = '#242120';
      ctx.lineWidth = Math.max(2, stroke.thickness * (PLANE_CSS_PX / 2));
      ctx.beginPath();
      const start = stroke.points[0];
      if (!start) continue;
      const first = toPx(start[0], start[1]);
      ctx.moveTo(first.px, first.py);
      for (const point of stroke.points.slice(1)) {
        const next = toPx(point[0], point[1]);
        ctx.lineTo(next.px, next.py);
      }
      ctx.stroke();
    }
    const progress = state.inProgress;
    if (progress && progress.points.length > 0) {
      ctx.strokeStyle = '#1d4ed8';
      ctx.lineWidth = Math.max(2, progress.thickness * (PLANE_CSS_PX / 2));
      ctx.beginPath();
      const start = progress.points[0] as [number, number];
      const first = toPx(start[0], start[1]);
      ctx.moveTo(first.px, first.py);
      for (const point of progress.points.slice(1)) {
        const next = toPx(point[0], point[1]);
        ctx.lineTo(next.px, next.py);
      }
      ctx.stroke();
    }
    ctx.restore();
    const cursorPx = {
      px: (state.cursorX + 1) * (PLANE_CSS_PX / 2),
      py: (1 - state.cursorY) * (PLANE_CSS_PX / 2),
    };
    cursor.style.left = `${cursorPx.px}px`;
    cursor.style.top = `${cursorPx.py}px`;
    syncAttributes();
  };

  const statsRegion = el('div', { role: 'region', 'aria-label': t('controls', 'weapon-stats'), class: 'stats-region' });
  const meter = el('div', { role: 'meter', 'aria-label': t('controls', 'vertex-budget'), class: 'vertex-meter', 'aria-valuemin': '0', 'aria-valuemax': '12000', 'aria-valuenow': '0' });
  const meterFill = el('div', { class: 'meter-fill' });
  const meterText = el('span', { class: 'meter-text' });
  meter.append(meterFill, meterText);
  const forgeStats = el('div', { id: 'forge-stats', role: 'status', 'aria-live': 'polite', class: 'polite-region', 'aria-label': t('controls', 'forge-stats') });
  const tooManyStrokes = el('p', { class: 'limit-marker', hidden: true, text: t('copy', 'too-many-strokes') });
  const overVertex = el('p', { class: 'limit-marker', hidden: true, text: t('copy', 'over-vertex') });

  const vertexCount = () => state.strokes.reduce((sum, s) => sum + s.points.length * 8, 0);

  const syncAttributes = () => {
    plane.setAttribute('data-cursor-x', state.cursorX.toFixed(2));
    plane.setAttribute('data-cursor-y', state.cursorY.toFixed(2));
    plane.setAttribute('data-stroke-points', String(state.inProgress ? state.inProgress.points.length : 0));
    plane.setAttribute('data-strokes', String(state.strokes.length));
    plane.setAttribute('data-lift', state.lift);
    plane.setAttribute('data-tube-radius', state.tubeRadius.toFixed(3));
    plane.setAttribute('data-plane-yaw', String(Math.round(state.planeYaw)));
    plane.setAttribute('data-plane-opacity', state.planeOpacity.toFixed(2));
    plane.setAttribute('data-arc-height', state.arcHeight.toFixed(2));
    plane.setAttribute('data-grip-gap', state.gripGap.toFixed(3));
    plane.setAttribute('data-equipped-weapon', state.equippedWeaponId);
  };

  let lastServerStats: Stats = { reach_m: 0, weight_kg: 0, swing_per_s: 0 };
  let lastAnnounced: string | null = null;

  const renderStats = (stats: Stats | null) => {
    const effective = stats ?? { reach_m: 0, weight_kg: 0, swing_per_s: 0 };
    if (stats) lastServerStats = stats;
    const shown = stats ? stats : lastServerStats;
    const vertices = vertexCount();
    statsRegion.replaceChildren(
      el('p', { text: `${t('copy', 'reach')}: ${t('copy', 'stats-reach', { reach: formatNumber(shown.reach_m, locale as Locale, 2) })}` }),
      el('p', { text: `${t('copy', 'weight')}: ${t('copy', 'stats-weight', { weight: formatNumber(shown.weight_kg, locale as Locale, 2) })}` }),
      el('p', { text: `${t('copy', 'swing-speed')}: ${t('copy', 'stats-swing', { swing: formatNumber(shown.swing_per_s, locale as Locale, 2) })}` }),
    );
    meter.setAttribute('aria-valuenow', String(vertices));
    meterText.textContent = t('copy', 'vertex-meter', { used: formatNumber(vertices, locale as Locale), limit: formatNumber(12000, locale as Locale) });
    meterFill.style.width = `${Math.min(100, (vertices / 12000) * 100)}%`;
    overVertex.hidden = vertices <= 12000;
    tooManyStrokes.hidden = state.strokes.length <= 24;
    forgeButton.disabled = state.strokes.length === 0 || vertices > 12000 || state.strokes.length > 24;
    const announcement = t('copy', 'forge-stats', {
      reach: formatNumber(shown.reach_m, locale as Locale, 2),
      weight: formatNumber(shown.weight_kg, locale as Locale, 2),
      swing: formatNumber(shown.swing_per_s, locale as Locale, 2),
      used: formatNumber(vertices, locale as Locale),
      limit: formatNumber(12000, locale as Locale),
    });
    if (announcement !== lastAnnounced) {
      forgeStats.textContent = announcement;
      lastAnnounced = announcement;
    }
  };

  // Server preview with the latest-revision check (DP-61).
  let sentRevision = 0;
  let newestRevision = 0;
  const requestPreview = async () => {
    sentRevision += 1;
    newestRevision = sentRevision;
    const revision = sentRevision;
    const result = await api<{ stats: Stats; vertices: number; over: string[] }>('POST', '/api/weapons/preview', {
      strokes: state.strokes,
      drawing_revision: revision,
    });
    if (revision !== newestRevision) return;
    if (result.status === 200 && result.data) {
      renderStats(result.data.stats);
    }
  };

  const commitStroke = () => {
    const stroke = state.inProgress;
    if (!stroke || stroke.points.length < 2) {
      if (stroke && stroke.points.length < 2) {
        notify(t('copy', 'stroke-shape'));
      }
      state.inProgress = null;
      renderPlane();
      return;
    }
    const previousCount = state.strokes.length;
    const previousVertices = vertexCount();
    state.strokes.push(stroke);
    state.inProgress = null;
    state.drawingRevision += 1;
    // The tube inflates over a short span (DP-22).
    state.tubeRadius = stroke.thickness;
    if (!reducedMotion()) {
      state.lift = 'inflating';
      setTimeout(() => {
        if (state.lift === 'inflating') state.lift = 'idle';
        renderPlane();
      }, 300);
    }
    renderPlane();
    if (previousCount <= 24 && state.strokes.length > 24) notify(t('copy', 'stroke-count'));
    if (previousVertices <= 12000 && vertexCount() > 12000) notify(t('copy', 'vertex-limit'));
    void requestPreview();
  };

  const addPoint = (x: number, y: number) => {
    const last = state.inProgress?.points[state.inProgress.points.length - 1];
    if (last) {
      const distance = Math.hypot(x - last[0], y - last[1]);
      if (distance < 0.02) return;
    }
    if (x < -1 || x > 1 || y < -1 || y > 1) return;
    if (!state.inProgress) state.inProgress = { thickness: state.thickness, points: [] };
    if (state.inProgress.points.length >= 200) return;
    state.inProgress.points.push([x, y]);
    renderPlane();
  };

  // Pointer input: CSS pixels from the plane's top-left corner.
  const pointerToMetres = (event: PointerEvent) => {
    const rect = plane.getBoundingClientRect();
    return planePxToMetres(event.clientX - rect.left, event.clientY - rect.top, PLANE_CSS_PX);
  };
  plane.addEventListener('pointerdown', (event) => {
    plane.setPointerCapture(event.pointerId);
    const { x, y } = pointerToMetres(event);
    state.inProgress = { thickness: state.thickness, points: [] };
    if (x >= -1 && x <= 1 && y >= -1 && y <= 1) state.inProgress.points.push([x, y]);
    renderPlane();
  });
  plane.addEventListener('pointermove', (event) => {
    if (!state.inProgress) return;
    const { x, y } = pointerToMetres(event);
    addPoint(x, y);
  });
  plane.addEventListener('pointerup', () => {
    commitStroke();
  });
  plane.addEventListener('pointercancel', () => {
    state.inProgress = null;
    renderPlane();
  });

  // Keyboard cursor
  plane.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      state.cursorY = clamp(state.cursorY + 0.05, -1, 1);
      renderPlane();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      state.cursorY = clamp(state.cursorY - 0.05, -1, 1);
      renderPlane();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      state.cursorX = clamp(state.cursorX + 0.05, -1, 1);
      renderPlane();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      state.cursorX = clamp(state.cursorX - 0.05, -1, 1);
      renderPlane();
    } else if (event.key === ' ') {
      event.preventDefault();
      addPoint(state.cursorX, state.cursorY);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      commitStroke();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      state.inProgress = null;
      renderPlane();
    }
  });

  const thicknessSlider = el('input', { type: 'range', min: '0.01', max: '0.08', step: '0.01', value: '0.04', id: 'stroke-thickness' });
  thicknessSlider.addEventListener('input', () => {
    state.thickness = Number(thicknessSlider.value);
    if (state.inProgress) state.inProgress.thickness = state.thickness;
    renderPlane();
  });
  const thicknessLabel = el('label', { for: 'stroke-thickness', text: t('controls', 'stroke-thickness') });

  const undoStroke = el('button', { class: 'ghost', text: t('controls', 'undo-stroke') });
  undoStroke.addEventListener('click', () => {
    state.strokes.pop();
    state.drawingRevision += 1;
    renderPlane();
    renderStats(null);
    void requestPreview();
  });
  const clearPlane = el('button', { class: 'ghost', text: t('controls', 'clear-plane') });
  clearPlane.addEventListener('click', () => {
    state.strokes = [];
    state.drawingRevision += 1;
    if (state.lift === 'socketed') {
      state.lift = 'idle';
      state.planeYaw = 0;
      state.planeOpacity = 1;
    }
    renderPlane();
    renderStats({ reach_m: 0, weight_kg: 0, swing_per_s: 0 });
    void requestPreview();
  });
  const forgeButton = el('button', { class: 'primary', text: t('controls', 'forge'), disabled: true });
  forgeButton.addEventListener('click', async () => {
    forgeButton.disabled = true;
    forgeButton.textContent = t('copy', 'working');
    const characterId = character?.id ?? '';
    const result = await api<{ weapon: Weapon; character: Character }>('POST', '/api/weapons', { character_id: characterId, strokes: state.strokes });
    forgeButton.textContent = t('controls', 'forge');
    if (result.status === 201 && result.data?.weapon) {
      notify(t('copy', 'weapon-forged'));
      const weapon = result.data.weapon;
      state.equippedWeaponId = weapon.id;
      await playLift(weapon);
    } else {
      const data = result.data as { error?: { fields?: Record<string, string> } } | null;
      const fields = data?.error?.fields ?? {};
      const message = Object.values(fields)[0] ?? t('copy', 'generic-error');
      notify(message);
      forgeButton.disabled = false;
    }
  });

  const playLift = async (weapon: Weapon) => {
    const reduced = reducedMotion();
    const heroNow = heroDataOf(character);
    preview.setHero(heroNow, { strokes: weapon.strokes, stats: weapon.stats });
    if (reduced) {
      state.lift = 'crossfading';
      state.planeOpacity = 0.5;
      renderPlane();
      await wait(120);
      state.planeOpacity = 0;
      state.gripGap = 0;
      state.lift = 'socketed';
      renderPlane();
      return;
    }
    state.lift = 'flying';
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const progress = i / steps;
      state.planeYaw = -35 * progress;
      state.planeOpacity = 1 - progress;
      state.arcHeight = Math.sin(progress * Math.PI) * 0.8;
      renderPlane();
      await wait(50);
    }
    state.planeOpacity = 0;
    state.arcHeight = 0;
    state.lift = 'catching';
    renderPlane();
    await wait(600);
    state.gripGap = 0;
    state.lift = 'socketed';
    renderPlane();
  };

  const statsBox = el('div', {});
  statsBox.append(statsRegion, tooManyStrokes, overVertex, meter, forgeStats);

  inspector.append(
    thicknessLabel, thicknessSlider,
    el('div', { class: 'drawing-hint', text: t('copy', 'drawing-hint') }),
    statsBox,
    el('div', { class: 'button-row' }, undoStroke, clearPlane, forgeButton),
    languagePickerHtml(), signOutButton(),
  );

  layout.append(inspector);
  root.append(layout, scene, plane);
  renderPlane();
  renderStats({ reach_m: 0, weight_kg: 0, swing_per_s: 0 });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
