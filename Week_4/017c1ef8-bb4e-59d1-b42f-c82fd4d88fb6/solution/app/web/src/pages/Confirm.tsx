import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { AuthFrame } from '../auth/AuthFrame';
import { CONFIRM_EMAIL_KEY } from '../auth/confirm-email';
import { useSession } from '../session';
import { Alert, Button, Field } from '../ui';

export default function Confirm() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  const location = useLocation();
  const remembered = (location.state as { email?: string } | null)?.email ?? sessionStorage.getItem(CONFIRM_EMAIL_KEY) ?? '';
  const [email, setEmail] = useState(remembered);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setFailure('');
    try {
      await api.post('/api/auth/confirm', { email, code });
      sessionStorage.removeItem(CONFIRM_EMAIL_KEY);
      await refresh();
      navigate('/feed');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422) setError(caught.field('code') ?? '');
      else setFailure('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title="Confirm" lead={remembered ? `We sent a six-digit code to ${remembered}.` : 'Enter the six-digit code we sent you.'}>
      <form className="auth-form" onSubmit={(event) => void submit(event)} noValidate>
        <Alert>{failure}</Alert>
        {remembered ? null : (
          <Field name="email" label="Email" type="email" value={email} autoComplete="email" onChange={(event) => setEmail(event.target.value)} />
        )}
        <Field
          name="code"
          label="Confirmation code"
          value={code}
          error={error}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          onChange={(event) => setCode(event.target.value)}
        />
        <Button type="submit" disabled={busy}>
          Confirm
        </Button>
      </form>
    </AuthFrame>
  );
}
