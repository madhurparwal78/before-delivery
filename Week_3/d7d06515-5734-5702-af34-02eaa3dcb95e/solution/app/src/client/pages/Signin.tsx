// /signin: the Sign in form (brief: Account). Every refusal shows in the form's alert.
import { useState, type FormEvent } from 'react';
import { post } from '../api.ts';
import { Link, navigate } from '../router.tsx';
import { TextField } from '../ui/Field.tsx';
import { signinFailure } from './errors.ts';
import { PublicShell } from './PublicShell.tsx';
import { ResendButton } from './ResendButton.tsx';

export function Signin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<{ message: string; unconfirmedEmail?: string } | null>(null);
  const [resent, setResent] = useState<{ message: string; accepted: boolean } | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setRefusal(null);
    setResent(null);
    try {
      await post('/api/auth/signin', { email, password });
      navigate('/drawings');
    } catch (error) {
      setRefusal(signinFailure(error));
      setPending(false);
    }
  };

  return (
    <PublicShell>
      <h1>Sign in to Corbel Draft</h1>
      <form aria-label="Sign in" noValidate onSubmit={(event) => void submit(event)} className="form">
        <TextField label="Email" kind="email" value={email} onChange={setEmail} autoComplete="email" />
        <TextField label="Password" kind="secret" value={password} onChange={setPassword} autoComplete="current-password" />
        {refusal ? <p role="alert" className="form-error">{refusal.message}</p> : null}
        {refusal?.unconfirmedEmail ? (
          <div className="form-actions">
            <ResendButton
              label="Resend link"
              target={{ email: refusal.unconfirmedEmail }}
              email={refusal.unconfirmedEmail}
              onResult={(message, accepted) => setResent({ message, accepted })}
            />
          </div>
        ) : null}
        {resent ? <p className={resent.accepted ? 'success-copy' : 'form-error'}>{resent.message}</p> : null}
        <button type="submit" className="btn btn-primary btn-wide" aria-disabled={pending || undefined}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="fine-print">New here? <Link to="/signup">Create an account</Link></p>
    </PublicShell>
  );
}
