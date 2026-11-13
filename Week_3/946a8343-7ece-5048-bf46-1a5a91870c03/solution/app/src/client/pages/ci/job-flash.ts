// `job-status`: a graph node or job row whose status changed brightens from 40% to fully visible (240 ms). Elements opt in with
// `data-flash="<job id>"`; the first render, new attempts and reduced motion play nothing.
import type { RefObject } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { prefersReducedMotion } from "../../hooks.ts";

const JOB_STATUS_MS = 240;

export function useJobFlash(root: RefObject<HTMLElement>, jobs: readonly { id: number; status: string }[] | undefined): void {
  const seen = useRef(new Map<number, string>());
  useLayoutEffect(() => {
    if (jobs === undefined) return;
    const calm = prefersReducedMotion();
    for (const job of jobs) {
      const before = seen.current.get(job.id);
      seen.current.set(job.id, job.status);
      if (before === undefined || before === job.status || calm || root.current === null) continue;
      for (const element of root.current.querySelectorAll<HTMLElement>(`[data-flash="${job.id}"]`)) {
        element.animate({ opacity: [0.4, 1] }, { id: "job-status", duration: JOB_STATUS_MS, easing: "ease-out" });
      }
    }
  }, [jobs]);
}
