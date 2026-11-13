import { useState, type FormEvent } from 'react';
import { Field } from './Field';
import { useWorkbench } from '../workbench';

export function SignIn() {
  const { signIn, signingIn, signInError } = useWorkbench();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void signIn(email, password);
  };

  return (
    <main className="signin">
      <div className="signin-brand">
        <h1 className="wordmark">Kerfline Bench</h1>
        <p className="maker">Halyard Instrument Works</p>
      </div>
      <form aria-label="Sign in" className="panel signin-form" onSubmit={submit} noValidate>
        <Field label="Email" type="text" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} error={signInError?.fields['email']} />
        <Field label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={signInError?.fields['password']} />
        {signInError && Object.keys(signInError.fields).length === 0 && (
          <p role="alert" className="form-alert">
            {signInError.message}
          </p>
        )}
        <button type="submit" className="primary" disabled={signingIn}>
          {signingIn ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
