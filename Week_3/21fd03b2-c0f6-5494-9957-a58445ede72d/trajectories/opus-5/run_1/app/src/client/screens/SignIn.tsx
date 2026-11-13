import { useState } from 'react';
import { fieldCopy } from '../../shared/copy.js';
import { ApiFault, api } from '../api.js';
import { ErrorSummary } from '../components/ErrorSummary.jsx';
import { LiveRegions } from '../components/LiveRegions.jsx';
import { Toolbar, Wordmark } from '../components/Toolbar.jsx';
import { navigate, useLocation } from '../nav.js';

interface Landing {
  landing: string;
}

const IDS = { email: 'sign-in-email', password: 'sign-in-password' };

export function SignIn(): JSX.Element {
  const location = useLocation();
  const invite = location.search.get('invite');
  const returnPath = location.search.get('return');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setFields({});
    setFormError(undefined);
    try {
      const response = await api<Landing>('/api/auth/sign-in', {
        method: 'POST',
        allowUnauthenticated: true,
        body: {
          email,
          password,
          invite: invite ?? '',
          return: returnPath ?? '',
        },
      });
      window.location.assign(response.landing);
    } catch (error) {
      if (error instanceof ApiFault && error.code === 'validation') setFields(error.fields);
      else setFormError(fieldCopy.signInFailed);
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
            <h1 className="panel-title">Sign in</h1>
          </div>
          <div className="panel-body">
            <ErrorSummary fields={fields} formError={formError} ids={IDS} />
            <form onSubmit={submit} noValidate>
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
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <div className="dialog-actions">
                <button type="button" className="chip" onClick={() => navigate('/sign-up')}>
                  Create account
                </button>
                <button type="submit" className="chip on" disabled={busy}>
                  Sign in
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
