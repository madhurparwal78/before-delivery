import { ReactElement, useEffect, useState } from 'react';
import { ApiCallError, api } from '../api';
import { LiveRegion } from '../components/LiveRegion';
import { useRouter } from '../router';
import { SETTINGS, SETTING_LABELS, Setting, UserSummary } from '../types';

export function NewRequest(): ReactElement {
  const { navigate } = useRouter();
  const [consumers, setConsumers] = useState<UserSummary[]>([]);
  const [title, setTitle] = useState('');
  const [setting, setSetting] = useState<Setting>('medical');
  const [location, setLocation] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [consumerId, setConsumerId] = useState('');
  const [notes, setNotes] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void api.consumers().then((payload) => {
      setConsumers(payload.consumers);
      setConsumerId(payload.consumers[0]?.id ?? '');
    });
  }, []);

  const save = async (): Promise<void> => {
    setPending(true);
    setFields({});
    setMessage('Saving…');
    try {
      const { request } = await api.createRequest({
        title,
        setting,
        location,
        start,
        end,
        consumer_id: consumerId,
        notes,
      });
      setMessage(`Draft ${request.ref} saved.`);
      window.setTimeout(() => navigate(`/requests/${request.id}`), 700);
    } catch (error) {
      if (error instanceof ApiCallError && error.failure.code === 'validation') {
        setFields(error.failure.fields ?? {});
        setMessage('Check the highlighted fields.');
      } else {
        setMessage('Check the highlighted fields.');
      }
    } finally {
      setPending(false);
    }
  };

  const fieldError = (name: string): ReactElement | null =>
    fields[name] ? <p className="field-error">{fields[name]}</p> : null;

  return (
    <main className="column">
      <h1>New request</h1>
      <form
        aria-label="New request"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="field">
          <label htmlFor="title">Title</label>
          <input id="title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
          {fieldError('title')}
        </div>
        <div className="field">
          <label htmlFor="setting">Setting</label>
          <select
            id="setting"
            value={setting}
            onChange={(event) => setSetting(event.target.value as Setting)}
          >
            {SETTINGS.map((item) => (
              <option key={item} value={item}>
                {SETTING_LABELS[item]}
              </option>
            ))}
          </select>
          {fieldError('setting')}
        </div>
        <div className="field">
          <label htmlFor="location">Location</label>
          <input
            id="location"
            type="text"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          />
          {fieldError('location')}
        </div>
        <div className="field">
          <label htmlFor="start">Start</label>
          <input
            id="start"
            type="text"
            inputMode="numeric"
            placeholder="2026-10-27T14:00"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
          {fieldError('start')}
        </div>
        <div className="field">
          <label htmlFor="end">End</label>
          <input
            id="end"
            type="text"
            inputMode="numeric"
            placeholder="2026-10-27T15:00"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
          />
          {fieldError('end')}
        </div>
        <div className="field">
          <label htmlFor="consumer">Deaf consumer</label>
          <select
            id="consumer"
            value={consumerId}
            onChange={(event) => setConsumerId(event.target.value)}
          >
            {consumers.map((consumer) => (
              <option key={consumer.id} value={consumer.id}>
                {consumer.name}
              </option>
            ))}
          </select>
          {fieldError('consumer_id')}
        </div>
        <div className="field">
          <label htmlFor="notes">Notes</label>
          <textarea id="notes" rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} />
          {fieldError('notes')}
        </div>
        <button type="submit" disabled={pending}>
          Save draft
        </button>
      </form>
      <LiveRegion label="Request status" message={message} />
    </main>
  );
}
