import { useEffect, useState } from 'react';
import { api, ApiError, generalErrorCopy } from '../api/client.ts';
import type { ExportJob } from '../api/types.ts';
import type { ExportKind, ExportStatus, Filter, ParameterValue } from '../../shared/model.ts';
import { Button } from '../ui/button.tsx';
import { Status } from '../ui/live.tsx';
import { forgetExport, useExportProgress } from './events.ts';

type ExportTarget = { sheet: string } | { dashboard: string };

const KINDS: { kind: ExportKind; button: string; noun: string }[] = [
  { kind: 'pdf', button: 'Export PDF', noun: 'PDF' },
  { kind: 'png', button: 'Export PNG', noun: 'PNG' },
  { kind: 'csv', button: 'Export crosstab', noun: 'crosstab' },
];

const COPY: Record<ExportStatus, string> = {
  queued: 'Queued',
  rendering: 'Rendering',
  ready: 'Ready',
  failed: 'Failed. Try again.',
};

const OUTAGE = 'Storage is unavailable. Try again.';

interface Props {
  target: ExportTarget;
  filters: Filter[];
  parameters: Record<string, ParameterValue>;
}

/**
 * The export buttons and their state for one sheet or dashboard. The job's progress arrives on the server events;
 * the download link appears only with Ready.
 */
export function ExportControls({ target, filters, parameters }: Props) {
  const [job, setJob] = useState<ExportJob | null>(null);
  const [banner, setBanner] = useState('');
  const live = useExportProgress(job?.id ?? null);
  const status = live?.status ?? job?.status ?? null;
  const progress = live?.progress ?? job?.progress ?? 0;
  const [download, setDownload] = useState<string | null>(null);

  useEffect(() => {
    if (!job || status !== 'ready') {
      setDownload(null);
      return;
    }
    let current = true;
    void api.get<ExportJob>(`/api/exports/${job.id}`).then((ready) => {
      if (current) setDownload(ready.download);
    });
    return () => {
      current = false;
    };
  }, [job?.id, status]);

  const guard = async (work: () => Promise<void>) => {
    try {
      setBanner('');
      await work();
    } catch (caught) {
      setBanner(caught instanceof ApiError && caught.status === 503 ? OUTAGE : (generalErrorCopy(caught) ?? OUTAGE));
    }
  };

  const start = (kind: ExportKind) =>
    guard(async () => setJob(await api.post<ExportJob>('/api/exports', { kind, ...target, filters, parameters })));

  const retry = (failed: ExportJob) =>
    guard(async () => {
      forgetExport(failed.id);
      setJob(await api.post<ExportJob>(`/api/exports/${failed.id}/retry`));
    });

  const noun = KINDS.find((entry) => entry.kind === job?.kind)?.noun ?? '';
  return (
    <div className="export-controls">
      <div className="export-buttons">
        {KINDS.map(({ kind, button }) => (
          <Button key={kind} onClick={() => void start(kind)}>
            {button}
          </Button>
        ))}
      </div>
      <Status name="Export state" text={status ? COPY[status] : ''} />
      {job ? (
        <div
          role="progressbar"
          aria-label="Export progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          className="export-progress"
        >
          <div className="export-progress-fill" style={{ width: `${progress}%` }} />
        </div>
      ) : null}
      {status === 'ready' && download ? (
        <a
          className="btn btn-primary"
          href={download}
          onClick={(event) => {
            event.preventDefault();
            void guard(() => api.download(download, 'export'));
          }}
        >
          Download {noun}
        </a>
      ) : null}
      {job && status === 'failed' ? <Button onClick={() => void retry(job)}>Try again</Button> : null}
      <Status name="Download notice" text={banner} banner />
    </div>
  );
}
