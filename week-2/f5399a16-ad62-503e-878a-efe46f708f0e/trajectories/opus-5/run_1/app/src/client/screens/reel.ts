import { LABELS, say } from '../../domain/copy.js';
import {
  isDropFrame,
  nominalFrames,
  secondsText,
  timecode,
} from '../../domain/timecode.js';
import type { FrameRate } from '../../domain/timecode.js';
import {
  announce,
  api,
  openSurface,
  redraw,
  registerScreen,
  run,
  state,
} from '../app.js';
import type { Child } from '../dom.js';
import { h } from '../dom.js';
import { NORMAL, QUICK, SLOW, animate, playMoves, recordPlaces, reducedMotion } from '../motion.js';
import { registerSurface } from '../shell.js';
import { button, loadingBars, surfaceView } from '../ui.js';
import { jobNav, loadJob } from './job.js';
import type { Board, BoardFrame } from './job.js';
import type { Job } from './jobs.js';

/** Every clip is 2 CSS pixels per frame. */
const PIXELS_A_FRAME = 2;

type ReelData = { job: Job; board: Board };

let playhead = 0;
let playing = false;
let playTimer: number | null = null;
let tipFrame: number | null = null;
let scrubbing = false;

registerScreen({
  name: 'jobReel',
  frame: 'desk',
  refreshes: true,
  heading: (raw) => `Reel for ${(raw as unknown as ReelData).job?.title ?? ''}`,
  load: async () => {
    const jobId = state.screen.jobId ?? '';
    const [job, board] = await Promise.all([
      loadJob(jobId),
      api<Board>(`/api/jobs/${jobId}/board`),
    ]);
    return { job, board } as unknown as Record<string, unknown>;
  },
  mainAction: (raw) => {
    const board = (raw as unknown as ReelData).board;
    if (board === undefined) return null;
    return h(
      'div',
      { class: 'pair' },
      button({ id: 'earlier', label: 'Earlier', onPress: () => step(board, -1) }),
      button({
        id: 'play',
        label: playing ? 'Pause' : 'Play',
        kind: 'primary',
        onPress: () => togglePlay(board),
      }),
      button({ id: 'later', label: 'Later', onPress: () => step(board, 1) }),
    );
  },
  view: (raw) => {
    const data = raw as unknown as ReelData;
    if (state.loading || data.board === undefined) return [loadingBars('Reading the reel')];
    const board = data.board;
    const rate = board.frameRate as FrameRate;
    const starts = frameStarts(board.frames);
    const selected = clipAt(board, playhead);
    return [
      jobNav(data.job.id, '/reel'),
      h(
        'div',
        { key: 'stage', class: 'strip-stage' },
        h(
          'div',
          {
            key: 'scroll',
            class: 'strip-scroll',
            role: 'region',
            'aria-label': 'Slate strip frame',
            tabindex: '0',
          },
          h(
            'div',
            {
              class: 'strip',
              role: 'group',
              'aria-label': 'Slate strip',
              onkeydown: (event: Event) => stripKeys(event as KeyboardEvent, board),
              onpointermove: (event: Event) => scrub(event as PointerEvent, board),
              onpointerup: () => {
                scrubbing = false;
              },
            },
            ...board.frames.map((frame, index) =>
              h(
                'button',
                {
                  key: `clip-${frame.number}`,
                  id: `clip-${frame.number}`,
                  type: 'button',
                  class: 'clip',
                  'data-part': 'clip',
                  'data-frame': String(frame.number),
                  'data-duration': String(frame.durationFrames),
                  'aria-label': `Frame ${frame.number}`,
                  'aria-current': selected?.number === frame.number ? 'true' : 'false',
                  tabindex: selected?.number === frame.number ? '0' : '-1',
                  style: `width:${frame.durationFrames * PIXELS_A_FRAME}px`,
                  onpointerdown: (event: Event) => {
                    scrubbing = true;
                    startScrub(event as PointerEvent, board, index, starts);
                  },
                  onpointerenter: () => showTip(frame.number),
                  onfocus: () => showTip(frame.number),
                  onblur: () => hideTip(),
                  onclick: () => undefined,
                },
                frame.drawingUrl === null
                  ? null
                  : h('img', { src: frame.drawingUrl, alt: '', loading: 'lazy' }),
              ),
            ),
            h('span', {
              key: 'playhead',
              'data-part': 'playhead',
              'data-position': String(playhead),
              style: `inset-inline-start:${playhead * PIXELS_A_FRAME}px`,
            }),
          ),
        ),
        h(
          'p',
          { key: 'numerals', class: 'numerals' },
          h('span', { 'data-part': 'timecode' }, timecode(playhead, rate)),
          h('span', { 'data-part': 'seconds' }, secondsText(board.totalFrames, rate)),
          h('span', { 'data-part': 'target' }, board.targetText),
        ),
      ),
      h(
        'div',
        {
          key: 'rates',
          class: 'radio-row',
          role: 'radiogroup',
          'aria-label': 'Frame rate',
        },
        ...Object.entries(LABELS.frameRate).map(([value, label]) =>
          h(
            'label',
            { key: value, class: 'radio' },
            h('input', {
              type: 'radio',
              name: 'frame-rate',
              checked: board.frameRate === value,
              onchange: () => void changeRate(board, value as FrameRate),
            }),
            h('span', {}, label),
          ),
        ),
      ),
      tipFrame === null ? null : clipTip(board, tipFrame, starts),
      h(
        'p',
        { key: 'help' },
        'Left and Right step a frame, Shift steps a second. [ and ] trim the selected clip.',
      ),
    ];
  },
});

