import { useState, type FormEvent, type ReactNode } from 'react';
import type { UserBody } from '../../shared/api.js';
import { api, failureOf } from '../api.js';
import { Chrome } from '../components/Chrome.js';
import { Field } from '../components/Field.js';
import { clearError, raise } from '../notices.js';
import { navigate, useLocation } from '../router.js';
import { safeNext } from '../safeNext.js';
import { useSession } from '../session.js';

export function Auth({ mode }: { mode: 'signin' | 'signup' }): ReactNode {
  const { setUsername } = useSession();
  const { query } = useLocation();
  const [username, setName] = useState('');
  const [password, setPassword] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    clearError();
    setFields({});
    setBusy(true);
    try {
      const body = await api.post<UserBody>(`/api/auth/${signup ? 'signup' : 'signin'}`, { username, password });
      setUsername(body.user.username);
      navigate(safeNext(query.get('next'), '/t'));
    } catch (error) {
      const failure = failureOf(error);
      if (failure.body.fields) setFields(failure.body.fields);
      raise(failure.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Chrome>
      <form className="form-card" onSubmit={(event) => void submit(event)}>
        <h1 className="form-title">{signup ? 'Create your account' : 'Sign in'}</h1>
        <Field label="Username" error={fields['username']}>
          {(props) => <input {...props} type="text" name="username" autoComplete="username" value={username} autoCapitalize="none"
            spellCheck={false} onChange={(event) => setName(event.target.value)} />}
        </Field>
        <Field label="Password" error={fields['password']}>
          {(props) => <input {...props} type="password" name="password" autoComplete={signup ? 'new-password' : 'current-password'}
            value={password} onChange={(event) => setPassword(event.target.value)} />}
        </Field>
        <button type="submit" className="btn" disabled={busy}>{signup ? 'Create account' : 'Sign in'}</button>
      </form>
    </Chrome>
  );
}
