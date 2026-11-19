import { useState, useEffect, useRef } from 'react';
import { api, ApiError } from '../lib/api';
import type { MeJson, ClientJson, StateJson } from '../../../shared/types';
import { TopBar } from '../components/TopBar';
import { Dialog } from '../components/Dialog';
import type { Session } from '../lib/session';

export function ClientsScreen({ me, announce }: { me: MeJson; announce: (line: string) => void }): React.ReactNode {
  const [clients, setClients] = useState<ClientJson[]>([]);
  const [states, setStates] = useState<StateJson[]>([]);
  const session: Session = { me, signOut: async () => {} };
  const addRef = useRef<HTMLButtonElement>(null);

  const load = async () => {
    const [nextClients, nextStates] = await Promise.all([api.clients(), api.states()]);
    setClients(nextClients);
    setStates(nextStates);
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <>
      <TopBar session={session} route={{ path: '/clients', navigate: () => {} }} />
      <main className="page clients-page">
        <h1 className="page-title">Clients</h1>
        <div className="page-header">
          <h2>Clients</h2>
          <AddClientButton load={load} announce={announce} addRef={addRef} />
        </div>
        {clients.map((client) => (
          <section key={client.id} role="region" aria-label={client.name} className="client-region">
            <h3>{client.name}</h3>
            <p className="quiet">Owner: {client.owner.display_name} · {client.owner.email}</p>
            {client.registrations.length > 0 ? (
              <ul>
                {client.registrations.map((registration) => (
                  <li key={registration.id}>
                    {registration.state} · {registration.frequency} · from {registration.first_period}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="quiet">No registrations yet.</p>
            )}
            <RegisterButton client={client} states={states} load={load} announce={announce} />
          </section>
        ))}
        {clients.length === 0 ? <p className="quiet">No clients yet. Add a client to start.</p> : null}
      </main>
    </>
  );
}

function AddClientButton({ load, announce, addRef }: {
  load: () => Promise<void>;
  announce: (line: string) => void;
  addRef: React.RefObject<HTMLButtonElement | null>;
}): React.ReactNode {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await api.addClient({
        name,
        owner: { display_name: ownerName, email: ownerEmail, password: ownerPassword },
      });
      setOpen(false);
      setErrors({});
      announce(`Client added: ${name}.`);
      await load();
    } catch (error) {
      if (error instanceof ApiError) setErrors(error.errors);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button ref={addRef} type="button" className="button button-primary" onClick={() => setOpen(true)}>
        Add client
      </button>
      {open ? (
        <Dialog label="Add client" onClose={() => setOpen(false)} openerRef={addRef}>
          <h2>Add client</h2>
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Field label="Business name" error={errors.name}>
              <input type="text" value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="Owner name" error={errors['owner.display_name']}>
              <input type="text" value={ownerName} onChange={(event) => setOwnerName(event.target.value)} />
            </Field>
            <Field label="Owner email" error={errors['owner.email']}>
              <input type="email" value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} />
            </Field>
            <Field label="Owner password" error={errors['owner.password']}>
              <input type="password" value={ownerPassword} onChange={(event) => setOwnerPassword(event.target.value)} />
            </Field>
            <div className="dialog-actions">
              <button type="submit" className="button button-primary">
                {saving ? 'Saving' : 'Save client'}
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

function RegisterButton({ client, states, load, announce }: {
  client: ClientJson;
  states: StateJson[];
  load: () => Promise<void>;
  announce: (line: string) => void;
}): React.ReactNode {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState('');
  const [frequency, setFrequency] = useState('');
  const [firstPeriod, setFirstPeriod] = useState('');
  const ref = useRef<HTMLButtonElement>(null);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await api.register(client.id, { state, frequency, first_period: firstPeriod });
      setOpen(false);
      setErrors({});
      announce(`${client.name} registered in ${state}.`);
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
        {`Register ${client.name} in a state`}
      </button>
      {open ? (
        <Dialog label="Register in a state" onClose={() => setOpen(false)} openerRef={ref}>
          <h2>Register in a state</h2>
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Field label="State" error={errors.state}>
              <select value={state} onChange={(event) => setState(event.target.value)}>
                <option value="">Choose a state</option>
                {states.map((s) => (
                  <option key={s.code} value={s.code}>{`${s.name} (${s.code})`}</option>
                ))}
              </select>
            </Field>
            <fieldset className="field">
              <legend className="field-label">Filing frequency</legend>
              {(['Monthly', 'Quarterly', 'Yearly'] as const).map((label) => (
                <label key={label} className="radio">
                  <input
                    type="radio"
                    name="frequency"
                    value={label.toLowerCase()}
                    checked={frequency === label.toLowerCase()}
                    onChange={() => setFrequency(label.toLowerCase())}
                  />
                  {label}
                </label>
              ))}
              {errors.frequency !== undefined ? <span className="field-error">{errors.frequency}</span> : null}
            </fieldset>
            <Field label="First period" error={errors.first_period} hint="2026-05, 2026-Q2 or 2026">
              <input type="text" value={firstPeriod} onChange={(event) => setFirstPeriod(event.target.value)} />
            </Field>
            <div className="dialog-actions">
              <button type="submit" className="button button-primary">
                {saving ? 'Saving' : 'Register'}
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

function Field({ label, error, hint, children }: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint !== undefined ? <span className="field-hint">{hint}</span> : null}
      {error !== undefined && error !== '' ? <span className="field-error">{error}</span> : null}
    </label>
  );
}
