import { useEffect, useState } from 'react';
import { ApiError, api } from '../../api';
import { Alert, Button, Dialog, Field } from '../../ui';
import { SOMETHING_WENT_WRONG, fieldMessages } from './jobModel';

interface EditCompanyDialogProps {
  handle: string;
  initial: { name: string; location: string; about: string };
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/** Company admins edit the page's name, location and about text. */
export function EditCompanyDialog({ handle, initial, open, onClose, onSaved }: EditCompanyDialogProps) {
  const [name, setName] = useState(initial.name);
  const [location, setLocation] = useState(initial.location);
  const [about, setAbout] = useState(initial.about);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initial.name);
      setLocation(initial.location);
      setAbout(initial.about);
      setErrors({});
      setAlert('');
    }
  }, [open]);

  const save = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    setErrors({});
    setAlert('');
    try {
      await api.patch(`/api/companies/${handle}`, { name, location, about });
      onSaved();
    } catch (error) {
      if (error instanceof ApiError && error.body.error === 'validation') setErrors(fieldMessages(error));
      else setAlert(SOMETHING_WENT_WRONG);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog name="Edit page" open={open} onClose={onClose}>
      <div className="stack">
        <h2 className="t-larger">Edit page</h2>
        <Field label="Name" name="company-name" value={name} error={errors.name} onChange={(event) => setName(event.target.value)} />
        <Field label="Location" name="company-location" value={location} error={errors.location} onChange={(event) => setLocation(event.target.value)} />
        <Field label="About" name="company-about" multiline rows={5} value={about} error={errors.about} onChange={(event) => setAbout(event.target.value)} />
        <Alert>{alert}</Alert>
        <div className="dialog-actions">
          <Button onClick={() => void save()} disabled={pending}>
            Save
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Dialog>
  );
}
