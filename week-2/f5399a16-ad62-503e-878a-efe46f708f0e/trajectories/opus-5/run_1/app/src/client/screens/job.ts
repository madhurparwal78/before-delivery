import { COPY, LABELS, say } from '../../domain/copy.js';
import {
  announce,
  api,
  closeSurface,
  focusBack,
  focusHeading,
  isRefusal,
  openSurface,
  redraw,
  refreshOnce,
  registerScreen,
  run,
  state,
} from '../app.js';
import type { Surface } from '../app.js';
import type { Child } from '../dom.js';
import { h } from '../dom.js';
import { NORMAL, playMoves, recordPlaces } from '../motion.js';
import { registerSurface } from '../shell.js';
import {
  button,
  combobox,
  emptyState,
  field,
  link,
  loadingBars,
  openMenu,
  problemsRegion,
  surfaceView,
} from '../ui.js';
import { guard } from './clients.js';
import type { Job } from './jobs.js';

export type BoardFrame = {
  number: number;
  position: number;
  durationFrames: number;
  actionNote: string;
  audioNote: string;
  shot: string;
  visual: string;
  fileName: string | null;
  width: number | null;
  height: number | null;
  sha256: string | null;
  drawingUrl: string | null;
};

export type Board = {
  jobId: string;
  stamp: string;
  frameRate: string;
  targetSeconds: number;
  targetFrames: number;
  totalFrames: number;
  secondsText: string;
  targetText: string;
  frames: BoardFrame[];
};

export type Removal = { frame: number; position: number; endsAt: string };

/** `navigation "This job"` scrolls sideways inside its own frame at 375. */
export function jobNav(jobId: string, here: string): Child {
  const pages: [string, string][] = [
    ['', 'Board'],
    ['/script', 'Script'],
    ['/reel', 'Reel'],
    ['/lines', 'Lines'],
    ['/cues', 'Cues'],
    ['/cuts', 'Cuts'],
    ['/notes', 'Notes'],
    ['/delivery', 'Delivery'],
    ['/letter', 'Fee letter'],
  ];
  return h(
    'nav',
    { key: 'job-nav', class: 'job-nav', 'aria-label': 'This job', tabindex: '0' },
    h(
      'ul',
      {},
      ...pages.map(([suffix, label]) =>
        h(
          'li',
          { key: label },
          link(`/desk/jobs/${jobId}${suffix}`, label, {
            ...(suffix === here ? { 'aria-current': 'page', class: 'link marked' } : {}),
          }),
        ),
      ),
    ),
  );
}

export async function loadJob(jobId: string): Promise<Job> {
  return api<Job>(`/api/jobs/${jobId}`);
}

type BoardData = { job: Job; board: Board; removals: Removal[] };

type UploadRow = {
  key: string;
  fileName: string;
  phase: 'waiting' | 'sending' | 'stored' | 'refused';
  message: string;
  file: File;
};

let uploads: UploadRow[] = [];
let focusedFrame: number | null = null;
let selected = new Set<number>();
let undoFrame: number | null = null;
let holdTimer: number | null = null;

