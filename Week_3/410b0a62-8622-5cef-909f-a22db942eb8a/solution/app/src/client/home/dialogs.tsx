import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { dayLabel } from '../../shared/dates.js';
import { formatTss, parseDuration, parsePace, pluralise } from '../../shared/format.js';
import type { AthleteRow, CopyResult, Sport, Workout } from '../../shared/types.js';
import { failureMessage, fieldErrors, post, postForm } from '../api.js';
import { useAnnouncer, type Announcer } from '../hooks.js';
import { Dialog, Field, focusFirstInvalid, Panel, Pill, Status } from '../ui.js';

type Tab = 'upload' | 'manual';

interface LogProps {
  athleteId: string;
  date: string;
  /** Announces into the page's Session status region. */
  session: Announcer;
  onClose: () => void;
  onSaved: () => void;
}

const LOG_FIELDS = ['day', 'sport', 'title', 'duration', 'power', 'pace'] as const;

export function LogSessionDialog({ athleteId, date, session, onClose, onSaved }: LogProps) {
  const [tab, setTab] = useState<Tab>('upload');
  const [day, setDay] = useState(date);
  const [sport, setSport] = useState<Sport>('bike');
  const [title, setTitle] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [duration, setDuration] = useState('');
  const [power, setPower] = useState('');
  const [pace, setPace] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alertText, setAlertText] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const alert = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const tabs = useRef<Record<Tab, HTMLButtonElement | null>>({ upload: null, manual: null });

  useEffect(() => {
    if (alertText) alert.current?.focus();
  }, [alertText]);
  useEffect(() => focusFirstInvalid(body.current, LOG_FIELDS, errors), [errors]);

  const returnToDay = (): HTMLElement | null => document.querySelector<HTMLElement>(`[aria-label="Log session on ${dayLabel(date)}"]`);

  const fail = (failure: unknown): void => {
    const fields = fieldErrors(failure);
    const next: Record<string, string> = {};
    let alertMessage: string | null = null;
    if (fields) {
      const mapped: Record<string, string> = { date: 'day', sport: 'sport', title: 'title', duration_s: 'duration', avg_power_w: 'power', avg_pace_s_per_km: 'pace' };
      for (const [field, message] of Object.entries(fields)) {
        const target = mapped[field];
        if (target) next[target] = message;
        else alertMessage ??= message;
      }
    } else {
      alertMessage = failureMessage(failure);
    }
    setErrors(next);
    setAlertText(alertMessage);
    session.say('');
  };

  const done = (workout: Workout): void => {
    session.say(`Saved ${workout.title}: ${formatTss(workout.tss ?? 0)} TSS.`);
    onSaved();
    onClose();
  };

  const upload = async (): Promise<void> => {
    const file = fileInput.current?.files?.[0];
    const form = new FormData();
    if (file) form.set('file', file);
    form.set('sport', sport);
    form.set('date', day);
    if (title.trim() !== '') form.set('title', title);
    setPending(true);
    setErrors({});
    setAlertText(null);
    session.say(`Uploading ${file?.name ?? 'file'}…`);
    try {
      done((await postForm<{ workout: Workout }>(`/api/athletes/${athleteId}/uploads`, form)).workout);
    } catch (failure) {
      fail(failure);
    } finally {
      setPending(false);
    }
  };

  const manual = async (): Promise<void> => {
    const watts = /^\d+$/.test(power.trim()) ? Number(power) : null;
    setPending(true);
    setErrors({});
    setAlertText(null);
    session.say('Saving…');
    try {
      const response = await post<{ workout: Workout }>(`/api/athletes/${athleteId}/manual`, {
        date: day,
        sport,
        title,
        duration_s: parseDuration(duration),
        ...(sport === 'bike' ? { avg_power_w: watts } : { avg_pace_s_per_km: parsePace(pace) })
      });
      done(response.workout);
    } catch (failure) {
      fail(failure);
    } finally {
      setPending(false);
    }
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const order: Tab[] = ['upload', 'manual'];
    const index = order.indexOf(tab);
    const next = event.key === 'ArrowRight' ? order[(index + 1) % 2] : event.key === 'ArrowLeft' ? order[(index + 1) % 2] : event.key === 'Home' ? order[0] : event.key === 'End' ? order[1] : undefined;
    if (!next) return;
    event.preventDefault();
    setTab(next);
    tabs.current[next]?.focus();
  };

  const pendingLabel = tab === 'upload' ? `Uploading ${fileName ?? 'file'}…` : 'Saving…';
  return (
    <Dialog title="Log a session" onClose={onClose} returnFocus={returnToDay}>
      <div ref={body}>
        <div role="tablist" aria-label="How to log" className="tabs">
          {(['upload', 'manual'] as const).map((value) => (
            <button
              key={value}
              ref={(element) => {
                tabs.current[value] = element;
              }}
              type="button"
              role="tab"
              id={`log-tab-${value}`}
              aria-selected={tab === value}
              aria-controls="log-panel"
              tabIndex={tab === value ? 0 : -1}
              className="tab"
              onClick={() => setTab(value)}
              onKeyDown={onTabKey}
            >
              {value === 'upload' ? 'Upload a file' : 'Enter by hand'}
            </button>
          ))}
        </div>
        <form
          role="tabpanel"
          id="log-panel"
          aria-labelledby={`log-tab-${tab}`}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void (tab === 'upload' ? upload() : manual());
          }}
        >
          <Field label="Day" error={errors['day']}>
            {(props) => <input {...props} data-field="day" type="text" inputMode="numeric" placeholder="YYYY-MM-DD" value={day} onChange={(event) => setDay(event.target.value)} />}
          </Field>
          <div role="radiogroup" aria-label="Sport" className="choice-row" data-field="sport">
            {(['bike', 'run'] as const).map((value) => (
              <label key={value} className="choice">
                <input type="radio" name="log-sport" checked={sport === value} onChange={() => setSport(value)} />
                <span>{value === 'bike' ? 'Bike' : 'Run'}</span>
              </label>
            ))}
          </div>
          <Field label="Title" error={errors['title']}>
            {(props) => <input {...props} data-field="title" type="text" value={title} onChange={(event) => setTitle(event.target.value)} />}
          </Field>
          {tab === 'upload' ? (
            <>
              <Field label="Activity file" hint="A .csv or .json activity file with one sample per second">
                {(props) => <input {...props} ref={fileInput} type="file" accept=".csv,.json" onChange={(event) => setFileName(event.target.files?.[0]?.name ?? null)} />}
              </Field>
              {alertText && (
                <Panel panelRef={alert} tabbable>
                  {alertText}
                </Panel>
              )}
            </>
          ) : (
            <>
              <Field label="Duration" error={errors['duration']} hint="H:MM:SS">
                {(props) => <input {...props} data-field="duration" type="text" placeholder="1:00:00" value={duration} onChange={(event) => setDuration(event.target.value)} />}
              </Field>
              {sport === 'bike' ? (
                <Field label="Average power" error={errors['power']} hint="Watts">
                  {(props) => <input {...props} data-field="power" type="text" inputMode="numeric" value={power} onChange={(event) => setPower(event.target.value)} />}
                </Field>
              ) : (
                <Field label="Average pace" error={errors['pace']} hint="M:SS per km">
                  {(props) => <input {...props} data-field="pace" type="text" placeholder="5:30" value={pace} onChange={(event) => setPace(event.target.value)} />}
                </Field>
              )}
              {alertText && (
                <Panel panelRef={alert} tabbable>
                  {alertText}
                </Panel>
              )}
            </>
          )}
          <div className="dialog-actions">
            <Pill tone="navy" type="submit" pending={pending} pendingText={pendingLabel}>
              {tab === 'upload' ? 'Upload session' : 'Save session'}
            </Pill>
            <Pill tone="ghost" onClick={onClose}>
              Cancel
            </Pill>
          </div>
        </form>
      </div>
    </Dialog>
  );
}

