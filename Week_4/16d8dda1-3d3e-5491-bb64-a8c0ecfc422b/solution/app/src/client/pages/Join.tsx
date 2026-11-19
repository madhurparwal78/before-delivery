import { useState, type FormEvent } from 'react';
import type { JoinBody } from '../../shared/wire';
import { api, ApiError } from '../api';
import { Link, navigate } from '../router';
import { Alert, PageStatus } from '../ui/feedback';
import { Field } from './Field';
import { useAction } from './useAction';
import { Wordmark } from './Wordmark';

const UNKNOWN_CODE = "That code doesn't match a class.";

export function JoinPage() {
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [unknown, setUnknown] = useState(false);
  const { pending, error, run } = useAction();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setUnknown(false);
    const joined = await run(async () => {
      try {
        return await api<JoinBody>('POST', '/api/join', { code, displayName });
      } catch (failure) {
        if (failure instanceof ApiError && failure.status === 404) setUnknown(true);
        throw failure;
      }
    });
    if (joined) navigate(`/sessions/${joined.value.sessionId}`);
  };

  return (
    <main className="page narrow">
      <Wordmark />
      <h1>Join a class</h1>
      <form className="panel" onSubmit={(event) => void submit(event)} noValidate>
        <Field label="Class code" value={code} onChange={setCode} autoComplete="off" hint="Your teacher gives you six letters and digits." />
        <Field label="Your name" value={displayName} onChange={setDisplayName} autoComplete="name" />
        {unknown ? <Alert>{UNKNOWN_CODE}</Alert> : error ? <Alert>{error}</Alert> : null}
        <div className="form-actions">
          <button type="submit" className="primary" disabled={pending} aria-busy={pending}>
            Join
          </button>
        </div>
        <PageStatus text={pending ? 'Saving...' : ''} />
      </form>
      <p className="aside">
        Teaching a class? <Link href="/sign-in">Teacher sign in</Link>
      </p>
    </main>
  );
}
