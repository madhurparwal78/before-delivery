import { useState } from 'react';
import type { ReferenceLineType } from '../../../../shared/model.ts';
import { Button } from '../../../ui/button.tsx';
import { Dialog } from '../../../ui/dialog.tsx';
import { Select, TextField } from '../../../ui/fields.tsx';
import type { ReferenceLineDialogProps } from './types.ts';

const LINE_TYPES: { value: ReferenceLineType; label: string }[] = [
  { value: 'average', label: 'Average' },
  { value: 'median', label: 'Median' },
  { value: 'constant', label: 'Constant' },
];

const NO_PARAMETER = '';

export function ReferenceLineDialog({ numberParameters, onSave, onClose }: ReferenceLineDialogProps) {
  const [type, setType] = useState<ReferenceLineType>('average');
  const [value, setValue] = useState('');
  const [parameter, setParameter] = useState(NO_PARAMETER);
  const constant = type === 'constant';
  const number = Number(value);
  const complete = !constant || parameter !== NO_PARAMETER || (value.trim() !== '' && Number.isFinite(number));

  const save = () => {
    onSave({
      type,
      value: constant && parameter === NO_PARAMETER ? number : null,
      parameter: constant && parameter !== NO_PARAMETER ? parameter : null,
    });
    onClose();
  };

  return (
    <Dialog name="Reference line" onClose={onClose}>
      <form
        className="form-grid"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <Select
          label="Line type"
          value={type}
          onChange={(next) => setType(LINE_TYPES.find((entry) => entry.value === next)?.value ?? 'average')}
          options={LINE_TYPES}
        />
        <TextField label="Value" type="number" value={value} onChange={setValue} />
        <Select
          label="Parameter"
          value={parameter}
          onChange={setParameter}
          options={[{ value: NO_PARAMETER, label: 'None' }, ...numberParameters.map((entry) => ({ value: entry.name, label: entry.name }))]}
        />
        <div className="dialog-actions">
          <Button variant="primary" type="submit" disabled={!complete}>
            Save line
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
