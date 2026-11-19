import { useCallback, useRef, useState } from "react";
import type { ExportJson } from "../../../server/exports.js";
import { useAnnounce } from "../../lib/announce.js";
import { failureText, get, post } from "../../lib/api.js";
import { useTopics } from "../../lib/live.js";
import { StatusBlock } from "../../lib/ui.js";

/**
 * Starts an export of the list and follows it through `export:<id>` events until storage accepted the file. A failed
 * export stays followed, because the server retries it when storage returns.
 */
export function useExport(table: string, filter: string, columns: string[]): { job: ExportJson | null; start: () => void } {
  const announce = useAnnounce();
  const [job, setJob] = useState<ExportJson | null>(null);
  const last = useRef("");

  const apply = useCallback(
    (next: ExportJson) => {
      const before = last.current;
      last.current = `${next.id}:${next.status}`;
      if (next.status === "complete") {
        setJob(null);
        if (before !== last.current) announce(`Export complete: ${next.rows_total} rows.`);
        return;
      }
      setJob(next);
      if (next.status === "failed" && before !== last.current) announce("Export failed: file storage is unreachable.");
    },
    [announce],
  );

  const refresh = useCallback(
    async (id: number) => {
      try {
        apply((await get<{ export: ExportJson }>(`/api/exports/${id}`)).export);
      } catch (error) {
        announce(failureText(error));
      }
    },
    [apply, announce],
  );

  useTopics(job ? [`export:${job.id}`] : [], () => {
    if (job) void refresh(job.id);
  });

  const start = useCallback(() => {
    post<{ export: ExportJson }>("/api/exports", { table, filter, columns }).then(
      (created) => {
        apply(created.export);
        void refresh(created.export.id);
      },
      (error: unknown) => announce(failureText(error)),
    );
  }, [table, filter, columns, apply, refresh, announce]);

  return { job, start };
}

/** The export's progress bar and its `<done> of <total> rows` text. */
export function ExportProgress({ job }: { job: ExportJson }): JSX.Element {
  const text = `${job.rows_done} of ${job.rows_total} rows`;
  const width = job.rows_total > 0 ? Math.min(100, (job.rows_done / job.rows_total) * 100) : 0;
  return (
    <div className="export-progress">
      <div role="progressbar" aria-label="Export progress" aria-valuemin={0} aria-valuemax={job.rows_total} aria-valuenow={job.rows_done} aria-valuetext={text} className="export-bar">
        <div className="export-fill" style={{ width: `${width}%` }} />
      </div>
      <span>{text}</span>
      {job.status === "failed" ? <StatusBlock>Failed</StatusBlock> : null}
    </div>
  );
}
