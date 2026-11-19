import { useState, type FormEvent } from 'react';
import type { TeacherBody } from '../../shared/wire';
import { api } from '../api';
import { setMe } from '../me';
import { Link, navigate } from '../router';
import { Alert, PageStatus } from '../ui/feedback';
import { Field } from './Field';
import { useAction } from './useAction';
import { Wordmark } from './Wordmark';

export function SignInPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { pending, error, run } = useAction();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const signedIn = await run(() => api<TeacherBody>('POST', '/api/sign-in', { email, password }));
    if (!signedIn) return;
    setMe({ role: 'teacher', ...signedIn.value });
    navigate('/classes');
  };

  return (
    <main className="page narrow">
      <Wordmark />
      <h1>Sign in</h1>
      <form className="panel" onSubmit={(event) => void submit(event)} noValidate>
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        {error ? <Alert>{error}</Alert> : null}
        <div className="form-actions">
          <button type="submit" className="primary" disabled={pending} aria-busy={pending}>
            Sign in
          </button>
        </div>
        <PageStatus text={pending ? 'Saving...' : ''} />
      </form>
      <p className="aside">
        New here? <Link href="/sign-up">Create an account</Link>
      </p>
    </main>
  );
}
