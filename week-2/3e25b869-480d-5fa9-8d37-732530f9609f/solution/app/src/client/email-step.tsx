// The email step: request a one-time code, verify it, then collapse to "Signed in as".
import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from './api';
import { useCopy } from './state';
import { Field } from './ui';

type Alert = 'locked' | 'rate' | null;

export function EmailStep({
  purpose,
  signedInAs,
  onVerified,
  announce,
}: {
  purpose: 'checkout' | 'sign_in';
  signedInAs: string | null;
  onVerified: (email: string) => void;
  announce: (text: string) => void;
}) {
  const { m } = useCopy();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; code?: string }>({});
  const [alert, setAlert] = useState<Alert>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (alert) alertRef.current?.focus();
  }, [alert]);

  if (signedInAs) return <p class="signed-in">{m.signedInAs(signedInAs)}</p>;

  const send = async () => {
    if (sending) return;
    setSending(true);
    const r = await api<{ status: string }>('POST', '/api/auth/code', { email, purpose });
    setSending(false);
    if (r.ok) {
      setErrors({});
      if (alert === 'rate') setAlert(null);
      announce(m.codeRequested(email.trim()));
    } else if (r.status === 429) {
      setAlert('rate');
    } else if (r.status === 0) announce(m.network);
    else setErrors({ email: r.error.fields?.email ?? r.error.message });
  };

  const verify = async () => {
    if (checking) return;
    setChecking(true);
    const r = await api<{ customer: { email: string } }>('POST', '/api/auth/verify', { email, code });
    setChecking(false);
    if (r.ok) {
      setErrors({});
      setAlert(null);
      onVerified(r.data.customer.email);
    } else if (r.status === 429) {
      setAlert('locked');
    } else if (r.status === 0) announce(m.network);
    else setErrors({ email: r.error.fields?.email, code: r.error.fields?.code ?? r.error.message });
  };

  return (
    <fieldset class="group email-step">
      <legend>{m.emailStep}</legend>
      {alert && (
        <div role="alert" aria-labelledby="stepup-alert-title" tabIndex={-1} ref={alertRef} class="summary">
          <h2 id="stepup-alert-title" class="summary-title">
            {alert === 'locked' ? m.lockedName : m.rateName}
          </h2>
          <p>{alert === 'locked' ? m.lockedCopy : m.rateCopy}</p>
        </div>
      )}
      <div class="field-row with-button">
        <Field
          id="f-email"
          label={m.email}
          type="email"
          autocomplete="email"
          value={email}
          onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
          error={errors.email}
        />
        <button type="button" class="button secondary" aria-disabled={sending ? 'true' : undefined} aria-busy={sending ? 'true' : undefined} onClick={send}>
          {sending ? m.sending : m.sendCode}
        </button>
      </div>
      <div class="field-row with-button">
        <Field
          id="f-code"
          label={m.code}
          inputMode="numeric"
          autocomplete="one-time-code"
          value={code}
          onInput={(e) => setCode((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void verify();
            }
          }}
          error={errors.code}
        />
        <button type="button" class="button secondary" aria-disabled={checking ? 'true' : undefined} aria-busy={checking ? 'true' : undefined} onClick={verify}>
          {checking ? m.checking : m.verify}
        </button>
      </div>
    </fieldset>
  );
}
