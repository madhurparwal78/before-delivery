import { useState, type FormEvent } from 'react';
import type { TeacherBody } from '../../shared/wire';
import { api } from '../api';
import { setMe } from '../me';
import { Link, navigate } from '../router';
import { Alert, PageStatus } from '../ui/feedback';
import { Field } from './Field';
import { useAction } from './useAction';
import { Wordmark } from './Wordmark';

export function SignUpPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const { pending, error, run } = useAction();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const created = await run(() => api<TeacherBody>('POST', '/api/teachers', { email, password, displayName }));
    if (!created) return;
    setMe({ role: 'teacher', ...created.value });
    navigate('/classes');
  };

  return (
    <main className="page narrow">
      <Wordmark />
      <h1>Create your teacher account</h1>
      <form className="panel" onSubmit={(event) => void submit(event)} noValidate>
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password" hint="Use at least 10 characters." />
        <Field label="Your name" value={displayName} onChange={setDisplayName} autoComplete="name" />
        {error ? <Alert>{error}</Alert> : null}
        <div className="form-actions">
          <button type="submit" className="primary" disabled={pending} aria-busy={pending}>
            Create account
          </button>
        </div>
        <PageStatus text={pending ? 'Saving...' : ''} />
      </form>
      <p className="aside">
        Already teaching here? <Link href="/sign-in">Sign in</Link>
      </p>
    </main>
  );
}
