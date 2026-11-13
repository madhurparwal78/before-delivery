// The Keel Section's state: planning day, time handle, the plan painted for the handle's current
// step only, open windows, announcements once the handle rests, commit and the hull transit.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signedMetres } from "../../shared/numerals";
import { clockText, isPortDate, moveHandle, SKIPPED_TIME, stepsOfDate, type HandleKey } from "../../shared/portTime";
import type { Move, Plan } from "../../shared/types";
import { get, NO_REPLY, request, useSingleFlight } from "../api";
import type { Live } from "../ui/live";

const REST_MS = 500;
const HULL_MS = 900;

export const prefersReducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Painted {
  key: string;
  plan: Plan;
}

const pinchName = (plan: Plan): string => plan.waypoints.find((w) => w.id === plan.pinch.waypoint_id)?.name ?? "";

/** The handle message: pinch first, then gate, joined by a full stop and a space. */
function handleMessage(plan: Plan, last: { pinch: string; gate: string }): string | null {
  const pinchChanged = plan.pinch.waypoint_id !== last.pinch;
  const gateChanged = plan.window_state !== last.gate;
  const pinch = `Pinch ${pinchName(plan)}, margin ${signedMetres(plan.pinch.margin_mm)} m`;
  const gate = plan.window_state === "open" ? "Gate open" : "Gate closed";
  if (pinchChanged && gateChanged) return `${pinch}. ${gate}`;
  if (pinchChanged) return pinch;
  if (gateChanged) return gate;
  return null;
}

/** Where the handle starts for a move: its committed boarding time if it has one, else its boarding time. */
const startOf = (move: Move): string => move.committed?.boarding_at ?? move.boarding_at;

/** What the Keel Section reads and drives: the hook's own return value. */
export type Planner = ReturnType<typeof usePlanner>;

