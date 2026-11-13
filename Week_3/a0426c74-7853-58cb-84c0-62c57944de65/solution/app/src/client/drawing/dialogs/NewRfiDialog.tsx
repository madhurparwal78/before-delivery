import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Rfi } from '../../../shared/types.ts';
import { sendJson } from '../../api.ts';
import { toastRefusal } from '../../toastRefusal.ts';
import { Button, Dialog } from '../../ui/index.ts';
import '../../styles/drawing/forms.css';

interface NewRfiDialogProps {
  issueId: string;
  /** the usernames with a role on the folder other than the asker, in name order */
  addressees: readonly string[];
  onCreated: (rfi: Rfi) => void;
  onClose: () => void;
}

/** `dialog "New RFI"`: a question and the person who holds the ball once it is sent. */
export function NewRfiDialog({ issueId, addressees, onCreated, onClose }: NewRfiDialogProps) {
  const [question, setQuestion] = useState('');
  const [addressee, setAddressee] = useState(addressees[0] ?? '');

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await toastRefusal(async () => {
      onCreated(await sendJson<Rfi>('POST', `/api/issues/${issueId}/rfis`, { question, addressee }));
      onClose();
    });
  }

  return (
    <Dialog name="New RFI" onClose={onClose}>
      <form className="form" onSubmit={(event) => void save(event)} noValidate>
        <div className="form-row">
          <label className="label" htmlFor="rfi-question">Question</label>
          <input id="rfi-question" className="field" type="text" autoComplete="off" data-autofocus value={question} onChange={(event) => setQuestion(event.target.value)} />
        </div>
        <div className="form-row">
          <label className="label" htmlFor="rfi-addressee">Addressee</label>
          <select id="rfi-addressee" className="field" value={addressee} onChange={(event) => setAddressee(event.target.value)}>
            {addressees.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <div className="actions">
          <Button primary type="submit">Save RFI</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
