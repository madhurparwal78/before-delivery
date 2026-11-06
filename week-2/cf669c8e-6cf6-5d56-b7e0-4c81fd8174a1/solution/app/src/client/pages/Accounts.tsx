import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Country, User } from '../../shared/types.js';
import { ApiError, post } from '../api.js';
import { ErrorSummary, Field } from '../components/Form.js';
import { Link, navigate } from '../router.js';
import { useSession } from '../session.js';

const COUNTRIES: Country[] = ['NL', 'BE', 'DE', 'LU'];

export function SignIn(): ReactNode {
  const { signedIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { document.title = 'Sign in · Ommezwaai Feeler'; }, []);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const user = await post<User>('/api/auth/sign-in', { email, password }, { poll: true });
      signedIn(user);
      navigate(user.landing);
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 401 ? 'Email or password is wrong.' : 'Could not sign in. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page narrow-page">
      <h1>Sign in</h1>
      <form className="stack ruled" aria-label="Sign in" onSubmit={(e) => { void submit(e); }} noValidate>
        <Field name="email" label="Email">
          {(p) => <input {...p} type="email" role="textbox" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />}
        </Field>
        <Field name="password" label="Password">
          {(p) => <input {...p} type="password" role="textbox" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
        </Field>
        {error ? <p className="field-error" role="alert">{error}</p> : null}
        <div className="row-actions">
          <button type="submit" className="btn primary" aria-busy={busy}>Sign in</button>
        </div>
      </form>
      <p>New here? <Link to="/register">Register</Link> to pay in stages and book test rides.</p>
    </section>
  );
}

export function Register(): ReactNode {
  const { signedIn } = useSession();
  const [form, setForm] = useState<{ email: string; password: string; name: string; country: Country }>({ email: '', password: '', name: '', country: 'NL' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { document.title = 'Register · Ommezwaai Feeler'; }, []);
  const set = (key: keyof typeof form) => (value: string): void => setForm((was) => ({ ...was, [key]: value }));

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const user = await post<User>('/api/auth/register', form, { poll: true });
      signedIn(user);
      navigate(user.landing);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422) setErrors(caught.fields);
      else if (caught instanceof ApiError && caught.code === 'email_taken') setErrors({ email: 'That email already has an account.' });
      else setErrors({ email: 'Could not register. Try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page narrow-page">
      <h1>Register</h1>
      <ErrorSummary errors={errors} />
      <form className="stack ruled" aria-label="Register" onSubmit={(e) => { void submit(e); }} noValidate>
        <Field name="email" label="Email" error={errors['email']}>
          {(p) => <input {...p} type="email" role="textbox" autoComplete="username" value={form.email} onChange={(e) => set('email')(e.target.value)} required />}
        </Field>
        <Field name="password" label="Password" error={errors['password']} hint="At least 10 characters.">
          {(p) => <input {...p} type="password" role="textbox" autoComplete="new-password" value={form.password} onChange={(e) => set('password')(e.target.value)} required />}
        </Field>
        <Field name="name" label="Name" error={errors['name']}>
          {(p) => <input {...p} type="text" autoComplete="name" value={form.name} onChange={(e) => set('name')(e.target.value)} required />}
        </Field>
        <Field name="country" label="Country" error={errors['country']}>
          {(p) => (
            <select {...p} value={form.country} onChange={(e) => set('country')(e.target.value)}>
              {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </Field>
        <div className="row-actions">
          <button type="submit" className="btn primary" aria-busy={busy}>Register</button>
        </div>
      </form>
      <p>Already registered? <Link to="/sign-in">Sign in</Link>.</p>
    </section>
  );
}