export function usePlanner(
  move: Move | null,
  announcements: Live,
  onFresh: (move: Move) => void,
) {
  const [day, setDayState] = useState("");
  const [index, setIndex] = useState(0);
  const [painted, setPainted] = useState<Painted | null>(null);
  const [windows, setWindows] = useState<{ key: string; list: { from: string; to: string }[] } | null>(null);
  const [hull, setHull] = useState(0);
  const [committing, setCommitting] = useState(false);
  const [reload, setReload] = useState(0);
  const steps = useMemo(() => (day ? stepsOfDate(day) : []), [day]);
  const step = steps[index];
  const ref = move?.ref ?? null;
  const key = ref && step ? `${ref}|${day}|${step.minutes}|${reload}` : "";

  const current = useRef(key);
  current.current = key;
  const latestMove = useRef(move);
  latestMove.current = move;
  const [restedKey, setRestedKey] = useState("");
  const announced = useRef<{ key: string; pinch: string; gate: string } | null>(null);
  const silent = useRef(true);
  const hullFrame = useRef(0);
  const flight = useSingleFlight();

  /** Places the handle on a move's start (or a fresh copy of it) and resets the baseline silently. */
  const place = useCallback((target: Move) => {
    const start = startOf(target);
    const date = start.slice(0, 10);
    const minutes = Number(start.slice(11, 13)) * 60 + Number(start.slice(14, 16));
    const found = stepsOfDate(date).findIndex((s) => s.minutes === minutes);
    setDayState(date);
    setIndex(Math.max(0, found));
    silent.current = true;
    setReload((r) => r + 1);
  }, []);

  // A different move is a load; a fresh copy of the same move keeps the handle where it is.
  useEffect(() => {
    cancelAnimationFrame(hullFrame.current);
    setHull(0);
    setPainted(null);
    if (latestMove.current) place(latestMove.current);
  }, [ref, place]);

  // Announce once the handle has rested on a value and that value's plan has painted.
  const say = announcements.say;
  useEffect(() => {
    if (!painted || painted.key !== current.current) return;
    const plan = painted.plan;
    const state = { key: painted.key, pinch: plan.pinch.waypoint_id, gate: plan.window_state };
    if (silent.current || !announced.current) {
      silent.current = false;
      announced.current = state;
      return;
    }
    if (restedKey !== painted.key || announced.current.key === painted.key) return;
    const message = handleMessage(plan, announced.current);
    announced.current = state;
    if (message) say(message);
  }, [painted, restedKey, say]);

  useEffect(() => {
    if (!key || !ref || !step) return;
    let live = true;
    void get<Plan>(`/api/moves/${encodeURIComponent(ref)}/plan?boarding_at=${day}T${clockText(step.minutes)}`).then((outcome) => {
      if (live && outcome.kind === "ok" && current.current === key) setPainted({ key, plan: outcome.data });
    });
    const timer = window.setTimeout(() => setRestedKey(key), REST_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [key, ref, day, step]);

  useEffect(() => {
    if (!ref || !day) return;
    const windowKey = `${ref}|${day}|${reload}`;
    let live = true;
    void get<{ windows: { from: string; to: string }[] }>(`/api/moves/${encodeURIComponent(ref)}/windows?date=${day}`).then(
      (outcome) => {
        if (live && outcome.kind === "ok") setWindows({ key: windowKey, list: outcome.data.windows });
      },
    );
    return () => {
      live = false;
    };
  }, [ref, day, reload]);

  const handleMoved = (): void => {
    cancelAnimationFrame(hullFrame.current);
    setHull(0);
  };

  const travel = (): void => {
    if (prefersReducedMotion()) {
      setHull(100);
      return;
    }
    const start = performance.now();
    const frame = (now: number): void => {
      const t = Math.min(1, (now - start) / HULL_MS);
      setHull(Math.round((1 - (1 - t) ** 3) * 100));
      if (t < 1) hullFrame.current = requestAnimationFrame(frame);
    };
    hullFrame.current = requestAnimationFrame(frame);
  };

  const commit = (): void => {
    const plan = painted?.plan;
    if (!move || !step || !plan || plan.window_state !== "open") return;
    const boardingAt = `${day}T${clockText(step.minutes)}`;
    void flight(async () => {
      setCommitting(true);
      announcements.say("Committing window...");
      const outcome = await request<Move & { plan?: Plan }>(`/api/moves/${encodeURIComponent(move.ref)}/commit`, {
        body: { boarding_at: boardingAt, tide_version: plan.tide_version, draught_mm: move.draught_mm },
        ifMatch: move.version,
      });
      setCommitting(false);
      if (outcome.kind === "no-reply") {
        announcements.say(NO_REPLY);
        return;
      }
      if (outcome.kind === "ok") {
        const committed = outcome.data.committed;
        announced.current = { key: current.current, pinch: plan.pinch.waypoint_id, gate: plan.window_state };
        announcements.say(
          `Window committed at ${clockText(step.minutes)} port time, pinch ${committed?.pinch_waypoint ?? pinchName(plan)} ${signedMetres(committed?.margin_mm ?? plan.pinch.margin_mm)} m`,
        );
        onFresh(outcome.data);
        travel();
        return;
      }
      const error = outcome.error;
      if (error.error === "stale_plan" || error.error === "window_closed") {
        if (error.plan) setPainted({ key: current.current, plan: error.plan });
        announced.current = error.plan ? { key: current.current, pinch: error.plan.pinch.waypoint_id, gate: error.plan.window_state } : announced.current;
        announcements.say(
          error.error === "stale_plan"
            ? "Commit refused: the tide table or draught changed. Section redrawn from new values."
            : `Commit refused: the window no longer clears at ${error.plan ? pinchName(error.plan) : ""}.`,
        );
        const fresh = await get<Move>(`/api/moves/${encodeURIComponent(move.ref)}`);
        if (fresh.kind === "ok") onFresh(fresh.data);
        setReload((r) => r + 1);
        silent.current = true;
        return;
      }
      if (error.error === "validation_failed") {
        announcements.say(
          error.errors?.boarding_at === SKIPPED_TIME
            ? "Commit refused: that time does not exist in port time on this date."
            : "Commit refused: that boarding time has passed.",
        );
        return;
      }
      announcements.say("Commit refused: another dispatcher changed this move. Section redrawn from fresh data.");
      const fresh = error.current ?? (await get<Move>(`/api/moves/${encodeURIComponent(move.ref)}`).then((o) => (o.kind === "ok" ? o.data : null)));
      if (fresh) {
        onFresh(fresh);
        place(fresh);
      }
    });
  };

  return {
    move,
    day,
    steps,
    index,
    minutes: step?.minutes ?? 0,
    painted: painted?.plan ?? null,
    windows: windows?.key === `${ref}|${day}|${reload}` ? windows.list : null,
    hull,
    committing,
    setDay: (next: string): void => {
      if (!isPortDate(next) || next === day) return;
      const nextSteps = stepsOfDate(next);
      const minutes = step?.minutes ?? 0;
      const nearest = nextSteps.reduce((best, s, i) => (Math.abs(s.minutes - minutes) < Math.abs((nextSteps[best]?.minutes ?? 0) - minutes) ? i : best), 0);
      handleMoved();
      setDayState(next);
      setIndex(nearest);
    },
    moveHandle: (handleKey: HandleKey): void => {
      handleMoved();
      setIndex((i) => moveHandle(steps, i, handleKey));
    },
    setMinutes: (minutes: number): void => {
      const nearest = steps.reduce((best, s, i) => (Math.abs(s.minutes - minutes) < Math.abs((steps[best]?.minutes ?? 0) - minutes) ? i : best), 0);
      if (nearest !== index) handleMoved();
      setIndex(nearest);
    },
    commit,
  };
}