function frameStarts(frames: readonly BoardFrame[]): number[] {
  let running = 0;
  return frames.map((frame) => {
    const start = running;
    running += frame.durationFrames;
    return start;
  });
}

function clipAt(board: Board, at: number): BoardFrame | undefined {
  const starts = frameStarts(board.frames);
  for (let index = board.frames.length - 1; index >= 0; index -= 1) {
    if ((starts[index] as number) <= at) return board.frames[index];
  }
  return board.frames[0];
}

function lastFrame(board: Board): number {
  return Math.max(0, board.totalFrames - 1);
}

function step(board: Board, by: number): void {
  playhead = Math.min(lastFrame(board), Math.max(0, playhead + by));
  redraw();
  keepClipInView(board);
}

function keepClipInView(board: Board): void {
  requestAnimationFrame(() => {
    const clip = clipAt(board, playhead);
    if (clip === undefined) return;
    document
      .getElementById(`clip-${clip.number}`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

function stripKeys(event: KeyboardEvent, board: Board): void {
  const second = nominalFrames(board.frameRate as FrameRate);
  const selected = clipAt(board, playhead);
  switch (event.key) {
    case 'ArrowLeft':
      event.preventDefault();
      step(board, event.shiftKey ? -second : -1);
      return;
    case 'ArrowRight':
      event.preventDefault();
      step(board, event.shiftKey ? second : 1);
      return;
    case 'Home':
      event.preventDefault();
      playhead = 0;
      redraw();
      keepClipInView(board);
      return;
    case 'End':
      event.preventDefault();
      playhead = lastFrame(board);
      redraw();
      keepClipInView(board);
      return;
    case ' ':
      event.preventDefault();
      togglePlay(board);
      return;
    case 'Enter':
      event.preventDefault();
      if (selected !== undefined) growClip(selected.number);
      return;
    case '[':
      event.preventDefault();
      if (selected !== undefined) void trim(board, selected, event.shiftKey ? -second : -1);
      return;
    case ']':
      event.preventDefault();
      if (selected !== undefined) void trim(board, selected, event.shiftKey ? second : 1);
      return;
    case 'Escape':
      hideTip();
      return;
    default:
  }
}

/** Trimming moves the later clips as the same elements in 160 ms. */
async function trim(board: Board, frame: BoardFrame, by: number): Promise<void> {
  const wanted = Math.max(1, frame.durationFrames + by);
  if (wanted === frame.durationFrames) return;
  const places = recordPlaces(document.querySelectorAll('[data-part="clip"]'));
  await run(`trim-${frame.number}`, async () => {
    const next = await api<Board>(`/api/jobs/${board.jobId}/frames/${frame.number}`, {
      method: 'PATCH',
      body: { durationFrames: wanted, stamp: board.stamp },
    });
    (state.data as unknown as ReelData).board = next;
    playhead = Math.min(lastFrame(next), playhead);
    redraw();
    announce(say.frameNowFrames(frame.number, wanted));
    requestAnimationFrame(() => playMoves(places, QUICK));
  });
}

/**
 * Changing the frame rate changes every clip's width, rolls the numerals and
 * glides the playhead, each for its published time.
 */
async function changeRate(board: Board, rate: FrameRate): Promise<void> {
  const places = recordPlaces(document.querySelectorAll('[data-part="clip"]'));
  const numerals = document.querySelector('.numerals');
  await run('frame-rate', async () => {
    const next = await api<Board & { playhead: number }>(
      `/api/jobs/${board.jobId}/frame-rate`,
      { method: 'POST', body: { frameRate: rate, playhead, stamp: board.stamp } },
    );
    (state.data as unknown as ReelData).board = next;
    playhead = next.playhead;
    redraw();
    announce(say.frameRateNow(rate));
    requestAnimationFrame(() => {
      playMoves(places, NORMAL);
      if (numerals !== null) {
        animate(
          numerals,
          [
            { transform: 'translateY(0)', opacity: 1 },
            { transform: 'translateY(-0.6em)', opacity: 0, offset: 0.5 },
            { transform: 'translateY(0)', opacity: 1 },
          ],
          NORMAL,
        );
      }
      const head = document.querySelector('[data-part="playhead"]');
      if (head !== null) animate(head, [{ opacity: 0.4 }, { opacity: 1 }], SLOW);
    });
  });
}

/** Playback steps the playhead frame by frame at the job's rate. */
function togglePlay(board: Board): void {
  if (playing) {
    stopPlay();
    redraw();
    return;
  }
  playing = true;
  const rate = board.frameRate as FrameRate;
  const everyMs = isDropFrame(rate)
    ? 1001 / 30
    : rate === '23.976'
      ? 1001 / 24
      : 1000 / 25;
  playTimer = window.setInterval(() => {
    if (document.hidden) {
      stopPlay();
      redraw();
      return;
    }
    if (playhead >= lastFrame(board)) {
      stopPlay();
      redraw();
      return;
    }
    playhead += 1;
    redraw();
  }, everyMs);
  redraw();
}

function stopPlay(): void {
  playing = false;
  if (playTimer !== null) {
    window.clearInterval(playTimer);
    playTimer = null;
  }
}

function startScrub(
  event: PointerEvent,
  board: Board,
  index: number,
  starts: number[],
): void {
  const clip = event.currentTarget as HTMLElement;
  const box = clip.getBoundingClientRect();
  const within = Math.max(0, Math.round((event.clientX - box.left) / PIXELS_A_FRAME));
  playhead = Math.min(lastFrame(board), (starts[index] ?? 0) + within);
  clip.setPointerCapture(event.pointerId);
  redraw();
}

/** Scrubbing keeps working when the pointer leaves the strip, until release. */
function scrub(event: PointerEvent, board: Board): void {
  if (!scrubbing) return;
  const strip = document.querySelector('.strip');
  if (strip === null) return;
  const box = strip.getBoundingClientRect();
  playhead = Math.min(
    lastFrame(board),
    Math.max(0, Math.round((event.clientX - box.left) / PIXELS_A_FRAME)),
  );
  redraw();
}

function showTip(frame: number): void {
  tipFrame = frame;
  redraw();
  requestAnimationFrame(() => {
    const tip = document.querySelector('.tip');
    const clip = document.getElementById(`clip-${frame}`);
    if (!(tip instanceof HTMLElement) || clip === null) return;
    const box = clip.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - tip.offsetWidth - 8))}px`;
    tip.style.top = `${Math.max(8, box.top - tip.offsetHeight - 8)}px`;
  });
}

function hideTip(): void {
  if (tipFrame === null) return;
  tipFrame = null;
  redraw();
}

function clipTip(board: Board, frame: number, starts: number[]): Child {
  const index = board.frames.findIndex((candidate) => candidate.number === frame);
  const held = board.frames[index];
  if (held === undefined) return null;
  const rate = board.frameRate as FrameRate;
  const start = starts[index] ?? 0;
  return h(
    'div',
    {
      key: 'tip',
      class: 'tip',
      role: 'tooltip',
      onpointerenter: () => showTip(frame),
      onpointerleave: () => hideTip(),
    },
    say.clipTip(
      frame,
      timecode(start, rate),
      timecode(start + held.durationFrames, rate),
    ),
  );
}

/** Enter grows the clip's drawing into the large view, which grows from its clip. */
function growClip(frame: number): void {
  openSurface(`Frame ${frame}`, `clip-${frame}`, { payload: { frame } });
  if (reducedMotion()) return;
  requestAnimationFrame(() => {
    const clip = document.getElementById(`clip-${frame}`);
    const large = document.querySelector('[data-part="frame-large"]');
    if (!(clip instanceof HTMLElement) || !(large instanceof HTMLElement)) return;
    const from = clip.getBoundingClientRect();
    const to = large.getBoundingClientRect();
    animate(
      large,
      [
        {
          transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${
            from.width / to.width
          }, ${from.height / to.height})`,
          transformOrigin: 'top left',
        },
        { transform: 'none', transformOrigin: 'top left' },
      ],
      NORMAL,
    );
  });
}

registerSurface('Frame', (surface) => {
  const data = state.data as unknown as ReelData;
  const frame = Number(surface.payload['frame'] ?? '0');
  const held = data.board?.frames.find((candidate) => candidate.number === frame);
  return surfaceView(surface, {
    title: `Frame ${frame}`,
    body: [
      h(
        'div',
        { 'data-part': 'frame-large', class: 'drawn' },
        held?.drawingUrl === null || held === undefined
          ? h('p', {}, 'No drawing yet')
          : h('img', { src: held.drawingUrl, alt: `Frame ${frame}` }),
      ),
      h(
        'p',
        { class: 'numeric' },
        `${held?.durationFrames ?? 0} frames · ${held?.actionNote ?? ''}`,
      ),
    ],
  });
});
