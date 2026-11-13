// The evaluation lifecycle (DP-05..DP-10, DP-14): the only place the evaluation states are named.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Diagnostic, EvaluationJson } from "../shared/api";
import type { Solid, Values, Vec3 } from "../shared/tine";
import { api } from "./api";

type EvalState = "dirty" | "evaluating" | "settling" | "settled" | "failed" | "stale";
type EvalEvent = "commit" | "debounce" | "succeeded" | "failed" | "fadeEnd";

function transition(state: EvalState, event: EvalEvent): EvalState {
  switch (event) {
    case "commit":
      return state === "settled" || state === "failed" || state === "settling" ? "dirty" : state === "evaluating" ? "stale" : state;
    case "debounce":
      return state === "dirty" || state === "stale" ? "evaluating" : state;
    case "succeeded":
      return state === "evaluating" ? "settling" : state;
    case "failed":
      return state === "evaluating" ? "failed" : state;
    case "fadeEnd":
      return state === "settling" ? "settled" : state;
  }
}

export const isFailed = (view: EvaluationView): boolean => view.state === "failed";
export const isEvaluating = (view: EvaluationView): boolean => view.state === "evaluating";

interface Drawn {
  solid: Solid;
  digest: string;
  volume: number;
  bbox: Vec3;
  faces: number;
  seq: number;
}

interface EvaluationView {
  state: EvalState;
  drawn: Drawn | null;
  diagnostic: Diagnostic | null;
  superseded: boolean;
  slow: boolean;
  /** The seq of the newest request sent. */
  sent: number;
}

interface Options {
  partSlug: string;
  revisionId?: string;
  viewerId: string;
  debounceMs: number;
  slowMs: number;
  /** The evaluation debounce elapsed: the address follows the values now. */
  onDebounce?: (values: Values) => void;
  onApplied?: (drawn: Drawn) => void;
}

export function useEvaluation(options: Options) {
  const opts = useRef(options);
  opts.current = options;
  const machine = useRef({ state: "dirty" as EvalState, sent: 0, applied: 0, drawnDigest: "", values: {} as Values, timer: 0, slowTimer: 0, abort: null as AbortController | null });
  const [view, setView] = useState<EvaluationView>({ state: "dirty", drawn: null, diagnostic: null, superseded: false, slow: false, sent: 0 });

  const dispatch = useCallback((event: EvalEvent, patch: Partial<EvaluationView> = {}) => {
    const m = machine.current;
    m.state = transition(m.state, event);
    setView((v) => ({ ...v, ...patch, state: m.state, sent: m.sent }));
  }, []);

  const stopSlow = () => {
    window.clearTimeout(machine.current.slowTimer);
  };

  const send = useCallback(async () => {
    const m = machine.current;
    const o = opts.current;
    o.onDebounce?.(m.values);
    const seq = ++m.sent;
    dispatch("debounce", { slow: false });
    const controller = new AbortController();
    m.abort = controller;
    stopSlow();
    m.slowTimer = window.setTimeout(() => setView((v) => ({ ...v, slow: true })), o.slowMs);
    let reply;
    try {
      reply = await api<EvaluationJson & { message?: string }>(
        "POST",
        "/api/evaluations",
        { partSlug: o.partSlug, ...(o.revisionId ? { revisionId: o.revisionId } : {}), values: m.values, seq, viewerId: o.viewerId },
        { signal: controller.signal },
      );
    } catch {
      return;
    }
    if (seq !== m.sent) return;
    stopSlow();
    const body = reply.data;
    if (reply.status === 200 && body.status === "cancelled") return;
    if (reply.status === 200 && body.status === "succeeded" && body.solid && body.geometryDigest && seq >= m.applied) {
      m.applied = seq;
      const drawn: Drawn = { solid: body.solid, digest: body.geometryDigest, volume: body.volume, bbox: body.bbox, faces: body.faces, seq };
      const unchanged = m.drawnDigest === drawn.digest;
      m.drawnDigest = drawn.digest;
      opts.current.onApplied?.(drawn);
      dispatch("succeeded", { drawn, diagnostic: null, superseded: false, slow: false });
      // The same solid is already on screen: there is no cross-fade to wait for.
      if (unchanged) dispatch("fadeEnd");
    } else if (seq >= m.applied) {
      const diagnostic = body.diagnostics?.[0] ?? { code: "E_NONPOSITIVE" as const, message: body.message ?? "Could not evaluate.", parameter: null };
      dispatch("failed", { diagnostic, superseded: false, slow: false });
    }
  }, [dispatch]);

  /** A value was committed: supersede any evaluation in flight and restart the debounce. */
  const commit = useCallback(
    (values: Values) => {
      const m = machine.current;
      m.values = values;
      let superseded = false;
      if (m.state === "evaluating") {
        m.abort?.abort();
        stopSlow();
        void api("POST", "/api/evaluations/cancel", { viewerId: opts.current.viewerId }).catch(() => undefined);
        superseded = true;
      }
      dispatch("commit", { ...(superseded ? { superseded: true, slow: false } : {}) });
      window.clearTimeout(m.timer);
      m.timer = window.setTimeout(() => void send(), opts.current.debounceMs);
    },
    [dispatch, send],
  );

  /** The first evaluation of a page load goes out at once. */
  const start = useCallback(
    (values: Values) => {
      machine.current.values = values;
      void send();
    },
    [send],
  );

  const fadeEnd = useCallback(() => dispatch("fadeEnd"), [dispatch]);

  useEffect(() => {
    const m = machine.current;
    return () => {
      window.clearTimeout(m.timer);
      window.clearTimeout(m.slowTimer);
      m.abort?.abort();
    };
  }, []);

  return { view, commit, start, fadeEnd };
}
