import { el } from './types';
import { reducedMotion } from './dialog';

export function initWeight(): void {
  const slider = document.getElementById('weight-slider') as HTMLInputElement | null;
  const readout = document.getElementById('weight-readout');
  const specimen = document.getElementById('weight-specimen');
  const announcement = document.getElementById('weight-announcement');
  if (!slider || !readout || !specimen || !announcement) return;

  let timer: number | undefined;
  let last = Number(slider.value);
  slider.addEventListener('input', () => {
    const value = Number(slider.value);
    last = value;
    readout.textContent = `Weight ${value}`;
    specimen.style.fontWeight = String(value);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      announcement.textContent = `Weight ${last}`;
    }, weightDelay());
  });
}

function weightDelay(): number {
  return (window as unknown as { __weightDelay?: number }).__weightDelay ?? 300;
}

const FAMILIES = ['Ember', 'Saffron', 'Meadow', 'Lagoon', 'Harbour', 'Iris', 'Orchid', 'Clay', 'Moss', 'Stone'];

export function initWheel(): void {
  const wheel = document.getElementById('palette-wheel');
  const table = document.getElementById('swatch-table');
  const status = document.getElementById('swatch-filter');
  if (!wheel || !table || !status) return;

  const discs = [...wheel.querySelectorAll<HTMLButtonElement>('.wheel-disc')];
  const showAll = document.getElementById('show-all');
  if (discs.length === 0) return;

  let focusedIndex = 0;
  let selected: string | null = null;

  const applySelection = (): void => {
    for (const disc of discs) {
      disc.tabIndex = discs.indexOf(disc) === focusedIndex ? 0 : -1;
      disc.setAttribute('aria-pressed', selected === disc.dataset.family ? 'true' : 'false');
    }
    for (const row of table.querySelectorAll<HTMLTableRowElement>('tbody tr')) {
      const rowFamily = row.dataset.family;
      row.hidden = selected !== null && rowFamily !== selected;
    }
    if (selected) {
      const count = [...table.querySelectorAll<HTMLTableRowElement>('tbody tr')].filter(
        (row) => row.dataset.family === selected,
      ).length;
      status.textContent = `${count} swatches in ${selected}`;
    } else {
      const count = table.querySelectorAll<HTMLTableRowElement>('tbody tr').length;
      status.textContent = `${count} swatches`;
    }
  };

  const select = (family: string | null): void => {
    selected = family;
    applySelection();
  };

  for (const disc of discs) {
    disc.addEventListener('click', () => {
      focusedIndex = discs.indexOf(disc);
      select(disc.dataset.family ?? null);
    });
    disc.addEventListener('keydown', (event) => {
      const index = discs.indexOf(disc);
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        focusedIndex = (index + 1) % discs.length;
        discs[focusedIndex].focus();
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        focusedIndex = (index - 1 + discs.length) % discs.length;
        discs[focusedIndex].focus();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select(disc.dataset.family ?? null);
      }
    });
  }

  if (showAll) {
    showAll.addEventListener('click', () => {
      select(null);
      status.textContent = '20 swatches';
    });
  }

  applySelection();
}

interface Keyframe {
  time: number;
  value: number;
}

const TRACKS: { property: string; keyframes: Keyframe[] }[] = [
  { property: 'Opacity', keyframes: [{ time: 0, value: 0 }, { time: 2, value: 1 }, { time: 10, value: 1 }, { time: 12, value: 0 }] },
  { property: 'Scale', keyframes: [{ time: 0, value: 0.8 }, { time: 3, value: 1 }, { time: 12, value: 1 }] },
  { property: 'Offset X', keyframes: [{ time: 0, value: -40 }, { time: 4, value: 0 }, { time: 8, value: 0 }, { time: 12, value: 40 }] },
  { property: 'Offset Y', keyframes: [{ time: 0, value: 24 }, { time: 3, value: 0 }, { time: 12, value: 0 }] },
  { property: 'Rotate', keyframes: [{ time: 0, value: -6 }, { time: 6, value: 0 }, { time: 12, value: 6 }] },
  { property: 'Blur', keyframes: [{ time: 0, value: 8 }, { time: 2, value: 0 }, { time: 10, value: 0 }, { time: 12, value: 4 }] },
];

function interpolate(track: { keyframes: Keyframe[] }, time: number): number {
  const frames = track.keyframes;
  if (time <= frames[0].time) return frames[0].value;
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    if (time >= a.time && time <= b.time) {
      const span = b.time - a.time;
      const t = span === 0 ? 0 : (time - a.time) / span;
      return a.value + (b.value - a.value) * t;
    }
  }
  return frames[frames.length - 1].value;
}

