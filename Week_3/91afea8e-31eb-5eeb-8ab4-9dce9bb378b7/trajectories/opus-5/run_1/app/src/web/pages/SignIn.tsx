/** Sign-in, sign-up, the code step and forgot-password. */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiFailure } from '../api.ts';
import { Link, useRouter } from '../router.tsx';
import { useCart, useSession } from '../state.tsx';
import { PendingButton, StatusRegion, Timer, useCountdown } from '../components/ui.tsx';
import { NoiseBackdrop } from '../effects/decor.tsx';
import { COPY, errorMessage } from '../../shared/messages.js';
import type { Account } from '../../shared/types.js';

const RESEND_KEY = 'chauraha_resend_until';
const NEXT_KEY = 'chauraha_next';

function keepNext(search: string): string | null {
  const next = new URLSearchParams(search).get('next');
  if (next !== null && next.startsWith('/') && !next.startsWith('//')) {
    sessionStorage.setItem(NEXT_KEY, next);
    return next;
  }
  return sessionStorage.getItem(NEXT_KEY);
}

function landing(role: Account['role']): string {
  return role === 'seller' ? '/seller/shipments' : role === 'support' ? '/support' : '/';
}

function startResendWindow(seconds: number): void {
  sessionStorage.setItem(
    RESEND_KEY,
    new Date(Date.now() + seconds * 1000).toISOString(),
  );
}

export function SignInPage(): ReactNode {
  const { search, navigate } = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState(() =>
    sessionStorage.getItem('chauraha_signed_out') === '1' ? errorMessage('signed_out') : '',
  );

  useEffect(() => {
    sessionStorage.removeItem('chauraha_signed_out');
    keepNext(search);
  }, [search]);

  const submit = async (): Promise<void> => {
    try {
      const response = await api<{ message: string; resend_in: number }>('/api/auth/signin', {
        method: 'POST',
        body: { identifier, password },
      });
      setStatus(response.message);
      startResendWindow(response.resend_in);
      navigate('/signin/code');
    } catch (error) {
      if (error instanceof ApiFailure) setStatus(error.body.message);
    }
  };

  return (
    <>
      <NoiseBackdrop />
      <h1>sign in</h1>
      <section className="panel">
        <label htmlFor="identifier">Email or phone</label>
        <input
          id="identifier"
          type="text"
          aria-label="Email or phone"
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          aria-label="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <PendingButton label="Continue" onPress={submit} />
        <StatusRegion name="Sign-in status" message={status} />
        <p>
          <Link to="/forgot">Forgot password?</Link>
        </p>
        <p>
          <Link to="/signup">new here? sign up</Link>
        </p>
      </section>
    </>
  );
}

export function SignUpPage(): ReactNode {
  const { navigate } = useRouter();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [status, setStatus] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (): Promise<void> => {
    try {
      const response = await api<{ message: string }>('/api/auth/signup', {
        method: 'POST',
        body: {
          name: form.name,
          email: form.email,
          phone: form.phone.startsWith('+91') ? form.phone : `+91${form.phone}`,
          password: form.password,
        },
      });
      setStatus(response.message);
      setErrors({});
      startResendWindow(30);
      navigate('/signup/code');
    } catch (error) {
      if (error instanceof ApiFailure) {
        setStatus(error.body.message);
        setErrors(error.body.errors ?? {});
      }
    }
  };

  return (
    <>
      <NoiseBackdrop />
      <h1>sign up</h1>
      <section className="panel">
        {Object.entries({
          name: 'Name',
          email: 'Email',
          phone: 'Phone',
          password: 'Password',
        }).map(([field, label]) => (
          <div key={field}>
            <label htmlFor={`signup-${field}`}>{label}</label>
            <input
              id={`signup-${field}`}
              type={field === 'password' ? 'password' : 'text'}
              aria-label={label}
              value={form[field as keyof typeof form]}
              onChange={(event) => setForm({ ...form, [field]: event.target.value })}
            />
            {errors[field] === undefined ? null : (
              <p className="panel panel-pink">{errors[field]}</p>
            )}
          </div>
        ))}
        <PendingButton label="Continue" onPress={submit} />
        <StatusRegion name="Sign-in status" message={status} />
      </section>
    </>
  );
}

export function CodePage({ kind }: { kind: 'signin' | 'signup' }): ReactNode {
  const { search, navigate } = useRouter();
  const { reload } = useSession();
  const { mergeGuestCart } = useCart();
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<string>(
    kind === 'signin' ? COPY.codeSent : COPY.codeMaybeSent,
  );
  const [until, setUntil] = useState<string | null>(() => sessionStorage.getItem(RESEND_KEY));
  const left = useCountdown(until, null);

  const verify = async (): Promise<void> => {
    try {
      const response = await api<{ account: Account }>(`/api/auth/${kind}/verify`, {
        method: 'POST',
        body: { code },
      });
      await mergeGuestCart();
      await reload();
      const next = keepNext(search);
      sessionStorage.removeItem(NEXT_KEY);
      navigate(next ?? landing(response.account.role));
    } catch (error) {
      if (error instanceof ApiFailure) setStatus(error.body.message);
    }
  };

  const resend = async (): Promise<void> => {
    try {
      const response = await api<{ resend_in: number }>('/api/auth/code/resend', {
        method: 'POST',
        body: {},
      });
      startResendWindow(response.resend_in);
      setUntil(sessionStorage.getItem(RESEND_KEY));
      setStatus(COPY.codeSent);
    } catch (error) {
      if (error instanceof ApiFailure) setStatus(error.body.message);
    }
  };

  return (
    <>
      <NoiseBackdrop />
      <h1>enter the code</h1>
      <section className="panel">
        <label htmlFor="code">6-digit code</label>
        <input
          id="code"
          type="text"
          aria-label="6-digit code"
          inputMode="numeric"
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <div className="row">
          <PendingButton label="Verify" onPress={verify} />
          <button type="button" className="btn btn-quiet" disabled={left > 0} onClick={() => void resend()}>
            {left > 0 ? `resend in ${left}s` : 'Resend code'}
          </button>
          <Timer name="Resend countdown" seconds={left} />
        </div>
        <StatusRegion name="Sign-in status" message={status} />
      </section>
    </>
  );
}

export function ForgotPage(): ReactNode {
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const { navigate } = useRouter();

  return (
    <>
      <NoiseBackdrop />
      <h1>forgot password</h1>
      <section className="panel">
        <label htmlFor="forgot-identifier">Email or phone</label>
        <input
          id="forgot-identifier"
          type="text"
          aria-label="Email or phone"
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
        />
        <PendingButton
          label="Continue"
          onPress={async () => {
            try {
              const response = await api<{ message: string }>('/api/auth/password/forgot', {
                method: 'POST',
                body: { identifier },
              });
              setStatus(response.message);
            } catch (error) {
              if (error instanceof ApiFailure) setStatus(error.body.message);
            }
          }}
        />
        <label htmlFor="forgot-code">6-digit code</label>
        <input
          id="forgot-code"
          type="text"
          aria-label="6-digit code"
          inputMode="numeric"
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <label htmlFor="forgot-password">New password</label>
        <input
          id="forgot-password"
          type="password"
          aria-label="New password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <PendingButton
          label="Reset password"
          onPress={async () => {
            try {
              await api('/api/auth/password/reset', {
                method: 'POST',
                body: { identifier, code, new_password: password },
              });
              navigate('/signin');
            } catch (error) {
              if (error instanceof ApiFailure) setStatus(error.body.message);
            }
          }}
        />
        <StatusRegion name="Sign-in status" message={status} />
      </section>
    </>
  );
}
