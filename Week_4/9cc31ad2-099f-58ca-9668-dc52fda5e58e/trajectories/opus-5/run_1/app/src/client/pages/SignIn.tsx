import { useEffect, useRef, useState, type FormEvent } from 'react';
import { apiPost } from '../api.js';
import { Dialog } from '../components/Dialog.js';
import { Page } from '../components/Page.js';
import { copy, signedIn, signinSent } from '../copy.js';
import { Link } from '../router.js';
import { refreshMe, useMe } from '../store.js';

export function SignIn() {
  const { me } = useMe();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');
  const [fieldError, setFieldError] = useState(false);
  const [sending, setSending] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    const result = await apiPost<{ status: string }>('/v1/auth/links', { email });
    setSending(false);
    if (result.kind === 'ok') {
      setFieldError(false);
      setStatus(signinSent(email));
      return;
    }
    if (result.kind === 'error' && result.status === 422) {
      setFieldError(true);
      setStatus('');
      return;
    }
    setFieldError(false);
    setStatus(copy.mailOutage);
  };

  return (
    <Page gutter={['Email', 'Status']} brandOnly={me === null}>
      <h1>Save my garage</h1>
      {fieldError && (
        <div role="alert" className="cell">
          <a
            href="#email"
            onClick={(event) => {
              event.preventDefault();
              field.current?.focus();
            }}
          >
            {copy.emailInvalid}
          </a>
        </div>
      )}
      <form className="inline-form" onSubmit={submit} noValidate>
        <label className="filter-field">
          <span className="label">Email</span>
          <input
            id="email"
            ref={field}
            type="email"
            aria-label="Email"
            aria-invalid={fieldError}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <button type="submit" className="primary" disabled={sending}>
          {sending ? copy.sending : 'Send sign-in link'}
        </button>
      </form>
      {fieldError && <p>{copy.emailInvalid}</p>}
      <div className="cell" role="status" aria-label="Sign-in status">
        {status}
      </div>
    </Page>
  );
}

export function SignInRedeem({ token }: { token: string }) {
  const { me } = useMe();
  const [status, setStatus] = useState(copy.signingIn);
  const [choice, setChoice] = useState<{ device: string; account: string } | null>(null);
  const [expired, setExpired] = useState(false);
  const firstButton = useRef<HTMLButtonElement>(null);

  const redeem = async (keep?: 'device' | 'account') => {
    const result = await apiPost<{ playerId: string; email: string; outcome: string }>(
      '/v1/auth/redeem',
      keep === undefined ? { token } : { token, keep },
    );
    if (result.kind === 'ok') {
      setChoice(null);
      await refreshMe();
      setStatus(signedIn(result.data.email));
      return;
    }
    if (result.kind === 'error' && result.body.error.code === 'GARAGE_CHOICE_REQUIRED') {
      setChoice({
        device: result.body.fields?.device ?? '',
        account: result.body.fields?.account ?? '',
      });
      setStatus(copy.signingIn);
      return;
    }
    setExpired(true);
    setStatus(copy.linkExpired);
  };

  useEffect(() => {
    void redeem();
  }, []);

  useEffect(() => {
    if (choice !== null) firstButton.current?.focus();
  }, [choice]);

  return (
    <Page gutter={['Sign-in']} brandOnly={me === null}>
      <h1>Sign in</h1>
      <div className="cell" role="status" aria-label="Sign-in status">
        {status}{' '}
        {expired && (
          <Link to="/sign-in">{copy.sendANewOne}</Link>
        )}
      </div>
      {!expired && choice === null && (
        <Link to="/garage" className="secondary">
          Back to garage
        </Link>
      )}
      {choice !== null && (
        <Dialog label="Keep which garage?" onEscape={null}>
          <h2>Keep which garage?</h2>
          <p>This device&apos;s garage: {choice.device}</p>
          <p>Your account&apos;s garage: {choice.account}</p>
          <div className="dialog-actions">
            <button
              type="button"
              className="primary"
              ref={firstButton}
              onClick={() => void redeem('device')}
            >
              Keep this device&apos;s garage
            </button>
            <button type="button" className="secondary" onClick={() => void redeem('account')}>
              Keep my account&apos;s garage
            </button>
          </div>
        </Dialog>
      )}
    </Page>
  );
}
