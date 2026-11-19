import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, generalErrorCopy } from '../../api/client.ts';
import { act, commit, useLoad } from '../../api/use-load.ts';
import { isNullText, parseCsv } from '../../../server/sources/csv.ts';
import type { FieldKind, Source, SourceField } from '../../../shared/model.ts';
import { Button } from '../../ui/button.tsx';
import { Dialog } from '../../ui/dialog.tsx';
import { Checkbox, TextField } from '../../ui/fields.tsx';
import { TableWrap } from '../../ui/table-wrap.tsx';
import type { CardProps } from './card-props.ts';

const FAILED = 'Something went wrong. Try again.';

interface DialogProps extends Omit<CardProps, 'creator' | 'project'> {
  field: SourceField;
  onClose: () => void;
}

function submitting(save: () => Promise<void>) {
  return (event: FormEvent) => {
    event.preventDefault();
    void save();
  };
}

function RenameDialog({ source, field, reload, say, warn, onClose }: DialogProps) {
  const [name, setName] = useState(field.name);
  const [error, setError] = useState<string | null>(null);

  const save = () =>
    act(
      async () => {
        const renamed = await api.patch<SourceField>(`/api/sources/${source.id}/fields/${field.id}`, { name });
        await reload();
        commit(() => say(`Renamed ${field.name} to ${renamed.name}.`));
        onClose();
      },
      (caught) => {
        const message = generalErrorCopy(caught) ?? caught.fieldMessage('name');
        setError(message);
        warn(message ?? FAILED);
      },
    );

  return (
    <Dialog name="Rename field" onClose={onClose}>
      <form className="form-grid" onSubmit={submitting(save)}>
        <TextField label="Name" value={name} onChange={setName} error={error} />
        <div className="dialog-actions">
          <Button type="submit" variant="primary">
            Save name
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function BinsDialog({ source, field, reload, say, warn, onClose }: DialogProps) {
  const [size, setSize] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = () =>
    act(
      async () => {
        const created = await api.post<SourceField>(`/api/sources/${source.id}/bins`, { field: field.id, size: Number(size) });
        await reload();
        commit(() => say(`Created ${created.name}.`));
        onClose();
      },
      (caught) => {
        const message = generalErrorCopy(caught) ?? caught.fieldMessage('size');
        setError(message);
        warn(message ?? FAILED);
      },
    );

  return (
    <Dialog name="Bins" onClose={onClose}>
      <form className="form-grid" onSubmit={submitting(save)}>
        <TextField label="Bin size" type="number" value={size} onChange={setSize} error={error} />
        <div className="dialog-actions">
          <Button type="submit" variant="primary">
            Save bins
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** The distinct values of a column of the stored file, in alphabetical order; the file is the one place they are listed. */
async function membersOf(source: Source, field: SourceField): Promise<string[]> {
  const table = source.tables.find((entry) => entry.name === field.table);
  if (!table) return [];
  const index = table.columns.findIndex((column) => column.id === field.id);
  const text = await api.text(`/api/sources/${source.id}/tables/${encodeURIComponent(table.name)}/file`);
  const values = new Set<string>();
  for (const record of parseCsv(text).records.slice(1)) {
    const value = record.fields[index];
    if (value !== undefined && !isNullText(value)) values.add(value);
  }
  return [...values].sort((a, b) => a.localeCompare(b));
}

function GroupDialog({ source, field, reload, say, warn, onClose }: DialogProps) {
  const members = useLoad(() => membersOf(source, field), [field.id]);
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const save = () =>
    act(
      async () => {
        const created = await api.post<SourceField>(`/api/sources/${source.id}/groups`, {
          field: field.id,
          groups: [{ name, members: chosen }],
        });
        await reload();
        commit(() => say(`Created ${created.name}.`));
        onClose();
      },
      (caught) => {
        const message = generalErrorCopy(caught) ?? caught.fieldMessage('name');
        setError(message);
        warn(message ?? FAILED);
      },
    );

  const toggle = (member: string, on: boolean) =>
    setChosen((current) => (on ? [...current, member] : current.filter((entry) => entry !== member)));

  return (
    <Dialog name="Group" onClose={onClose}>
      <form className="form-grid" onSubmit={submitting(save)}>
        <TextField label="Group name" value={name} onChange={setName} error={error} />
        <div className="check-list">
          {(members.data ?? []).map((member) => (
            <Checkbox key={member} label={member} checked={chosen.includes(member)} onChange={(on) => toggle(member, on)} />
          ))}
        </div>
        <div className="dialog-actions">
          <Button type="submit" variant="primary">
            Save group
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

type Editing = { kind: 'rename' | 'bins' | 'group'; field: SourceField } | null;

const otherKind = (kind: FieldKind): FieldKind => (kind === 'dimension' ? 'measure' : 'dimension');

/** `table "Fields"` with the buttons that shape each field. Explorers see the table without them. */
export function FieldsCard({ source, creator, reload, say, warn }: Omit<CardProps, 'project'>) {
  const [editing, setEditing] = useState<Editing>(null);
  const close = () => setEditing(null);

  const patch = (field: SourceField, body: { hidden?: boolean; kind?: FieldKind }, confirmation: string) =>
    act(
      async () => {
        await api.patch(`/api/sources/${source.id}/fields/${field.id}`, body);
        await reload();
        commit(() => say(confirmation));
      },
      (caught) => warn(generalErrorCopy(caught) ?? FAILED),
    );

  return (
    <section className="card-stack" aria-labelledby="fields-heading">
      <h2 id="fields-heading">Fields</h2>
      <TableWrap>
        <table aria-label="Fields">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Table</th>
              <th scope="col">Type</th>
              <th scope="col">Kind</th>
              {creator ? (
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {source.fields.map((field) => (
              <tr key={field.id}>
                <th scope="row" className="field-name">
                  {field.name}
                  {field.hidden ? <span className="muted"> (hidden)</span> : null}
                </th>
                <td>{field.table ?? ''}</td>
                <td>{field.type}</td>
                <td>{field.kind}</td>
                {creator ? (
                  <td>
                    <div className="field-actions">
                      <Button compact aria-label={`Rename ${field.name}`} onClick={() => setEditing({ kind: 'rename', field })}>
                        Rename
                      </Button>
                      <Button
                        compact
                        aria-label={`${field.hidden ? 'Show' : 'Hide'} ${field.name}`}
                        onClick={() =>
                          void patch(field, { hidden: !field.hidden }, `${field.name} ${field.hidden ? 'shown' : 'hidden'}.`)
                        }
                      >
                        {field.hidden ? 'Show' : 'Hide'}
                      </Button>
                      <Button
                        compact
                        aria-label={`Change kind of ${field.name}`}
                        onClick={() => void patch(field, { kind: otherKind(field.kind) }, `${field.name} is now a ${otherKind(field.kind)}.`)}
                      >
                        Change kind
                      </Button>
                      {field.type === 'number' ? (
                        <Button compact aria-label={`Create bins for ${field.name}`} onClick={() => setEditing({ kind: 'bins', field })}>
                          Bins
                        </Button>
                      ) : null}
                      {field.kind === 'dimension' && field.table ? (
                        <Button compact aria-label={`Create group for ${field.name}`} onClick={() => setEditing({ kind: 'group', field })}>
                          Group
                        </Button>
                      ) : null}
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {editing?.kind === 'rename' ? (
        <RenameDialog source={source} field={editing.field} reload={reload} say={say} warn={warn} onClose={close} />
      ) : null}
      {editing?.kind === 'bins' ? (
        <BinsDialog source={source} field={editing.field} reload={reload} say={say} warn={warn} onClose={close} />
      ) : null}
      {editing?.kind === 'group' ? (
        <GroupDialog source={source} field={editing.field} reload={reload} say={say} warn={warn} onClose={close} />
      ) : null}
    </section>
  );
}
