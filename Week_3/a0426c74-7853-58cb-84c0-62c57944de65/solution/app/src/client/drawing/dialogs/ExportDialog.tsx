import { useState } from 'react';
import { EXPORT_DONE, canRetryExport, isDownloadable, isExportBusy } from '../../../shared/rules.ts';
import { EXPORT_FORMATS } from '../../../shared/types.ts';
import type { ExportFormat, ExportJob } from '../../../shared/types.ts';
import { Button, Dialog } from '../../ui/index.ts';
import '../../styles/drawing/forms.css';

const FORMAT_LABEL: Readonly<Record<ExportFormat, string>> = { 'plot.txt': 'Plotfold text', svg: 'SVG' };

interface ExportDialogProps {
  /** the newest export job of this page (its progress arrives over the live channel) */
  job: ExportJob | null;
  onStart: (format: ExportFormat) => void;
  onRetry: () => void;
  onClose: () => void;
}

/** `dialog "Export"`: stays open to show the job's progress and result. */
export function ExportDialog({ job, onStart, onRetry, onClose }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('plot.txt');
  const running = job !== null && isExportBusy(job.state);
  return (
    <Dialog name="Export" onClose={onClose}>
      <div className="form">
        <div role="radiogroup" aria-label="Format">
          {EXPORT_FORMATS.map((option) => (
            <label key={option} className="choice">
              <input type="radio" name="export-format" checked={format === option} onChange={() => setFormat(option)} />
              {FORMAT_LABEL[option]}
            </label>
          ))}
        </div>
        {job ? (
          <div className="progress">
            <div className="progress__bar" role="progressbar" aria-label="Export" aria-valuemin={0} aria-valuemax={EXPORT_DONE} aria-valuenow={job.progress}>
              <span className="progress__fill" style={{ width: `${job.progress}%` }} />
            </div>
            <span>{job.progress}%</span>
          </div>
        ) : null}
        <div className="actions">
          {job && canRetryExport(job.state) ? <Button onClick={onRetry}>Retry export</Button> : null}
          {job && isDownloadable(job.state) && job.download_url ? <a className="btn" href={job.download_url} download>Download export</a> : null}
          <Button primary disabled={running} onClick={() => onStart(format)}>Start export</Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </Dialog>
  );
}
