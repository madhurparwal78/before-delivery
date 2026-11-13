import { useState } from 'react';
import type { Quizmaster } from '../../shared/protocol';
import { api } from '../lib/api';
import { copy } from '../lib/copy';
import { Link, useRouter } from '../lib/router';
import { FieldError, StatusRegion, describedBy } from '../components';

interface Props {
  onSignedIn: (quizmaster: Quizmaster) => void;
}

export function SignIn({ onSignedIn }: Props): JSX.Element {
  const { navigate } = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFields({});
    setStatus(copy.signingIn);
    const result = await api.post<{ quizmaster: Quizmaster }>('/api/auth/login', {
      email,
      password,
    });
    if (result.ok) {
      onSignedIn(result.data.quizmaster);
      navigate('/host');
      return;
    }
    setBusy(false);
    setFields(result.failure.fields);
    setStatus(
      result.failure.code === 'invalid_credentials'
        ? copy.invalidCredentials
        : result.failure.code === 'validation_failed'
          ? ''
          : copy.somethingWentWrong,
    );
  };

  return (
    <main className="column">
      <h1 className="wordmark">Lastbell</h1>
      <h2>Quizmaster sign in</h2>
      <form className="form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="signin-email">Email</label>
          <input
            id="signin-email"
            type="email"
            autoComplete="email"
            value={email}
            aria-describedby={describedBy('signin-email-error', fields['email'])}
            onChange={(event) => setEmail(event.target.value)}
          />
          <FieldError id="signin-email-error" message={fields['email']} />
        </div>
        <div className="field">
          <label htmlFor="signin-password">Password</label>
          <input
            id="signin-password"
            type="password"
            autoComplete="current-password"
            value={password}
            aria-describedby={describedBy('signin-password-error', fields['password'])}
            onChange={(event) => setPassword(event.target.value)}
          />
          <FieldError id="signin-password-error" message={fields['password']} />
        </div>
        <button className="button button-primary" type="submit" disabled={busy}>
          Sign in
        </button>
      </form>
      <StatusRegion label="Account status" text={status} />
      <p className="footer-link">
        <Link to="/host/signup">Create an account</Link>
      </p>
    </main>
  );
}

export function SignUp({ onSignedIn }: Props): JSX.Element {
  const { navigate } = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFields({});
    setStatus(copy.creatingAccount);
    const result = await api.post<{ quizmaster: Quizmaster }>('/api/auth/signup', {
      displayName,
      email,
      password,
    });
    if (result.ok) {
      onSignedIn(result.data.quizmaster);
      navigate('/host');
      return;
    }
    setBusy(false);
    setFields(result.failure.fields);
    setStatus(
      result.failure.code === 'email_taken'
        ? copy.emailTaken
        : result.failure.code === 'validation_failed'
          ? ''
          : copy.somethingWentWrong,
    );
  };

  return (
    <main className="column">
      <h1 className="wordmark">Lastbell</h1>
      <h2>Create account</h2>
      <form className="form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="signup-name">Display name</label>
          <input
            id="signup-name"
            type="text"
            autoComplete="name"
            value={displayName}
            aria-describedby={describedBy('signup-name-error', fields['displayName'])}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <FieldError id="signup-name-error" message={fields['displayName']} />
        </div>
        <div className="field">
          <label htmlFor="signup-email">Email</label>
          <input
            id="signup-email"
            type="email"
            autoComplete="email"
            value={email}
            aria-describedby={describedBy('signup-email-error', fields['email'])}
            onChange={(event) => setEmail(event.target.value)}
          />
          <FieldError id="signup-email-error" message={fields['email']} />
        </div>
        <div className="field">
          <label htmlFor="signup-password">Password</label>
          <input
            id="signup-password"
            type="password"
            autoComplete="new-password"
            value={password}
            aria-describedby={describedBy('signup-password-error', fields['password'])}
            onChange={(event) => setPassword(event.target.value)}
          />
          <FieldError id="signup-password-error" message={fields['password']} />
        </div>
        <button className="button button-primary" type="submit" disabled={busy}>
          Create account
        </button>
      </form>
      <StatusRegion label="Account status" text={status} />
      <p className="footer-link">
        <Link to="/host/login">Quizmaster sign in</Link>
      </p>
    </main>
  );
}
