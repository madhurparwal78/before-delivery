import { useCallback, useEffect, useState } from 'react';
import { ApiFailure, type Person } from '../api.js';
import { call } from '../guard.js';
import { refuse, say } from '../live.js';
import { Dialog, FieldRow } from './Dialog.js';

export function TravelDialog(props: {
  personId: string;
  personName: string;
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const [starts, setStarts] = useState('');
  const [ends, setEnds] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      await call(`/api/people/${props.personId}/travel`, {
        method: 'POST',
        body: { starts_at: starts, ends_at: ends },
      });
      say('Travel window saved.');
      props.onSaved();
    } catch (error) {
      if (error instanceof ApiFailure) {
        setFields(error.fields);
        refuse(error.message);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog title="Travel window" onClose={props.onClose}>
      <form onSubmit={save} noValidate>
        <FieldRow label="Starts" id="travel-starts" message={fields.starts_at}>
          <input
            id="travel-starts"
            type="datetime-local"
            value={starts}
            onChange={(event) => setStarts(event.target.value.slice(0, 16))}
          />
        </FieldRow>
        <FieldRow label="Ends" id="travel-ends" message={fields.ends_at}>
          <input
            id="travel-ends"
            type="datetime-local"
            value={ends}
            onChange={(event) => setEnds(event.target.value.slice(0, 16))}
          />
        </FieldRow>
        <div className="dialog-actions">
          <button type="submit" className="solid">
            {pending ? 'Saving' : 'Save travel window'}
          </button>
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function MyTravel(props: { me: Person }): React.ReactElement {
  const [windows, setWindows] = useState(props.me.travel);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    void call<{ person: Person }>('/api/me')
      .then((answer) => setWindows(answer.person.travel))
      .catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  return (
    <main>
      <h1>My travel windows</h1>
      <p>
        <button type="button" onClick={() => setOpen(true)}>
          Add travel window
        </button>
      </p>
      <div className="folder">
        <span className="folder-tab" aria-hidden="true">
          Travel
        </span>
        <div className="folder-band folder-band--surface">
          {windows.length === 0 ? (
            <p>Nothing filed here yet.</p>
          ) : (
            <ul className="slips">
              {windows.map((window) => (
                <li className="slip" key={window.id}>
                  <span className="figures">
                    {window.starts_at.replace('T', ' ')} to {window.ends_at.replace('T', ' ')} (America/Chicago)
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {open ? (
        <TravelDialog
          personId={props.me.id}
          personName={props.me.full_name}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            load();
          }}
        />
      ) : null}
    </main>
  );
}