registerScreen({
  name: 'job',
  frame: 'desk',
  refreshes: true,
  heading: (raw) => (raw as unknown as BoardData).job?.title ?? '',
  load: async () => {
    const jobId = state.screen.jobId ?? '';
    const [job, board, removals] = await Promise.all([
      loadJob(jobId),
      api<Board>(`/api/jobs/${jobId}/board`),
      api<{ removals: Removal[] }>(`/api/jobs/${jobId}/removals`),
    ]);
    return { job, board, removals: removals.removals } as unknown as Record<string, unknown>;
  },
  mainAction: () =>
    button({
      id: 'upload-frames',
      label: 'Upload frames',
      kind: 'primary',
      onPress: () => document.getElementById('frame-files')?.click(),
    }),
  view: (raw) => {
    const data = raw as unknown as BoardData;
    if (state.loading || data.board === undefined) return [loadingBars('Reading the board')];
    const board = data.board;
    const frames = board.frames;
    const current = frames.find((frame) => frame.number === focusedFrame) ?? frames[0];
    return [
      jobNav(data.job.id, ''),
      h(
        'div',
        { key: 'job-actions', class: 'row-actions' },
        button({
          id: 'edit-job',
          label: 'Edit job',
          onPress: () =>
            openSurface('Edit job', 'edit-job', {
              values: {
                title: data.job.title,
                adId: data.job.adId,
                dueDate: data.job.dueDate,
                targetSeconds: String(data.job.targetSeconds),
              },
            }),
        }),
      ),
      h(
        'p',
        { key: 'summary', class: 'numeric' },
        `${board.frames.length} frames · ${board.secondsText} · ${board.targetText}`,
      ),
      h(
        'div',
        { key: 'upload-area', class: 'file-field' },
        h('label', { class: 'field__label', for: 'frame-files' }, 'Frame files'),
        h('input', {
          id: 'frame-files',
          name: 'Frame files',
          type: 'file',
          multiple: true,
          accept: 'image/png,image/jpeg',
          class: 'input',
          onchange: (event: Event) => {
            const picked = (event.target as HTMLInputElement).files;
            if (picked !== null) void takeFiles([...picked], board.jobId);
          },
          ondrop: (event: Event) => {
            event.preventDefault();
            const dropped = (event as DragEvent).dataTransfer?.files;
            if (dropped !== undefined) void takeFiles([...dropped], board.jobId);
          },
        }),
      ),
      uploads.length === 0
        ? null
        : h(
            'ul',
            { key: 'uploads', class: 'uploads', 'aria-label': 'Uploads' },
            ...uploads.map((row) =>
              h(
                'li',
                { key: row.key },
                h('span', { class: 'uploads__name' }, row.fileName),
                h('span', {}, row.message),
                row.phase === 'refused'
                  ? button({
                      id: `try-again-${row.key}`,
                      label: 'Try again',
                      pendingKey: `upload-${row.key}`,
                      onPress: () => void sendOne(row, board.jobId),
                    })
                  : null,
              ),
            ),
          ),
      undoFrame === null
        ? null
        : h(
            'div',
            { key: 'undo', class: 'panel' },
            h('p', {}, say.frameRemoved(undoFrame)),
            button({
              id: 'undo',
              label: 'Undo',
              pendingKey: 'undo',
              extra: {
                onpointerenter: holdWindow,
                onfocus: holdWindow,
                onpointerleave: stopHolding,
                onblur: stopHolding,
              },
              onPress: () => void undoRemoval(board.jobId),
            }),
          ),
      frames.length === 0
        ? emptyState('No frame on this board yet. Upload drawings to start.')
        : h(
            'ul',
            {
              key: 'board',
              class: 'board',
              role: 'listbox',
              'aria-label': 'Board',
              'aria-multiselectable': 'true',
              onkeydown: (event: Event) => boardKeys(event as KeyboardEvent, board),
            },
            ...frames.map((frame) =>
              h(
                'li',
                {
                  key: `frame-${frame.number}`,
                  id: `board-frame-${frame.number}`,
                  class: 'board-frame',
                  role: 'option',
                  'data-part': 'board-frame',
                  'data-frame': String(frame.number),
                  'data-position': String(frame.position),
                  'aria-selected': selected.has(frame.number) ? 'true' : 'false',
                  tabindex: (current?.number ?? 0) === frame.number ? '0' : '-1',
                  draggable: 'true',
                  onfocus: () => {
                    focusedFrame = frame.number;
                    redraw();
                  },
                  onclick: () => {
                    focusedFrame = frame.number;
                    selected = new Set([frame.number]);
                    redraw();
                  },
                  ondragstart: (event: Event) => {
                    (event as DragEvent).dataTransfer?.setData('text/plain', String(frame.number));
                  },
                  ondragover: (event: Event) => event.preventDefault(),
                  ondrop: (event: Event) => {
                    event.preventDefault();
                    const moved = Number(
                      (event as DragEvent).dataTransfer?.getData('text/plain') ?? '0',
                    );
                    if (moved !== 0) void moveFrame(board, moved, frame.position);
                  },
                },
                h(
                  'span',
                  { class: 'pair' },
                  h('span', { class: 'board-frame__mark', 'aria-hidden': 'true' }),
                  `Frame ${frame.number}`,
                ),
                frame.drawingUrl === null
                  ? h('span', { class: 'muted' }, 'No drawing yet')
                  : h('img', { src: frame.drawingUrl, alt: '', loading: 'lazy' }),
                h('span', { class: 'numeric' }, `Position ${frame.position}`),
              ),
            ),
          ),
      current === undefined
        ? null
        : h(
            'div',
            { key: 'tools', class: 'row-actions', role: 'group', 'aria-label': 'Frame tools' },
            button({
              id: 'move-earlier',
              label: 'Move earlier',
              disabledLook: current.position === 1,
              onPress: () => void moveFrame(board, current.number, current.position - 1, 'button'),
            }),
            button({
              id: 'move-later',
              label: 'Move later',
              disabledLook: current.position === frames.length,
              onPress: () => void moveFrame(board, current.number, current.position + 1, 'button'),
            }),
            button({
              id: 'edit-frame',
              label: `Edit frame ${current.number}`,
              onPress: () =>
                openSurface(`Edit frame ${current.number}`, 'edit-frame', {
                  values: {
                    number: String(current.number),
                    durationFrames: String(current.durationFrames),
                    actionNote: current.actionNote,
                    stamp: board.stamp,
                  },
                }),
            }),
            button({
              id: 'frame-actions',
              label: `Actions for frame ${current.number}`,
              extra: { 'aria-haspopup': 'menu' },
              onPress: () => openFrameMenu(board, current),
            }),
          ),
    ];
  },
});

