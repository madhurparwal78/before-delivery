import { clamp, el, prefersReducedMotion } from '../dom.js';
import { registerCleanup } from '../main.js';

interface Keyframe {
  time: number;
  value: number;
}

interface Track {
  property: string;
  keyframes: Keyframe[];
}

const TRACKS: Track[] = [
  { property: 'Opacity', keyframes: [{ time: 0, value: 0 }, { time: 2, value: 1 }, { time: 10, value: 1 }, { time: 12, value: 0 }] },
  { property: 'Scale', keyframes: [{ time: 0, value: 0.8 }, { time: 3, value: 1 }, { time: 12, value: 1 }] },
  { property: 'Offset X', keyframes: [{ time: 0, value: -40 }, { time: 4, value: 0 }, { time: 8, value: 0 }, { time: 12, value: 40 }] },
  { property: 'Offset Y', keyframes: [{ time: 0, value: 24 }, { time: 3, value: 0 }, { time: 12, value: 0 }] },
  { property: 'Rotate', keyframes: [{ time: 0, value: -6 }, { time: 6, value: 0 }, { time: 12, value: 6 }] },
  { property: 'Blur', keyframes: [{ time: 0, value: 8 }, { time: 2, value: 0 }, { time: 10, value: 0 }, { time: 12, value: 4 }] },
];

const LENGTH = 12;

function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function valueAt(track: Track, time: number): number {
  const frames = track.keyframes;
  if (time <= frames[0]!.time) return frames[0]!.value;
  const last = frames[frames.length - 1]!;
  if (time >= last.time) return last.value;
  for (let index = 0; index < frames.length - 1; index += 1) {
    const from = frames[index]!;
    const to = frames[index + 1]!;
    if (time >= from.time && time <= to.time) {
      const span = to.time - from.time;
      return span === 0 ? to.value : from.value + ((time - from.time) / span) * (to.value - from.value);
    }
  }
  return last.value;
}

