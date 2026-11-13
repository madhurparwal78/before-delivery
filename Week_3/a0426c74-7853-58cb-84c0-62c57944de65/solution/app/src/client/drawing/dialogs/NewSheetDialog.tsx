import { useState } from 'react';
import type { FormEvent } from 'react';
import { PAPER_SIZE_NAMES } from '../../../shared/types.ts';
import type { PaperSize } from '../../../shared/types.ts';
import { sendJson } from '../../api.ts';
import { toastRefusal } from '../../toastRefusal.ts';
import { Button, Dialog } from '../../ui/index.ts';
import '../../styles/drawing/forms.css';

/** `dialog "New sheet"`: a name and A3 or A4 paper. The new layout arrives as a live `version` message. */
export function NewSheetDialog({ drawingId, onClose }: { drawingId: string; onClose: () => void }) {
  const [name, setName] = useState('');
  const [size, setSize] = useState<PaperSize>('A3');

  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await toastRefusal(async () => {
      await sendJson('POST', `/api/drawings/${drawingId}/sheets`, { name, size });
      onClose();
    });
  }

  return (
    <Dialog name="New sheet" onClose={onClose}>
      <form className="form" onSubmit={(event) => void create(event)} noValidate>
        <div className="form-row">
          <label className="label" htmlFor="sheet-name">Sheet name</label>
          <input id="sheet-name" className="field" type="text" autoComplete="off" data-autofocus value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div role="radiogroup" aria-label="Paper size">
          {PAPER_SIZE_NAMES.map((option) => (
            <label key={option} className="choice">
              <input type="radio" name="paper-size" checked={size === option} onChange={() => setSize(option)} />
              {option}
            </label>
          ))}
        </div>
        <div className="actions">
          <Button primary type="submit">Create sheet</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
