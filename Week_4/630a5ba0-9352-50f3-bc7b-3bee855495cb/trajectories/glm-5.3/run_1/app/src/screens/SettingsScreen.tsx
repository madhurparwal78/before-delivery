import { useCallback, useEffect, useRef, useState } from 'react';
import { api, isFailure, type ApiRoutine } from '../api/client';
import { useSession, useAnnouncer } from '../api/session';
import { SubscriptionBanner, navigate } from '../shell';
import { Dialog, PendingButton, GENERIC_ERROR, fieldErrors } from '../components';
import { KNOWN_TIME_ZONES } from '../../src-shared/domain';

export function SettingsScreen(): JSX.Element {
  const { me, reload } = useSession();
  const { announce } = useAnnouncer();
  const [timeZone, setTimeZone] = useState('');
  const [threshold, setThreshold] = useState(360);
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [feedUrl, setFeedUrl] = useState('');
  const [rotating, setRotating] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [routines, setRoutines] = useState<ApiRoutine[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [routineSaving, setRoutineSaving] = useState(false);
  const [routineFields, setRoutineFields] = useState<Record<string, string>>({});
  const rotateButtonRef = useRef<HTMLButtonElement | null>(null);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (me === null) return;
    setTimeZone(me.member.timeZone);
    setThreshold(me.member.thresholdMinutes);
  }, [me]);

  const loadFeedAndRoutines = useCallback(async () => {
    try {
      const feed = await api.get<{ url: string }>('/api/feed');
      setFeedUrl(feed.url);
      const res = await api.get<{ routines: ApiRoutine[] }>('/api/routines');
      setRoutines(res.routines);
    } catch {
      /* keep showing what we have */
    }
  }, []);

  useEffect(() => {
    void loadFeedAndRoutines();
  }, [loadFeedAndRoutines]);

  if (me === null) {
    return <main className="settings-page"><p>Loading…</p></main>;
  }

  const saveSettings = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSaving(true);
    setFields({});
    try {
      const res = await api.patch<{ today: string }>('/api/me', { timeZone, thresholdMinutes: threshold });
      await reload();
      const label = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone }).format(new Date(`${res.today}T12:00:00Z`));
      announce(`Settings saved. Today is ${label} in ${timeZone}.`);
    } catch (err) {
      const errors = fieldErrors(err);
      setFields(errors ?? {});
      announce(errors === undefined ? GENERIC_ERROR : 'Check the highlighted fields.');
    } finally {
      setSaving(false);
    }
  };

  const copyUrl = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(feedUrl);
      announce('Feed URL copied.');
    } catch {
      announce("Couldn't copy. Select the URL and copy it yourself.");
    }
  };

  const rotate = async (): Promise<void> => {
    setConfirmRotate(false);
    setRotating(true);
    try {
      const res = await api.post<{ url: string }>('/api/feed/rotate');
      setFeedUrl(res.url);
      announce('Feed URL rotated. The old URL has stopped working.');
    } catch {
      announce(GENERIC_ERROR);
    } finally {
      setRotating(false);
    }
  };

  const deleteRoutine = async (routine: ApiRoutine): Promise<void> => {
    try {
      await api.delete(`/api/routines/${routine.id}`);
      announce(`Deleted routine ${routine.name}.`);
      await loadFeedAndRoutines();
    } catch {
      announce(GENERIC_ERROR);
    }
  };

  return (
    <main className="settings-page">
      <SubscriptionBanner />
      <form aria-label="Day settings" onSubmit={(e) => { void saveSettings(e); }}>
        <section className="settings-section">
          <h2>Day settings</h2>
          <div className="field-row">
            <div>
              <label htmlFor="zone">Time zone</label>
              <select id="zone" className="mono" value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
                {KNOWN_TIME_ZONES.map((z) => (
                  <option key={z} value={z}>{z}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="threshold">Workload threshold (minutes)</label>
              <input
                id="threshold"
                type="number"
                className="mono"
                min={60}
                max={960}
                step={15}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                aria-describedby={fields.thresholdMinutes !== undefined ? 'threshold-error' : undefined}
              />
              {fields.thresholdMinutes !== undefined ? <p className="field-error" id="threshold-error">{fields.thresholdMinutes}</p> : null}
            </div>
          </div>
          <p><PendingButton type="submit" pending={saving} pendingLabel="Saving…" className="primary">Save settings</PendingButton></p>
        </section>
      </form>

      <section className="settings-section" aria-label="Calendar feed">
        <h2>Calendar feed</h2>
        <div className="feed-row">
          <label htmlFor="feed-url" className="visually-hidden">Feed URL</label>
          <input id="feed-url" readOnly value={feedUrl} />
          <button type="button" onClick={() => { void copyUrl(); }}>Copy feed URL</button>
          <button type="button" ref={rotateButtonRef} onClick={() => setConfirmRotate(true)} aria-busy={rotating}>Rotate feed URL</button>
        </div>
      </section>

      <section className="settings-section" aria-label="Routines">
        <h2>Routines</h2>
        <ul className="card-list">
          {routines.map((r) => (
            <li key={r.id} className="routine-line">
              <span>
                <span className="name">{r.name} · </span>
                <span className="when">{r.startTime} · {r.durationMinutes}m · {r.repeats === 'daily' ? 'Every day' : 'Weekdays'}</span>
              </span>
              <button type="button" onClick={() => { void deleteRoutine(r); }} aria-label={`Delete routine ${r.name}`}>Delete</button>
            </li>
          ))}
        </ul>
        <p><button type="button" ref={addButtonRef} onClick={() => setAddOpen(true)}>Add routine</button></p>
      </section>

      {confirmRotate ? (
        <Dialog label="Rotate feed URL?" onClose={() => setConfirmRotate(false)} returnFocusRef={rotateButtonRef}>
          <h2>Rotate feed URL?</h2>
          <p>Calendar apps using the old URL will stop updating.</p>
          <div className="dialog-actions">
            <PendingButton type="button" pending={rotating} pendingLabel="Rotating…" onClick={() => { void rotate(); }} className="primary">Rotate</PendingButton>
            <button type="button" onClick={() => setConfirmRotate(false)}>Keep current URL</button>
          </div>
        </Dialog>
      ) : null}

      {addOpen ? (
        <AddRoutineDialog
          onClose={() => setAddOpen(false)}
          returnRef={addButtonRef}
          announce={announce}
          onSaved={loadFeedAndRoutines}
          saving={routineSaving}
          setSaving={setRoutineSaving}
          setFields={setRoutineFields}
          fields={routineFields}
        />
      ) : null}
    </main>
  );
}

function AddRoutineDialog({
  onClose,
  returnRef,
  announce,
  onSaved,
  saving,
  setSaving,
  setFields,
  fields,
}: {
  onClose: () => void;
  returnRef: React.RefObject<HTMLButtonElement | null>;
  announce: (s: string) => void;
  onSaved: () => Promise<void>;
  saving: boolean;
  setSaving: (v: boolean) => void;
  setFields: (f: Record<string, string>) => void;
  fields: Record<string, string>;
}): JSX.Element {
  const [name, setName] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [minutes, setMinutes] = useState(30);
  const [repeats, setRepeats] = useState<'daily' | 'weekdays'>('daily');

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSaving(true);
    setFields({});
    try {
      await api.post('/api/routines', { name, startTime, durationMinutes: minutes, repeats });
      announce(`Added routine ${name} at ${startTime}.`);
      await onSaved();
      onClose();
    } catch (err) {
      const errors = fieldErrors(err);
      setFields(errors ?? {});
      announce(errors === undefined ? GENERIC_ERROR : 'Check the highlighted fields.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog label="Add routine" onClose={onClose} returnFocusRef={returnRef}>
      <form onSubmit={(e) => { void save(e); }}>
        <h2>Add routine</h2>
        <div>
          <label htmlFor="routine-name">Name</label>
          <input id="routine-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          {fields.name !== undefined ? <p className="field-error">{fields.name}</p> : null}
        </div>
        <div>
          <label htmlFor="routine-start">Start time</label>
          <input id="routine-start" type="time" className="mono" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="routine-minutes">Minutes</label>
          <input
            id="routine-minutes"
            type="number"
            className="mono"
            min={5}
            max={240}
            step={5}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
          />
          {fields.durationMinutes !== undefined ? <p className="field-error">{fields.durationMinutes}</p> : null}
        </div>
        <fieldset className="estimate-options" role="radiogroup" aria-label="Repeats" style={{ paddingLeft: 0 }}>
          <label>
            <input type="radio" name="repeats" value="daily" checked={repeats === 'daily'} onChange={() => setRepeats('daily')} />
            Every day
          </label>
          <label>
            <input type="radio" name="repeats" value="weekdays" checked={repeats === 'weekdays'} onChange={() => setRepeats('weekdays')} />
            Weekdays
          </label>
        </fieldset>
        <div className="dialog-actions">
          <PendingButton type="submit" pending={saving} pendingLabel="Saving…" className="primary">Save routine</PendingButton>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}

export { navigate };
