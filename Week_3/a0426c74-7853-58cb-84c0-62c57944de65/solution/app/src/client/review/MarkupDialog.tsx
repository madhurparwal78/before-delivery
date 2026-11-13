import { useState } from 'react';
import type { FormEvent } from 'react';
import { NOT_A_POINT } from '../../shared/copy.ts';
import { parsePoint } from '../../shared/commands/points.ts';
import type { Markup, MarkupKind } from '../../shared/types.ts';
import { ApiFailure, sendJson } from '../api.ts';
import { Button, Dialog, pushToast } from '../ui/index.ts';
import '../styles/drawing/forms.css';

interface MarkupDialogProps {
  kind: MarkupKind;
  versionId: string;
  onPlaced: (markup: Markup) => void;
  onClose: () => void;
}

/** `dialog "New markup"`: the two world corners of the markup's box and its note. */
export function MarkupDialog({ kind, versionId, onPlaced, onClose }: MarkupDialogProps) {
  const [first, setFirst] = useState('');
  const [opposite, setOpposite] = useState('');
  const [note, setNote] = useState('');

  async function place(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const from = parsePoint(first.trim(), [0, 0]);
    const to = parsePoint(opposite.trim(), [0, 0]);
    if (!from || !to) {
      pushToast(NOT_A_POINT);
      return;
    }
    try {
      onPlaced(await sendJson<Markup>('POST', `/api/versions/${versionId}/markups`, { kind, x1: from[0], y1: from[1], x2: to[0], y2: to[1], text: note }));
      onClose();
    } catch (raw) {
      if (!(raw instanceof ApiFailure)) throw raw;
      pushToast(raw.message);
    }
  }

  return (
    <Dialog name="New markup" onClose={onClose}>
      <form className="form" onSubmit={(event) => void place(event)} noValidate>
        <div className="form-row">
          <label className="label" htmlFor="markup-first">First corner</label>
          <input id="markup-first" className="field" type="text" autoComplete="off" placeholder="0,0" data-autofocus value={first} onChange={(event) => setFirst(event.target.value)} />
        </div>
        <div className="form-row">
          <label className="label" htmlFor="markup-opposite">Opposite corner</label>
          <input id="markup-opposite" className="field" type="text" autoComplete="off" placeholder="10,10" value={opposite} onChange={(event) => setOpposite(event.target.value)} />
        </div>
        <div className="form-row">
          <label className="label" htmlFor="markup-note">Note</label>
          <input id="markup-note" className="field" type="text" autoComplete="off" value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
        <div className="actions">
          <Button primary type="submit">{`Place ${kind}`}</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
