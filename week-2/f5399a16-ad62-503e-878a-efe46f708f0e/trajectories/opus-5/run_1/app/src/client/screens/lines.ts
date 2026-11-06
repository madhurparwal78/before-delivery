import { COPY, LABELS } from '../../domain/copy.js';
import {
  announce,
  api,
  focusHeading,
  isRefusal,
  queryOf,
  redraw,
  refreshOnce,
  registerScreen,
  run,
  setQuery,
  state,
} from '../app.js';
import { h } from '../dom.js';
import { button, combobox, field, loadingBars, problemsRegion } from '../ui.js';
import { jobNav, loadJob } from './job.js';
import type { Board } from './job.js';
import type { Job } from './jobs.js';

type Line = {
  id: string;
  frame: number;
  market: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  clips: number;
};

type LinesData = { job: Job; board: Board; lines: Line[] };

type Draft = {
  id: string | null;
  frame: string;
  text: string;
  x: string;
  y: string;
  width: string;
  height: string;
  clips: string;
};

const drafts = new Map<string, Draft>();
let frameShown = '';
let focusedLine: string | null = null;

function market(): string {
  return queryOf().get('market') ?? 'en';
}

function draft(): Draft {
  const held = drafts.get(market());
  if (held !== undefined) return held;
  const fresh: Draft = {
    id: null,
    frame: frameShown,
    text: '',
    x: '10',
    y: '70',
    width: '60',
    height: '10',
    clips: '1',
  };
  drafts.set(market(), fresh);
  return fresh;
}

registerScreen({
  name: 'lines',
  frame: 'desk',
  refreshes: true,
  heading: (raw) => `Lines for ${(raw as unknown as LinesData).job?.title ?? ''}`,
  load: async () => {
    const jobId = state.screen.jobId ?? '';
    const [job, board, lines] = await Promise.all([
      loadJob(jobId),
      api<Board>(`/api/jobs/${jobId}/board`),
      api<{ lines: Line[] }>(`/api/jobs/${jobId}/lines?market=${market()}`),
    ]);
    if (frameShown === '') frameShown = String(board.frames[0]?.number ?? 1);
    return { job, board, lines: lines.lines } as unknown as Record<string, unknown>;
  },
  mainAction: () =>
    button({
      id: 'save-line',
      label: 'Save',
      kind: 'primary',
      pendingKey: 'line',
      onPress: () => void saveLine(),
    }),
  view: (raw) => {
    const data = raw as unknown as LinesData;
    if (state.loading || data.board === undefined) return [loadingBars('Reading the lines')];
    const held = draft();
    const shown = data.lines.filter((line) => String(line.frame) === frameShown);
    const frame = data.board.frames.find((candidate) => String(candidate.number) === frameShown);
    return [
      jobNav(data.job.id, '/lines'),
      combobox({
        id: 'line-frame',
        label: 'Frame',
        value: frameShown,
        options: data.board.frames.map((candidate) => ({
          value: String(candidate.number),
          label: `Frame ${candidate.number}`,
        })),
        onChange: (value) => {
          frameShown = value;
          held.frame = value;
          redraw();
        },
      }),
      h(
        'div',
        { key: 'markets', class: 'radio-row', role: 'radiogroup', 'aria-label': 'Market' },
        ...Object.keys(LABELS.language).map((value) =>
          h(
            'label',
            { key: value, class: 'radio' },
            h('input', {
              type: 'radio',
              name: 'market',
              checked: market() === value,
              onchange: () => setQuery({ market: value }),
            }),
            h('span', {}, value),
          ),
        ),
      ),
      h(
        'div',
        { key: 'frame', class: 'line-frame' },
        frame?.drawingUrl === null || frame === undefined
          ? null
          : h('img', {
              src: frame.drawingUrl,
              alt: '',
              style: 'width:100%;height:100%;display:block',
            }),
        ...shown.map((line) =>
          h(
            'span',
            {
              key: line.id,
              id: `line-${line.id}`,
              'data-part': 'line',
              'data-x': String(line.x),
              'data-y': String(line.y),
              tabindex: '0',
              dir: line.market === 'ar' ? 'rtl' : 'ltr',
              style: `inset-inline-start:${line.x}%;top:${line.y}%;width:${line.width}%;height:${
                line.height
              }%;text-align:${line.market === 'ar' ? 'right' : 'start'}`,
              onfocus: () => {
                focusedLine = line.id;
              },
              onkeydown: (event: Event) => void nudge(event as KeyboardEvent, line),
              onpointerdown: (event: Event) => dragLine(event as PointerEvent, line),
              onclick: () => {
                drafts.set(market(), {
                  id: line.id,
                  frame: String(line.frame),
                  text: line.text,
                  x: String(line.x),
                  y: String(line.y),
                  width: String(line.width),
                  height: String(line.height),
                  clips: String(line.clips),
                });
                redraw();
              },
            },
            line.text,
          ),
        ),
      ),
      problemsRegion(state.problems),
      h(
        'div',
        { key: 'form', class: 'filters filters--inline' },
        field({
          id: 'line-text',
          label: 'Line text',
          value: held.text,
          onInput: (value) => {
            held.text = value;
          },
          problem: state.problems['text'],
        }),
        ...(['x', 'y', 'width', 'height', 'clips'] as const).map((name) =>
          field({
            id: `line-${name}`,
            label: name === 'clips' ? 'Clips' : name.charAt(0).toUpperCase() + name.slice(1),
            value: held[name],
            onInput: (value) => {
              held[name] = value;
              redraw();
            },
            problem: state.problems[name],
          }),
        ),
      ),
      h(
        'div',
        { key: 'line-actions', class: 'row-actions' },
        button({
          id: 'add-line',
          label: 'Add line',
          onPress: () => {
            drafts.set(market(), {
              id: null,
              frame: frameShown,
              text: '',
              x: '10',
              y: '70',
              width: '60',
              height: '10',
              clips: '1',
            });
            redraw();
            requestAnimationFrame(() => document.getElementById('line-text')?.focus());
          },
        }),
        held.id === null
          ? null
          : button({
              id: 'remove-line',
              label: 'Remove line',
              pendingKey: 'remove-line',
              onPress: () =>
                void run('remove-line', async () => {
                  await api(`/api/lines/${held.id ?? ''}`, { method: 'DELETE' });
                  drafts.delete(market());
                  announce(COPY.lineRemoved);
                  await refreshOnce();
                  focusHeading();
                }),
            }),
      ),
    ];
  },
});

