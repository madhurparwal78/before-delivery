import { useState, type ReactNode } from 'react';
import type { SessionUser } from '../../shared/contract.js';
import { ApiFailure, api } from '../api.js';
import { usePoll } from '../hooks.js';
import { Field, StatusRegion } from '../ui.js';

export function Org({ user }: { user: SessionUser }): ReactNode {
  const schedulers = usePoll(() => api.schedulers());
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  const add = async (): Promise<void> => {
    setPending(true);
    setFields({});
    setStatus('Saving…');
    try {
      const created = await api.addScheduler({ name, email, phone, password });
      setStatus(`${created.name} can now request interpreters.`);
      setName('');
      setEmail('');
      setPhone('');
      setPassword('');
      await schedulers.refresh();
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'email_taken') {
        setStatus('That email is already in use.');
      } else if (error instanceof ApiFailure && error.status === 422) {
        setFields(error.fields);
        setStatus('Check the highlighted fields.');
      } else {
        setStatus("Couldn't reach Teamseat. Try again shortly.");
      }
    } finally {
      setPending(false);
    }
  };

  const remove = async (id: number, personName: string): Promise<void> => {
    setPending(true);
    setStatus('Saving…');
    try {
      await api.removeScheduler(id);
      setStatus(`${personName} no longer has access.`);
      await schedulers.refresh();
    } catch {
      setStatus("Couldn't reach Teamseat. Try again shortly.");
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="sheet">
      <section className="panel span-8">
        <h2 className="panel__title">Schedulers</h2>
        <StatusRegion name="Scheduler status" text={status} />
        <div className="table-wrap">
  <table className="stacked" aria-label="Schedulers">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Phone</th>
                <th scope="col">
                  <span className="visually-hidden">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(schedulers.data?.schedulers ?? []).map((scheduler) => (
                <tr key={scheduler.id}>
                  <td data-label="Name">{scheduler.name}</td>
                  <td data-label="Email">{scheduler.email}</td>
                  <td data-label="Phone">
                    <span className="num">{scheduler.phone}</span>
                  </td>
                  <td data-label="">
                    <button
                      type="button"
                      className="btn btn--quiet"
                      disabled={pending}
                      onClick={() => void remove(scheduler.id, scheduler.name)}
                    >
                      Remove {scheduler.name}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
</div>

        <h3>Add a scheduler</h3>
        <form
          aria-label="Add scheduler"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <Field label="Name" error={fields['name']}>
            {({ id, describedBy }) => (
              <input
                id={id}
                type="text"
                aria-describedby={describedBy}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
          <Field label="Email" error={fields['email']}>
            {({ id, describedBy }) => (
              <input
                id={id}
                type="email"
                aria-describedby={describedBy}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>
          <Field label="Phone" error={fields['phone']}>
            {({ id, describedBy }) => (
              <input
                id={id}
                type="text"
                aria-describedby={describedBy}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            )}
          </Field>
          <Field label="Initial password" hint="At least 12 characters" error={fields['password']}>
            {({ id, describedBy }) => (
              <input
                id={id}
                type="text"
                aria-describedby={describedBy}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </Field>
          <button type="submit" className="btn btn--primary" disabled={pending}>
            Add scheduler
          </button>
        </form>
      </section>

      <section className="panel span-4">
        <h2 className="panel__title">Monthly statement</h2>
        <StatementForm orgCode={user.org?.code ?? ''} />
      </section>
    </main>
  );
}

function StatementForm({ orgCode }: { orgCode: string }): ReactNode {
  const [month, setMonth] = useState('');
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);

  const download = async (): Promise<void> => {
    setPending(true);
    setStatus('Preparing…');
    try {
      const response = await fetch(`/api/org/statement?month=${encodeURIComponent(month)}`, {
        credentials: 'same-origin',
      });
      if (!response.ok) {
        setStatus('Give a month as YYYY-MM.');
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `teamseat-${orgCode}-${month}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus(`Statement for ${month} downloaded.`);
    } catch {
      setStatus("Couldn't reach Teamseat. Try again shortly.");
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      aria-label="Monthly statement"
      onSubmit={(event) => {
        event.preventDefault();
        void download();
      }}
    >
      <Field label="Month" hint="YYYY-MM">
        {({ id, describedBy }) => (
          <input
            id={id}
            type="text"
            inputMode="numeric"
            placeholder="2026-11"
            aria-describedby={describedBy}
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        )}
      </Field>
      <button type="submit" className="btn btn--primary" disabled={pending}>
        Download statement
      </button>
      <StatusRegion name="Statement status" text={status} />
    </form>
  );
}