interface CopyProps {
  athleteId: string;
  week: string;
  planned: Workout[];
  athletes: AthleteRow[];
  onClose: () => void;
}

export function CopyWeekDialog({ athleteId, week, planned, athletes, onClose }: CopyProps) {
  const others = athletes.filter((athlete) => athlete.id !== athleteId);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState(others[0]?.id ?? '');
  const [toWeek, setToWeek] = useState(week);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const status: Announcer = useAnnouncer();
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => focusFirstInvalid(form.current, ['workout_ids', 'to_week'], errors), [errors]);

  const toggle = (id: string): void =>
    setChosen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const copy = async (): Promise<void> => {
    setPending(true);
    setErrors({});
    status.say('Copying…');
    try {
      const result = await post<CopyResult>(`/api/athletes/${athleteId}/copy-week`, { week, workout_ids: [...chosen], to_athlete_id: target, to_week: toWeek });
      const name = others.find((athlete) => athlete.id === target)?.name ?? '';
      status.say(`Copied ${result.created} ${pluralise(result.created, 'workout')} to ${name}. Skipped ${result.skipped} on days that have already passed.`);
    } catch (failure) {
      const fields = fieldErrors(failure);
      if (fields) {
        setErrors(fields);
        status.say('');
      } else {
        status.say(failureMessage(failure));
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog title="Copy week" onClose={onClose}>
      <form
        ref={form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void copy();
        }}
      >
        <div className="copy-head">
          <p className="muted">Choose the planned workouts to copy.</p>
          <Pill tone="ghost" className="pill-compact" onClick={() => setChosen(new Set(planned.map((workout) => workout.id)))}>
            Select all
          </Pill>
        </div>
        <ul className="copy-list" data-field="workout_ids" tabIndex={-1}>
          {planned.map((workout) => (
            <li key={workout.id}>
              <label className="choice choice-row-item">
                <input type="checkbox" checked={chosen.has(workout.id)} onChange={() => toggle(workout.id)} />
                <span>{`${workout.title} · ${dayLabel(workout.date)}`}</span>
              </label>
            </li>
          ))}
        </ul>
        {errors['workout_ids'] && <p className="field-error">{errors['workout_ids']}</p>}
        <Field label="Copy to athlete">
          {(props) => (
            <select {...props} value={target} onChange={(event) => setTarget(event.target.value)}>
              {others.map((athlete) => (
                <option key={athlete.id} value={athlete.id}>
                  {athlete.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Target week" error={errors['to_week']} hint="YYYY-Www">
          {(props) => <input {...props} data-field="to_week" type="text" value={toWeek} onChange={(event) => setToWeek(event.target.value)} />}
        </Field>
        <Status label="Copy status" announcer={status} className="dialog-status" />
        <div className="dialog-actions">
          <Pill tone="navy" type="submit" pending={pending} pendingText="Copying…">
            Copy workouts
          </Pill>
          <Pill tone="ghost" onClick={onClose}>
            Cancel
          </Pill>
        </div>
      </form>
    </Dialog>
  );
}