function printValue(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

/** The motion chapter's timeline. */
export function timelineFigure(): HTMLElement {
  let playhead = 0;
  let playing = false;
  let raf = 0;

  const readout = el('p', { class: 'figure-readout' }, `${clock(0)} / ${clock(LENGTH)}`);
  const slider = el('input', {
    type: 'range',
    min: '0',
    max: String(LENGTH),
    step: '1',
    value: '0',
    'aria-label': 'Playhead',
    class: 'playhead',
  }) as HTMLInputElement;

  const valuesBody = el('tbody');
  const marker = el('span', { class: 'timeline-marker', 'aria-hidden': 'true' });

  const paint = (): void => {
    slider.value = String(playhead);
    readout.textContent = `${clock(playhead)} / ${clock(LENGTH)}`;
    marker.style.left = `${(playhead / LENGTH) * 100}%`;
    valuesBody.replaceChildren(
      ...TRACKS.map((track) =>
        el('tr', {}, el('th', { scope: 'row' }, track.property), el('td', {}, printValue(valueAt(track, playhead)))),
      ),
    );
  };

  const setPlayhead = (seconds: number): void => {
    playhead = clamp(Math.round(seconds), 0, LENGTH);
    paint();
  };

  slider.addEventListener('input', () => setPlayhead(Number(slider.value)));

  const timeline = el(
    'div',
    { class: 'timeline', role: 'group', 'aria-label': 'Timeline' },
    marker,
    ...TRACKS.map((track) =>
      el(
        'span',
        { class: 'timeline-track', 'aria-hidden': 'true' },
        ...track.keyframes.map((frame) =>
          el('span', { class: 'timeline-dot', style: `left:${(frame.time / LENGTH) * 100}%` }),
        ),
      ),
    ),
  );

  const fromPointer = (event: PointerEvent): void => {
    const rect = timeline.getBoundingClientRect();
    setPlayhead(((event.clientX - rect.left) / rect.width) * LENGTH);
  };
  timeline.addEventListener('pointerdown', (event) => {
    timeline.setPointerCapture(event.pointerId);
    fromPointer(event);
  });
  timeline.addEventListener('pointermove', (event) => {
    if (event.buttons === 1) fromPointer(event);
  });

  const playButton = el('button', { type: 'button', class: 'pill' }, 'Play') as HTMLButtonElement;
  const stop = (): void => {
    playing = false;
    playButton.textContent = 'Play';
    cancelAnimationFrame(raf);
  };
  playButton.addEventListener('click', () => {
    if (playing) {
      stop();
      return;
    }
    if (prefersReducedMotion()) {
      setPlayhead(LENGTH);
      return;
    }
    playing = true;
    playButton.textContent = 'Pause';
    const startedAt = performance.now();
    const startValue = playhead >= LENGTH ? 0 : playhead;
    const step = (): void => {
      if (!playing) return;
      const elapsed = (performance.now() - startedAt) / 1000;
      setPlayhead(startValue + elapsed);
      if (startValue + elapsed >= LENGTH) {
        setPlayhead(LENGTH);
        stop();
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  });
  registerCleanup(stop);

  const keyframeButtons = el(
    'div',
    { class: 'keyframe-buttons' },
    ...TRACKS.flatMap((track) =>
      track.keyframes.map((frame) =>
        el(
          'button',
          {
            type: 'button',
            class: 'chip-button',
            'aria-label': `${track.property} keyframe at ${clock(frame.time)}`,
            onclick: () => setPlayhead(frame.time),
          },
          `${track.property} ${clock(frame.time)}`,
        ),
      ),
    ),
  );

  paint();

  return el(
    'div',
    { class: 'figure' },
    el(
      'ul',
      { 'aria-label': 'Tracks', class: 'track-list' },
      ...TRACKS.map((track) => el('li', {}, `${track.property}, ${track.keyframes.length} keyframes`)),
    ),
    timeline,
    slider,
    readout,
    playButton,
    keyframeButtons,
    el(
      'table',
      { class: 'values-table' },
      el('caption', {}, 'Values at playhead'),
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Property'), el('th', { scope: 'col' }, 'Value'))),
      valuesBody,
    ),
    el(
      'p',
      { class: 'figure-text' },
      'Title sequences finish within 12 seconds. Move the playhead by whole seconds to read every property at that moment.',
    ),
  );
}

interface Curve {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const DEFAULT_CURVE: Curve = { x1: 0.3, y1: 0, x2: 0.2, y2: 1 };
const PLOT = 320;

function printCurve(curve: Curve): string {
  const values = [curve.x1, curve.y1, curve.x2, curve.y2].map((value) => value.toFixed(2));
  return `cubic-bezier(${values.join(', ')})`;
}

/** The motion chapter's curve editor. */
export function curveFigure(): HTMLElement {
  let curve: Curve = { ...DEFAULT_CURVE };

  const printed = el('p', { class: 'figure-readout', role: 'status', 'aria-live': 'polite', 'aria-label': 'Printed curve' });
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#1F4E8C');
  path.setAttribute('stroke-width', '3');

  const plot = el('div', { class: 'curve-plot' });
  const canvas = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  canvas.setAttribute('viewBox', `0 0 ${PLOT} ${PLOT}`);
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('class', 'curve-canvas');
  canvas.appendChild(path);
  plot.appendChild(canvas);

  const toPixels = (x: number, y: number): { left: number; top: number } => ({
    left: x * PLOT,
    top: ((1.5 - y) / 2) * PLOT,
  });

  const handles: { button: HTMLButtonElement; text: HTMLElement; key: 1 | 2 }[] = [];

  const paint = (): void => {
    const first = toPixels(curve.x1, curve.y1);
    const second = toPixels(curve.x2, curve.y2);
    const start = toPixels(0, 0);
    const end = toPixels(1, 1);
    path.setAttribute(
      'd',
      `M${start.left} ${start.top} C${first.left} ${first.top}, ${second.left} ${second.top}, ${end.left} ${end.top}`,
    );
    printed.textContent = printCurve(curve);
    for (const handle of handles) {
      const point = handle.key === 1 ? { x: curve.x1, y: curve.y1 } : { x: curve.x2, y: curve.y2 };
      const pixels = toPixels(point.x, point.y);
      handle.button.style.left = `${pixels.left}px`;
      handle.button.style.top = `${pixels.top}px`;
      handle.text.textContent = `x ${point.x.toFixed(2)}, y ${point.y.toFixed(2)}`;
    }
  };

  const update = (key: 1 | 2, x: number, y: number): void => {
    const nextX = Math.round(clamp(x, 0, 1) * 100) / 100;
    const nextY = Math.round(clamp(y, -0.5, 1.5) * 100) / 100;
    curve = key === 1 ? { ...curve, x1: nextX, y1: nextY } : { ...curve, x2: nextX, y2: nextY };
    paint();
  };

  for (const key of [1, 2] as const) {
    const textId = `curve-handle-${key}-value`;
    const text = el('span', { class: 'handle-value', id: textId });
    const button = el('button', {
      type: 'button',
      class: 'curve-handle',
      'aria-label': `Handle ${key}`,
      'aria-describedby': textId,
      onkeydown: (event: Event) => {
        const keyboard = event as KeyboardEvent;
        const step = keyboard.shiftKey ? 0.1 : 0.01;
        const point = key === 1 ? { x: curve.x1, y: curve.y1 } : { x: curve.x2, y: curve.y2 };
        if (keyboard.key === 'ArrowLeft') update(key, point.x - step, point.y);
        else if (keyboard.key === 'ArrowRight') update(key, point.x + step, point.y);
        else if (keyboard.key === 'ArrowUp') update(key, point.x, point.y + step);
        else if (keyboard.key === 'ArrowDown') update(key, point.x, point.y - step);
        else return;
        keyboard.preventDefault();
      },
      onpointerdown: (event: Event) => {
        const pointer = event as PointerEvent;
        (pointer.target as HTMLElement).setPointerCapture(pointer.pointerId);
      },
      onpointermove: (event: Event) => {
        const pointer = event as PointerEvent;
        if (pointer.buttons !== 1 && pointer.pointerType === 'mouse') return;
        const rect = plot.getBoundingClientRect();
        update(
          key,
          (pointer.clientX - rect.left) / rect.width,
          1.5 - ((pointer.clientY - rect.top) / rect.height) * 2,
        );
      },
    }) as HTMLButtonElement;
    handles.push({ button, text, key });
    plot.append(button, text);
  }

  const block = el('span', { class: 'demo-block', 'aria-hidden': 'true' });
  const demo = el('div', { class: 'curve-demo', role: 'region', 'aria-label': 'Curve demo' }, block);

  const replay = el(
    'button',
    {
      type: 'button',
      class: 'pill',
      onclick: () => {
        if (prefersReducedMotion()) {
          block.style.transition = 'none';
          block.style.transform = 'translateX(calc(100% * 3))';
          return;
        }
        block.style.transition = 'none';
        block.style.transform = 'translateX(0)';
        void block.offsetWidth;
        block.style.transition = `transform 1s ${printCurve(curve)}`;
        block.style.transform = 'translateX(calc(100% * 3))';
      },
    },
    'Replay',
  );

  const reset = el(
    'button',
    {
      type: 'button',
      class: 'pill',
      onclick: () => {
        curve = { ...DEFAULT_CURVE };
        paint();
      },
    },
    'Reset curve',
  );

  paint();

  return el(
    'div',
    { class: 'figure' },
    el('div', { class: 'curve-editor', role: 'group', 'aria-label': 'Curve editor' }, plot),
    printed,
    el('div', { class: 'figure-actions' }, reset, replay),
    demo,
    el(
      'p',
      { class: 'figure-text' },
      'Panels open on the standard easing curve. Move either handle with the arrow keys, or drag it, to reshape the curve.',
    ),
  );
}
