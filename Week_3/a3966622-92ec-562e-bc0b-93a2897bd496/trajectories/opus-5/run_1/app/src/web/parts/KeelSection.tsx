import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  existingSteps,
  minutesAfterMidnight,
  parsePortDate,
  parsePortDateTime,
  wallOnDate,
  wallToInstant,
} from '../../domain/porttime.ts';
import { NoReply, send } from '../api.ts';
import { FORMULA, NO_REPLY, marginFromMm, stepLabel, minutesOfTime } from '../format.ts';
import { useReducedMotion } from '../hooks.ts';
import type { Move, Plan, WindowsReply } from '../types.ts';
import { SectionDrawing } from './SectionDrawing.tsx';

const ANNOUNCE_REST_MS = 500;

export type SectionState = {
  plan: Plan | null;
  planningDay: string;
  handle: number;
};

type Props = {
  move: Move | null;
  canCommit: boolean;
  tideVersion: number;
  onCommitted: (move: Move) => void;
  onPlan: (plan: Plan | null) => void;
  handleRef?: React.MutableRefObject<HTMLDivElement | null>;
};

function dayOf(move: Move | null): string {
  if (move === null) return '';
  return (move.committed?.boarding_at ?? move.boarding_at).slice(0, 10);
}

function handleOf(move: Move | null): number {
  if (move === null) return 0;
  const text = move.committed?.boarding_at ?? move.boarding_at;
  const wall = parsePortDateTime(text);
  return wall === null ? 0 : minutesAfterMidnight(wall);
}

function stepInstant(day: string, minutes: number): number | null {
  const date = parsePortDate(day);
  if (date === null) return null;
  return wallToInstant(wallOnDate(date, minutes));
}

