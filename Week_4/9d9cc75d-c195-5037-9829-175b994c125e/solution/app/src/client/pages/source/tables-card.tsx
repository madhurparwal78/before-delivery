import { useState } from 'react';
import { api, generalErrorCopy } from '../../api/client.ts';
import { act, commit } from '../../api/use-load.ts';
import { formatCount } from '../../../shared/display.ts';
import type { Source, SourceTable } from '../../../shared/model.ts';
import { Button } from '../../ui/button.tsx';
import { Dialog } from '../../ui/dialog.tsx';
import { Select, TextField } from '../../ui/fields.tsx';
import { Status } from '../../ui/live.tsx';
import { CsvUpload } from '../upload/csv-upload.tsx';
import type { CardProps } from './card-props.ts';

const OUTAGE = 'Storage is unavailable. Try again.';

function AddTableDialog({ source, project, reload, onClose }: { source: Source; project: string; reload: () => Promise<void>; onClose: () => void }) {
  const [tableName, setTableName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const query = new URLSearchParams({ table: tableName.trim() });
  return (
    <Dialog name="Add table" onClose={onClose}>
      <TextField label="Table name" value={tableName} onChange={setTableName} error={errors.table} />
      <CsvUpload
        previewPath={`/api/projects/${project}/sources/preview`}
        tableName={tableName}
        send={(bytes) => api.csv<Source>('POST', `/api/sources/${source.id}/tables?${query.toString()}`, bytes)}
        onUploaded={reload}
        onNameErrors={setErrors}
      />
    </Dialog>
  );
}

/** Keys are columns as uploaded, so a renamed or hidden field still names its column. */
function keyChoices(table: SourceTable | undefined) {
  return (table?.columns ?? []).map((column) => ({ value: column.name, label: column.name }));
}

function RelateDialog({ source, reload, say, warn, onClose }: Omit<CardProps, 'creator' | 'project'> & { onClose: () => void }) {
  const [left, right] = source.tables;
  const leftChoices = keyChoices(left);
  const rightChoices = keyChoices(right);
  const [leftKey, setLeftKey] = useState(source.relation?.left_key ?? leftChoices[0]?.value ?? '');
  const [rightKey, setRightKey] = useState(source.relation?.right_key ?? rightChoices[0]?.value ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = () =>
    act(
      async () => {
        if (!left || !right) return;
        await api.put(`/api/sources/${source.id}/relation`, {
          left_table: left.name,
          left_key: leftKey,
          right_table: right.name,
          right_key: rightKey,
        });
        await reload();
        commit(() => say(`Related ${left.name} to ${right.name}.`));
        onClose();
      },
      (caught) => {
        setErrors(caught.fields);
        warn(generalErrorCopy(caught) ?? caught.fieldMessage('right_key') ?? 'Something went wrong. Try again.');
      },
    );

  return (
    <Dialog name="Relate tables" onClose={onClose}>
      <Select label="Left key" value={leftKey} onChange={setLeftKey} options={leftChoices} error={errors.left_key} />
      <Select label="Right key" value={rightKey} onChange={setRightKey} options={rightChoices} error={errors.right_key} />
      <div className="dialog-actions">
        <Button variant="primary" disabled={!left || !right} onClick={() => void save()}>
          Save relation
        </Button>
      </div>
    </Dialog>
  );
}

/** The tables with their row counts and downloads, the relation and `status "Join notice"`. */
export function TablesCard(props: CardProps) {
  const { source, project, creator, reload, say, warn } = props;
  const [adding, setAdding] = useState(false);
  const [relating, setRelating] = useState(false);

  const download = (table: string) =>
    act(
      () => api.download(`/api/sources/${source.id}/tables/${encodeURIComponent(table)}/file`, `${table}.csv`),
      (caught) => warn(caught.status === 503 ? OUTAGE : (generalErrorCopy(caught) ?? 'Something went wrong. Try again.')),
    );

  const { relation } = source;
  return (
    <section className="card card-tables" aria-labelledby="tables-heading">
      <h2 id="tables-heading">Tables</h2>
      <ul className="link-list">
        {source.tables.map((table) => (
          <li key={table.name}>
            <span className="table-name">{table.name}</span>
            <span className="muted">{formatCount(table.rows)} rows</span>
            {creator ? (
              <a
                className="download-link"
                href={`/api/sources/${source.id}/tables/${encodeURIComponent(table.name)}/file`}
                onClick={(event) => {
                  event.preventDefault();
                  void download(table.name);
                }}
              >
                Download {table.name}
              </a>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="muted">
        {relation
          ? `${relation.left_table} (${relation.left_key}) is joined to ${relation.right_table} (${relation.right_key}).`
          : 'No relation yet.'}
      </p>
      <Status name="Join notice" text={source.notices.join(' ')} ok />
      {creator ? (
        <div className="form-actions">
          <Button onClick={() => setAdding(true)}>Add table</Button>
          <Button onClick={() => setRelating(true)}>Relate tables</Button>
        </div>
      ) : null}
      {adding ? <AddTableDialog source={source} project={project} reload={reload} onClose={() => setAdding(false)} /> : null}
      {relating ? <RelateDialog source={source} reload={reload} say={say} warn={warn} onClose={() => setRelating(false)} /> : null}
    </section>
  );
}
