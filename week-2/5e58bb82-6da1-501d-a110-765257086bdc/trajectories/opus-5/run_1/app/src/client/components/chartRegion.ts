import type { Position } from '../../shared/types.js';
import { Chart, LENS_DIAMETER_PX, type ChartData } from '../chart.js';
import { button, el, prefersReducedMotion } from '../dom.js';

export interface ChartRegionOptions {
  /** The console carries the lens; the survey chart does not, and arrows pan it. */
  lens: boolean;
  onLensMoved?(ground: Position): void;
  onQueueAtLens?(): void;
}

export interface ChartRegion {
  node: HTMLElement;
  chart: Chart;
  application: HTMLElement;
  lensMarker: HTMLElement | null;
  overlayHost: HTMLElement;
  setData(data: ChartData): void;
}

const ARROW_STEP_M = 10;
const SHIFT_STEP_M = 50;

/**
 * `region "Survey chart"` holding the focusable `application "Coverage chart"`,
 * the zoom controls, and — on the console — the holiday lens.
 */
export function createChartRegion(options: ChartRegionOptions): ChartRegion {
  const canvas = el('canvas', { class: 'chart-canvas', 'aria-hidden': 'true' });
  const chart = new Chart(canvas);

  const overlayHost = el('div', { class: 'chart-overlays' });
  const lensMarker = options.lens
    ? el('div', { role: 'img', 'aria-label': 'Holiday lens', class: 'lens-marker' })
    : null;
  if (lensMarker) lensMarker.hidden = true;

  const application = el('div', {
    role: 'application',
    'aria-label': 'Coverage chart',
    tabindex: '0',
    class: 'chart-application',
  });
  application.append(canvas, overlayHost);
  if (lensMarker) application.append(lensMarker);

  const zoomIn = button('Zoom in');
  const zoomOut = button('Zoom out');
  const fit = button('Fit survey area');
  zoomIn.addEventListener('click', () => chart.zoom(1.25));
  zoomOut.addEventListener('click', () => chart.zoom(0.8));
  fit.addEventListener('click', () => chart.fit());

  const node = el(
    'section',
    { role: 'region', 'aria-label': 'Survey chart', class: 'chart-region' },
    [application, el('div', { class: 'chart-controls' }, [zoomIn, zoomOut, fit])],
  );

  function placeLensMarker(): void {
    if (!lensMarker) return;
    const ground = chart.lensGround;
    if (!ground || chart.lensOpenProgress <= 0) {
      lensMarker.hidden = true;
      return;
    }
    const at = chart.toScreen(ground);
    lensMarker.hidden = false;
    lensMarker.style.left = `${at.x - LENS_DIAMETER_PX / 2}px`;
    lensMarker.style.top = `${at.y - LENS_DIAMETER_PX / 2}px`;
    lensMarker.style.width = `${LENS_DIAMETER_PX}px`;
    lensMarker.style.height = `${LENS_DIAMETER_PX}px`;
  }

  function moveLens(ground: Position, trail: boolean): void {
    chart.moveLens(ground, { trail: trail && !prefersReducedMotion() });
    placeLensMarker();
    options.onLensMoved?.(ground);
  }

  if (options.lens) {
    application.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') return;
      const rect = application.getBoundingClientRect();
      const ground = chart.toGround(event.clientX - rect.left, event.clientY - rect.top);
      if (chart.lensOpenProgress <= 0) chart.openLens(ground, !prefersReducedMotion());
      moveLens(ground, true);
    });
    application.addEventListener('pointerleave', () => {
      if (document.activeElement !== application && !application.contains(document.activeElement)) {
        chart.closeLens();
        placeLensMarker();
      }
    });
    application.addEventListener('focus', () => {
      const ground = chart.lensGround ?? chart.toGround(
        application.clientWidth / 2,
        application.clientHeight / 2,
      );
      chart.openLens(ground, !prefersReducedMotion());
      placeLensMarker();
      options.onLensMoved?.(ground);
    });
    node.addEventListener('focusout', () => {
      window.setTimeout(() => {
        if (!node.contains(document.activeElement)) {
          chart.closeLens();
          placeLensMarker();
        }
      }, 0);
    });
    application.addEventListener('click', (event) => {
      const rect = application.getBoundingClientRect();
      const ground = chart.toGround(event.clientX - rect.left, event.clientY - rect.top);
      moveLens(ground, false);
      if (chart.holidayUnderCentre()) options.onQueueAtLens?.();
    });
  }

  // These keys work while focus is anywhere inside the chart region.
  node.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? SHIFT_STEP_M : ARROW_STEP_M;
    const ground = chart.lensGround;
    const pan = (dx: number, dy: number): void => {
      if (options.lens && ground) {
        const next = { easting: ground.easting + dx, northing: ground.northing + dy };
        moveLens(next, false);
        chart.ensureLensVisible();
        placeLensMarker();
      } else {
        chart.panByPixels(-dx, dy);
      }
    };
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        pan(-step, 0);
        break;
      case 'ArrowRight':
        event.preventDefault();
        pan(step, 0);
        break;
      case 'ArrowUp':
        event.preventDefault();
        pan(0, step);
        break;
      case 'ArrowDown':
        event.preventDefault();
        pan(0, -step);
        break;
      case 'Enter':
        if (options.lens && document.activeElement === application) {
          event.preventDefault();
          options.onQueueAtLens?.();
        }
        break;
      default:
        break;
    }
  });

  // A one-finger drag pans the chart; a tap places the lens; neither scrolls sideways.
  let dragFrom: { x: number; y: number } | null = null;
  let dragged = false;
  let pinchFrom: number | null = null;
  application.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length === 1) {
        dragFrom = { x: event.touches[0]!.clientX, y: event.touches[0]!.clientY };
        dragged = false;
      } else if (event.touches.length === 2) {
        pinchFrom = Math.hypot(
          event.touches[0]!.clientX - event.touches[1]!.clientX,
          event.touches[0]!.clientY - event.touches[1]!.clientY,
        );
      }
    },
    { passive: true },
  );
  application.addEventListener(
    'touchmove',
    (event) => {
      if (event.touches.length === 2 && pinchFrom !== null) {
        const now = Math.hypot(
          event.touches[0]!.clientX - event.touches[1]!.clientX,
          event.touches[0]!.clientY - event.touches[1]!.clientY,
        );
        if (now > 0) chart.zoom(now / pinchFrom);
        pinchFrom = now;
        event.preventDefault();
        return;
      }
      if (event.touches.length === 1 && dragFrom) {
        const dx = event.touches[0]!.clientX - dragFrom.x;
        const dy = event.touches[0]!.clientY - dragFrom.y;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragged = true;
        chart.panByPixels(dx, dy);
        dragFrom = { x: event.touches[0]!.clientX, y: event.touches[0]!.clientY };
        placeLensMarker();
        event.preventDefault();
      }
    },
    { passive: false },
  );
  application.addEventListener('touchend', (event) => {
    if (!dragged && dragFrom && options.lens) {
      const rect = application.getBoundingClientRect();
      const ground = chart.toGround(dragFrom.x - rect.left, dragFrom.y - rect.top);
      if (chart.lensOpenProgress <= 0) chart.openLens(ground, false);
      moveLens(ground, false);
    }
    dragFrom = null;
    pinchFrom = null;
    void event;
  });

  let mouseFrom: { x: number; y: number } | null = null;
  application.addEventListener('mousedown', (event) => {
    if (options.lens) return;
    mouseFrom = { x: event.clientX, y: event.clientY };
  });
  window.addEventListener('mousemove', (event) => {
    if (!mouseFrom) return;
    chart.panByPixels(event.clientX - mouseFrom.x, event.clientY - mouseFrom.y);
    mouseFrom = { x: event.clientX, y: event.clientY };
  });
  window.addEventListener('mouseup', () => {
    mouseFrom = null;
  });

  const observer = new ResizeObserver(() => {
    chart.schedule();
    placeLensMarker();
  });
  observer.observe(application);

  return {
    node,
    chart,
    application,
    lensMarker,
    overlayHost,
    setData(data) {
      chart.setData(data);
      placeLensMarker();
    },
  };
}
