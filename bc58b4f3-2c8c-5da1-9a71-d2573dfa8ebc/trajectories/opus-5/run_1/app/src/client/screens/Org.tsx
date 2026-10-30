import { useMemo, useState, type ReactNode } from 'react';
import {
  ApiFailure,
  addScheduler,
  downloadStatement,
  loadSchedulers,
  removeScheduler,
} from '../lib/api';
import { LiveStatus } from '../components/Shell';
import { usePolling } from '../lib/hooks';
import type { CurrentUser } from '../lib/api';

export function Org({ user }: { user: CurrentUser }): ReactNode {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);
  const [month, setMonth] = useState('');
  const [statementStatus, setStatementStatus] = useState('');
  const { data, refresh } = usePolling(() => loadSchedulers(), []);
  const schedulers = useMemo(() => data?.schedulers ?? [], [data]);

  return (
    <main className="sheet">
      <h1>{user.org?.name ?? 'Organisation'}</h1>
      <div className="grid-12">
        <div className="col-8">
          <div className="panel">
            <h2>Schedulers</h2>
            <LiveStatus name="Scheduler status" message={status} />
            <table aria-label="Schedulers" className="stacked-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Phone</th>
                  <th scope="col">Remove</th>
                </tr>
              </thead>
              <tbody>
                {schedulers.map((scheduler) => (
                  <tr key={scheduler.id}>
                    <td data-label="Name">{scheduler.name}</td>
                    <td data-label="Email">{scheduler.email}</td>
                    <td data-label="Phone" className="numeral">
                      {scheduler.phone}
                    </td>
                    <td data-label="Remove">
                      <button
                        type="button"
                        aria-label={`Remove ${scheduler.name}`}
                        onClick={() => {
                          setStatus('Saving…');
                          removeScheduler(scheduler.id)
                            .then(() => {
                              setStatus(`${scheduler.name} no longer has access.`);
                              refresh();
                            })
                            .catch(() => setStatus('That scheduler could not be removed.'));
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form
            noValidate
            aria-label="Add scheduler"
            className="panel"
            onSubmit={(event) => {
              event.preventDefault();
              setPending(true);
              setStatus('Saving…');
              setFields({});
              addScheduler({ name, email, phone, password })
                .then((scheduler) => {
                  setStatus(`${scheduler.name} can now request interpreters.`);
                  setName('');
                  setEmail('');
                  setPhone('');
                  setPassword('');
                  refresh();
                })
                .catch((error: unknown) => {
                  if (error instanceof ApiFailure && error.code === 'email_taken') {
                    setStatus('That email is already in use.');
                    return;
                  }
                  if (error instanceof ApiFailure && error.code === 'validation') {
                    setFields(error.fields);
                    setStatus('Check the highlighted fields.');
                    return;
                  }
                  setStatus('That scheduler could not be added.');
                })
                .finally(() => setPending(false));
            }}
          >
            <h2>Add scheduler</h2>
            <div className="field">
              <label htmlFor="scheduler-name">Name</label>
              <input
                id="scheduler-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              {fields['name'] === undefined ? null : <p className="field-error">{fields['name']}</p>}
            </div>
            <div className="field">
              <label htmlFor="scheduler-email">Email</label>
              <input
                id="scheduler-email"
                type="text"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              {fields['email'] === undefined ? null : (
                <p className="field-error">{fields['email']}</p>
              )}
            </div>
            <div className="field">
              <label htmlFor="scheduler-phone">Phone</label>
              <input
                id="scheduler-phone"
                type="text"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
              {fields['phone'] === undefined ? null : (
                <p className="field-error">{fields['phone']}</p>
              )}
            </div>
            <div className="field">
              <label htmlFor="scheduler-password">Initial password</label>
              <input
                id="scheduler-password"
                type="text"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              {fields['password'] === undefined ? null : (
                <p className="field-error">{fields['password']}</p>
              )}
            </div>
            <button type="submit" className="primary" disabled={pending}>
              Add scheduler
            </button>
          </form>
        </div>
        <div className="col-4">
          <form
            noValidate
            aria-label="Monthly statement"
            className="panel"
            onSubmit={(event) => {
              event.preventDefault();
              setStatementStatus('Preparing…');
              downloadStatement(month)
                .then(() => setStatementStatus(`Statement for ${month} downloaded.`))
                .catch(() => setStatementStatus('Use a month written as YYYY-MM.'));
            }}
          >
            <h2>Monthly statement</h2>
            <div className="field">
              <label htmlFor="statement-month">Month</label>
              <input
                id="statement-month"
                type="text"
                placeholder="YYYY-MM"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              />
            </div>
            <button type="submit">Download statement</button>
            <LiveStatus name="Statement status" message={statementStatus} />
          </form>
        </div>
      </div>
    </main>
  );
}
