import { useRef, useState } from 'react';
import { COPY, fill } from '../../shared/copy';
import { announce } from '../announce';
import { api } from '../api';
import { useLive } from '../live';
import { AsyncButton, BottomBar, Heading, LoadingBars, NotFound, Problems, useForm } from '../ui/kit';
import { JobNav } from './frame';
import { readJob } from './jobshared';

interface ScriptRow {
  row: number;
  shot: string;
  result: 'new' | 'matched' | 'refused';
  reason: string | null;
}

export function Script({ jobId }: { jobId: string }) {
  const live = useLive(() => readJob(jobId));
  const [rows, setRows] = useState<ScriptRow[] | null>(null);
  const file = useRef<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const form = useForm(null, () => ({}));

  const choose = (chosen: File) => {
    file.current = chosen;
    void form.submit(async () => {
      setRows(null);
      const answer = await api<{ rows: ScriptRow[] }>(`/api/jobs/${jobId}/script/preview`, { method: 'POST', file: chosen });
      setRows(answer.rows);
      const count = (result: ScriptRow['result']) => answer.rows.filter((row) => row.result === result).length;
      announce(fill(COPY.previewReady, { new: count('new'), matched: count('matched'), refused: count('refused') }));
    });
  };

  const save = () =>
    form.submit(async () => {
      if (!file.current) {
        form.refuse(COPY.scriptHeader);
        return;
      }
      const answer = await api<{ created: number; updated: number }>(`/api/jobs/${jobId}/script`, { method: 'POST', file: file.current });
      announce(fill(COPY.scriptSaved, { new: answer.created, changed: answer.updated }));
    });

  if (live.failedStatus === 404) return <NotFound />;
  if (!live.data) return <LoadingBars />;
  return (
    <section className="screen">
      <Heading title={`Script for ${live.data.title}`} refreshFailed={live.refreshFailed} />
      <JobNav jobId={jobId} />
      <Problems form={form} />
      <div className="field">
        <label htmlFor="script-file">Script file</label>
        <input
          ref={input}
          id="script-file"
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen) choose(chosen);
            event.target.value = '';
          }}
        />
      </div>
      {rows ? (
        <section role="region" aria-label="Script preview" className="table-frame" tabIndex={0}>
          <table>
            <thead><tr><th>Row</th><th>Shot</th><th>Result</th><th>Reason</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.row}>
                  <td className="tabular">{row.row}</td>
                  <td>{row.shot}</td>
                  <td>{row.result === 'new' ? 'New' : row.result === 'matched' ? 'Matched' : 'Refused'}</td>
                  <td>{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      <BottomBar><AsyncButton label="Save" onPress={save} /></BottomBar>
    </section>
  );
}
