import { useState, useEffect, useRef } from 'react';
import { api, ApiError } from '../lib/api';
import type { MeJson, StateJson } from '../../../shared/types';
import { TopBar } from '../components/TopBar';
import { Dialog } from '../components/Dialog';
import type { Session } from '../lib/session';

export function StatesScreen({ me, announce }: { me: MeJson; announce: (line: string) => void }): React.ReactNode {
  const [states, setStates] = useState<StateJson[]>([]);
  const session: Session = { me, signOut: async () => {} };

  const load = async () => {
    setStates(await api.states());
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <>
      <TopBar session={session} route={{ path: '/states', navigate: () => {} }} />
      <main className="page states-page">
        <h1 className="page-title">States</h1>
        <h2>States</h2>
        {states.map((state) => (
          <section key={state.code} role="region" aria-label={state.name} className="state-region">
            <h3>{state.name}</h3>
            <p className="quiet">{state.zone_label} · {state.zone}</p>
            <p className="quiet">Holidays: {state.holidays.length === 0 ? 'none' : state.holidays.join(', ')}</p>
            <p className="quiet">
              Editions: {state.editions.map((e) => `${e.effective_date} · due day ${e.due_day} · ${e.carry === 'next_business' ? 'Next business day' : 'Fixed date'} · ${e.rate}% · extension ${e.extension_days} days`).join(' | ')}
            </p>
            <HolidaysButton state={state} load={load} announce={announce} />
            <EditionButton state={state} load={load} announce={announce} />
          </section>
        ))}
      </main>
    </>
  );
}

function HolidaysButton({ state, load, announce }: {
  state: StateJson;
  load: () => Promise<void>;
  announce: (line: string) => void;
}): React.ReactNode {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [dates, setDates] = useState(state.holidays.join('\n'));
  const ref = useRef<HTMLButtonElement>(null);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const list = dates.split('\n').map((line) => line.trim()).filter((line) => line !== '');
      await api.saveHolidays(state.code, list);
      setOpen(false);
      setErrors({});
      announce(`Holidays saved for ${state.code}.`);
      await load();
    } catch (error) {
      if (error instanceof ApiError) setErrors(error.errors);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button ref={ref} type="button" className="button button-secondary" onClick={() => setOpen(true)}>
        {`Edit holidays for ${state.code}`}
      </button>
      {open ? (
        <Dialog label={`Holidays for ${state.code}`} onClose={() => setOpen(false)} openerRef={ref}>
          <h2>{`Holidays for ${state.code}`}</h2>
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label className="field">
              <span className="field-label">Holiday dates</span>
              <textarea rows={6} value={dates} onChange={(event) => setDates(event.target.value)} />
              {errors.holidays !== undefined ? <span className="field-error">{errors.holidays}</span> : null}
            </label>
            <div className="dialog-actions">
              <button type="submit" className="button button-primary">
                {saving ? 'Saving' : 'Save holidays'}
              </button>
              <button type="button" className="button button-secondary" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </>
  );
}

function EditionButton({ state, load, announce }: {
  state: StateJson;
  load: () => Promise<void>;
  announce: (line: string) => void;
}): React.ReactNode {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [effectiveDate, setEffectiveDate] = useState('');
  const [dueDay, setDueDay] = useState('20');
  const [carry, setCarry] = useState<'next_business' | 'fixed'>('next_business');
  const [rate, setRate] = useState('4.000');
  const [extensionDays, setExtensionDays] = useState('30');
  const ref = useRef<HTMLButtonElement>(null);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await api.publishEdition(state.code, {
        effective_date: effectiveDate,
        due_day: Number(dueDay),
        carry,
        rate,
        extension_days: Number(extensionDays),
      });
      setOpen(false);
      setErrors({});
      announce(`Rule change published for ${state.code}.`);
      await load();
    } catch (error) {
      if (error instanceof ApiError) setErrors(error.errors);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button ref={ref} type="button" className="button button-secondary" onClick={() => setOpen(true)}>
        {`Publish rule change for ${state.code}`}
      </button>
      {open ? (
        <Dialog label="Publish rule change" onClose={() => setOpen(false)} openerRef={ref}>
          <h2>Publish rule change</h2>
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Field label="Effective date" error={errors.effective_date}>
              <input type="text" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} />
            </Field>
            <Field label="Due day" error={errors.due_day}>
              <input type="number" value={dueDay} onChange={(event) => setDueDay(event.target.value)} />
            </Field>
            <fieldset className="field">
              <legend className="field-label">Carry-forward</legend>
              <label className="radio">
                <input
                  type="radio"
                  name="carry"
                  checked={carry === 'next_business'}
                  onChange={() => setCarry('next_business')}
                />
                Next business day
              </label>
              <label className="radio">
                <input
                  type="radio"
                  name="carry"
                  checked={carry === 'fixed'}
                  onChange={() => setCarry('fixed')}
                />
                Fixed date
              </label>
              {errors.carry !== undefined ? <span className="field-error">{errors.carry}</span> : null}
            </fieldset>
            <Field label="Reference rate" error={errors.rate}>
              <input type="text" value={rate} onChange={(event) => setRate(event.target.value)} />
            </Field>
            <Field label="Extension days" error={errors.extension_days}>
              <input type="number" value={extensionDays} onChange={(event) => setExtensionDays(event.target.value)} />
            </Field>
            <div className="dialog-actions">
              <button type="submit" className="button button-primary">
                {saving ? 'Saving' : 'Publish'}
              </button>
              <button type="button" className="button button-secondary" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }): React.ReactNode {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {error !== undefined && error !== '' ? <span className="field-error">{error}</span> : null}
    </label>
  );
}
