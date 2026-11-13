import { useEffect, useRef, useState } from 'react';
import type { ApplyResult, AthleteRow, Plan } from '../../shared/types.js';
import { formatDuration, pluralise } from '../../shared/format.js';
import { failureMessage, fieldErrors, get, post } from '../api.js';
import { useAnnouncer, useLoaded } from '../hooks.js';
import { Link } from '../router.js';
import { useMe } from '../session.js';
import { Dialog, EmptyMark, Field, focusFirstInvalid, Pill, Skeleton, Status } from '../ui.js';

const FIELD_ORDER = ['mode', 'date', 'event_name'] as const;

function ApplyDialog({ plan, athletes, today, onClose }: { plan: Plan; athletes: AthleteRow[]; today: string; onClose: () => void }) {
  const [athleteId, setAthleteId] = useState(athletes[0]?.id ?? '');
  const [mode, setMode] = useState<'start' | 'event'>('start');
  const [date, setDate] = useState(today);
  const [eventName, setEventName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const status = useAnnouncer();
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => focusFirstInvalid(form.current, FIELD_ORDER, errors), [errors]);

  const apply = async (): Promise<void> => {
    setPending(true);
    setErrors({});
    status.say('Applying…');
    try {
      const body = { athlete_id: athleteId, mode, date, ...(mode === 'event' && { event_name: eventName }) };
      const result = await post<ApplyResult>(`/api/plans/${plan.id}/apply`, body);
      const name = athletes.find((athlete) => athlete.id === athleteId)?.name ?? '';
      const kept = result.kept > 0 ? ` ${result.kept} ${pluralise(result.kept, 'day')} already had workouts; they were kept alongside the plan.` : '';
      status.say(`Added ${result.created} ${pluralise(result.created, 'workout')} to ${name}'s calendar. Skipped ${result.skipped} on days that have already passed.${kept}`);
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
    <Dialog title="Apply plan" onClose={onClose}>
      <form
        ref={form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void apply();
        }}
      >
        <Field label="Athlete">
          {(props) => (
            <select {...props} value={athleteId} onChange={(event) => setAthleteId(event.target.value)}>
              {athletes.map((athlete) => (
                <option key={athlete.id} value={athlete.id}>
                  {athlete.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div role="radiogroup" aria-label="Mode" className="choice-row">
          <label className="choice">
            <input type="radio" name="mode" data-field="mode" checked={mode === 'start'} onChange={() => setMode('start')} />
            <span>Start on</span>
          </label>
          <label className="choice">
            <input type="radio" name="mode" checked={mode === 'event'} onChange={() => setMode('event')} />
            <span>Count back from event</span>
          </label>
        </div>
        <Field label="Date" error={errors['date']}>
          {(props) => <input {...props} data-field="date" type="text" inputMode="numeric" placeholder="YYYY-MM-DD" value={date} onChange={(event) => setDate(event.target.value)} />}
        </Field>
        {mode === 'event' && (
          <Field label="Event name" error={errors['event_name']}>
            {(props) => <input {...props} data-field="event_name" type="text" value={eventName} onChange={(event) => setEventName(event.target.value)} />}
          </Field>
        )}
        <Status label="Plan status" announcer={status} className="dialog-status" />
        <div className="dialog-actions">
          <Pill tone="navy" type="submit" pending={pending} pendingText="Applying…">
            Apply plan
          </Pill>
          <Pill tone="ghost" onClick={onClose}>
            Cancel
          </Pill>
        </div>
      </form>
    </Dialog>
  );
}

export function Plans() {
  const me = useMe();
  const plans = useLoaded(() => get<{ plans: Plan[] }>('/api/plans').then((body) => body.plans), []);
  const athletes = useLoaded(() => get<{ athletes: AthleteRow[] }>('/api/athletes').then((body) => body.athletes), []);
  const [applying, setApplying] = useState<Plan | null>(null);

  return (
    <section className="wrap page">
      <h1 className="page-title">Plans</h1>
      {plans.data === null && <Skeleton lines={3} />}
      {plans.data && plans.data.length === 0 && (
        <div className="empty">
          <EmptyMark kind="list" />
          <p className="empty-line">No plan templates yet</p>
          <Link to="/coach" className="pill pill-navy">
            Back to athletes
          </Link>
        </div>
      )}
      <ul className="plan-grid">
        {(plans.data ?? []).map((plan) => {
          const perWeek = Math.round(plan.entries.length / plan.weeks);
          const seconds = plan.entries.reduce((sum, entry) => sum + entry.duration_s, 0);
          return (
            <li key={plan.id} className="tile plan-tile">
              <h2>{plan.name}</h2>
              <p className="plan-meta">{`${plan.weeks} ${pluralise(plan.weeks, 'week')} · ${perWeek} ${pluralise(perWeek, 'workout')} a week · ${formatDuration(seconds)} in all`}</p>
              <p className="plan-note">Every fourth week is a rest week at 60% of the duration.</p>
              <Pill tone="navy" aria-label={`Apply ${plan.name}`} onClick={() => setApplying(plan)}>
                Apply
              </Pill>
            </li>
          );
        })}
      </ul>
      {applying && athletes.data && <ApplyDialog plan={applying} athletes={athletes.data} today={me.today} onClose={() => setApplying(null)} />}
    </section>
  );
}
