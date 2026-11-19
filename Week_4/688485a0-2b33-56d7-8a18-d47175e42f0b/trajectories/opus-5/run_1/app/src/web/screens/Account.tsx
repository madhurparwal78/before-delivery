import { useState } from 'react';
import { ApiFailure, SessionUser, apiSend } from '../api';
import { LANDING_LINE, accountStatusText, codeSentText } from '../copy';
import { PlainShell } from '../components/Shell';
import { navigate } from '../router';

function nextPath(search: string): string {
  const value = new URLSearchParams(search).get('next');
  return value && value.startsWith('/') ? value : '/projects';
}

export function SignupScreen({ user }: { user: SessionUser | null }): JSX.Element {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');

  const submit = async (): Promise<void> => {
    try {
      await apiSend('POST', '/api/auth/signup', { name, email, password });
      setStatus(codeSentText(email.trim().toLowerCase()));
      window.sessionStorage.setItem('jarful:email', email.trim().toLowerCase());
      navigate('/confirm');
    } catch (failure) {
      if (failure instanceof ApiFailure) setStatus(accountStatusText(failure));
    }
  };

  return (
    <PlainShell user={user}>
      <h1>Make an account</h1>
      <p className="secondary">{LANDING_LINE}</p>
      <div className="field">
        <label htmlFor="signup-name">Name</label>
        <input id="signup-name" type="text" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="signup-email">Email</label>
        <input id="signup-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="signup-password">Password</label>
        <input
          id="signup-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      <button type="button" className="primary" onClick={() => void submit()}>
        Create account
      </button>
      <p role="status" aria-label="Account status">
        {status}
      </p>
    </PlainShell>
  );
}

export function ConfirmScreen({
  user,
  onSignedIn,
}: {
  user: SessionUser | null;
  onSignedIn: (user: SessionUser) => void;
}): JSX.Element {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState('');
  const email = window.sessionStorage.getItem('jarful:email') ?? '';
  const [address, setAddress] = useState(email);

  const confirm = async (): Promise<void> => {
    try {
      const answer = await apiSend<{ user: SessionUser }>('POST', '/api/auth/confirm', { email: address, code });
      onSignedIn(answer.user);
      navigate('/projects');
    } catch (failure) {
      if (failure instanceof ApiFailure) setStatus(accountStatusText(failure));
    }
  };

  return (
    <PlainShell user={user}>
      <h1>Type your code</h1>
      {email ? null : (
        <div className="field">
          <label htmlFor="confirm-email">Email</label>
          <input id="confirm-email" type="email" value={address} onChange={(event) => setAddress(event.target.value)} />
        </div>
      )}
      <div className="field">
        <label htmlFor="confirm-code">Code</label>
        <input id="confirm-code" type="text" value={code} onChange={(event) => setCode(event.target.value)} />
      </div>
      <div className="inline">
        <button type="button" className="primary" onClick={() => void confirm()}>
          Confirm
        </button>
        <button
          type="button"
          onClick={async () => {
            await apiSend('POST', '/api/auth/resend', { email: address });
            setStatus(codeSentText(address));
          }}
        >
          Send a new code
        </button>
      </div>
      <p role="status" aria-label="Account status">
        {status}
      </p>
    </PlainShell>
  );
}

export function SigninScreen({
  user,
  search,
  onSignedIn,
}: {
  user: SessionUser | null;
  search: string;
  onSignedIn: (user: SessionUser) => void;
}): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');

  const submit = async (): Promise<void> => {
    try {
      const answer = await apiSend<{ user: SessionUser }>('POST', '/api/auth/signin', { email, password });
      onSignedIn(answer.user);
      navigate(nextPath(search));
    } catch (failure) {
      if (failure instanceof ApiFailure) setStatus(accountStatusText(failure));
    }
  };

  return (
    <PlainShell user={user}>
      <h1>Sign in</h1>
      <div className="field">
        <label htmlFor="signin-email">Email</label>
        <input id="signin-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="signin-password">Password</label>
        <input
          id="signin-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      <button type="button" className="primary" onClick={() => void submit()}>
        Sign in
      </button>
      <p role="status" aria-label="Account status">
        {status}
      </p>
    </PlainShell>
  );
}
