import { useState } from 'react';
import { ApiError, api } from '../../api';
import { useConfig } from '../../clock';
import { instantToZonedText, zonedTextToInstant } from '../../format';
import { Alert, Button, Dialog, Field } from '../../ui';
import { SOMETHING_WENT_WRONG, WORKPLACES, WORKPLACE_LABELS, fieldMessages, type Workplace } from './jobModel';

interface PostJobDialogProps {
  companyId: string;
  open: boolean;
  onClose: () => void;
  onPublished: () => void;
}

/** Company admins publish a job with a closing instant typed as `YYYY-MM-DD HH:MM` in the configured time zone. */
export function PostJobDialog({ companyId, open, onClose, onPublished }: PostJobDialogProps) {
  const { time_zone: zone, now } = useConfig();
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [workplace, setWorkplace] = useState<Workplace>('on-site');
  const [closes, setCloses] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState('');
  const [pending, setPending] = useState(false);

  const publish = async (): Promise<void> => {
    if (pending) return;
    const closesAt = zonedTextToInstant(closes, zone);
    if (!closesAt) {
      setErrors({ closes_at: 'Use YYYY-MM-DD HH:MM.' });
      return;
    }
    setPending(true);
    setErrors({});
    setAlert('');
    try {
      await api.post('/api/jobs', { company_id: companyId, title, location, workplace, closes_at: closesAt, description });
      setTitle('');
      setLocation('');
      setCloses('');
      setDescription('');
      onPublished();
    } catch (error) {
      if (error instanceof ApiError && error.body.error === 'validation') setErrors(fieldMessages(error));
      else setAlert(SOMETHING_WENT_WRONG);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog name="Post a job" open={open} onClose={onClose}>
      <div className="stack">
        <h2 className="t-larger">Post a job</h2>
        <Field label="Job title" name="job-title" value={title} error={errors.title} onChange={(event) => setTitle(event.target.value)} />
        <Field label="Location" name="job-location" value={location} error={errors.location} onChange={(event) => setLocation(event.target.value)} />
        <div className="field">
          <label htmlFor="job-workplace" className="field-label">
            Workplace
          </label>
          <select id="job-workplace" className="input" value={workplace} onChange={(event) => setWorkplace(event.target.value as Workplace)}>
            {WORKPLACES.map((value) => (
              <option key={value} value={value}>
                {WORKPLACE_LABELS[value]}
              </option>
            ))}
          </select>
          {errors.workplace ? <p className="field-message">{errors.workplace}</p> : null}
        </div>
        <Field
          label="Closes"
          name="job-closes"
          hint={`For example ${instantToZonedText(now, zone)}`}
          value={closes}
          error={errors.closes_at}
          onChange={(event) => setCloses(event.target.value)}
        />
        <Field label="Description" name="job-description" multiline rows={5} value={description} error={errors.description} onChange={(event) => setDescription(event.target.value)} />
        <Alert>{alert}</Alert>
        <div className="dialog-actions">
          <Button onClick={() => void publish()} disabled={pending}>
            Publish job
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Dialog>
  );
}
