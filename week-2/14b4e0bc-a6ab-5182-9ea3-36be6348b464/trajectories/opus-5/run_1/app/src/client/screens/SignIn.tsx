import { type ReactNode, useState } from 'react';
import { useAppState } from '../lib/hooks.ts';
import { store } from '../lib/store.ts';

export function SignIn(): ReactNode {
  const state = useAppState();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <main className="signin" data-motion={state.motion}>
      <h1 className="wordmark">Quarrystone Strata</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void store.signIn(email, password);
        }}
      >
        <label htmlFor="signin-email">Email</label>
        <input
          id="signin-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <label htmlFor="signin-password">Password</label>
        <input
          id="signin-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button type="submit">Sign in</button>
      </form>
      <p role="status" aria-label="Sign-in status">
        {state.signInStatus}
      </p>
      {state.signInAlert === '' ? null : <p role="alert">{state.signInAlert}</p>}
    </main>
  );
}
