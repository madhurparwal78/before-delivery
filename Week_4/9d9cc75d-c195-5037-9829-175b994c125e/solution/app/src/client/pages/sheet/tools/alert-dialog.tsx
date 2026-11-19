import { useState } from 'react';
import { api, generalErrorCopy } from '../../../api/client.ts';
import { act, commit } from '../../../api/use-load.ts';
import { measureCaption } from '../../../../shared/display.ts';
import { Button } from '../../../ui/button.tsx';
import { Dialog } from '../../../ui/dialog.tsx';
import { Select, TextField } from '../../../ui/fields.tsx';
import { numberOrText } from './number-text.ts';
import type { AlertDialogProps } from './types.ts';

export function AlertDialog({ sheetId, measures, onSaved, onClose }: AlertDialogProps) {
  const [name, setName] = useState('');
  const [measure, setMeasure] = useState('0');
  const [above, setAbove] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);

  const save = () =>
    act(
      async () => {
        await api.post(`/api/sheets/${sheetId}/alerts`, { name, measure: measures[Number(measure)], above: numberOrText(above) });
        commit(() => {
          onSaved(name);
          onClose();
        });
      },
      (caught) => {
        setErrors(caught.fields);
        setFailure(generalErrorCopy(caught));
      },
    );

  return (
    <Dialog name="Alert" onClose={onClose}>
      <form
        className="form-grid"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <TextField label="Alert name" value={name} onChange={setName} error={errors.name} />
        <Select
          label="Measure"
          value={measure}
          onChange={setMeasure}
          options={measures.map((pill, index) => ({ value: String(index), label: measureCaption(pill) }))}
          error={errors.measure}
        />
        <TextField label="Above" type="number" value={above} onChange={setAbove} error={errors.above} />
        {failure ? <p className="field-error">{failure}</p> : null}
        <div className="dialog-actions">
          <Button variant="primary" type="submit">
            Save alert
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
