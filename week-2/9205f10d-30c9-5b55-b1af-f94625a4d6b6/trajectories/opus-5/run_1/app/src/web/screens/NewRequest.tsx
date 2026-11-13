import { useEffect, useState, type ReactNode } from 'react';
import { api, RequestFailed, UNREACHABLE_COPY } from '../api.js';
import { useNavigation } from '../router.jsx';
import { CREDENTIAL_OPTIONS, agencyIsoDate, clock } from '../format.js';
import type { RequestView, Setting } from '../../shared/types.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(0?[1-9]|1[0-2]):[0-5]\d (?:AM|PM)$/i;

const DATE_ERROR = 'Enter the date as YYYY-MM-DD.';
const TIME_ERROR = 'Enter the time like 9:00 AM.';

/** Joins the two entry boxes into the agency wall-clock `starts_at` the API takes. */
function toStartsAt(date: string, time: string): string {
  const match = /^(\d{1,2}):(\d{2}) (AM|PM)$/i.exec(time.trim());
  const hour12 = Number(match?.[1] ?? '12');
  const minute = match?.[2] ?? '00';
  const meridiem = (match?.[3] ?? 'AM').toUpperCase();
  const hour24 = meridiem === 'AM' ? (hour12 === 12 ? 0 : hour12) : hour12 === 12 ? 12 : hour12 + 12;
  return `${date}T${String(hour24).padStart(2, '0')}:${minute}`;
}

