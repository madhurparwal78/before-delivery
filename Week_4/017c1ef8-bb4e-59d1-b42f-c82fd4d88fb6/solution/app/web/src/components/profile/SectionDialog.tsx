import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '../../api';
import { announce } from '../../announce';
import { Alert, Button, Dialog, FieldErrorSummary, type FieldProblem } from '../../ui';

type Current = Record<string, unknown>;

interface Conflict {
  version: number;
  current: Current;
}

interface Props<Form> {
  /** The dialog's accessible name, such as `Edit about`. */
  name: string;
  section: 'intro' | 'about' | 'experience' | 'education';
  open: boolean;
  onClose: () => void;
  /** The section version the member read when the dialog opened. */
  version: number;
  initial: Form;
  /** The form for the values a version conflict carries. */
  fromCurrent: (current: Current) => Form;
  /** The section fields sent with the version. */
  toBody: (form: Form) => Current;
  /** A readable label for a field path such as `experience.0.title`, for the error summary. */
  labelOf: (path: string) => string;
  /** Read the profile again after a save. */
  onSaved: () => Promise<void>;
  children: (form: Form, setForm: (next: Form) => void, errors: Record<string, string>) => ReactNode;
}

/**
 * An owner edit dialog for one profile section. A stale save shows the conflict alert with Load latest (the form takes the
 * current values) and Save mine anyway (the same form saved on top of the current version).
 */
export function SectionDialog<Form>({ name, section, open, onClose, version, initial, fromCurrent, toBody, labelOf, onSaved, children }: Props<Form>) {
  const [form, setForm] = useState<Form>(initial);
  const [readVersion, setReadVersion] = useState(version);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(initial);
    setReadVersion(version);
    setConflict(null);
    setErrors({});
    setProblem('');
    // The form starts from the profile as it is when the dialog opens; later refreshes must not overwrite typing.
  }, [open]);

  const save = async (sendVersion: number): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setProblem('');
    setErrors({});
    try {
      await api.patch(`/api/me/sections/${section}`, { version: sendVersion, ...toBody(form) });
      announce('Profile announcements', 'Section saved.');
      onClose();
      await onSaved();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.body.error === 'version_conflict') {
        setConflict({ version: Number(error.body.current_version), current: error.body.current as Current });
      } else if (error instanceof ApiError && error.body.error === 'validation') {
        setErrors((error.body.fields ?? {}) as Record<string, string>);
      } else {
        setProblem('Something went wrong. Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const problems: FieldProblem[] = Object.entries(errors).map(([path, message]) => ({ name: path.replace(/\./g, '-'), label: labelOf(path), message }));

  return (
    <Dialog name={name} open={open} onClose={onClose}>
      <h2 className="pf-dialog-title">{name}</h2>
      <form
        className="stack-s"
        onSubmit={(event) => {
          event.preventDefault();
          void save(readVersion);
        }}
      >
        <FieldErrorSummary problems={problems} />
        {children(form, setForm, errors)}
        <Alert>{conflict ? 'Someone changed this section since you opened it.' : problem}</Alert>
        {conflict ? (
          <div className="pf-conflict">
            <Button
              className="pf-quiet"
              onClick={() => {
                setForm(fromCurrent(conflict.current));
                setReadVersion(conflict.version);
                setConflict(null);
              }}
            >
              Load latest
            </Button>
            <Button className="pf-quiet" disabled={busy} onClick={() => void save(conflict.version)}>
              Save mine anyway
            </Button>
          </div>
        ) : null}
        <div className="dialog-actions">
          <Button type="submit" disabled={busy}>
            Save
          </Button>
          <Button className="pf-quiet" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
