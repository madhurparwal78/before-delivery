import { useId, useState } from 'react';
import { api, generalErrorCopy } from '../../../api/client.ts';
import { act, commit, useLoad } from '../../../api/use-load.ts';
import { formatCell, measureCaption } from '../../../../shared/display.ts';
import type { Cell, SetDef } from '../../../../shared/model.ts';
import { Button } from '../../../ui/button.tsx';
import { Dialog } from '../../../ui/dialog.tsx';
import { Checkbox, options, Select, TextField } from '../../../ui/fields.tsx';
import { numberOrText } from './number-text.ts';
import type { SetDialogProps } from './types.ts';

type Mode = 'members' | 'top';

const NO_PARAMETER = '';

function RadioRow({ group, label, checked, onSelect, disabled }: { group: string; label: string; checked: boolean; onSelect: () => void; disabled?: boolean }) {
  return (
    <label className="check">
      <input type="radio" name={group} checked={checked} disabled={disabled} onChange={onSelect} />
      <span>{label}</span>
    </label>
  );
}

export function SetDialog({ workbookId, existing, dimensions, measures, numberParameters, loadMembers, onSaved, onClose }: SetDialogProps) {
  const group = useId();
  const [name, setName] = useState(existing?.name ?? '');
  const [field, setField] = useState(existing?.field ?? dimensions[0] ?? '');
  const [mode, setMode] = useState<Mode>(existing?.top ? 'top' : 'members');
  const [picked, setPicked] = useState<Cell[]>(existing?.members ?? []);
  const topN = existing?.top?.n;
  const [count, setCount] = useState(typeof topN === 'number' ? String(topN) : '');
  const [parameter, setParameter] = useState(typeof topN === 'string' ? topN.slice(1) : NO_PARAMETER);
  const [by, setBy] = useState(() => String(Math.max(0, measures.findIndex((pill) => existing?.top && measureCaption(pill) === measureCaption(existing.top.by)))));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const members = useLoad(() => (field ? loadMembers(field) : Promise.resolve([])), [field]);
  const memberList = members.data ?? [];

  const toggle = (member: Cell, on: boolean) =>
    setPicked((current) => (on ? [...current, member] : current.filter((entry) => entry !== member)));

  const save = () =>
    act(
      async () => {
        const pill = measures[Number(by)];
        let shape: Pick<SetDef, 'members' | 'top'>;
        if (mode === 'members') shape = { members: memberList.filter((member) => picked.includes(member)) };
        else if (pill) shape = { top: { n: parameter === NO_PARAMETER ? numberOrText(count) : `@${parameter}`, by: pill } };
        else return;
        const body = { name, field, ...shape };
        let id: string;
        if (existing) {
          await api.put(`/api/sets/${existing.id}`, body);
          id = existing.id;
        } else {
          id = (await api.post<{ id: string }>(`/api/workbooks/${workbookId}/sets`, body)).id;
        }
        commit(() => {
          onSaved({ id, ...body });
          onClose();
        });
      },
      (caught) => setErrors(caught.fields),
    );

  const other = Object.entries(errors).find(([key]) => key !== 'name')?.[1] ?? null;
  const loadFailure = members.error ? generalErrorCopy(members.error) : null;

  return (
    <Dialog name="Set" onClose={onClose}>
      <form
        className="form-grid"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <TextField label="Set name" value={name} onChange={setName} error={errors.name} />
        <Select
          label="Field"
          value={field}
          onChange={(next) => {
            setField(next);
            setPicked([]);
          }}
          options={options(dimensions)}
        />
        <fieldset className="radio-group">
          <legend className="field-label">Choose by</legend>
          <RadioRow group={group} label="Chosen members" checked={mode === 'members'} onSelect={() => setMode('members')} />
          <RadioRow group={group} label="Top N" checked={mode === 'top'} onSelect={() => setMode('top')} disabled={measures.length === 0} />
        </fieldset>
        {mode === 'members' ? (
          <div className="check-list" role="group" aria-label="Members">
            {memberList.map((member) => (
              <Checkbox key={`${typeof member}:${member}`} label={formatCell(member)} checked={picked.includes(member)} onChange={(on) => toggle(member, on)} />
            ))}
          </div>
        ) : (
          <>
            <TextField label="Top N" type="number" value={count} onChange={setCount} disabled={parameter !== NO_PARAMETER} />
            <Select
              label="Use parameter"
              value={parameter}
              onChange={setParameter}
              options={[{ value: NO_PARAMETER, label: 'None' }, ...numberParameters.map((entry) => ({ value: entry.name, label: entry.name }))]}
            />
            <Select
              label="By"
              value={by}
              onChange={setBy}
              options={measures.map((pill, index) => ({ value: String(index), label: measureCaption(pill) }))}
            />
          </>
        )}
        {other || loadFailure ? <p className="field-error">{other ?? loadFailure}</p> : null}
        <div className="dialog-actions">
          <Button variant="primary" type="submit">
            Save set
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
