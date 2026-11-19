import { useState } from 'react';
import { api, generalErrorCopy } from '../../api/client.ts';
import { act, commit } from '../../api/use-load.ts';
import type { Extract, Schedule } from '../../../shared/model.ts';
import { setExtract, useExtract } from '../../shell/events.ts';
import { ExtractState, nextRefreshCopy } from '../../shell/extract-state.tsx';
import { Button } from '../../ui/button.tsx';
import { Select, TextField } from '../../ui/fields.tsx';
import { Status } from '../../ui/live.tsx';
import type { CardProps } from './card-props.ts';

const FAILED = 'Something went wrong. Try again.';

const KINDS = [
  { value: 'full', label: 'Full' },
  { value: 'incremental', label: 'Incremental' },
];

/** What a refresh or a schedule change leaves in the shared event store, as an `extract` event would. */
function publish(source: string, extract: Extract): void {
  const { rows: _rows, ...info } = extract;
  setExtract(source, info);
}

/** The extract state, the next refresh and, for those who may schedule, the schedule and `Refresh now`. */
export function ExtractCard({ source, canSchedule, reload, say, warn }: Omit<CardProps, 'project' | 'creator'> & { canSchedule: boolean }) {
  const extract = useExtract(source.id);
  const next = extract ? extract.next_run_at : (source.schedule?.next_run_at ?? null);
  const [every, setEvery] = useState(String(source.schedule?.every_minutes ?? 60));
  const [kind, setKind] = useState<string>(source.schedule?.kind ?? 'full');
  const [key, setKey] = useState(source.schedule?.key ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = () =>
    act(
      async () => {
        await api.put<Schedule>(`/api/sources/${source.id}/schedule`, { every_minutes: Number(every), kind, key: key || null });
        publish(source.id, await api.get<Extract>(`/api/sources/${source.id}/extract`));
        await reload();
        commit(() => {
          setErrors({});
          say('Schedule saved.');
        });
      },
      (caught) => {
        const fields = caught.fields;
        setErrors(fields.key ? { key: fields.key } : { every_minutes: caught.fieldMessage('every_minutes') ?? '' });
        warn(generalErrorCopy(caught) ?? caught.fieldMessage('every_minutes') ?? FAILED);
      },
    );

  const refresh = () =>
    act(
      async () => {
        const result = await api.post<Extract>(`/api/sources/${source.id}/refresh`);
        publish(source.id, result);
        commit(() => say(result.state === 'refresh_failed' ? 'Refresh failed.' : 'Refresh finished.'));
      },
      (caught) => warn(generalErrorCopy(caught) ?? FAILED),
    );

  return (
    <section className="card card-extract" aria-labelledby="extract-heading">
      <h2 id="extract-heading">Extract</h2>
      <ExtractState source={source.id} />
      <Status name="Next refresh" text={nextRefreshCopy(next)} ok />
      {canSchedule ? (
        <>
          <div className="form-grid">
            <TextField label="Every minutes" type="number" value={every} onChange={setEvery} error={errors.every_minutes} />
            <Select label="Refresh kind" value={kind} onChange={setKind} options={KINDS} />
            <Select
              label="Key"
              value={key}
              onChange={setKey}
              options={[{ value: '', label: 'None' }, ...source.fields.filter((field) => field.table !== null).map((field) => ({ value: field.name, label: field.name }))]}
              error={errors.key}
            />
          </div>
          <div className="form-actions">
            <Button variant="primary" onClick={() => void save()}>
              Save schedule
            </Button>
            <Button onClick={() => void refresh()}>Refresh now</Button>
          </div>
        </>
      ) : null}
    </section>
  );
}
