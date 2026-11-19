import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiError } from '../../api/client.ts';
import { act } from '../../api/use-load.ts';
import { navigate, safeNext, useLocation } from '../../router.ts';
import { useSession } from '../../shell/session.tsx';
import { Button } from '../../ui/button.tsx';
import { TextField } from '../../ui/fields.tsx';
import { Status } from '../../ui/live.tsx';
import './signin.css';

function stateCopy(error: ApiError): string {
  if (error.status === 429) return `Too many sign-in attempts. Try again in ${error.retryAfter ?? 1} seconds.`;
  if (error.status === 401) return 'Wrong username or password.';
  if (error.status >= 500) return 'Something went wrong. Try again.';
  return error.fieldMessage() ?? 'Something went wrong. Try again.';
}

export function SignInPage() {
  const { refresh } = useSession();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [state, setState] = useState('');

  const enter = (route: 'login' | 'register') =>
    act(
      async () => {
        await api.post(`/api/auth/${route}`, { username, password });
        await refresh();
        navigate(safeNext(location.query.get('next')) ?? '/workbooks');
      },
      (caught) => {
        setFields(caught.fields);
        setState(stateCopy(caught));
      },
    );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void enter('login');
  };

  return (
    <div className="signin">
      <form className="card signin-card" onSubmit={submit} noValidate>
        <h1>Sign in</h1>
        <TextField label="Username" value={username} onChange={setUsername} autoComplete="username" error={fields.username} />
        <TextField label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" error={fields.password} />
        <Status name="Sign-in state" text={state} />
        <div className="form-actions">
          <Button type="submit" variant="primary">
            Sign in
          </Button>
          <Button onClick={() => void enter('register')}>Create account</Button>
        </div>
      </form>
    </div>
  );
}
