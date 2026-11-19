// Background refresh: runs `work` every `ms`, never while the session dialog is open, and stops on unmount.
import { session, SessionCancelled } from "./api.js";

export function poll(work, ms = 2000) {
  let timer = null;
  let stopped = false;
  const loop = async () => {
    if (stopped) return;
    if (!session.paused) {
      try { await work(); } catch (error) { if (!(error instanceof SessionCancelled)) { /* the next tick tries again */ } }
    }
    if (!stopped) timer = setTimeout(loop, ms);
  };
  timer = setTimeout(loop, ms);
  return { stop() { stopped = true; clearTimeout(timer); }, now: work };
}
