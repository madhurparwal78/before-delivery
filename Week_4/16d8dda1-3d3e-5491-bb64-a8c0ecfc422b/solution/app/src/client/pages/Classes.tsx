import { useEffect, useState, type FormEvent } from 'react';
import type { ClassListItem } from '../../shared/wire';
import { api, apiNoContent } from '../api';
import { setMe } from '../me';
import { Link, navigate } from '../router';
import { Dialog } from '../ui/Dialog';
import { Alert, Empty, PageStatus, Skeleton } from '../ui/feedback';
import { Field } from './Field';
import { useAction } from './useAction';
import { useLoad } from './useLoad';

const ZONES: string[] = [...new Set(['UTC', ...Intl.supportedValuesOf('timeZone')])];

function defaultZone(): string {
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return ZONES.includes(local) ? local : 'UTC';
}

function NewClassDialog({ onClose, onSaving }: { onClose: () => void; onSaving: (saving: boolean) => void }) {
  const [title, setTitle] = useState('');
  const [timeZone, setTimeZone] = useState(defaultZone);
  const { pending, error, run } = useAction();
  useEffect(() => onSaving(pending), [pending, onSaving]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const created = await run(() => api<{ id: string }>('POST', '/api/classes', { title, timeZone }));
    if (created) navigate(`/classes/${created.value.id}`);
  };

  return (
    <Dialog title="New class" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <Field label="Title" value={title} onChange={setTitle} autoComplete="off" />
        <div className="field">
          <label htmlFor="new-class-zone">Time zone</label>
          <select id="new-class-zone" value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>
            {ZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </div>
        {error ? <Alert>{error}</Alert> : null}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={pending} aria-busy={pending}>
            Create class
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function ClassesPage() {
  const { result } = useLoad<{ classes: ClassListItem[] }>('/api/classes');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const signOut = useAction();

  if (result.state === 'refused' || result.state === 'missing') {
    return (
      <main className="page">
        <Alert>{result.state === 'refused' ? result.message : 'You need to sign in first.'}</Alert>
      </main>
    );
  }

  const leave = async () => {
    const done = await signOut.run(() => apiNoContent('POST', '/api/sign-out'));
    if (!done) return;
    setMe(null);
    navigate('/sign-in');
  };

  return (
    <main className="page">
      <div className="page-head">
        <h1>Your classes</h1>
        <div className="row">
          <button type="button" className="primary" onClick={() => setCreating(true)}>
            New class
          </button>
          <button type="button" onClick={() => void leave()} disabled={signOut.pending}>
            Sign out
          </button>
        </div>
      </div>
      {result.state === 'loading' ? (
        <Skeleton rows={3} label="Loading your classes" />
      ) : result.data.classes.length === 0 ? (
        <Empty drawing="tray">You have no classes yet. Make one and arrange its room.</Empty>
      ) : (
        <ul className="ruled class-list" aria-label="Classes">
          {result.data.classes.map((item) => (
            <li key={item.id}>
              <Link className="class-title" href={`/classes/${item.id}`}>
                {item.title}
              </Link>
              <span className="class-meta">
                <span className="mono">Code {item.code}</span>
                <span>{item.timeZone}</span>
                <span className="badge">{item.role === 'owner' ? 'Owner' : 'Co-teacher'}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {signOut.error ? <Alert>{signOut.error}</Alert> : null}
      <PageStatus text={saving ? 'Saving...' : ''} />
      {creating ? <NewClassDialog onClose={() => setCreating(false)} onSaving={setSaving} /> : null}
    </main>
  );
}
