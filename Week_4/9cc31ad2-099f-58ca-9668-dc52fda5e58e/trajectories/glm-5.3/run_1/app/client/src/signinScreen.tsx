// Sign-in: email form, link redeem, the keep-which-garage choice.
import { useEffect, useState, type JSX } from 'react';
import { api, ApiError } from './api';
import { Dialog, navigate } from './ui';
import { useApp } from './appState';
import { fmtCoins } from './formats';

export default function SignInScreen({ token }: { token: string | null }): JSX.Element {
  const { me, refreshMe, refreshGarage } = useApp();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');
  const [sending, setSending] = useState(false);
  const [fieldError, setFieldError] = useState(false);
  const [choice, setChoice] = useState<null | { deviceBalance: number; deviceCars: number; accountBalance: number; accountCars: number; email: string; token: string }>(null);

  useEffect(() => {
    if (!token || me === null) return;
    void redeem(token);
  }, [token, me]);

  const redeem = async (tok: string, keep?: 'device' | 'account'): Promise<void> => {
    setStatus('Signing you in…');
    try {
      const out = await api.redeem(tok, keep);
      await refreshMe();
      await refreshGarage();
      setStatus(`Signed in as ${out.email}. Your garage is saved.`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'GARAGE_CHOICE_REQUIRED') {
          setChoice({ deviceBalance: me?.guest ? 0 : 0, deviceCars: 0, accountBalance: 0, accountCars: 0, email: '', token: tok });
          return;
        }
        setStatus(err.code === 'MAIL_UNAVAILABLE'
          ? 'We couldn\'t send the email right now. Try again in a minute.'
          : 'This sign-in link has expired or was already used. Send a new one.');
      }
    }
  };

  const send = async (): Promise<void> => {
    setSending(true);
    try {
      await api.sendLink(email);
      setStatus(`Check ${email} for your sign-in link.`);
      setFieldError(false);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'VALIDATION_FAILED') setFieldError(true);
        else if (err.code === 'MAIL_UNAVAILABLE') setStatus('We couldn\'t send the email right now. Try again in a minute.');
      }
    }
    setSending(false);
  };

  return (
    <main className="page" style={{ paddingTop: 24, maxWidth: 520 }}>
      <h1>Sign in</h1>
      <div className="status" role="status" aria-live="polite" style={{ minHeight: '1.5em' }}>{status}</div>
      {fieldError && (
        <div className="alert" role="alert">
          <a href="#email-field" onClick={e => { e.preventDefault(); document.getElementById('email-field')?.focus(); }}>
            Enter a valid email address.
          </a>
        </div>
      )}
      {!token && (
        <form onSubmit={e => { e.preventDefault(); void send(); }} noValidate>
          <label className="field">
            <span className="label">Email</span>
            <input
              id="email-field"
              type="email"
              aria-label="Email"
              value={email}
              onChange={e => { setEmail(e.target.value); setFieldError(false); }}
              aria-invalid={fieldError}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={sending}>
            {sending ? 'Sending…' : 'Send sign-in link'}
          </button>
        </form>
      )}
      {status.startsWith('This sign-in link has expired') && (
        <p><a href="/sign-in" onClick={e => { e.preventDefault(); setStatus(''); navigate('/sign-in'); }}>Send a new one</a></p>
      )}
      {choice && (
        <Dialog title="Keep which garage?" onClose={() => undefined} escapeless initialFocus="first">
          <h2>Keep which garage?</h2>
          <p>Two garages have progress. Which one should be kept?</p>
          <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            <button className="btn" onClick={() => void redeem(choice.token, 'device')}>
              Keep this device's garage
            </button>
            <button className="btn" onClick={() => void redeem(choice.token, 'account')}>
              Keep my account's garage
            </button>
          </div>
        </Dialog>
      )}
      {me && !me.guest && <p>Signed in as {me.email}.</p>}
    </main>
  );
}
