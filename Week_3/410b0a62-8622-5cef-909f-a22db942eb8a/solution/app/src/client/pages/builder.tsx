import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { Plus } from 'lucide-react';
import { dayLabel } from '../../shared/dates.js';
import { formatDuration, formatIf, formatTss } from '../../shared/format.js';
import {
  clampRepeat, defaultStep, flattenParts, LIMITS, partLabel, snapDuration, snapTarget, STEP_LABELS, stepsDuration, stepsIf, stepsTss, withPart,
  type Part, type PartName, type StepKind
} from '../../shared/steps.js';
import type { AthleteDetail, Sport, Step, Workout, WorkoutDetail } from '../../shared/types.js';
import { failureMessage, fieldErrors, get, isNotFound, patch, post } from '../api.js';
import { useAnnouncer, useLoaded } from '../hooks.js';
import { useMe } from '../session.js';
import { NotFound } from '../shell.js';
import { Field, FieldError, focusFirstInvalid, Pill, Skeleton, Status } from '../ui.js';

const GRAPH_HEIGHT = 240;
const AXIS_MAX_PERCENT = 210;
const MIN_DOMAIN_S = 3600;
const HANDLE = 16;
const GHOSTS = [
  { at: 4, span: 18, target: 60 },
  { at: 24, span: 46, target: 105 },
  { at: 72, span: 18, target: 50 }
];
const ADD_KINDS: { kind: StepKind; label: string }[] = [
  { kind: 'warmup', label: 'warm-up' },
  { kind: 'steady', label: 'steady' },
  { kind: 'interval', label: 'interval' },
  { kind: 'recovery', label: 'recovery' },
  { kind: 'cooldown', label: 'cool-down' }
];

interface Selection {
  stepIndex: number;
  part: PartName;
}

interface Scale {
  spp: number;
  ppp: number;
}

interface Drag {
  kind: 'duration' | 'target';
  selection: Selection;
  startX: number;
  startY: number;
  duration_s: number;
  target_pct: number;
  scale: Scale;
}

const sameSelection = (part: Part, selection: Selection | null): boolean =>
  selection !== null && part.stepIndex === selection.stepIndex && part.part === selection.part;

const optionId = (part: Part): string => `step-${part.stepIndex}-${part.part ?? 'plain'}`;

const zoneOf = (target: number): string => (target < 76 ? 'zone-easy' : target <= 105 ? 'zone-steady' : 'zone-hard');

function announcement(part: Part): string {
  return `${partLabel(part)} ${formatDuration(part.duration_s)} at ${part.target_pct}%.`;
}

function useWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useLayoutEffect(() => {
    const element = ref.current as HTMLDivElement;
    const measure = (): void => setWidth(Math.max(element.clientWidth, 120));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export function Builder({ athleteId, params }: { athleteId: string; params: URLSearchParams }) {
  const me = useMe();
  const athlete = useLoaded(() => get<AthleteDetail>(`/api/athletes/${athleteId}`), [athleteId], [athleteId]);
  const editing = params.get('workout');
  const existing = useLoaded(() => (editing ? get<WorkoutDetail>(`/api/workouts/${editing}`) : Promise.resolve(null)), [editing]);

  const [sport, setSport] = useState<Sport>('bike');
  const [name, setName] = useState('');
  const [day, setDay] = useState(params.get('date') ?? me.today);
  const [steps, setSteps] = useState<Step[]>([]);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<'calendar' | 'library' | null>(null);
  const [frozen, setFrozen] = useState<Scale | null>(null);
  const announcer = useAnnouncer();
  const listRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const loadedFor = useRef<string | null>(null);
  const [graphRef, graphWidth] = useWidth();

  useEffect(() => {
    const detail = existing.data;
    if (!detail || loadedFor.current === detail.workout.id) return;
    loadedFor.current = detail.workout.id;
    const workout: Workout = detail.workout;
    setSport(workout.sport);
    setName(workout.title);
    setDay(workout.date);
    setSteps(workout.steps ?? []);
    setVersion(workout.version);
    setSelected(workout.steps?.length ? { stepIndex: 0, part: workout.steps[0]?.kind === 'interval' ? 'work' : null } : null);
  }, [existing.data]);

  useEffect(() => focusFirstInvalid(formRef.current, ['name', 'day', 'steps'], errors), [errors]);

  const parts = flattenParts(steps);
  const selectedIndex = parts.findIndex((part) => sameSelection(part, selected));
  const selectedPart = selectedIndex >= 0 ? parts[selectedIndex] : undefined;
  const totalSeconds = stepsDuration(steps);
  const scale: Scale = frozen ?? { spp: Math.max(totalSeconds, MIN_DOMAIN_S) / (graphWidth - HANDLE), ppp: AXIS_MAX_PERCENT / GRAPH_HEIGHT };

  if (athlete.error && isNotFound(athlete.error)) return <NotFound />;
  if (existing.error && isNotFound(existing.error)) return <NotFound />;

  const choose = (part: Part): void => setSelected({ stepIndex: part.stepIndex, part: part.part });

  const change = (index: number, update: { duration_s?: number; target_pct?: number }, say: boolean): Step[] => {
    const part = parts[index] as Part;
    const next = steps.map((step, position) => (position === part.stepIndex ? withPart(step, part.part, update) : step));
    setSteps(next);
    if (say) {
      const moved = flattenParts(next)[index] as Part;
      announcer.say(announcement(moved));
    }
    return next;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const { key } = event;
    const handled = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '+', '-', 'Delete', 'Backspace'].includes(key);
    if (!handled || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    if (parts.length === 0) return;
    const index = selectedIndex < 0 ? 0 : selectedIndex;
    const part = parts[index] as Part;
    if (selectedIndex < 0) choose(part);

    if (key === 'ArrowUp' || key === 'ArrowDown') {
      const direction = key === 'ArrowUp' ? -1 : 1;
      if (event.altKey) {
        const target = Math.min(Math.max(part.stepIndex + direction, 0), steps.length - 1);
        const next = [...steps];
        const [moving] = next.splice(part.stepIndex, 1);
        next.splice(target, 0, moving as Step);
        setSteps(next);
        setSelected({ stepIndex: target, part: part.part });
        announcer.say(`${STEP_LABELS[part.kind]} moved to position ${target + 1} of ${steps.length}.`);
      } else if (event.shiftKey) {
        change(index, { target_pct: snapTarget(part.target_pct - direction) }, true);
      } else {
        const next = parts[Math.min(Math.max(index + direction, 0), parts.length - 1)] as Part;
        choose(next);
      }
    } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const direction = key === 'ArrowLeft' ? -1 : 1;
      change(index, { duration_s: snapDuration(part.duration_s + direction * LIMITS.durationStep) }, true);
    } else if (key === '+' || key === '-') {
      if (part.kind !== 'interval') return;
      const repeat = clampRepeat((part.repeat ?? 1) + (key === '+' ? 1 : -1));
      setSteps(steps.map((step, position) => (position === part.stepIndex && step.kind === 'interval' ? { ...step, repeat } : step)));
      announcer.say(`Interval repeats ${repeat}.`);
    } else {
      const next = steps.filter((_, position) => position !== part.stepIndex);
      const stay = Math.min(part.stepIndex, next.length - 1);
      setSteps(next);
      setSelected(next.length === 0 ? null : { stepIndex: stay, part: next[stay]?.kind === 'interval' ? 'work' : null });
      announcer.say(`${STEP_LABELS[part.kind]} removed.`);
    }
  };

  const add = (kind: StepKind): void => {
    if (steps.length >= LIMITS.stepsMax) return;
    const at = selected ? selected.stepIndex + 1 : steps.length;
    const next = [...steps];
    next.splice(at, 0, defaultStep(kind));
    setSteps(next);
    setSelected({ stepIndex: at, part: kind === 'interval' ? 'work' : null });
    announcer.say(`${STEP_LABELS[kind]} added.`);
    listRef.current?.focus({ preventScroll: true });
  };

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>, kind: Drag['kind'], part: Part): void => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const selection = { stepIndex: part.stepIndex, part: part.part };
    drag.current = { kind, selection, startX: event.clientX, startY: event.clientY, duration_s: part.duration_s, target_pct: part.target_pct, scale };
    setFrozen(scale);
    setSelected(selection);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    if (!current) return;
    const index = parts.findIndex((part) => sameSelection(part, current.selection));
    if (index < 0) return;
    if (current.kind === 'duration') {
      change(index, { duration_s: snapDuration(current.duration_s + (event.clientX - current.startX) * current.scale.spp) }, false);
    } else {
      change(index, { target_pct: snapTarget(current.target_pct - (event.clientY - current.startY) * current.scale.ppp) }, false);
    }
  };

  const endDrag = (): void => {
    const current = drag.current;
    drag.current = null;
    setFrozen(null);
    const part = current ? parts.find((candidate) => sameSelection(candidate, current.selection)) : undefined;
    if (part) announcer.say(announcement(part));
  };

  const save = async (target: 'calendar' | 'library'): Promise<void> => {
    setSaving(target);
    setErrors({});
    announcer.say('Saving…');
    try {
      if (target === 'library') {
        await post('/api/library', { name, sport, steps });
        announcer.say(`Saved ${name.trim()} to your library.`);
      } else if (editing && version !== null) {
        const { workout } = await patch<{ workout: Workout }>(`/api/workouts/${editing}`, { version, date: day, title: name, steps });
        setVersion(workout.version);
        announcer.say(`Saved ${workout.title} on ${dayLabel(workout.date)}.`);
      } else {
        const { workout } = await post<{ workout: Workout }>(`/api/athletes/${athleteId}/workouts`, { date: day, sport, title: name, steps });
        announcer.say(`Saved ${workout.title} on ${dayLabel(workout.date)}.`);
      }
    } catch (failure) {
      const fields = fieldErrors(failure);
      if (fields) {
        setErrors({
          ...(fields['title'] ?? fields['name'] ? { name: (fields['title'] ?? fields['name']) as string } : {}),
          ...(fields['date'] ? { day: fields['date'] } : {}),
          ...(fields['steps'] ? { steps: fields['steps'] } : {}),
          ...(fields['sport'] ? { sport: fields['sport'] } : {})
        });
        announcer.say('');
      } else {
        announcer.say(failureMessage(failure));
      }
    } finally {
      setSaving(null);
    }
  };

  const bars: { part: Part; left: number; width: number; height: number; key: string }[] = [];
  let cursor = 0;
  steps.forEach((step, stepIndex) => {
    const repeats = step.kind === 'interval' ? step.repeat : 1;
    const stepParts = parts.filter((part) => part.stepIndex === stepIndex);
    for (let repetition = 0; repetition < repeats; repetition++) {
      for (const part of stepParts) {
        bars.push({ part, left: cursor / scale.spp, width: part.duration_s / scale.spp, height: part.target_pct / scale.ppp, key: `${stepIndex}-${part.part ?? 'plain'}-${repetition}` });
        cursor += part.duration_s;
      }
    }
  });

  const planned = stepsTss(steps);
  const totalIf = stepsIf(steps);

  return (
    <section className="wrap page builder" ref={formRef}>
      <p className="eyebrow">{athlete.data && athlete.data.id !== me.id ? athlete.data.name : 'Builder'}</p>
      <h1 className="page-title">Build a workout</h1>
      <div className="builder-grid">
        <div className="builder-meta tile">
          <div role="radiogroup" aria-label="Sport" className="choice-row" data-field="sport">
            {(['bike', 'run'] as const).map((value) => (
              <label key={value} className="choice">
                <input type="radio" name="builder-sport" checked={sport === value} disabled={editing !== null} onChange={() => setSport(value)} />
                <span>{value === 'bike' ? 'Bike' : 'Run'}</span>
              </label>
            ))}
          </div>
          <Field label="Workout name" error={errors['name']}>
            {(props) => <input {...props} data-field="name" type="text" value={name} onChange={(event) => setName(event.target.value)} />}
          </Field>
          <Field label="Day" error={errors['day']}>
            {(props) => <input {...props} data-field="day" type="text" inputMode="numeric" placeholder="YYYY-MM-DD" value={day} onChange={(event) => setDay(event.target.value)} />}
          </Field>
        </div>

        <div className="builder-graph tile">
          <div
            role="group"
            aria-label="Workout graph"
            className="graph"
            ref={graphRef}
            style={{ height: GRAPH_HEIGHT }}
            data-seconds-per-px={scale.spp.toFixed(4)}
            data-percent-per-px={scale.ppp.toFixed(4)}
          >
            <div className="graph-reference" style={{ bottom: 100 / scale.ppp }} aria-hidden="true" />
            {steps.length === 0 && (
              <>
                <p className="graph-empty">Add a step to draw the workout.</p>
                {GHOSTS.map((ghost) => (
                  <div key={ghost.at} className={`graph-ghost ${zoneOf(ghost.target)}`} style={{ left: `${ghost.at}%`, width: `${ghost.span}%`, height: ghost.target / scale.ppp }} aria-hidden="true" />
                ))}
              </>
            )}
            {[50, 100, 150].map((percent) => (
              <span key={percent} className="graph-axis" style={{ bottom: percent / scale.ppp - 9 }} aria-hidden="true">{`${percent}%`}</span>
            ))}
            {bars.map(({ part, left, width, height, key }) => (
              <div
                key={key}
                className={`bar ${zoneOf(part.target_pct)}${sameSelection(part, selected) ? ' bar-selected' : ''}`}
                data-step-index={part.stepIndex}
                data-part={part.part ?? ''}
                style={{ left, width, height }}
                onPointerDown={() => {
                  choose(part);
                  listRef.current?.focus({ preventScroll: true });
                }}
              />
            ))}
            {bars.map(({ part, left, width, height, key }) => (
              <div
                key={`t-${key}`}
                className="handle handle-target"
                data-handle="target"
                data-step-index={part.stepIndex}
                data-part={part.part ?? ''}
                style={{ left, width, bottom: height - HANDLE / 2 }}
                onPointerDown={(event) => startDrag(event, 'target', part)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              />
            ))}
            {bars.map(({ part, left, width, height, key }) => (
              <div
                key={`d-${key}`}
                className="handle handle-duration"
                data-handle="duration"
                data-step-index={part.stepIndex}
                data-part={part.part ?? ''}
                style={{ left: left + width - HANDLE / 2, height }}
                onPointerDown={(event) => startDrag(event, 'duration', part)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              />
            ))}
          </div>
        </div>

        <div
          role="group"
          aria-label="Workout totals"
          className="totals tile"
          data-duration-s={totalSeconds}
          data-planned-tss={formatTss(planned)}
          data-if={formatIf(totalIf)}
        >
          <div className="total">
            <span>Duration</span> <strong>{formatDuration(totalSeconds)}</strong>
          </div>
          <div className="total">
            <span>Planned</span> <strong>{formatTss(planned)} TSS</strong>
          </div>
          <div className="total">
            <span>IF</span> <strong>{formatIf(totalIf)}</strong>
          </div>
        </div>

        <div className="builder-add tile">
          {ADD_KINDS.map(({ kind, label }) => (
            <Pill key={kind} tone="ghost" aria-label={`Add ${label}`} disabled={steps.length >= LIMITS.stepsMax} onClick={() => add(kind)}>
              <Plus aria-hidden="true" size={18} />
              {label.charAt(0).toUpperCase() + label.slice(1)}
            </Pill>
          ))}
        </div>

        <div className="builder-save tile">
          <Pill tone="navy" pending={saving === 'calendar'} pendingText="Saving…" disabled={saving !== null} onClick={() => void save('calendar')}>
            Save to calendar
          </Pill>
          <Pill tone="cobalt" pending={saving === 'library'} pendingText="Saving…" disabled={saving !== null} onClick={() => void save('library')}>
            Save to library
          </Pill>
          <Status label="Builder announcements" announcer={announcer} className="builder-status" />
        </div>

        <div className="builder-steps tile">
          <h2 className="tile-title">Steps</h2>
          <div
            role="listbox"
            aria-label="Steps"
            className="steps"
            tabIndex={0}
            ref={listRef}
            aria-activedescendant={selectedPart ? optionId(selectedPart) : undefined}
            aria-describedby={errors['steps'] ? 'steps-error' : undefined}
            aria-invalid={errors['steps'] ? true : undefined}
            data-field="steps"
            onKeyDown={onKeyDown}
          >
            {parts.map((part) => (
              <div
                key={optionId(part)}
                id={optionId(part)}
                role="option"
                aria-selected={sameSelection(part, selected)}
                className={`step-option ${zoneOf(part.target_pct)}${sameSelection(part, selected) ? ' step-option-selected' : ''}`}
                data-kind={part.kind}
                data-duration-s={part.duration_s}
                data-target-pct={part.target_pct}
                data-step-index={part.stepIndex}
                data-repeat={part.repeat ?? undefined}
                onClick={() => {
                  choose(part);
                  listRef.current?.focus({ preventScroll: true });
                }}
              >
                <span className="step-name">{partLabel(part)}</span>
                <span>{formatDuration(part.duration_s)}</span>
                <span>{`${part.target_pct}%`}</span>
                {part.repeat !== null && <span className="step-repeat">{`×${part.repeat}`}</span>}
              </div>
            ))}
          </div>
          {steps.length === 0 && !errors['steps'] && <p className="muted">No steps yet.</p>}
          {errors['steps'] && <FieldError id="steps-error">{errors['steps']}</FieldError>}
          <p className="muted keys-hint">
            Up and Down select, Left and Right resize by 30 seconds, Shift with Up or Down retargets, + and - repeat, Alt with Up or Down reorders, Delete removes.
          </p>
        </div>
      </div>
      {existing.data === null && editing && <Skeleton lines={2} />}
    </section>
  );
}
