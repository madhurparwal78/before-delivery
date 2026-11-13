// The landing stage: black on load, the light rising over 800 ms, headline
// lines staggering 60 ms apart, the light leaning toward the pointer.
export interface FollowLightHandle {
  region: HTMLElement;
  canvas: HTMLCanvasElement;
  level(): number;
  dispose(): void;
}

interface LightState {
  level: number;
  levelStart: number;
  focus: { x: number; y: number };
  target: { x: number; y: number };
  pointer: { x: number; y: number } | null;
  leaving: boolean;
  leaveStart: number;
  leaveFrom: { x: number; y: number };
}

const REST = { x: 0.8, y: 0.9 };

export function createFollowLightStage(reducedMotion: boolean): FollowLightHandle {
  const region = document.createElement('section');
  region.setAttribute('role', 'region');
  region.setAttribute('aria-label', 'Follow Light stage');
  region.className = 'landing-stage';
  region.dataset.lightLevel = '0';
  region.dataset.lightFocus = '0.800, 0.900';

  const canvas = document.createElement('canvas');
  region.append(canvas);

  const state: LightState = {
    level: 0,
    levelStart: performance.now(),
    focus: { ...REST },
    target: { ...REST },
    pointer: null,
    leaving: false,
    leaveStart: 0,
    leaveFrom: { ...REST },
  };

  const update = (): void => {
    const now = performance.now();
    if (reducedMotion) {
      state.level = 1;
      state.focus = { ...REST };
    } else {
      const elapsed = now - state.levelStart;
      // The light rises and brightens over 800 ms, settling softly.
      const t = Math.min(1, elapsed / 800);
      state.level = t * (2 - t);
      if (state.pointer) {
        state.target = { x: state.pointer.x, y: state.pointer.y };
        state.leaving = false;
        // The light trails the pointer using the smoothing rule.
        const f = 1 - 0.92 * 1;
        state.focus.x += (state.target.x - state.focus.x) * f;
        state.focus.y += (state.target.y - state.focus.y) * f;
      } else if (state.leaving) {
        const p = Math.min(1, (now - state.leaveStart) / 1200);
        const e = glide(p);
        state.focus.x = state.leaveFrom.x + (REST.x - state.leaveFrom.x) * e;
        state.focus.y = state.leaveFrom.y + (REST.y - state.leaveFrom.y) * e;
      } else {
        state.focus = { ...REST };
      }
    }
    region.dataset.lightLevel = state.level.toFixed(3);
    region.dataset.lightFocus = `${state.focus.x.toFixed(3)}, ${state.focus.y.toFixed(3)}`;
    draw();
    raf = requestAnimationFrame(update);
  };

  let raf = requestAnimationFrame(update);

  const draw = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = region.clientWidth;
    const h = region.clientHeight;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const level = state.level;
    // A violet light volume rising from the bottom-right.
    const fx = state.focus.x * w;
    const fy = state.focus.y * h;
    const cx = w * 0.72 + (fx - w * 0.72) * 0.35;
    const cy = h * 0.9 + (fy - h * 0.9) * 0.35;
    const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, Math.max(w, h) * 0.75);
    grad.addColorStop(0, `rgba(124, 92, 255, ${0.5 * level})`);
    grad.addColorStop(0.4, `rgba(84, 60, 180, ${0.22 * level})`);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    // A thin violet floor glow
    const floor = ctx.createLinearGradient(0, h, 0, h * 0.7);
    floor.addColorStop(0, `rgba(124, 92, 255, ${0.25 * level})`);
    floor.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = floor;
    ctx.fillRect(0, h * 0.7, w, h * 0.3);
  };

  const onMove = (e: PointerEvent): void => {
    const rect = region.getBoundingClientRect();
    state.pointer = { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  };
  const onLeave = (): void => {
    if (state.pointer) {
      state.leaving = true;
      state.leaveStart = performance.now();
      state.leaveFrom = { ...state.focus };
      state.pointer = null;
    }
  };
  if (!reducedMotion) {
    region.addEventListener('pointermove', onMove);
    region.addEventListener('pointerleave', onLeave);
    region.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      if (t) {
        const rect = region.getBoundingClientRect();
        state.pointer = { x: (t.clientX - rect.left) / rect.width, y: (t.clientY - rect.top) / rect.height };
      }
    }, { passive: true });
    region.addEventListener('touchend', onLeave);
  }

  return {
    region,
    canvas,
    level: () => state.level,
    dispose: () => {
      cancelAnimationFrame(raf);
      region.removeEventListener('pointermove', onMove);
      region.removeEventListener('pointerleave', onLeave);
    },
  };

  function glide(t: number): number {
    // The Glide preset's bézier, sampled by bisection.
    const x1 = 0.22, y1 = 1, x2 = 0.36, y2 = 1;
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const cx = (tt: number) => {
      const u = 1 - tt;
      return 3 * u * u * tt * x1 + 3 * u * tt * tt * x2 + tt * tt * tt;
    };
    const cy = (tt: number) => {
      const u = 1 - tt;
      return 3 * u * u * tt * y1 + 3 * u * tt * tt * y2 + tt * tt * tt;
    };
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (cx(mid) < t) lo = mid;
      else hi = mid;
    }
    return cy((lo + hi) / 2);
  }
}
