import { api } from './api.js';
import type { AppCtx } from './shell.js';
import { h, prefersReducedMotion } from './dom.js';
import { fmtDuration, fmtTss, fmtIf, dataAttr, dayLabel } from './format.js';
import {
  MAX_DURATION_S,
  MAX_REPEAT,
  MAX_STEPS,
  MAX_TARGET,
  MIN_DURATION_S,
  MIN_REPEAT,
  MIN_TARGET,
  STEP_DEFAULTS,
  STEP_LABELS,
  plannedIf,
  stepParts,
  stepsDuration,
  stepsPlannedTss,
  type Step,
  type StepKind,
  type StepPart,
} from './domain.js';

export function renderBuilder(ctx: AppCtx, athleteId: string, date: string | null, workout: string | null): HTMLElement {
  const steps: Step[] = [];
  let selectedStep = -1;
  let selectedPart = 0;

  const root = h('div', { class: 'page builder' });
  const announcements = h('div', { class: 'sr-only', role: 'status', id: 'builder-announcements' });

  const sportBike = h('input', { type: 'radio', name: 'builder-sport', id: 'builder-bike', value: 'bike' }) as HTMLInputElement;
  const sportRun = h('input', { type: 'radio', name: 'builder-sport', id: 'builder-run', value: 'run' }) as HTMLInputElement;
  sportBike.checked = true;

  const name = h('input', { class: 'field', type: 'text', id: 'workout-name', 'aria-label': 'Workout name', value: 'New workout' }) as HTMLInputElement;
  const day = h('input', { class: 'field', type: 'date', id: 'workout-day', 'aria-label': 'Day', value: date ?? '' }) as HTMLInputElement;

  const graph = h('div', { class: 'workout-graph', role: 'group', 'aria-label': 'Workout graph', 'data-seconds-per-px': '0.05', 'data-percent-per-px': '1.5' });
  const listbox = h('ul', { class: 'steps-list', role: 'listbox', 'aria-label': 'Steps', tabindex: '0', id: 'steps-list' });
  const totals = h('div', { class: 'workout-totals', role: 'group', 'aria-label': 'Workout totals' });
  const status = h('div', { class: 'dialog-status', role: 'status', id: 'builder-status' });

  const addToCalendar = h('button', { class: 'pill pill-primary', id: 'save-to-calendar' }, 'Save to calendar');
  const addToLibrary = h('button', { class: 'pill pill-secondary', id: 'save-to-library' }, 'Save to library');

  const addButtons: [string, StepKind][] = [
    ['Add warm-up', 'warmup'],
    ['Add steady', 'steady'],
    ['Add interval', 'interval'],
    ['Add recovery', 'recovery'],
    ['Add cool-down', 'cooldown'],
  ];

  function announce(text: string): void {
    announcements.textContent = text;
  }

  function addStep(kind: StepKind): void {
    if (steps.length >= MAX_STEPS) {
      announce('A workout has at most 50 steps.');
      return;
    }
    const defaults = STEP_DEFAULTS[kind];
    let step: Step;
    if (kind === 'interval') {
      const d = defaults as { repeat: number; work: { duration_s: number; target_pct: number }; recovery: { duration_s: number; target_pct: number } };
      step = { kind, repeat: d.repeat, work: { ...d.work }, recovery: { ...d.recovery } };
    } else {
      const d = defaults as { duration_s: number; target_pct: number };
      step = { kind, duration_s: d.duration_s, target_pct: d.target_pct };
    }
    const insertAt = selectedStep < 0 ? steps.length : selectedStep + 1;
    steps.splice(insertAt, 0, step);
    selectedStep = insertAt;
    selectedPart = 0;
    announce(`${STEP_LABELS[kind]} added.`);
    redraw();
    listbox.focus();
  }

  function partOf(stepIndex: number, partIndex: number): { label: string; duration: number; target: number } | null {
    const step = steps[stepIndex];
    if (!step) return null;
    const parts = stepParts(step);
    const part = parts[partIndex];
    if (!part) return null;
    return { label: part.label, duration: part.duration_s, target: part.target_pct };
  }

  function adjustSelected(deltaDuration: number, deltaTarget: number): void {
    const info = partOf(selectedStep, selectedPart);
    if (!info || steps[selectedStep] === undefined) return;
    const step = steps[selectedStep]!;
    const parts = stepParts(step);
    const part = parts[selectedPart]!;
    let newDuration = info.duration + deltaDuration;
    let newTarget = info.target + deltaTarget;
    newDuration = Math.max(MIN_DURATION_S, Math.min(MAX_DURATION_S, newDuration));
    newTarget = Math.max(MIN_TARGET, Math.min(MAX_TARGET, newTarget));
    const durationChanged = newDuration !== info.duration;
    const targetChanged = newTarget !== info.target;
    applyPart(step, part.kind, newDuration, newTarget);
    if (durationChanged || targetChanged) {
      announce(`${part.label} ${fmtDuration(newDuration)} at ${newTarget}%.`);
    } else {
      announce(`${part.label} ${fmtDuration(newDuration)} at ${newTarget}%.`);
    }
    redraw();
  }

  function applyPart(step: Step, partKind: string, duration: number, target: number): void {
    if (step.kind === 'interval') {
      if (partKind === 'work') {
        step.work.duration_s = duration;
        step.work.target_pct = target;
      } else {
        step.recovery.duration_s = duration;
        step.recovery.target_pct = target;
      }
    } else {
      step.duration_s = duration;
      step.target_pct = target;
    }
  }

  function adjustRepeat(delta: number): void {
    const step = steps[selectedStep];
    if (!step || step.kind !== 'interval') return;
    const next = step.repeat + delta;
    if (next < MIN_REPEAT || next > MAX_REPEAT) {
      announce(`Interval repeats ${step.repeat}.`);
      return;
    }
    step.repeat = next;
    announce(`Interval repeats ${next}.`);
    redraw();
  }

  function moveStep(delta: number): void {
    const target = selectedStep + delta;
    if (target < 0 || target >= steps.length) {
      const step = steps[selectedStep];
      if (step) announce(`${STEP_LABELS[step.kind]} moved to position ${selectedStep + 1} of ${steps.length}.`);
      return;
    }
    const [moved] = steps.splice(selectedStep, 1);
    if (!moved) return;
    steps.splice(target, 0, moved);
    selectedStep = target;
    announce(`${STEP_LABELS[moved.kind]} moved to position ${target + 1} of ${steps.length}.`);
    redraw();
  }

  function removeStep(): void {
    const step = steps[selectedStep];
    if (!step) return;
    const label = STEP_LABELS[step.kind];
    steps.splice(selectedStep, 1);
    if (selectedStep >= steps.length) selectedStep = steps.length - 1;
    if (selectedStep < 0) selectedPart = 0;
    announce(`${label} removed.`);
    redraw();
  }

  function select(delta: number): void {
    const next = selectedStep + delta;
    if (next < 0 || next >= steps.length) return;
    selectedStep = next;
    selectedPart = 0;
    announce(stepAnnouncement());
    redraw();
  }

  function stepAnnouncement(): string {
    const info = partOf(selectedStep, selectedPart);
    if (!info) return 'No step selected.';
    return `${info.label} ${fmtDuration(info.duration)} at ${info.target}%.`;
  }

  listbox.addEventListener('keydown', (event) => {
    const ke = event as KeyboardEvent;
    if (ke.altKey && (ke.key === 'ArrowUp' || ke.key === 'ArrowDown')) {
      moveStep(ke.key === 'ArrowUp' ? -1 : 1);
      ke.preventDefault();
      return;
    }
    switch (ke.key) {
      case 'ArrowUp':
        if (ke.shiftKey) {
          adjustSelected(0, 1);
        } else {
          select(-1);
        }
        ke.preventDefault();
        break;
      case 'ArrowDown':
        if (ke.shiftKey) {
          adjustSelected(0, -1);
        } else {
          select(1);
        }
        ke.preventDefault();
        break;
      case 'ArrowLeft':
        adjustSelected(-30, 0);
        ke.preventDefault();
        break;
      case 'ArrowRight':
        adjustSelected(30, 0);
        ke.preventDefault();
        break;
      case '+':
        adjustRepeat(1);
        ke.preventDefault();
        break;
      case '-':
        adjustRepeat(-1);
        ke.preventDefault();
        break;
      case 'Delete':
      case 'Backspace':
        removeStep();
        ke.preventDefault();
        break;
      default:
        break;
    }
  });

  function redraw(): void {
    drawGraph();
    drawList();
    drawTotals();
  }

  function drawGraph(): void {
    const secondsPerPx = 1200 / Math.max(1, stepsDuration(steps));
    graph.setAttribute('data-seconds-per-px', String(Number(secondsPerPx.toFixed(4))));
    graph.setAttribute('data-percent-per-px', '1.5');
    while (graph.firstChild) graph.removeChild(graph.firstChild);
    let offset = 0;
    for (const [stepIndex, step] of steps.entries()) {
      const parts: StepPart[] = stepParts(step);
      for (const [partIndex, part] of parts.entries()) {
        const width = Math.max(4, (part.duration_s / Math.max(1, stepsDuration(steps))) * 1200);
        const height = (part.target_pct / MAX_TARGET) * 180;
        const bar = h('div', {
          class: 'graph-bar',
          'data-step-index': String(stepIndex),
          'data-part': part.kind,
        });
        bar.style.position = 'absolute';
        bar.style.left = `${offset}px`;
        bar.style.width = `${width}px`;
        bar.style.height = `${height}px`;
        bar.style.bottom = '10px';
        const durationHandle = h('span', { class: 'graph-handle', 'data-handle': 'duration' });
        const targetHandle = h('span', { class: 'graph-handle', 'data-handle': 'target' });
        bar.append(durationHandle, targetHandle);
        attachDrag(bar, durationHandle, targetHandle, stepIndex, partIndex);
        graph.append(bar);
        offset += width;
      }
    }
    graph.setAttribute('data-seconds-per-px', String(Number((stepsDuration(steps) / 1200).toFixed(4))));
  }

  function attachDrag(bar: HTMLElement, durationHandle: HTMLElement, targetHandle: HTMLElement, stepIndex: number, partIndex: number): void {
    const begin = (handle: HTMLElement, mode: 'duration' | 'target') => {
      return (event: Event): void => {
        const pointer = event as PointerEvent;
        const startX = pointer.clientX;
        const startY = pointer.clientY;
        const step = steps[stepIndex];
        if (!step) return;
        const parts = stepParts(step);
        const part = parts[partIndex];
        if (!part) return;
        const startDuration = part.duration_s;
        const startTarget = part.target_pct;
        const secondsPerPx = Number(graph.getAttribute('data-seconds-per-px')) || 1;
        const percentPerPx = Number(graph.getAttribute('data-percent-per-px')) || 1;
        const onMove = (moveEvent: Event): void => {
          const me = moveEvent as PointerEvent;
          const dx = me.clientX - startX;
          const dy = me.clientY - startY;
          if (mode === 'duration') {
            let seconds = startDuration + dx * secondsPerPx;
            seconds = Math.round(seconds / 30) * 30;
            seconds = Math.max(MIN_DURATION_S, Math.min(MAX_DURATION_S, seconds));
            applyPart(step, part.kind, seconds, startTarget);
          } else {
            let target = startTarget - dy / percentPerPx;
            target = Math.round(target);
            target = Math.max(MIN_TARGET, Math.min(MAX_TARGET, target));
            applyPart(step, part.kind, startDuration, target);
          }
          redraw();
        };
        const onUp = (): void => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          announce(stepAnnouncement());
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        void handle;
      };
    };
    durationHandle.addEventListener('pointerdown', begin(durationHandle, 'duration'));
    targetHandle.addEventListener('pointerdown', begin(targetHandle, 'target'));
    void bar;
  }

  function drawList(): void {
    while (listbox.firstChild) listbox.removeChild(listbox.firstChild);
    for (const [stepIndex, step] of steps.entries()) {
      for (const [partIndex, part] of stepParts(step).entries()) {
        const attrs: Record<string, string> = {
          'data-kind': step.kind,
          'data-duration-s': String(part.duration_s),
          'data-target-pct': String(part.target_pct),
          'data-step-index': String(stepIndex),
        };
        if (step.kind === 'interval') attrs['data-repeat'] = String(step.repeat);
        const option = h(
          'li',
          {
            class: stepIndex === selectedStep ? 'step-option selected' : 'step-option',
            role: 'option',
            'aria-selected': stepIndex === selectedStep ? 'true' : 'false',
            onclick: () => {
              selectedStep = stepIndex;
              selectedPart = partIndex;
              redraw();
              listbox.focus();
            },
            ...attrs,
          },
          `${part.label} · ${fmtDuration(part.duration_s)} at ${part.target_pct}%`
        );
        listbox.append(option);
      }
    }
  }

  function drawTotals(): void {
    while (totals.firstChild) totals.removeChild(totals.firstChild);
    const duration = stepsDuration(steps);
    const tss = stepsPlannedTss(steps);
    const intensity = steps.length === 0 ? 0 : plannedIf(steps);
    totals.append(
      h('p', { class: 'totals-line', 'data-duration-s': String(duration) }, `Duration ${fmtDuration(duration)}`),
      h('p', { class: 'totals-line', 'data-planned-tss': dataAttr(tss, 1) }, `Planned ${fmtTss(tss)} TSS`),
      h('p', { class: 'totals-line', 'data-if': intensity.toFixed(2) }, `IF ${fmtIf(intensity)}`)
    );
  }

  const buttonRow = h(
    'div',
    { class: 'add-step-row' },
    ...addButtons.map(([label, kind]) =>
      h('button', { class: 'pill pill-secondary', onclick: () => addStep(kind) }, label)
    )
  );

  const saveRow = h('div', { class: 'save-row' }, addToCalendar, addToLibrary);

  addToCalendar.addEventListener('click', async () => {
    const targetDay = day.value || ctx.me?.today || '';
    addToCalendar.disabled = true;
    addToCalendar.textContent = 'Saving…';
    status.textContent = 'Saving…';
    try {
      const res = await api.post<{ workout: { title: string } }>(`/athletes/${athleteId}/workouts`, {
        date: targetDay,
        sport: sportRun.checked ? 'run' : 'bike',
        title: name.value.trim() === '' ? 'New workout' : name.value.trim(),
        steps,
      });
      status.textContent = `Saved ${res.workout.title} on ${dayLabel(targetDay)}.`;
      window.setTimeout(() => {
        window.location.href = `/athletes/${athleteId}`;
      }, 700);
    } catch (err) {
      addToCalendar.disabled = false;
      addToCalendar.textContent = 'Save to calendar';
      status.textContent = (err as Error).message;
    }
  });

  addToLibrary.addEventListener('click', async () => {
    addToLibrary.disabled = true;
    addToLibrary.textContent = 'Saving…';
    try {
      await api.post('/library', {
        name: name.value.trim() === '' ? 'New workout' : name.value.trim(),
        sport: sportRun.checked ? 'run' : 'bike',
        steps,
      });
      status.textContent = `Saved ${name.value.trim()} to your library.`;
      addToLibrary.disabled = false;
      addToLibrary.textContent = 'Save to library';
    } catch (err) {
      addToLibrary.disabled = false;
      addToLibrary.textContent = 'Save to library';
      status.textContent = (err as Error).message;
    }
  });

  root.append(
    h('h1', { class: 'screen-title' }, 'Workout builder'),
    announcements,
    h('div', { class: 'builder-form-row' },
      h('div', { class: 'radiogroup', role: 'radiogroup', 'aria-label': 'Sport' },
        h('label', { class: 'radio-label', for: 'builder-bike' }, sportBike, 'Bike'),
        h('label', { class: 'radio-label', for: 'builder-run' }, sportRun, 'Run')
      ),
      h('label', { class: 'field-label', for: 'workout-name' }, 'Workout name'),
      name,
      h('label', { class: 'field-label', for: 'workout-day' }, 'Day'),
      day
    ),
    h('div', { class: 'builder-grid' },
      h('div', { class: 'builder-left' }, graph, totals, buttonRow, saveRow, status),
      listbox
    )
  );

  if (workout !== null) {
    void api.get<{ workout: { steps: Step[]; title: string; sport: string; date: string } }>(`/workouts/${workout}`).then((res) => {
      steps.splice(0, steps.length, ...res.workout.steps);
      name.value = res.workout.title;
      day.value = res.workout.date;
      if (res.workout.sport === 'run') {
        sportRun.checked = true;
        sportBike.checked = false;
      }
      selectedStep = 0;
      redraw();
    }).catch(() => {
      status.textContent = 'That workout is not available.';
    });
  }

  redraw();
  void prefersReducedMotion;
  return root;
}
