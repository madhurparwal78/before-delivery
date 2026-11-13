import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { copy } from '../../shared/copy.js';
import type { User } from '../../shared/wire.js';
import { Band, Field, PageHeading } from '../components/ui.js';
import { failureOf as apiFailure, post } from '../lib/api.js';
import { raise } from '../lib/announce.js';
import { afterSignIn } from '../lib/redirect.js';
import { Link, navigate } from '../lib/router.js';
import { userStore } from '../lib/user.js';

interface Failure { message: string; fields: Record<string, string> }

const failureOf = (error: unknown): Failure => {
  const failure = apiFailure(error);
  return { message: failure.code === 'VALIDATION' ? copy.fieldErrors : failure.message, fields: failure.fields };
};

export const SignIn = (): JSX.Element => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      const { user } = await post<{ user: User }>('/api/auth/signin', { email, password });
      userStore.set(user);
      navigate(afterSignIn());
    } catch (error) {
      const next = failureOf(error);
      setFailure(next);
      raise(next.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="form" onSubmit={submit} noValidate>
      <PageHeading>Sign in</PageHeading>
      {failure ? <Band>{failure.message}</Band> : null}
      <Field label="Email" error={failure?.fields['email']}>
        {(props) => <input {...props} type="text" inputMode="email" autoComplete="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} />}
      </Field>
      <Field label="Password" error={failure?.fields['password']}>
        {(props) => <input {...props} type="password" autoComplete="current-password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} />}
      </Field>
      <button type="submit" class="button" disabled={busy}>Sign in</button>
      <p>No account yet? <Link href={`/signup${location.search}`}>Create one</Link></p>
    </form>
  );
};

export const SignUp = (): JSX.Element => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      const { user } = await post<{ user: User }>('/api/auth/signup', { email, password, display_name: displayName });
      userStore.set(user);
      navigate(afterSignIn());
    } catch (error) {
      const next = failureOf(error);
      setFailure(next);
      raise(next.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="form" onSubmit={submit} noValidate>
      <PageHeading>Create your account</PageHeading>
      {failure ? <Band>{failure.message}</Band> : null}
      <Field label="Email" error={failure?.fields['email']}>
        {(props) => <input {...props} type="text" inputMode="email" autoComplete="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} />}
      </Field>
      <Field label="Password" error={failure?.fields['password']}>
        {(props) => <input {...props} type="password" autoComplete="new-password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} />}
      </Field>
      <Field label="Display name" error={failure?.fields['display_name']}>
        {(props) => <input {...props} type="text" autoComplete="name" value={displayName} onInput={(e) => setDisplayName(e.currentTarget.value)} />}
      </Field>
      <button type="submit" class="button" disabled={busy}>Create account</button>
      <p>Already have an account? <Link href={`/signin${location.search}`}>Sign in</Link></p>
    </form>
  );
};

export const Follow = (): JSX.Element => {
  const [code, setCode] = useState('');
  return (
    <form
      class="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (code.trim() !== '') navigate(`/live/${encodeURIComponent(code.trim())}`);
      }}
    >
      <PageHeading>Follow a match</PageHeading>
      <p class="muted">Enter the viewer code the scorer shared with you.</p>
      <Field label="Viewer code">
        {(props) => <input {...props} type="text" autoComplete="off" autoCapitalize="off" spellcheck={false} value={code} onInput={(e) => setCode(e.currentTarget.value)} />}
      </Field>
      <button type="submit" class="button">Follow</button>
    </form>
  );
};