export function KeelSection({
  move,
  canCommit,
  tideVersion,
  onCommitted,
  onPlan,
  handleRef,
}: Props): JSX.Element {
  const [planningDay, setPlanningDay] = useState(() => dayOf(move));
  const [handle, setHandle] = useState(() => handleOf(move));
  const [plan, setPlan] = useState<Plan | null>(null);
  const [windows, setWindows] = useState<WindowsReply | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [progress, setProgress] = useState(0);
  const [committing, setCommitting] = useState(false);
  const planToken = useRef(0);
  const announced = useRef<{ pinch: string; gate: string } | null>(null);
  const baselineNeeded = useRef(true);
  const loadedRef = useRef<string | null>(null);
  const reduced = useReducedMotion();

  const steps = useMemo(() => {
    const date = parsePortDate(planningDay);
    return date === null ? [] : existingSteps(date);
  }, [planningDay]);

  useEffect(() => {
    if (move === null) return;
    if (loadedRef.current === move.ref) return;
    loadedRef.current = move.ref;
    setPlanningDay(dayOf(move));
    setHandle(handleOf(move));
    setProgress(0);
    baselineNeeded.current = true;
  }, [move]);

  useEffect(() => {
    if (move === null || planningDay === '') return;
    let current = true;
    void (async () => {
      const reply = await send<WindowsReply>(
        'GET',
        `/api/moves/${encodeURIComponent(move.ref)}/windows?date=${planningDay}`,
      ).catch(() => null);
      if (current && reply !== null && reply.ok) setWindows(reply.data);
    })();
    return () => {
      current = false;
    };
  }, [move, planningDay, tideVersion]);

  /** Only the reply for the handle's current value and planning day paints. */
  useEffect(() => {
    if (move === null || planningDay === '') return;
    const instant = stepInstant(planningDay, handle);
    if (instant === null) return;
    const token = planToken.current + 1;
    planToken.current = token;
    const requestedDay = planningDay;
    const requestedStep = handle;
    void (async () => {
      const boarding = `${requestedDay}T${stepLabel(requestedStep)}`;
      const reply = await send<Plan>(
        'GET',
        `/api/moves/${encodeURIComponent(move.ref)}/plan?boarding_at=${boarding}`,
      ).catch(() => null);
      if (reply === null || !reply.ok) return;
      if (planToken.current !== token) return;
      setPlan(reply.data);
      onPlan(reply.data);
    })();
  }, [move, planningDay, handle, tideVersion, onPlan]);

  /** The region compares the painted pinch and gate with the pair it last announced. */
  useEffect(() => {
    if (plan === null) return;
    if (plan.boarding_at !== `${planningDay}T${stepLabel(handle)}`) return;
    const pinchWaypoint = plan.waypoints.find((waypoint) => waypoint.pinch);
    const painted = {
      pinch: `Pinch ${pinchWaypoint?.name ?? ''}, margin ${marginFromMm(plan.pinch.margin_mm)} m`,
      gate: plan.window_state === 'open' ? 'Gate open' : 'Gate closed',
    };
    if (baselineNeeded.current) {
      baselineNeeded.current = false;
      announced.current = painted;
      return;
    }
    const timer = setTimeout(() => {
      const last = announced.current;
      const pinchChanged = last === null || last.pinch !== painted.pinch;
      const gateChanged = last === null || last.gate !== painted.gate;
      if (pinchChanged && gateChanged) setAnnouncement(`${painted.pinch}. ${painted.gate}`);
      else if (pinchChanged) setAnnouncement(painted.pinch);
      else if (gateChanged) setAnnouncement(painted.gate);
      announced.current = painted;
    }, ANNOUNCE_REST_MS);
    return () => clearTimeout(timer);
  }, [plan, planningDay, handle]);

  const moveHandle = useCallback(
    (minutes: number) => {
      setHandle(minutes);
      setProgress(0);
    },
    [],
  );

  const stepBy = useCallback(
    (direction: 1 | -1) => {
      const index = steps.indexOf(handle);
      const fallback = direction === 1 ? steps.find((step) => step > handle) : [...steps].reverse().find((step) => step < handle);
      const next = index === -1 ? fallback : steps[index + direction];
      if (next !== undefined) moveHandle(next);
    },
    [handle, steps, moveHandle],
  );

  const jumpRealMinutes = useCallback(
    (realMinutes: number) => {
      const current = stepInstant(planningDay, handle);
      if (current === null) return;
      const target = current + realMinutes * 60_000;
      const candidates = steps
        .map((step) => ({ step, instant: stepInstant(planningDay, step) }))
        .filter((entry): entry is { step: number; instant: number } => entry.instant !== null);
      if (realMinutes > 0) {
        const next = candidates.find((entry) => entry.instant >= target);
        moveHandle(next?.step ?? (steps[steps.length - 1] as number));
      } else {
        const earlier = [...candidates].reverse().find((entry) => entry.instant <= target);
        moveHandle(earlier?.step ?? (steps[0] as number));
      }
    },
    [handle, planningDay, steps, moveHandle],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const keys: Record<string, () => void> = {
      ArrowLeft: () => stepBy(-1),
      ArrowDown: () => stepBy(-1),
      ArrowRight: () => stepBy(1),
      ArrowUp: () => stepBy(1),
      PageDown: () => jumpRealMinutes(-30),
      PageUp: () => jumpRealMinutes(30),
      Home: () => moveHandle(steps[0] ?? 0),
      End: () => moveHandle(steps[steps.length - 1] ?? 1435),
    };
    const action = keys[event.key];
    if (action === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    action();
  };

  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  const fromClientX = (clientX: number): void => {
    const track = trackRef.current;
    if (track === null || steps.length === 0) return;
    const bounds = track.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width));
    const wanted = fraction * 1435;
    let nearest = steps[0] as number;
    for (const step of steps) {
      if (Math.abs(step - wanted) < Math.abs(nearest - wanted)) nearest = step;
    }
    moveHandle(nearest);
  };

  const commit = (): void => {
    if (move === null || committing) return;
    setCommitting(true);
    setAnnouncement('Committing window...');
    void (async () => {
      try {
        const reply = await send<Move>(
          'POST',
          `/api/moves/${encodeURIComponent(move.ref)}/commit`,
          {
            body: {
              boarding_at: `${planningDay}T${stepLabel(handle)}`,
              tide_version: tideVersion,
              draught_mm: move.draught_mm,
            },
            ifMatch: move.version,
          },
        );
        if (reply.ok) {
          const pinch = reply.data.committed;
          setAnnouncement(
            `Window committed at ${stepLabel(handle)} port time, pinch ${
              pinch?.pinch_waypoint ?? ''
            } ${marginFromMm(pinch?.margin_mm ?? 0)} m`,
          );
          setProgress(100);
          onCommitted(reply.data);
          return;
        }
        const error = reply.error;
        if (error.error === 'stale_version') {
          setAnnouncement(
            'Commit refused: another dispatcher changed this move. Section redrawn from fresh data.',
          );
          if (error.current !== undefined) onCommitted(error.current);
        } else if (error.error === 'stale_plan') {
          setAnnouncement(
            'Commit refused: the tide table or draught changed. Section redrawn from new values.',
          );
          if (error.plan !== undefined) {
            setPlan(error.plan);
            onPlan(error.plan);
          }
        } else if (error.error === 'window_closed') {
          const closed = error.plan?.waypoints.find((waypoint) => waypoint.pinch);
          setAnnouncement(`Commit refused: the window no longer clears at ${closed?.name ?? ''}.`);
          if (error.plan !== undefined) {
            setPlan(error.plan);
            onPlan(error.plan);
          }
        } else if (error.errors?.boarding_at !== undefined) {
          setAnnouncement(
            error.errors.boarding_at.includes('does not exist')
              ? 'Commit refused: that time does not exist in port time on this date.'
              : 'Commit refused: that boarding time has passed.',
          );
        } else {
          setAnnouncement(`Commit refused: ${error.message}`);
        }
        setProgress(0);
      } catch (cause) {
        if (cause instanceof NoReply) setAnnouncement(NO_REPLY);
      } finally {
        setCommitting(false);
      }
    })();
  };

  const pinchWaypoint = plan?.waypoints.find((waypoint) => waypoint.pinch);
  const gateOpen = plan?.window_state === 'open';
  const effectiveProgress = reduced && progress === 100 ? 100 : progress;

  return (
    <>
      <section className="keel-region" aria-label="Keel Section">
        {move === null ? (
          <p>Select a move to plan</p>
        ) : (
          <>
            <SectionDrawing plan={plan} move={move} progress={effectiveProgress} />
            <div
              className="gate-ribbon"
              data-testid="gate-ribbon"
              data-state={gateOpen ? 'open' : 'closed'}
            />
            <div className="keel-controls">
              <div
                className="slider-track"
                ref={trackRef}
                onPointerDown={(event) => {
                  dragging.current = true;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  fromClientX(event.clientX);
                }}
                onPointerMove={(event) => {
                  if (dragging.current) fromClientX(event.clientX);
                }}
                onPointerUp={() => {
                  dragging.current = false;
                }}
                onPointerCancel={() => {
                  dragging.current = false;
                }}
              >
                <div
                  ref={handleRef}
                  role="slider"
                  aria-label="Boarding time"
                  aria-valuemin={0}
                  aria-valuemax={1435}
                  aria-valuenow={handle}
                  aria-valuetext={`${stepLabel(handle)} port time`}
                  aria-orientation="horizontal"
                  tabIndex={0}
                  className="slider-handle"
                  style={{ left: `${(handle / 1435) * 100}%` }}
                  onKeyDown={onKeyDown}
                />
                {(windows?.windows ?? []).map((window) => (
                  <div
                    key={`${window.from}-${window.to}`}
                    className="window-strip"
                    style={{
                      left: `${(minutesOfTime(window.from) / 1435) * 100}%`,
                      width: `${Math.max(1, ((minutesOfTime(window.to) - minutesOfTime(window.from)) / 1435) * 100)}%`,
                    }}
                  />
                ))}
              </div>
              <label>
                Planning day
                <input
                  aria-label="Planning day"
                  value={planningDay}
                  onChange={(event) => {
                    setPlanningDay(event.target.value);
                    setProgress(0);
                  }}
                  size={10}
                />
              </label>
              {canCommit && (
                <button
                  type="button"
                  className="primary"
                  disabled={!gateOpen || committing}
                  onClick={commit}
                >
                  Commit window
                </button>
              )}
            </div>
            <div className="keel-readout">
              <span className="mono">{`${stepLabel(handle)} port time`}</span>
              <span aria-label="Pinch" className="mono">
                {`Pinch ${pinchWaypoint?.name ?? ''} ${marginFromMm(plan?.pinch.margin_mm ?? 0)} m`}
              </span>
              <span aria-label="Gate" className={gateOpen ? 'mono' : 'mono negative'}>
                {gateOpen ? 'Gate open' : 'Gate closed'}
              </span>
              <span aria-label="Formula" className="dim">
                {FORMULA}
              </span>
            </div>
            <div role="group" aria-label="Open windows" className="keel-readout">
              {(windows?.windows ?? []).length === 0 ? (
                <span className="dim">No open window on this day</span>
              ) : (
                (windows?.windows ?? []).map((window) => (
                  <button
                    key={`${window.from}-${window.to}`}
                    type="button"
                    onClick={() => moveHandle(minutesOfTime(window.from))}
                  >
                    {`Open window ${window.from} to ${window.to}`}
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </section>
      <div role="status" aria-label="Section announcements" className="announce">
        {announcement}
      </div>
    </>
  );
}
