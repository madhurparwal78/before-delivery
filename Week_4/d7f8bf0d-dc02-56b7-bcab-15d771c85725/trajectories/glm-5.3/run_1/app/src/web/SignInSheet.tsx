import React, { useCallback, useState } from 'react';
import { api } from './apiClient';
import type { Me } from './store/types';

export function SignInSheet({ onSignedIn, announce }: {
  onSignedIn: (me: Me) => void;
  announce: (message: string) => void;
}): React.ReactElement {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    announce('Signing in.');
    try {
      await api('POST', '/api/auth/sign-in', { email, password });
      const me = await api<Me>('GET', '/api/me', undefined);
      announce('Signed in.');
      onSignedIn(me);
    } catch {
      announce('That email and password do not match.');
    } finally {
      setBusy(false);
    }
  }, [email, password, announce, onSignedIn]);

  return (
    <div className="dialog-backdrop" style={{ zIndex: 70, background: 'rgba(255,255,255,0.4)' }}>
      <form className="dialog" data-testid="sign-in-form" onSubmit={submit}>
        <h2>Sign in</h2>
        <div className="field">
          <label htmlFor="sign-in-email">Email</label>
          <input
            id="sign-in-email"
            type="textbox"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="sign-in-password">Password</label>
          <input
            id="sign-in-password"
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="actions">
          <button className="lipped" type="submit" disabled={busy}>Sign in</button>
        </div>
      </form>
    </div>
  );
}

export function SignInAgainDialog({ open, email, onSubmit, onClose }: {
  open: boolean;
  email: string;
  onSubmit: (password: string) => Promise<boolean>;
  onClose: () => void;
}): React.ReactElement | null {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  return (
    <div className="dialog-backdrop" style={{ zIndex: 95 }}>
      <form
        className="dialog"
        role="dialog"
        aria-label="Sign in again"
        data-testid="sign-in-again"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const ok = await onSubmit(password);
          setBusy(false);
          if (ok) setPassword('');
        }}
      >
        <h2>Sign in again</h2>
        <p>Your sign-in has ended. Your work is kept.</p>
        <div className="field">
          <label htmlFor="again-email">Email</label>
          <input id="again-email" type="textbox" value={email} readOnly />
        </div>
        <div className="field">
          <label htmlFor="again-password">Password</label>
          <input
            id="again-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </div>
        <div className="actions">
          <button className="lipped" type="submit" disabled={busy || password === ''}>Sign in</button>
        </div>
      </form>
    </div>
  );
}
