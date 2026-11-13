import { useState } from 'react';
import { ApiFault, api } from '../api.js';
import { ErrorSummary } from '../components/ErrorSummary.jsx';
import { LiveRegions } from '../components/LiveRegions.jsx';
import { Toolbar, Wordmark } from '../components/Toolbar.jsx';
import { navigate, useLocation } from '../nav.js';

const IDS = {
  displayName: 'sign-up-name',
  email: 'sign-up-email',
  password: 'sign-up-password',
};

export function SignUp(): JSX.Element {
  const location = useLocation();
  const invite = location.search.get('invite');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setFields({});
    try {
      const response = await api<{ landing: string }>('/api/auth/sign-up', {
        method: 'POST',
        allowUnauthenticated: true,
        body: { displayName, email, password, invite: invite ?? '' },
      });
      window.location.assign(response.landing);
    } catch (error) {
      if (error instanceof ApiFault) setFields(error.fields);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <Toolbar>
        <Wordmark />
      </Toolbar>
      <div className="screen-body">
        <div className="panel">
          <div className="panel-head">
            <h1 className="panel-title">Create account</h1>
          </div>
          <div className="panel-body">
            <ErrorSummary fields={fields} ids={IDS} />
            <form onSubmit={submit} noValidate>
              <div className="field">
                <label htmlFor={IDS.displayName}>Display name</label>
                <input
                  id={IDS.displayName}
                  type="text"
                  value={displayName}
                  aria-invalid={fields.displayName ? true : undefined}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
                {fields.displayName ? (
                  <span className="field-error">{fields.displayName}</span>
                ) : null}
              </div>
              <div className="field">
                <label htmlFor={IDS.email}>Email</label>
                <input
                  id={IDS.email}
                  type="text"
                  value={email}
                  aria-invalid={fields.email ? true : undefined}
                  onChange={(event) => setEmail(event.target.value)}
                />
                {fields.email ? <span className="field-error">{fields.email}</span> : null}
              </div>
              <div className="field">
                <label htmlFor={IDS.password}>Password</label>
                <input
                  id={IDS.password}
                  type="password"
                  value={password}
                  aria-invalid={fields.password ? true : undefined}
                  onChange={(event) => setPassword(event.target.value)}
                />
                {fields.password ? <span className="field-error">{fields.password}</span> : null}
              </div>
              <div className="dialog-actions">
                <button type="button" className="chip" onClick={() => navigate('/sign-in')}>
                  Sign in
                </button>
                <button type="submit" className="chip on" disabled={busy}>
                  Create account
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <LiveRegions />
    </div>
  );
}
