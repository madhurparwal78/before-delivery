import { useState } from 'react';
import { Dialog } from './Dialog.js';
import { ErrorSummary, FieldError, fieldProps, noFormErrors, type FormErrors } from './ErrorSummary.js';

const formName = 'clip-details';

export interface ClipDetails {
  title: string;
  frameRate: number;
  durationMs: number;
}

interface ClipDetailsDialogProps {
  file: File;
  durationMs: number | null;
  onCancel: () => void;
  onConfirm: (details: ClipDetails) => void;
}

export function ClipDetailsDialog({ file, durationMs, onCancel, onConfirm }: ClipDetailsDialogProps): JSX.Element {
  const [title, setTitle] = useState(file.name.replace(/\.[^.]+$/, ''));
  const [frameRate, setFrameRate] = useState('25');
  const [errors, setErrors] = useState<FormErrors>(noFormErrors);

  return (
    <Dialog name="Clip details" onClose={onCancel}>
      <h2>Clip details</h2>
      <ErrorSummary formName={formName} errors={errors} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim() === '' || Array.from(title).length > 80) {
            setErrors({ fields: { title: 'Enter a title of 1 to 80 characters.' }, token: Date.now() });
            return;
          }
          onConfirm({
            title,
            frameRate: Number(frameRate),
            durationMs: Math.max(1, Math.min(3_600_000, Math.round(durationMs ?? 1000))),
          });
        }}
      >
        <div className="field">
          <label htmlFor={`${formName}-title`}>Title</label>
          <input
            type="text"
            data-autofocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            {...fieldProps(formName, 'title', errors)}
          />
          <FieldError formName={formName} field="title" errors={errors} />
        </div>
        <fieldset role="radiogroup" aria-label="Frame rate">
          <legend>Frame rate</legend>
          {['24', '25', '30'].map((rate) => (
            <div className="radiorow" key={rate}>
              <input
                type="radio"
                id={`${formName}-rate-${rate}`}
                name="frameRate"
                value={rate}
                checked={frameRate === rate}
                onChange={() => setFrameRate(rate)}
              />
              <label htmlFor={`${formName}-rate-${rate}`}>{rate}</label>
            </div>
          ))}
        </fieldset>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Upload clip
          </button>
        </div>
      </form>
    </Dialog>
  );
}
