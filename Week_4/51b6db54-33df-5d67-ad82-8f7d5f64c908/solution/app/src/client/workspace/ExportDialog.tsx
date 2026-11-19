import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { api, refusal } from '../api';
import { followJob, jobEnded, jobText } from '../jobs';
import { clearAlerts, Dialog, raise } from '../ui';
import type { Model } from './model';
import { useModel } from './use-model';

type Format = 'png' | 'gif' | 'sheet';

export function ExportDialog({ m }: { m: Model }): JSX.Element | null {
  useModel(m);
  return m.exportOpen ? <ExportForm m={m} /> : null;
}

function ExportForm({ m }: { m: Model }): JSX.Element {
  const [format, setFormat] = useState<Format>('png');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const close = (): void => {
    m.exportOpen = false;
    m.changed();
  };
  const running = m.job !== null && !jobEnded(m.job.state);

  const start = async (event: Event): Promise<void> => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    clearAlerts();
    const body: Record<string, unknown> = { format, scale: Number(data.get('scale')), label: String(data.get('label') ?? '') };
    if (format === 'png') body.frame = Number(data.get('frame'));
    if (format === 'sheet') {
      body.padding = Number(data.get('padding'));
      body.extrude = Number(data.get('extrude'));
    }
    const result = await api<{ job: number }>('POST', `/api/sprites/${m.spriteId}/exports`, body);
    if (!result.ok) {
      const { message, fields } = refusal(result);
      setErrors(fields);
      return raise(message);
    }
    setErrors({});
    const id = result.body.job;
    m.job = { id, state: { state: 'queued', done: 0, total: 0, files: [] } };
    m.changed();
    followJob(id, (state) => {
      m.job = { id, state };
      m.changed();
    });
  };

  const cancel = async (): Promise<void> => {
    if (!m.job) return;
    const result = await api('POST', `/api/jobs/${m.job.id}/cancel`);
    if (!result.ok) raise(refusal(result).message);
  };

  const field = (name: string): JSX.Element | null => (errors[name] ? <p class="field-error">{errors[name]}</p> : null);
  return (
    <Dialog label="Export" onClose={close}>
      <form class="stack" onSubmit={(event) => void start(event)} noValidate>
        <h2>Export</h2>
        <label class="field-label">
          Format
          <select class="input" name="format" value={format} onChange={(event) => setFormat((event.currentTarget as HTMLSelectElement).value as Format)} data-autofocus>
            <option value="png">PNG</option>
            <option value="gif">GIF</option>
            <option value="sheet">Sheet</option>
          </select>
        </label>
        {field('format')}
        <label class="field-label">
          Scale
          <input class="input" name="scale" type="number" defaultValue="1" min="1" max="16" />
        </label>
        {field('scale')}
        {format === 'png' && (
          <label class="field-label">
            Export frame
            <input class="input" name="frame" type="number" defaultValue={m.frameNumber} min="1" />
          </label>
        )}
        {field('frame')}
        {format === 'sheet' && (
          <>
            <label class="field-label">
              Padding
              <input class="input" name="padding" type="number" defaultValue="0" min="0" max="64" />
            </label>
            {field('padding')}
            <label class="field-label">
              Extrude
              <input class="input" name="extrude" type="number" defaultValue="0" min="0" max="16" />
            </label>
            {field('extrude')}
          </>
        )}
        <label class="field-label">
          Export label
          <input class="input" name="label" type="text" />
        </label>
        <div class="row">
          <button type="submit" class="pill" disabled={running}>
            Start export
          </button>
          <button type="button" class="pill ghost" onClick={close}>
            Close
          </button>
        </div>
        {m.job && (
          <div class="job">
            <div role="status" aria-label="Job progress">
              {jobText(m.job.state, m.locale)}
            </div>
            {running && (
              <button type="button" class="pill small" onClick={() => void cancel()}>
                Cancel job
              </button>
            )}
          </div>
        )}
      </form>
    </Dialog>
  );
}
