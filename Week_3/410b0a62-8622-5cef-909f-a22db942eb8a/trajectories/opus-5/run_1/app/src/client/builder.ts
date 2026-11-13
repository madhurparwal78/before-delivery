import { api, ApiCallError } from './api.js';
import { app, type Screen } from './app.js';
import { el, fieldError, keepFocus } from './dom.js';
import { dataNumber, formatDay, formatDuration, formatIf, formatTss } from './format.js';
import {
  DURATION_STEP_S,
  MAX_STEPS,
  PART_LABELS,
  STEP_LABELS,
  TARGET_MAX_PCT,
  TARGET_MIN_PCT,
  clampDuration,
  clampRepeat,
  defaultStep,
  isIntervalStep,
  plannedIf,
  plannedTss,
  snapDuration,
  snapTarget,
  stepParts,
  stepsDurationS,
  type StepKind,
} from '../domain/steps.js';
import type { SimpleStep, Sport, Step } from '../domain/types.js';

const SECONDS_PER_PX = 12;
const PERCENT_PER_PX = 1;

interface Selection {
  stepIndex: number;
  part: 'work' | 'recovery' | '';
}

export async function createBuilderScreen(athleteId: string): Promise<Screen> {
  const params = new URLSearchParams(window.location.search);
  const today = app.me?.today as string;
  const workoutId = params.get('workout');
  let steps: Step[] = [];
  let sport: Sport = 'bike';
  let name = 'New workout';
  let day = params.get('date') ?? today;
  let version = 0;
  let selection: Selection | null = null;

  if (workoutId) {
    const loaded = await api.workout(workoutId);
    steps = loaded.workout.steps ?? [];
    sport = loaded.workout.sport;
    name = loaded.workout.title;
    day = loaded.workout.date;
    version = loaded.workout.version;
  }

  const announcements = el('p', {
    class: 'status-line',
    attrs: { role: 'status', 'aria-live': 'polite', 'aria-label': 'Builder announcements' },
  });
  const graph = el('div', {
    class: 'builder-graph',
    attrs: {
      role: 'group',
      'aria-label': 'Workout graph',
      'data-seconds-per-px': String(SECONDS_PER_PX),
      'data-percent-per-px': String(PERCENT_PER_PX),
    },
  });
  const list = el('div', {
    class: 'steps-list',
    attrs: { role: 'listbox', 'aria-label': 'Steps', tabindex: '0' },
  });
  const totals = el('div', {
    class: 'builder-totals',
    attrs: { role: 'group', 'aria-label': 'Workout totals' },
  });
  const errors = el('div');

  const nameInput = el('input', {
    class: 'field',
    attrs: { type: 'text', value: name, 'aria-label': 'Workout name', id: 'builder-name' },
    on: {
      input: (event) => {
        name = (event.target as HTMLInputElement).value;
      },
    },
  });
  const dayInput = el('input', {
    class: 'field',
    attrs: { type: 'text', value: day, 'aria-label': 'Day', id: 'builder-day' },
    on: {
      input: (event) => {
        day = (event.target as HTMLInputElement).value;
      },
    },
  });
  const bikeRadio = el('input', {
    attrs: { type: 'radio', name: 'builder-sport', 'aria-label': 'Bike', checked: sport === 'bike' },
    on: {
      change: () => {
        sport = 'bike';
      },
    },
  });
  const runRadio = el('input', {
    attrs: { type: 'radio', name: 'builder-sport', 'aria-label': 'Run', checked: sport === 'run' },
    on: {
      change: () => {
        sport = 'run';
      },
    },
  });

  function partsOf(): ReturnType<typeof stepParts> {
    return stepParts(steps);
  }

  function selectedIndex(): number {
    if (!selection) return -1;
    return partsOf().findIndex(
      (part) => part.stepIndex === selection?.stepIndex && part.part === selection.part,
    );
  }

  function partLabel(stepIndex: number, part: 'work' | 'recovery' | ''): string {
    const step = steps[stepIndex];
    if (!step) return '';
    if (isIntervalStep(step)) return PART_LABELS[`interval:${part}`] as string;
    return PART_LABELS[step.kind] as string;
  }

  function announcePart(stepIndex: number, part: 'work' | 'recovery' | ''): void {
    const step = steps[stepIndex];
    if (!step) return;
    const values = isIntervalStep(step)
      ? part === 'work'
        ? step.work
        : step.recovery
      : { duration_s: step.duration_s, target_pct: step.target_pct };
    announcements.textContent = `${partLabel(stepIndex, part)} ${formatDuration(
      values.duration_s,
    )} at ${values.target_pct}%.`;
  }

  function setSelection(index: number): void {
    const parts = partsOf();
    const part = parts[index];
    selection = part ? { stepIndex: part.stepIndex, part: part.part } : null;
  }

  function changeDuration(delta: number): void {
    if (!selection) return;
    const step = steps[selection.stepIndex];
    if (!step) return;
    if (isIntervalStep(step)) {
      const target = selection.part === 'work' ? step.work : step.recovery;
      target.duration_s = clampDuration(target.duration_s + delta);
    } else {
      step.duration_s = clampDuration(step.duration_s + delta);
    }
    render();
    announcePart(selection.stepIndex, selection.part);
  }

  function changeTarget(delta: number): void {
    if (!selection) return;
    const step = steps[selection.stepIndex];
    if (!step) return;
    const clamp = (value: number): number =>
      Math.min(TARGET_MAX_PCT, Math.max(TARGET_MIN_PCT, value));
    if (isIntervalStep(step)) {
      const target = selection.part === 'work' ? step.work : step.recovery;
      target.target_pct = clamp(target.target_pct + delta);
    } else {
      step.target_pct = clamp(step.target_pct + delta);
    }
    render();
    announcePart(selection.stepIndex, selection.part);
  }

  function changeRepeat(delta: number): void {
    if (!selection) return;
    const step = steps[selection.stepIndex];
    if (!step || !isIntervalStep(step)) return;
    step.repeat = clampRepeat(step.repeat + delta);
    render();
    announcements.textContent = `Interval repeats ${step.repeat}.`;
  }

  function moveStep(delta: number): void {
    if (!selection) return;
    const from = selection.stepIndex;
    const to = from + delta;
    if (to < 0 || to >= steps.length) {
      announcements.textContent = `${STEP_LABELS[(steps[from] as Step).kind as StepKind]} moved to position ${
        from + 1
      } of ${steps.length}.`;
      return;
    }
    const [moved] = steps.splice(from, 1);
    steps.splice(to, 0, moved as Step);
    selection = { stepIndex: to, part: selection.part };
    render();
    announcements.textContent = `${STEP_LABELS[(moved as Step).kind as StepKind]} moved to position ${
      to + 1
    } of ${steps.length}.`;
  }

  function removeStep(): void {
    if (!selection) return;
    const index = selection.stepIndex;
    const step = steps[index];
    if (!step) return;
    const wasLast = index === steps.length - 1;
    steps.splice(index, 1);
    const nextStepIndex = wasLast ? index - 1 : index;
    if (steps.length === 0 || nextStepIndex < 0) selection = null;
    else {
      const nextStep = steps[nextStepIndex] as Step;
      selection = { stepIndex: nextStepIndex, part: isIntervalStep(nextStep) ? 'work' : '' };
    }
    render();
    announcements.textContent = `${STEP_LABELS[step.kind as StepKind]} removed.`;
  }

  function addStep(kind: StepKind): void {
    if (steps.length >= MAX_STEPS) {
      announcements.textContent = 'A workout has at most 50 steps.';
      return;
    }
    const step = defaultStep(kind);
    const at = selection ? selection.stepIndex + 1 : steps.length;
    steps.splice(at, 0, step);
    selection = { stepIndex: at, part: isIntervalStep(step) ? 'work' : '' };
    render();
    announcements.textContent = `${STEP_LABELS[kind]} added.`;
    list.focus();
  }

  list.addEventListener('keydown', (event) => {
    const keyboard = event as KeyboardEvent;
    const parts = partsOf();
    const index = selectedIndex();
    if (keyboard.key === 'ArrowUp' && keyboard.altKey) {
      keyboard.preventDefault();
      moveStep(-1);
      return;
    }
    if (keyboard.key === 'ArrowDown' && keyboard.altKey) {
      keyboard.preventDefault();
      moveStep(1);
      return;
    }
    if (keyboard.key === 'ArrowUp' && keyboard.shiftKey) {
      keyboard.preventDefault();
      changeTarget(1);
      return;
    }
    if (keyboard.key === 'ArrowDown' && keyboard.shiftKey) {
      keyboard.preventDefault();
      changeTarget(-1);
      return;
    }
    if (keyboard.key === 'ArrowUp' || keyboard.key === 'ArrowDown') {
      keyboard.preventDefault();
      if (parts.length === 0) return;
      const next =
        index === -1
          ? 0
          : Math.min(parts.length - 1, Math.max(0, index + (keyboard.key === 'ArrowUp' ? -1 : 1)));
      setSelection(next);
      render();
      if (selection) announcePart(selection.stepIndex, selection.part);
      return;
    }
    if (keyboard.key === 'ArrowLeft' || keyboard.key === 'ArrowRight') {
      keyboard.preventDefault();
      changeDuration(keyboard.key === 'ArrowLeft' ? -DURATION_STEP_S : DURATION_STEP_S);
      return;
    }
    if (keyboard.key === '+' || keyboard.key === '=') {
      keyboard.preventDefault();
      changeRepeat(1);
      return;
    }
    if (keyboard.key === '-') {
      keyboard.preventDefault();
      changeRepeat(-1);
      return;
    }
    if (keyboard.key === 'Delete' || keyboard.key === 'Backspace') {
      keyboard.preventDefault();
      removeStep();
    }
  });

  function startDrag(
    event: PointerEvent,
    stepIndex: number,
    part: 'work' | 'recovery' | '',
    handle: 'duration' | 'target',
  ): void {
    event.preventDefault();
    const step = steps[stepIndex];
    if (!step) return;
    selection = { stepIndex, part };
    const values = isIntervalStep(step)
      ? part === 'work'
        ? step.work
        : step.recovery
      : (step as SimpleStep);
    const startDuration = values.duration_s;
    const startTarget = values.target_pct;
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (moveEvent: Event): void => {
      const pointer = moveEvent as PointerEvent;
      if (handle === 'duration') {
        const seconds = startDuration + (pointer.clientX - startX) * SECONDS_PER_PX;
        values.duration_s = snapDuration(seconds);
      } else {
        const percent = startTarget + (startY - pointer.clientY) * PERCENT_PER_PX;
        values.target_pct = snapTarget(percent);
      }
      render();
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      announcePart(stepIndex, part);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function renderGraph(): void {
    const bars: HTMLElement[] = [];
    steps.forEach((step, stepIndex) => {
      const pieces: { part: 'work' | 'recovery' | ''; duration: number; target: number }[] = [];
      if (isIntervalStep(step)) {
        for (let repeat = 0; repeat < step.repeat; repeat += 1) {
          pieces.push({ part: 'work', duration: step.work.duration_s, target: step.work.target_pct });
          pieces.push({
            part: 'recovery',
            duration: step.recovery.duration_s,
            target: step.recovery.target_pct,
          });
        }
      } else {
        pieces.push({ part: '', duration: step.duration_s, target: step.target_pct });
      }
      for (const piece of pieces) {
        const selected =
          selection?.stepIndex === stepIndex && selection.part === piece.part ? 'true' : 'false';
        const bar = el('div', {
          class: `graph-bar${selected === 'true' ? ' graph-bar-selected' : ''}`,
          attrs: {
            'data-step-index': String(stepIndex),
            'data-part': piece.part,
            'data-duration-s': String(piece.duration),
            'data-target-pct': String(piece.target),
            style: `width:${piece.duration / SECONDS_PER_PX}px;height:${
              piece.target / PERCENT_PER_PX
            }px`,
          },
          children: [
            el('span', {
              class: 'graph-handle graph-handle-target',
              attrs: { 'data-handle': 'target' },
              on: {
                pointerdown: (event) =>
                  startDrag(event as PointerEvent, stepIndex, piece.part, 'target'),
              },
            }),
            el('span', {
              class: 'graph-handle graph-handle-duration',
              attrs: { 'data-handle': 'duration' },
              on: {
                pointerdown: (event) =>
                  startDrag(event as PointerEvent, stepIndex, piece.part, 'duration'),
              },
            }),
          ],
        });
        bars.push(bar);
      }
    });
    graph.replaceChildren(
      bars.length === 0 ? el('p', { class: 'graph-empty', text: 'Add a step to start' }) : el('div', {
        class: 'graph-bars',
        children: bars,
      }),
    );
  }

  function renderList(): void {
    const parts = partsOf();
    const options = parts.map((part, index) => {
      const selected =
        selection?.stepIndex === part.stepIndex && selection.part === part.part;
      return el('div', {
        class: `step-option${selected ? ' step-option-selected' : ''}`,
        attrs: {
          role: 'option',
          id: `step-option-${index}`,
          'aria-selected': selected ? 'true' : 'false',
          'data-kind': part.kind,
          'data-part': part.part,
          'data-duration-s': String(part.duration_s),
          'data-target-pct': String(part.target_pct),
          'data-step-index': String(part.stepIndex),
          'data-repeat': part.repeat === null ? null : String(part.repeat),
        },
        on: {
          click: () => {
            setSelection(index);
            render();
            list.focus();
          },
        },
        children: [
          el('span', { class: 'step-kind', text: part.label }),
          el('span', { class: 'step-duration', text: formatDuration(part.duration_s) }),
          el('span', { class: 'step-target', text: `${part.target_pct}%` }),
          part.repeat === null
            ? null
            : el('span', { class: 'step-repeat', text: `× ${part.repeat}` }),
        ],
      });
    });
    list.replaceChildren(...options);
    const index = selectedIndex();
    if (index >= 0) list.setAttribute('aria-activedescendant', `step-option-${index}`);
    else list.removeAttribute('aria-activedescendant');
  }

  function renderTotals(): void {
    const duration = stepsDurationS(steps);
    const tss = steps.length === 0 ? 0 : plannedTss(steps);
    const intensity = steps.length === 0 ? 0 : plannedIf(steps);
    totals.replaceChildren(
      el('p', {
        class: 'total-duration',
        text: `Duration ${formatDuration(duration)}`,
        attrs: { 'data-duration-s': String(duration) },
      }),
      el('p', {
        class: 'total-tss',
        text: `Planned ${formatTss(tss)} TSS`,
        attrs: { 'data-planned-tss': dataNumber(tss, 1) },
      }),
      el('p', {
        class: 'total-if',
        text: `IF ${formatIf(intensity)}`,
        attrs: { 'data-if': dataNumber(intensity, 2) },
      }),
    );
  }

  function render(): void {
    renderGraph();
    renderList();
    renderTotals();
  }

  const saveCalendar = el('button', {
    class: 'pill pill-accent',
    text: 'Save to calendar',
    attrs: { type: 'button' },
  });
  saveCalendar.addEventListener('click', async () => {
    errors.replaceChildren();
    saveCalendar.disabled = true;
    saveCalendar.textContent = 'Saving…';
    announcements.textContent = 'Saving…';
    try {
      if (workoutId) {
        await api.patchWorkout(workoutId, { version, date: day, title: name, steps });
        version += 1;
      } else {
        await api.createWorkout(athleteId, { date: day, sport, title: name, steps });
      }
      announcements.textContent = `Saved ${name} on ${formatDay(day)}.`;
    } catch (error) {
      announcements.textContent = '';
      showErrors(error);
    } finally {
      saveCalendar.disabled = false;
      saveCalendar.textContent = 'Save to calendar';
      keepFocus(saveCalendar);
    }
  });

  const saveLibrary = el('button', {
    class: 'pill pill-ink',
    text: 'Save to library',
    attrs: { type: 'button' },
  });
  saveLibrary.addEventListener('click', async () => {
    errors.replaceChildren();
    saveLibrary.disabled = true;
    saveLibrary.textContent = 'Saving…';
    announcements.textContent = 'Saving…';
    try {
      await api.createLibraryItem({ name, sport, steps });
      announcements.textContent = `Saved ${name} to your library.`;
    } catch (error) {
      announcements.textContent = '';
      showErrors(error);
    } finally {
      saveLibrary.disabled = false;
      saveLibrary.textContent = 'Save to library';
      keepFocus(saveLibrary);
    }
  });

  function showErrors(error: unknown): void {
    if (!(error instanceof ApiCallError)) return;
    const fields = error.failure.errors ?? {};
    const nodes: HTMLElement[] = [];
    if (fields.steps) nodes.push(fieldError(list, fields.steps));
    if (fields.date) nodes.push(fieldError(dayInput, fields.date));
    if (fields.title || fields.name) {
      nodes.push(fieldError(nameInput, (fields.title ?? fields.name) as string));
    }
    if (nodes.length === 0 && error.failure.message) {
      nodes.push(el('p', { class: 'field-error', text: error.failure.message }));
    }
    errors.replaceChildren(...nodes);
    const first = nodes[0];
    if (first) {
      const described = fields.date ? dayInput : fields.steps ? list : nameInput;
      described.focus();
    }
  }

  const addButtons = (['warmup', 'steady', 'interval', 'recovery', 'cooldown'] as StepKind[]).map(
    (kind) =>
      el('button', {
        class: 'pill pill-quiet',
        text: `Add ${STEP_LABELS[kind].toLowerCase()}`,
        attrs: { type: 'button' },
        on: { click: () => addStep(kind) },
      }),
  );

  const element = el('main', {
    class: 'builder',
    children: [
      el('h1', { class: 'page-title', text: 'Workout builder' }),
      el('div', {
        class: 'builder-fields',
        children: [
          el('div', {
            class: 'radio-row',
            attrs: { role: 'radiogroup', 'aria-label': 'Sport' },
            children: [
              el('label', { class: 'radio', children: [bikeRadio, el('span', { text: 'Bike' })] }),
              el('label', { class: 'radio', children: [runRadio, el('span', { text: 'Run' })] }),
            ],
          }),
          el('label', {
            class: 'field-row',
            children: [el('span', { text: 'Workout name' }), nameInput],
          }),
          el('label', { class: 'field-row', children: [el('span', { text: 'Day' }), dayInput] }),
        ],
      }),
      el('div', {
        class: 'builder-columns',
        children: [
          el('section', { class: 'card builder-graph-card', children: [graph] }),
          el('section', {
            class: 'card builder-side',
            children: [
              totals,
              el('div', { class: 'add-steps', children: addButtons }),
              list,
              el('div', { class: 'save-row', children: [saveCalendar, saveLibrary] }),
              errors,
              announcements,
            ],
          }),
        ],
      }),
    ],
  });

  render();

  return { element };
}
