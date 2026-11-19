import { useState } from 'react';
import { api, generalErrorCopy } from '../../api/client.ts';
import { act } from '../../api/use-load.ts';
import type { ActionType, Dashboard, DashboardAction, DashboardBody, ParameterDef, SetDef } from '../../../shared/model.ts';
import { Button } from '../../ui/button.tsx';
import { Dialog } from '../../ui/dialog.tsx';
import { Checkbox, Select, TextField } from '../../ui/fields.tsx';
import { Status } from '../../ui/live.tsx';
import type { ObjectRef } from './objects-list.tsx';
import { ACTION_WORDS } from './selection.ts';

const TYPES: readonly ActionType[] = ['filter', 'highlight', 'set_parameter', 'change_set'];

interface Props {
  dashboard: Dashboard;
  sheets: readonly ObjectRef[];
  parameters: readonly ParameterDef[];
  sets: readonly SetDef[];
  /** the dimensions the marks of a sheet carry, which the Field choice offers */
  dimensions: (sheet: string) => string[];
  /** the workbook version the page loaded, sent as `If-Match` */
  version: number;
  onSaved: (dashboard: Dashboard, action: DashboardAction) => void;
  onClose: () => void;
}

/** `dialog "Action"`: adds one action to the dashboard. */
export function ActionDialog({ dashboard, sheets, parameters, sets, dimensions, version, onSaved, onClose }: Props) {
  const [name, setName] = useState('');
  const [type, setType] = useState<ActionType>('filter');
  const [source, setSource] = useState(sheets[0]?.sheet ?? '');
  const [targets, setTargets] = useState<string[]>([]);
  const [field, setField] = useState('');
  const [parameter, setParameter] = useState('');
  const [set, setSetName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState('');

  const fields = dimensions(source);
  const chosenField = fields.includes(field) ? field : (fields[0] ?? '');
  const chosenParameter = parameter || (parameters[0]?.name ?? '');
  const chosenSet = set || (sets[0]?.name ?? '');

  const save = () =>
    act(
      async () => {
        const action: DashboardAction = {
          name,
          type,
          source,
          targets,
          field: chosenField,
          parameter: type === 'set_parameter' ? chosenParameter : null,
          set: type === 'change_set' ? chosenSet : null,
        };
        const update: DashboardBody = {
          name: dashboard.name,
          layout: dashboard.layout,
          floating: dashboard.floating,
          phone_order: dashboard.phone_order,
          phone_heights: dashboard.phone_heights,
          actions: [...dashboard.actions, action],
        };
        const saved = await api.put<Dashboard>(`/api/dashboards/${dashboard.id}`, update, { 'If-Match': String(version) });
        onSaved(saved, action);
      },
      (caught) => {
        setErrors(caught.fields);
        setState(generalErrorCopy(caught) ?? caught.fieldMessage('actions') ?? 'Something went wrong. Try again.');
      },
    );

  return (
    <Dialog name="Action" onClose={onClose}>
      <TextField label="Action name" value={name} onChange={setName} error={errors.name} />
      <Select
        label="Action type"
        value={type}
        onChange={(value) => setType(TYPES.find((entry) => entry === value) ?? 'filter')}
        options={TYPES.map((entry) => ({ value: entry, label: ACTION_WORDS[entry] }))}
      />
      <Select
        label="Source sheet"
        value={source}
        onChange={setSource}
        options={sheets.map((sheet) => ({ value: sheet.sheet, label: sheet.name }))}
      />
      <fieldset className="action-targets">
        <legend className="field-label">Targets</legend>
        {sheets.map((sheet) => (
          <Checkbox
            key={sheet.sheet}
            label={sheet.name}
            checked={targets.includes(sheet.sheet)}
            onChange={(checked) => setTargets(checked ? [...targets, sheet.sheet] : targets.filter((id) => id !== sheet.sheet))}
          />
        ))}
      </fieldset>
      <Select label="Field" value={chosenField} onChange={setField} options={fields.map((entry) => ({ value: entry, label: entry }))} />
      <Select
        label="Parameter"
        value={chosenParameter}
        onChange={setParameter}
        disabled={type !== 'set_parameter'}
        options={parameters.map((entry) => ({ value: entry.name, label: entry.name }))}
      />
      <Select
        label="Set"
        value={chosenSet}
        onChange={setSetName}
        disabled={type !== 'change_set'}
        options={sets.map((entry) => ({ value: entry.name, label: entry.name }))}
      />
      <Status name="Action state" text={state} />
      <div className="dialog-actions">
        <Button variant="primary" onClick={() => void save()}>
          Save action
        </Button>
      </div>
    </Dialog>
  );
}
