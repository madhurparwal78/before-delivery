// The job's log lines: the stored lines from `GET /api/jobs/<id>/log`, then `job_log` messages applied inside the socket handler.
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { api } from "../../api.ts";
import { subscribeProject } from "../../live.ts";
import { asNumber, nextTick } from "../../util.ts";
import { type LogLine, mergeLines, parseLogLine } from "./log-view.tsx";

export function useJobLog(project: number, jobId: number): { lines: LogLine[]; loading: boolean } {
  const [state, setState] = useState<{ lines: LogLine[]; loading: boolean }>({ lines: [], loading: true });
  const fetched = useRef(0);

  useLayoutEffect(() => {
    let alive = true;
    setState({ lines: [], loading: true });
    const load = () => {
      fetched.current = nextTick();
      api.get<{ lines: string[] }>(`/api/jobs/${jobId}/log`).then(
        (body) => {
          if (!alive) return;
          const stored = body.lines.flatMap((raw) => parseLogLine(raw) ?? []);
          setState((current) => ({ lines: mergeLines(current.lines, stored), loading: false }));
        },
        () => {
          if (alive) setState((current) => ({ ...current, loading: false }));
        },
      );
    };
    const unsubscribe = subscribeProject(project, {
      onMessage(message) {
        if (message.type !== "job_log" || asNumber(message.data.job_id) !== jobId) return;
        const raw = message.data.lines;
        if (!Array.isArray(raw)) return;
        const fresh = raw.flatMap((line) => (typeof line === "string" ? (parseLogLine(line) ?? []) : []));
        setState((current) => ({ lines: mergeLines(current.lines, fresh), loading: current.loading }));
      },
      onResync: load,
      onSnapshot(tick) {
        if (fetched.current < tick) load();
      },
    });
    load();
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [project, jobId]);

  return state;
}