function roundHalfUp(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value) * 100 + Number.EPSILON) / 100;
}

function mmss(seconds: number): string {
  const whole = Math.round(seconds);
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

export function initMotion(): void {
  const tracks = document.getElementById('tracks');
  const playhead = document.getElementById('playhead') as HTMLInputElement | null;
  const timeline = document.getElementById('timeline');
  const readout = document.getElementById('playhead-readout');
  const keyframes = document.getElementById('keyframes');
  const valuesBody = document.getElementById('values-body');
  const playButton = document.getElementById('play-button');
  if (!tracks || !playhead || !timeline || !readout || !keyframes || !valuesBody || !playButton) return;

  for (const track of TRACKS) {
    tracks.append(el('li', {}, `${track.property}, ${track.keyframes.length} keyframes`));
  }
  for (const track of TRACKS) {
    for (const frame of track.keyframes) {
      const button = el('button', { type: 'button' }, `${track.property} keyframe at ${mmss(frame.time)}`);
      button.addEventListener('click', () => {
        playhead.value = String(frame.time);
        render();
      });
      keyframes.append(button);
    }
  }

  let playing = false;
  let startValue = 0;
  let startTime = 0;

  const render = (): void => {
    const value = Number(playhead.value);
    readout.textContent = `${mmss(value)} / 00:12`;
    valuesBody.replaceChildren();
    for (const track of TRACKS) {
      const interpolated = interpolate(track, value);
      const rounded = roundHalfUp(interpolated);
      valuesBody.append(
        el('tr', {}, el('th', { scope: 'row' }, track.property), el('td', {}, rounded.toFixed(2))),
      );
    }
  };

  playhead.addEventListener('input', render);

  const pointToTime = (event: PointerEvent): number => {
    const rect = timeline.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    return Math.round(ratio * 12);
  };

  timeline.addEventListener('pointerdown', (event) => {
    if (event.target === playhead) return;
    playhead.value = String(pointToTime(event));
    render();
    const move = (moveEvent: PointerEvent): void => {
      playhead.value = String(pointToTime(moveEvent));
      render();
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  const stop = (): void => {
    playing = false;
    playButton.textContent = 'Play';
  };

  playButton.addEventListener('click', () => {
    if (playing) {
      stop();
      return;
    }
    if (reducedMotion()) {
      playhead.value = '12';
      render();
      return;
    }
    playing = true;
    playButton.textContent = 'Pause';
    startValue = Number(playhead.value);
    startTime = performance.now();
    const step = (): void => {
      if (!playing) return;
      const elapsed = (performance.now() - startTime) / 1000;
      const next = startValue + elapsed;
      if (next >= 12) {
        playhead.value = '12';
        render();
        stop();
        return;
      }
      playhead.value = String(Math.floor(next));
      render();
      window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
  });

  render();
  initCurve();
}

const DEFAULT_CURVE = { x1: 0.3, y1: 0, x2: 0.2, y2: 1 };

function printedCurve(curve: { x1: number; y1: number; x2: number; y2: number }): string {
  return `cubic-bezier(${curve.x1.toFixed(2)}, ${curve.y1.toFixed(2)}, ${curve.x2.toFixed(2)}, ${curve.y2.toFixed(2)})`;
}

function initCurve(): void {
  const plot = document.getElementById('curve-plot');
  const svg = document.getElementById('curve-svg') as unknown as SVGSVGElement | null;
  const handle1 = document.getElementById('handle-1') as HTMLButtonElement | null;
  const handle2 = document.getElementById('handle-2') as HTMLButtonElement | null;
  const value1 = document.getElementById('handle-1-value');
  const value2 = document.getElementById('handle-2-value');
  const printed = document.getElementById('printed-curve');
  const reset = document.getElementById('reset-curve');
  const replay = document.getElementById('replay-curve');
  const demo = document.getElementById('curve-demo');
  const block = document.getElementById('demo-block');
  if (!plot || !svg || !handle1 || !handle2 || !value1 || !value2 || !printed || !reset || !replay || !demo || !block) return;

  const state = { ...DEFAULT_CURVE };

  const position = (): { x1: number; y1: number; x2: number; y2: number } => {
    return state;
  };

  const plotPoint = (x: number, y: number): { left: number; top: number } => {
    const left = (x / 1) * 320 - 16;
    const top = (1 - (y + 0.5) / 2) * 320 - 16;
    return { left, top };
  };

  const draw = (): void => {
    const { x1, y1, x2, y2 } = state;
    handle1.style.left = `${(x1 / 1) * 320 - 16}px`;
    handle1.style.top = `${(1 - (y1 + 0.5) / 2) * 320 - 16}px`;
    handle2.style.left = `${(x2 / 1) * 320 - 16}px`;
    handle2.style.top = `${(1 - (y2 + 0.5) / 2) * 320 - 16}px`;
    value1.textContent = `x ${x1.toFixed(2)}, y ${y1.toFixed(2)}`;
    value2.textContent = `x ${x2.toFixed(2)}, y ${y2.toFixed(2)}`;
    handle1.setAttribute('aria-describedby', 'handle-1-value');
    handle2.setAttribute('aria-describedby', 'handle-2-value');
    const p1 = plotPoint(x1, y1);
    const p2 = plotPoint(x2, y2);
    const path = `M 0 320 C ${(p1.left + 16).toFixed(1)} ${(p1.top + 16).toFixed(1)}, ${(p2.left + 16).toFixed(1)} ${(p2.top + 16).toFixed(1)}, 320 0`;
    svg.innerHTML = `<path d="${path}" stroke="#17161C" stroke-width="2" fill="none"></path>`;
    printed.textContent = printedCurve(state);
    const curve = printedCurve(state);
    demo.style.setProperty('--demo-curve', curve);
  };

  const snap = (value: number): number => Math.round(value * 100) / 100;

  const moveTo = (handle: 'h1' | 'h2', x: number, y: number): void => {
    const clampedX = Math.min(1, Math.max(0, snap(x)));
    const clampedY = Math.min(1.5, Math.max(-0.5, snap(y)));
    if (handle === 'h1') {
      state.x1 = clampedX;
      state.y1 = clampedY;
    } else {
      state.x2 = clampedX;
      state.y2 = clampedY;
    }
    draw();
  };

  const pointerFrom = (event: PointerEvent): { x: number; y: number } => {
    const rect = plot.getBoundingClientRect();
    const width = rect.width || 320;
    const height = rect.height || 320;
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / width));
    const y = Math.min(1.5, Math.max(-0.5, (1 - (event.clientY - rect.top) / height) * 2 - 0.5));
    return { x, y };
  };

  const wireHandle = (button: HTMLButtonElement, which: 'h1' | 'h2'): void => {
    button.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 0.1 : 0.01;
      const key = which === 'h1' ? { x: state.x1, y: state.y1 } : { x: state.x2, y: state.y2 };
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        moveTo(which, key.x + (event.key === 'ArrowRight' ? step : -step), key.y);
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        moveTo(which, key.x, key.y + (event.key === 'ArrowUp' ? step : -step));
      }
    });
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const move = (moveEvent: PointerEvent): void => {
        const point = pointerFrom(moveEvent);
        moveTo(which, point.x, point.y);
      };
      const up = (): void => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  };

  wireHandle(handle1, 'h1');
  wireHandle(handle2, 'h2');

  reset.addEventListener('click', () => {
    state.x1 = DEFAULT_CURVE.x1;
    state.y1 = DEFAULT_CURVE.y1;
    state.x2 = DEFAULT_CURVE.x2;
    state.y2 = DEFAULT_CURVE.y2;
    draw();
  });

  const playDemo = (): void => {
    const curve = printedCurve(state);
    block.style.transition = 'none';
    block.style.transform = 'translateX(0)';
    if (reducedMotion()) {
      block.style.transition = 'none';
      block.style.transform = `translateX(calc(100% - 40px))`;
      return;
    }
    window.requestAnimationFrame(() => {
      block.style.transition = `transform 1s ${curve}`;
      block.style.transform = `translateX(calc(100% - 40px))`;
    });
  };

  replay.addEventListener('click', playDemo);
  block.addEventListener('transitionend', () => {
    if (block.style.transform.includes('100%')) {
      window.setTimeout(() => {
        block.style.transition = 'none';
        block.style.transform = 'translateX(0)';
      }, 400);
    }
  });

  draw();
}

export function initRuleFocus(): void {
  const rule = (window as unknown as { __focusRule?: string }).__focusRule;
  if (!rule) return;
  const item = document.getElementById(rule);
  if (!item) return;
  item.scrollIntoView({ block: 'center', behavior: 'auto' });
  item.setAttribute('tabindex', '-1');
  item.focus();
}
