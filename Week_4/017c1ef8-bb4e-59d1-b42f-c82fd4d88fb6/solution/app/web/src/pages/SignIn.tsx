import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { AuthFrame } from '../auth/AuthFrame';
import { useSession } from '../session';
import { Alert, Button, Field } from '../ui';

export default function SignIn() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem('');
    try {
      await api.post('/api/auth/signin', { email, password });
      await refresh();
      navigate('/feed');
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) setProblem("That email and password don't match.");
      else if (error instanceof ApiError && error.status === 409) setProblem('Confirm your email first. We sent you a code.');
      else setProblem('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title="Sign in">
      <form className="auth-form" onSubmit={(event) => void submit(event)} noValidate>
        <Alert>{problem}</Alert>
        <Field name="email" label="Email" type="email" value={email} autoComplete="email" spellCheck={false} onChange={(event) => setEmail(event.target.value)} />
        <Field
          name="password"
          label="Password"
          type="password"
          role="textbox"
          value={password}
          autoComplete="current-password"
          onChange={(event) => setPassword(event.target.value)}
        />
        <Button type="submit" disabled={busy}>
          Sign in
        </Button>
      </form>
      <p className="auth-aside">
        New here? <Link to="/join">Join</Link>
      </p>
    </AuthFrame>
  );
}
