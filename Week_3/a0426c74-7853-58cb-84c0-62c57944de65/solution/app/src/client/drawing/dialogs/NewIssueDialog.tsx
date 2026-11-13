import { useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import type { Issue, Point } from '../../../shared/types.ts';
import { sendJson } from '../../api.ts';
import { toastRefusal } from '../../toastRefusal.ts';
import { Button, Dialog } from '../../ui/index.ts';
import '../../styles/drawing/forms.css';

interface NewIssueDialogProps {
  versionId: string;
  /** where the issue is pinned, in world units */
  at: Point;
  /** where focus returns: the drawing pane, which opened the dialog by a tap or from the long-press menu */
  opener: RefObject<HTMLElement | null>;
  onCreated: (issue: Issue) => void;
  onClose: () => void;
}

/** `dialog "New issue"`: a title for the pin placed at a world point of a version. */
export function NewIssueDialog({ versionId, at, opener, onCreated, onClose }: NewIssueDialogProps) {
  const [title, setTitle] = useState('');

  async function pin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await toastRefusal(async () => {
      onCreated(await sendJson<Issue>('POST', `/api/versions/${versionId}/issues`, { title, x: at[0], y: at[1] }));
      onClose();
    });
  }

  return (
    <Dialog name="New issue" onClose={onClose} opener={opener}>
      <form className="form" onSubmit={(event) => void pin(event)} noValidate>
        <div className="form-row">
          <label className="label" htmlFor="issue-title">Issue title</label>
          <input id="issue-title" className="field" type="text" autoComplete="off" data-autofocus value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div className="actions">
          <Button primary type="submit">Pin issue</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
