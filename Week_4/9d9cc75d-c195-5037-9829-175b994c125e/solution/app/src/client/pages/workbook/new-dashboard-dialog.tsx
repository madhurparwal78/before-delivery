import { useState } from 'react';
import { api, generalErrorCopy } from '../../api/client.ts';
import { act } from '../../api/use-load.ts';
import type { DashboardBody } from '../../../shared/model.ts';
import { Button } from '../../ui/button.tsx';
import { Dialog } from '../../ui/dialog.tsx';
import { Checkbox, Select, TextField } from '../../ui/fields.tsx';
import { Status } from '../../ui/live.tsx';

type Arrangement = 'horizontal' | 'vertical';

const ARRANGEMENTS: { value: Arrangement; label: string }[] = [
  { value: 'horizontal', label: 'Horizontal' },
  { value: 'vertical', label: 'Vertical' },
];

/** The height a sheet gets in the phone column of a new dashboard. */
const PHONE_HEIGHT = 320;

interface Props {
  workbook: string;
  version: number;
  sheets: readonly { id: string; name: string }[];
  onCreated: () => Promise<void>;
  onClose: () => void;
}

/** `dialog "New dashboard"`: a name, the sheets it holds and how they are arranged. */
export function NewDashboardDialog({ workbook, version, sheets, onCreated, onClose }: Props) {
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [arrangement, setArrangement] = useState<Arrangement>('horizontal');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState('');

  const create = () =>
    act(
      async () => {
        const ids = sheets.filter((sheet) => chosen.includes(sheet.id)).map((sheet) => sheet.id);
        const body: DashboardBody = {
          name,
          layout: { type: arrangement, children: ids.map((sheet) => ({ sheet, fixed: null })) },
          floating: [],
          phone_order: ids,
          phone_heights: Object.fromEntries(ids.map((id) => [id, PHONE_HEIGHT])),
          actions: [],
        };
        await api.post(`/api/workbooks/${workbook}/dashboards`, body, { 'If-Match': String(version) });
        await onCreated();
      },
      (caught) => {
        setErrors(caught.fields);
        setState(generalErrorCopy(caught) ?? caught.fieldMessage() ?? 'Something went wrong. Try again.');
      },
    );

  const sheetsError = errors.sheets ?? errors.layout;
  return (
    <Dialog name="New dashboard" onClose={onClose}>
      <TextField label="Dashboard name" value={name} onChange={setName} error={errors.name} />
      <fieldset className="dialog-sheets">
        <legend className="field-label">Sheets</legend>
        {sheets.map((sheet) => (
          <Checkbox
            key={sheet.id}
            label={sheet.name}
            checked={chosen.includes(sheet.id)}
            onChange={(checked) => setChosen(checked ? [...chosen, sheet.id] : chosen.filter((id) => id !== sheet.id))}
          />
        ))}
        {sheetsError ? <p className="field-error">{sheetsError}</p> : null}
      </fieldset>
      <Select
        label="Arrangement"
        value={arrangement}
        onChange={(value) => setArrangement(ARRANGEMENTS.find((entry) => entry.value === value)?.value ?? 'horizontal')}
        options={ARRANGEMENTS}
      />
      <Status name="New dashboard state" text={state} />
      <div className="dialog-actions">
        <Button variant="primary" onClick={() => void create()}>
          Create dashboard
        </Button>
      </div>
    </Dialog>
  );
}
