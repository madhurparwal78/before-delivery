// Title block A3: the workspace's revision table. A new revision applies to exports issued on or after its effective date.
import { useEffect, useRef, useState } from 'react';
import type { RevisionView } from '../../../shared/types.ts';
import { ApiError, get, post } from '../../api.ts';
import { TextField } from '../../ui/Field.tsx';
import { writeRefusal } from '../panels/refusals.ts';
import { useEditor } from '../store.ts';
import '../../styles/panels.css';

const REVISIONS = '/api/templates/title-block-a3/revisions';

/** The body of `dialog "Title block A3"`; ExportDialog hosts it so one dialog owns the focus trap. */
export function TitleBlockForm({ onBack }: { onBack: () => void }) {
  const editor = useEditor();
  const [revisions, setRevisions] = useState<RevisionView[]>([]);
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    root.current?.querySelector('input')?.focus();
    let live = true;
    void get<{ revisions: RevisionView[] }>(REVISIONS).then((answer) => { if (live) setRevisions(answer.revisions); });
    return () => { live = false; };
  }, []);

  const add = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      const { revision } = await post<{ revision: RevisionView }>(REVISIONS, { footer_note: note, effective_date: date });
      setRevisions((current) => [...current, revision]);
      setNote('');
      setDate('');
      editor.announce(`Revision ${revision.letter} added, effective ${revision.effective_date}.`);
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      if (failure.status === 422) setErrors(failure.fields);
      else setFormError(writeRefusal(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={root}>
      <h2>Title block A3</h2>
      <ul className="revision-list" aria-label="Revisions">
        {revisions.map((revision) => (
          <li key={revision.letter} className="panel-item">
            <p className="panel-item-text">{`Revision ${revision.letter} · ${revision.effective_date} · ${revision.footer_note}`}</p>
          </li>
        ))}
      </ul>
      <form noValidate onSubmit={(event) => { event.preventDefault(); void add(); }}>
        <TextField label="Footer note" value={note} onChange={setNote} error={errors.footer_note} />
        <TextField label="Effective date" value={date} onChange={setDate} error={errors.effective_date} />
        {formError ? <p role="alert" className="panel-alert">{formError}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="btn btn-outline" onClick={onBack}>Close</button>
          <button type="submit" className="btn btn-primary" aria-disabled={busy}>Add revision</button>
        </div>
      </form>
    </div>
  );
}