function boardKeys(event: KeyboardEvent, board: Board): void {
  const frames = board.frames;
  const at = frames.findIndex((frame) => frame.number === focusedFrame);
  const index = at === -1 ? 0 : at;
  const move = (step: number): void => {
    const next = frames[Math.min(frames.length - 1, Math.max(0, index + step))];
    if (next === undefined) return;
    focusedFrame = next.number;
    if (event.shiftKey) selected.add(next.number);
    redraw();
    requestAnimationFrame(() => document.getElementById(`board-frame-${next.number}`)?.focus());
  };
  if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    event.preventDefault();
    const frame = frames[index];
    if (frame === undefined) return;
    void moveFrame(board, frame.number, frame.position + (event.key === 'ArrowLeft' ? -1 : 1));
    return;
  }
  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      event.preventDefault();
      move(1);
      return;
    case 'ArrowLeft':
    case 'ArrowUp':
      event.preventDefault();
      move(-1);
      return;
    case 'Home':
      event.preventDefault();
      move(-frames.length);
      return;
    case 'End':
      event.preventDefault();
      move(frames.length);
      return;
    case 'Escape':
      selected = new Set();
      redraw();
      return;
    case 'a':
    case 'A':
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        selected = new Set(frames.map((frame) => frame.number));
        redraw();
      }
      return;
    case ' ':
      event.preventDefault();
      if (focusedFrame !== null) {
        if (selected.has(focusedFrame)) selected.delete(focusedFrame);
        else selected.add(focusedFrame);
        redraw();
      }
      return;
    default:
  }
}

/** Moved frames travel as the same elements, and focus stays on the control used. */
async function moveFrame(
  board: Board,
  number: number,
  position: number,
  from: 'tile' | 'button' = 'tile',
): Promise<void> {
  const frames = board.frames;
  if (position < 1 || position > frames.length) return;
  const places = recordPlaces(document.querySelectorAll('[data-part="board-frame"]'));
  await run(`move-${number}`, async () => {
    const next = await api<Board>(`/api/jobs/${board.jobId}/frames/${number}/move`, {
      method: 'POST',
      body: { position, stamp: board.stamp },
    });
    (state.data as unknown as BoardData).board = next;
    focusedFrame = number;
    redraw();
    announce(say.frameMoved(number, position, next.frames.length));
    requestAnimationFrame(() => {
      playMoves(places, NORMAL);
      if (from === 'tile') document.getElementById(`board-frame-${number}`)?.focus();
    });
  });
}