/** A focused line moves by arrow keys 1% and Shift 10%. */
async function nudge(event: KeyboardEvent, line: Line): Promise<void> {
  const steps: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  const step = steps[event.key];
  if (step === undefined) return;
  event.preventDefault();
  const scale = event.shiftKey ? 10 : 1;
  await saveMoved(line, line.x + step[0] * scale, line.y + step[1] * scale);
}

function dragLine(event: PointerEvent, line: Line): void {
  const element = event.currentTarget as HTMLElement;
  const frame = element.parentElement;
  if (frame === null) return;
  element.setPointerCapture(event.pointerId);
  const box = frame.getBoundingClientRect();
  const move = (moved: PointerEvent): void => {
    element.style.insetInlineStart = `${((moved.clientX - box.left) / box.width) * 100}%`;
    element.style.top = `${((moved.clientY - box.top) / box.height) * 100}%`;
  };
  const release = (released: PointerEvent): void => {
    element.removeEventListener('pointermove', move as EventListener);
    element.removeEventListener('pointerup', release as EventListener);
    void saveMoved(
      line,
      Math.round(((released.clientX - box.left) / box.width) * 1000) / 10,
      Math.round(((released.clientY - box.top) / box.height) * 1000) / 10,
    );
  };
  element.addEventListener('pointermove', move as EventListener);
  element.addEventListener('pointerup', release as EventListener);
}

async function saveMoved(line: Line, x: number, y: number): Promise<void> {
  await run(`line-${line.id}`, async () => {
    state.problems = {};
    try {
      await api(`/api/lines/${line.id}`, {
        method: 'PATCH',
        body: {
          x: Math.min(100, Math.max(0, Math.round(x * 10) / 10)),
          y: Math.min(100, Math.max(0, Math.round(y * 10) / 10)),
        },
      });
      announce(COPY.lineSaved);
      await refreshOnce();
      if (focusedLine !== null) {
        requestAnimationFrame(() => document.getElementById(`line-${focusedLine}`)?.focus());
      }
    } catch (error) {
      if (isRefusal(error)) {
        state.problems = showProblem(error.failure.fields, error.failure.message);
        announce(error.failure.message);
        redraw();
        return;
      }
      throw error;
    }
  });
}

function showProblem(
  fields: Record<string, string>,
  message: string,
): Record<string, string> {
  return Object.keys(fields).length > 0 ? fields : { text: message };
}

async function saveLine(): Promise<void> {
  const held = draft();
  await run('line', async () => {
    state.problems = {};
    const body = {
      frame: Number(held.frame || frameShown),
      market: market(),
      text: held.text,
      x: Number(held.x),
      y: Number(held.y),
      width: Number(held.width),
      height: Number(held.height),
      clips: Number(held.clips),
    };
    try {
      if (held.id === null) {
        const made = await api<Line>(`/api/jobs/${state.screen.jobId ?? ''}/lines`, {
          method: 'POST',
          body,
        });
        held.id = made.id;
      } else {
        await api(`/api/lines/${held.id}`, { method: 'PATCH', body });
      }
      announce(COPY.lineSaved);
      await refreshOnce();
    } catch (error) {
      if (isRefusal(error)) {
        state.problems = showProblem(error.failure.fields, error.failure.message);
        announce(error.failure.message);
        redraw();
        requestAnimationFrame(() => {
          document.querySelector<HTMLElement>('.problems')?.focus();
        });
        return;
      }
      throw error;
    }
  });
}

export type { Line };