export function NewRequest({ draftId }: { draftId: string | null }): ReactNode {
  const { navigate } = useNavigation();
  const [savedId, setSavedId] = useState<string | null>(draftId);
  const [setting, setSetting] = useState<Setting>('medical');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [duration, setDuration] = useState(120);
  const [credential, setCredential] = useState('');
  const [consumerName, setConsumerName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (draftId === null) return;
    void api
      .request(draftId)
      .then((draft: RequestView) => {
        setSetting(draft.setting);
        setDate(agencyIsoDate(draft.starts_at));
        setStartTime(clock(draft.starts_at));
        setDuration(draft.duration_minutes);
        setCredential(draft.required_credential);
        setConsumerName(draft.consumer_name ?? '');
        setAddress(draft.location_address ?? '');
        setCity(draft.city);
        setNotes(draft.notes ?? '');
      })
      .catch(() => setMessage(UNREACHABLE_COPY));
  }, [draftId]);

  const entryErrors = (): Record<string, string> => {
    const found: Record<string, string> = {};
    if (!DATE_PATTERN.test(date.trim())) found['starts_at_date'] = DATE_ERROR;
    if (!TIME_PATTERN.test(startTime.trim())) found['starts_at_time'] = TIME_ERROR;
    return found;
  };

  const fields = (): Record<string, unknown> => ({
    setting,
    starts_at: toStartsAt(date.trim(), startTime.trim().toUpperCase()),
    duration_minutes: duration,
    consumer_name: consumerName,
    location_address: address,
    city,
    notes,
    ...(credential === '' ? {} : { required_credential: credential }),
  });

  const save = async (then: 'stay' | 'submit'): Promise<void> => {
    const entry = entryErrors();
    if (Object.keys(entry).length > 0) {
      setErrors(entry);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const saved =
        savedId === null
          ? await api.createRequest(fields())
          : await api.updateRequest(savedId, fields());
      setSavedId(saved.id);
      if (then === 'submit') {
        await api.submitRequest(saved.id);
        navigate(`/requests/${saved.id}`, {
          flash: 'Request submitted. Seats are open for interpreters.',
        });
        return;
      }
      setMessage('Draft saved.');
      navigate(`/requests/${saved.id}`, { flash: 'Draft saved.' });
    } catch (failure) {
      if (failure instanceof RequestFailed) {
        if (failure.code === 'validation') {
          setErrors(mapServerFields(failure.fields));
          setMessage('');
        } else setMessage(failure.code === 'unreachable' ? UNREACHABLE_COPY : failure.message);
      }
    } finally {
      setPending(false);
    }
  };

  const fieldError = (key: string): ReactNode =>
    errors[key] === undefined ? null : (
      <p className="field-error" id={`${key}-error`}>
        {errors[key]}
      </p>
    );

  return (
    <main className="page">
      <h1>{draftId === null ? 'New request' : 'Edit draft'}</h1>
      <form
        className="form-6"
        aria-label="New request"
        onSubmit={(event) => {
          event.preventDefault();
          void save('stay');
        }}
      >
        <div className="field">
          <label htmlFor="setting">Setting</label>
          <select
            id="setting"
            value={setting}
            onChange={(event) => setSetting(event.target.value as Setting)}
          >
            <option value="medical">Medical</option>
            <option value="education">Education</option>
            <option value="legal">Legal</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="date">
            Date <span className="hint">YYYY-MM-DD</span>
          </label>
          <input
            id="date"
            type="text"
            value={date}
            aria-invalid={errors['starts_at_date'] !== undefined}
            aria-describedby={errors['starts_at_date'] !== undefined ? 'starts_at_date-error' : undefined}
            onChange={(event) => setDate(event.target.value)}
          />
          {fieldError('starts_at_date')}
        </div>
        <div className="field">
          <label htmlFor="start-time">
            Start time <span className="hint">h:mm AM/PM</span>
          </label>
          <input
            id="start-time"
            type="text"
            value={startTime}
            aria-invalid={errors['starts_at_time'] !== undefined}
            aria-describedby={errors['starts_at_time'] !== undefined ? 'starts_at_time-error' : undefined}
            onChange={(event) => setStartTime(event.target.value)}
          />
          {fieldError('starts_at_time')}
        </div>
        <div className="field">
          <label htmlFor="duration">Duration (minutes)</label>
          <input
            id="duration"
            type="number"
            min={30}
            max={480}
            value={duration}
            aria-invalid={errors['duration_minutes'] !== undefined}
            aria-describedby={
              errors['duration_minutes'] !== undefined ? 'duration_minutes-error' : undefined
            }
            onChange={(event) => setDuration(Number(event.target.value))}
          />
          {fieldError('duration_minutes')}
        </div>
        <div className="field">
          <label htmlFor="required-credential">Required credential</label>
          <select
            id="required-credential"
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
          >
            <option value="">Default for the setting</option>
            {CREDENTIAL_OPTIONS.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="consumer-name">Deaf consumer name</label>
          <input
            id="consumer-name"
            type="text"
            value={consumerName}
            aria-invalid={errors['consumer_name'] !== undefined}
            aria-describedby={errors['consumer_name'] !== undefined ? 'consumer_name-error' : undefined}
            onChange={(event) => setConsumerName(event.target.value)}
          />
          {fieldError('consumer_name')}
        </div>
        <div className="field">
          <label htmlFor="street-address">Street address</label>
          <input
            id="street-address"
            type="text"
            value={address}
            aria-invalid={errors['location_address'] !== undefined}
            aria-describedby={
              errors['location_address'] !== undefined ? 'location_address-error' : undefined
            }
            onChange={(event) => setAddress(event.target.value)}
          />
          {fieldError('location_address')}
        </div>
        <div className="field">
          <label htmlFor="city">City</label>
          <input
            id="city"
            type="text"
            value={city}
            aria-invalid={errors['city'] !== undefined}
            aria-describedby={errors['city'] !== undefined ? 'city-error' : undefined}
            onChange={(event) => setCity(event.target.value)}
          />
          {fieldError('city')}
        </div>
        <div className="field">
          <label htmlFor="notes">Notes for interpreters</label>
          <textarea
            id="notes"
            rows={3}
            value={notes}
            aria-invalid={errors['notes'] !== undefined}
            aria-describedby={errors['notes'] !== undefined ? 'notes-error' : undefined}
            onChange={(event) => setNotes(event.target.value)}
          />
          {fieldError('notes')}
        </div>
        <div className="button-row">
          <button type="submit" disabled={pending}>
            Save draft
          </button>
          <button type="button" className="quiet" disabled={pending} onClick={() => void save('submit')}>
            Submit request
          </button>
        </div>
        <p className="live" role="status" aria-label="Request status">
          {message}
        </p>
      </form>
    </main>
  );
}

/** The server reports one `starts_at` error; the form shows it under the Date box. */
function mapServerFields(fields: Record<string, string>): Record<string, string> {
  const mapped: Record<string, string> = { ...fields };
  if (fields['starts_at'] !== undefined) mapped['starts_at_date'] = fields['starts_at'];
  return mapped;
}