function openFrameMenu(board: Board, frame: BoardFrame): void {
  openMenu(`Actions for frame ${frame.number}`, 'frame-actions', [
    {
      label: 'Duplicate',
      run: () =>
        void run(`duplicate-${frame.number}`, async () => {
          const next = await api<Board>(
            `/api/jobs/${board.jobId}/frames/${frame.number}/duplicate`,
            { method: 'POST', body: { stamp: board.stamp } },
          );
          const made = next.frames.find(
            (candidate) => candidate.position === frame.position + 1,
          );
          (state.data as unknown as BoardData).board = next;
          redraw();
          announce(say.frameDuplicated(frame.number, made?.number ?? frame.number));
          focusBack('frame-actions');
        }),
    },
    {
      label: 'Insert after',
      run: () =>
        void run(`insert-${frame.number}`, async () => {
          const next = await api<Board>(
            `/api/jobs/${board.jobId}/frames/${frame.number}/insert-after`,
            { method: 'POST', body: { stamp: board.stamp } },
          );
          const made = next.frames.find(
            (candidate) => candidate.position === frame.position + 1,
          );
          (state.data as unknown as BoardData).board = next;
          redraw();
          announce(say.frameInserted(made?.number ?? frame.number, frame.number));
          focusBack('frame-actions');
        }),
    },
    {
      label: 'Remove',
      run: () =>
        void run(`remove-${frame.number}`, async () => {
          await api(`/api/jobs/${board.jobId}/removals`, {
            method: 'POST',
            body: { frame: frame.number, stamp: board.stamp },
          });
          undoFrame = frame.number;
          focusedFrame = null;
          announce(say.frameRemoved(frame.number));
          await refreshOnce();
          requestAnimationFrame(() => document.getElementById('undo')?.focus());
        }),
    },
  ]);
}

/** Hovering or focusing Undo holds the window, renewed on the server every 2 seconds. */
function holdWindow(): void {
  if (holdTimer !== null || undoFrame === null) return;
  const jobId = (state.data as unknown as BoardData).board.jobId;
  const renew = (): void => {
    if (undoFrame === null) return;
    void api(`/api/jobs/${jobId}/removals/${undoFrame}/hold`, { method: 'POST' }).catch(
      () => undefined,
    );
  };
  renew();
  holdTimer = window.setInterval(renew, 2000);
}

function stopHolding(): void {
  if (holdTimer !== null) {
    window.clearInterval(holdTimer);
    holdTimer = null;
  }
}

async function undoRemoval(jobId: string): Promise<void> {
  const frame = undoFrame;
  if (frame === null) return;
  await run('undo', async () => {
    try {
      const next = await api<Board>(`/api/jobs/${jobId}/removals/${frame}/undo`, {
        method: 'POST',
      });
      (state.data as unknown as BoardData).board = next;
      undoFrame = null;
      stopHolding();
      focusedFrame = frame;
      redraw();
      announce(say.frameBack(frame));
      requestAnimationFrame(() => document.getElementById(`board-frame-${frame}`)?.focus());
    } catch (error) {
      if (isRefusal(error)) {
        undoFrame = null;
        stopHolding();
        announce(error.failure.message);
        redraw();
        focusHeading();
        return;
      }
      throw error;
    }
  });
}

/** Each row sends on its own, and one refused file never stops the others. */
async function takeFiles(files: File[], jobId: string): Promise<void> {
  const rows = files.map((file, index) => ({
    key: `${Date.now()}-${index}-${file.name}`,
    fileName: file.name,
    phase: 'waiting' as const,
    message: 'Waiting',
    file,
  }));
  uploads = [...uploads, ...rows];
  redraw();
  for (const row of rows) await sendOne(row, jobId);
}

