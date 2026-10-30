import { useState } from 'react';
import { apiSend } from '../api';
import { useFeedback } from '../feedback';
import { KITCHEN_NAME } from '../kitchenTime';
import type { User } from '../types';

export function SignInScreen({ onSignedIn }: { onSignedIn: (user: User) => void }): JSX.Element {
  const { perform } = useFeedback();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const result = await perform({
      pending: 'Signing in…',
      success: () => '',
      errors: (failure) => {
        if (failure.code === 'invalid_credentials') {
          return "That email and password don't match an account.";
        }
        if (failure.code === 'tenant_offboarded') {
          return 'This business has been offboarded. Contact the kitchen.';
        }
        return null;
      },
      run: () => apiSend<{ user: User }>('POST', '/api/session', { email, password }),
    });
    if (result) onSignedIn(result.user);
  };

  return (
    <div className="centred">
      <h1>Stationkeeper</h1>
      <p>{KITCHEN_NAME}</p>
      <form onSubmit={(event) => void submit(event)}>
        <div className="field">
          <label htmlFor="signin-email">Email</label>
          <input
            id="signin-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            style={{ width: '100%' }}
          />
        </div>
        <div className="field">
          <label htmlFor="signin-password">Password</label>
          <input
            id="signin-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={{ width: '100%' }}
          />
        </div>
        <button type="submit" className="primary">
          Sign in
        </button>
      </form>
    </div>
  );
}
