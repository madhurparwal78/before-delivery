import { useCallback, useEffect, useState } from 'react';
import { ApiFailure, type Person, type Vault } from '../api.js';
import { call } from '../guard.js';
import { PERSON_STATUS, ROLE_LABEL, ROLE_ORDER, SEAT_CELL, displayName, officeDate } from '../format.js';
import { refuse, say, useLive } from '../live.js';
import { Dialog, FieldRow } from './Dialog.js';
import { TravelDialog } from './Travel.js';

type LeaveAnswer = {
  person: Person;
  turns_due: { credential_id: string; label: string; due_by: string }[];
  seat: 'released' | 'release_waiting';
};

export function People(props: { me: Person }): React.ReactElement {
  const [people, setPeople] = useState<Person[]>([]);
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [joinerOpen, setJoinerOpen] = useState(false);
  const [accessFor, setAccessFor] = useState<Person | null>(null);
  const [leaveFor, setLeaveFor] = useState<Person | null>(null);
  const [travelFor, setTravelFor] = useState<Person | null>(null);

  const load = useCallback(() => {
    void call<{ people: Person[] }>('/api/people')
      .then((answer) => setPeople(answer.people))
      .catch(() => undefined);
    void call<{ vaults: Vault[] }>('/api/vaults')
      .then((answer) => setVaults(answer.vaults))
      .catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  useLive(
    'seat-confirmed',
    useCallback(
      (raw: unknown) => {
        const data = raw as { name: string; change: 'add' | 'release' };
        say(data.change === 'add' ? `Billing confirmed ${data.name}'s seat.` : `Billing released ${data.name}'s seat.`);
        load();
      },
      [load],
    ),
  );
  useLive('billing-changed', load);

  return (
    <main>
      <h1>People</h1>
      {props.me.role === 'office_manager' ? (
        <p>
          <button type="button" onClick={() => setJoinerOpen(true)}>
            Add joiner
          </button>
        </p>
      ) : null}
      <table>
        <caption className="hidden-live">People</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Role</th>
            <th scope="col">Status</th>
            <th scope="col">Seat</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {people.map((person) => (
            <tr key={person.id}>
              <td>{person.full_name}</td>
              <td>{ROLE_LABEL[person.role]}</td>
              <td>{PERSON_STATUS[person.status]}</td>
              <td>{SEAT_CELL[person.seat]}</td>
              <td>
                {props.me.role === 'office_manager' && person.id !== props.me.id && person.left_at === null ? (
                  <span className="slip-actions">
                    <button type="button" onClick={() => setAccessFor(person)}>
                      {`Change access for ${person.full_name}`}
                    </button>
                    <button type="button" onClick={() => setLeaveFor(person)}>
                      {`Leave for ${person.full_name}`}
                    </button>
                    <button type="button" onClick={() => setTravelFor(person)}>
                      {`Travel for ${person.full_name}`}
                    </button>
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {joinerOpen ? (
        <AddJoiner
          vaults={vaults}
          onClose={() => setJoinerOpen(false)}
          onAdded={() => {
            setJoinerOpen(false);
            load();
          }}
        />
      ) : null}

      {accessFor === null ? null : (
        <ChangeAccess
          person={accessFor}
          vaults={vaults}
          onClose={() => setAccessFor(null)}
          onSaved={() => {
            setAccessFor(null);
            load();
          }}
        />
      )}

      {leaveFor === null ? null : (
        <ConfirmLeaver
          person={leaveFor}
          onClose={() => setLeaveFor(null)}
          onLeft={() => {
            setLeaveFor(null);
            load();
          }}
        />
      )}

      {travelFor === null ? null : (
        <TravelDialog
          personId={travelFor.id}
          personName={travelFor.full_name}
          onClose={() => setTravelFor(null)}
          onSaved={() => {
            setTravelFor(null);
            load();
          }}
        />
      )}
    </main>
  );
}

function VaultChecks(props: {
  vaults: Vault[];
  chosen: string[];
  onToggle: (vaultId: string, on: boolean) => void;
  idPrefix: string;
}): React.ReactElement {
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: '0 0 0.9rem' }}>
      <legend>Vaults</legend>
      {props.vaults.map((vault) => (
        <label key={vault.id} htmlFor={`${props.idPrefix}-${vault.id}`}>
          <input
            id={`${props.idPrefix}-${vault.id}`}
            type="checkbox"
            checked={props.chosen.includes(vault.id)}
            onChange={(event) => props.onToggle(vault.id, event.target.checked)}
            style={{ width: 'auto', minHeight: 0, marginRight: '0.5rem' }}
          />
          {displayName(vault)}
        </label>
      ))}
    </fieldset>
  );
}

function AddJoiner(props: {
  vaults: Vault[];
  onClose: () => void;
  onAdded: () => void;
}): React.ReactElement {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [handle, setHandle] = useState('');
  const [role, setRole] = useState('staff_accountant');
  const [aliases, setAliases] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [password, setPassword] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [key] = useState(() => `joiner-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      const person = await call<Person>('/api/people', {
        method: 'POST',
        idempotencyKey: key,
        body: {
          full_name: fullName,
          email,
          handle,
          role,
          aliases: aliases
            .split(',')
            .map((alias) => alias.trim())
            .filter((alias) => alias !== ''),
          vault_ids: chosen,
          initial_password: password,
          term: role === 'outside_bookkeeper' ? { starts_on: startsOn, ends_on: endsOn } : null,
        },
      });
      say(
        person.seat === 'confirmed'
          ? `${person.full_name} joined. Seat confirmed by billing.`
          : `${person.full_name} joined. Their seat is waiting on billing.`,
      );
      props.onAdded();
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
    <Dialog title="Add joiner" onClose={props.onClose}>
      <form onSubmit={save} noValidate>
        <FieldRow label="Full name" id="joiner-name" message={fields.full_name}>
          <input id="joiner-name" type="text" value={fullName} onChange={(event) => setFullName(event.target.value)} />
        </FieldRow>
        <FieldRow label="Email" id="joiner-email" message={fields.email}>
          <input id="joiner-email" type="text" value={email} onChange={(event) => setEmail(event.target.value)} />
        </FieldRow>
        <FieldRow label="Handle" id="joiner-handle" message={fields.handle}>
          <input id="joiner-handle" type="text" value={handle} onChange={(event) => setHandle(event.target.value)} />
        </FieldRow>
        <FieldRow label="Role" id="joiner-role" message={fields.role}>
          <select id="joiner-role" value={role} onChange={(event) => setRole(event.target.value)}>
            {ROLE_ORDER.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABEL[value]}
              </option>
            ))}
          </select>
        </FieldRow>
        <FieldRow label="Aliases" id="joiner-aliases" message={fields.aliases}>
          <input
            id="joiner-aliases"
            type="text"
            value={aliases}
            onChange={(event) => setAliases(event.target.value)}
          />
        </FieldRow>
        <VaultChecks
          vaults={props.vaults}
          chosen={chosen}
          idPrefix="joiner"
          onToggle={(vaultId, on) =>
            setChosen((current) => (on ? [...current, vaultId] : current.filter((id) => id !== vaultId)))
          }
        />
        <FieldRow label="Initial password" id="joiner-password" message={fields.initial_password}>
          <input
            id="joiner-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </FieldRow>
        <FieldRow label="Term starts on" id="joiner-starts" message={fields.term}>
          <input id="joiner-starts" type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} />
        </FieldRow>
        <FieldRow label="Term ends on" id="joiner-ends">
          <input id="joiner-ends" type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} />
        </FieldRow>
        <div className="dialog-actions">
          <button type="submit" className="solid">
            {pending ? 'Adding' : 'Add to the office'}
          </button>
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ChangeAccess(props: {
  person: Person;
  vaults: Vault[];
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const [role, setRole] = useState(props.person.role as string);
  const [chosen, setChosen] = useState<string[]>(props.person.vault_ids);
  const [aliases, setAliases] = useState(props.person.aliases.join(', '));
  const [endsOn, setEndsOn] = useState(props.person.term?.ends_on ?? '');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      const body: Record<string, unknown> = {
        role,
        vault_ids: chosen,
        aliases: aliases
          .split(',')
          .map((alias) => alias.trim())
          .filter((alias) => alias !== ''),
      };
      if (endsOn !== '') body.term_ends_on = endsOn;
      await call<Person>(`/api/people/${props.person.id}`, { method: 'PATCH', body });
      say(`${props.person.full_name} saved.`);
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
    <Dialog title="Change access" onClose={props.onClose}>
      <form onSubmit={save} noValidate>
        <FieldRow label="Role" id="access-role" message={fields.role}>
          <select id="access-role" value={role} onChange={(event) => setRole(event.target.value)}>
            {ROLE_ORDER.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABEL[value]}
              </option>
            ))}
          </select>
        </FieldRow>
        <VaultChecks
          vaults={props.vaults}
          chosen={chosen}
          idPrefix="access"
          onToggle={(vaultId, on) =>
            setChosen((current) => (on ? [...current, vaultId] : current.filter((id) => id !== vaultId)))
          }
        />
        <FieldRow label="Aliases" id="access-aliases" message={fields.aliases}>
          <input
            id="access-aliases"
            type="text"
            value={aliases}
            onChange={(event) => setAliases(event.target.value)}
          />
        </FieldRow>
        <FieldRow label="Term ends on" id="access-ends" message={fields.term ?? fields.term_ends_on}>
          <input id="access-ends" type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} />
        </FieldRow>
        <div className="dialog-actions">
          <button type="submit" className="solid">
            {pending ? 'Saving' : 'Save access'}
          </button>
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ConfirmLeaver(props: {
  person: Person;
  onClose: () => void;
  onLeft: () => void;
}): React.ReactElement {
  const [pending, setPending] = useState(false);
  const [key] = useState(() => `leave-${props.person.id}`);

  const confirm = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    try {
      const answer = await call<LeaveAnswer>(`/api/people/${props.person.id}/leave`, {
        method: 'POST',
        idempotencyKey: key,
        body: { confirm: true },
      });
      const dueBy = answer.turns_due[0]?.due_by;
      say(
        `${props.person.full_name} has left. ${answer.turns_due.length} logins are due to turn by ${dueBy === undefined ? '' : officeDate(dueBy)}.`,
      );
      props.onLeft();
    } catch (error) {
      if (error instanceof ApiFailure) refuse(error.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog title="Confirm leaver" onClose={props.onClose}>
      <p>{`${props.person.full_name} loses every vault and their sign-in at once.`}</p>
      <div className="dialog-actions">
        <button type="button" className="solid" onClick={() => void confirm()}>
          {pending ? 'Confirming' : 'Confirm leave'}
        </button>
        <button type="button" onClick={props.onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