async function sendOne(row: UploadRow, jobId: string): Promise<void> {
  row.phase = 'sending';
  row.message = 'Sending';
  redraw();
  const form = new FormData();
  form.append('file', row.file, row.fileName);
  try {
    await api(`/api/jobs/${jobId}/frames`, { form });
    row.phase = 'stored';
    row.message = 'Stored';
    announce(say.fileStored(row.fileName));
  } catch (error) {
    row.phase = 'refused';
    row.message = isRefusal(error) ? error.failure.message : COPY.storeUnavailable;
    announce(say.fileRefused(row.fileName, row.message));
  }
  redraw();
  await refreshOnce();
}

registerSurface('Edit job', (surface) => {
  const data = state.data as unknown as BoardData;
  const set = (name: string) => (value: string) => {
    surface.values[name] = value;
    redraw();
  };
  return surfaceView(surface, {
    title: 'Edit job',
    body: [
      problemsRegion(surface.problems, { withLinks: false, message: surface.message }),
      field({
        id: 'edit-title',
        label: 'Title',
        value: surface.values['title'] ?? '',
        onInput: set('title'),
        problem: surface.problems['title'],
      }),
      field({
        id: 'edit-adId',
        label: 'Ad-ID',
        value: surface.values['adId'] ?? '',
        onInput: set('adId'),
        problem: surface.problems['adId'],
      }),
      field({
        id: 'edit-dueDate',
        label: 'Due date',
        value: surface.values['dueDate'] ?? '',
        onInput: set('dueDate'),
        problem: surface.problems['dueDate'],
      }),
      combobox({
        id: 'edit-targetSeconds',
        label: 'Target length',
        value: surface.values['targetSeconds'] ?? '30',
        options: Object.entries(LABELS.targetSeconds).map(([value, label]) => ({ value, label })),
        onChange: set('targetSeconds'),
      }),
    ],
    footer: [
      button({
        id: 'save-edit-job',
        label: 'Save',
        kind: 'primary',
        pendingKey: 'edit-job',
        onPress: () =>
          void run(
            'edit-job',
            guard(surface, async () => {
              await api(`/api/jobs/${data.job.id}`, {
                method: 'PATCH',
                body: {
                  title: surface.values['title'] ?? '',
                  adId: surface.values['adId'] ?? '',
                  dueDate: surface.values['dueDate'] ?? '',
                  targetSeconds: Number(surface.values['targetSeconds'] ?? '30'),
                },
              });
              closeSurface('Edit job');
              announce(COPY.jobSaved);
              await refreshOnce();
            }),
          ),
      }),
    ],
  });
});

/** A change arriving while the Edit dialog is open is refused on save, as typed. */
registerSurface('Edit frame', (surface) =>
  frameDialog(surface, Number(surface.values['number'] ?? '0')),
);

function frameDialog(surface: Surface, number: number): Child {
  const data = state.data as unknown as BoardData;
  const set = (name: string) => (value: string) => {
    surface.values[name] = value;
    redraw();
  };
  return surfaceView(surface, {
    title: `Edit frame ${number}`,
    body: [
      problemsRegion(surface.problems, { withLinks: false, message: surface.message }),
      field({
        id: 'frame-duration',
        label: 'Duration in frames',
        value: surface.values['durationFrames'] ?? '',
        onInput: set('durationFrames'),
        problem: surface.problems['durationFrames'],
      }),
      field({
        id: 'frame-note',
        label: 'Action note',
        value: surface.values['actionNote'] ?? '',
        onInput: set('actionNote'),
        problem: surface.problems['actionNote'],
      }),
    ],
    footer: [
      button({
        id: 'save-frame',
        label: 'Save',
        kind: 'primary',
        pendingKey: `frame-${number}`,
        onPress: () =>
          void run(
            `frame-${number}`,
            guard(surface, async () => {
              const next = await api<Board>(
                `/api/jobs/${data.job.id}/frames/${number}`,
                {
                  method: 'PATCH',
                  body: {
                    durationFrames: Number(surface.values['durationFrames'] ?? '0'),
                    actionNote: surface.values['actionNote'] ?? '',
                    stamp: surface.values['stamp'] ?? '',
                  },
                },
              );
              data.board = next;
              closeSurface(`Edit frame ${number}`);
              announce(say.frameSaved(number));
              redraw();
            }),
          ),
      }),
    ],
  });
}
