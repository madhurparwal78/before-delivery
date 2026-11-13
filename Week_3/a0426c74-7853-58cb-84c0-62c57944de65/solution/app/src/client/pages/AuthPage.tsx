import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { onRefusal, sendJson } from '../api.ts';
import { navigate } from '../history.ts';
import { Button, Notice } from '../ui/index.ts';

type Mode = 'signin' | 'register';

const COPY = {
  signin: { title: 'Sign in', path: '/api/auth/login' },
  register: { title: 'Create account', path: '/api/auth/register' },
} as const;

export function AuthPage({ mode }: { mode: Mode }) {
  const copy = COPY[mode];
  const id = useId();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [sentences, setSentences] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    await onRefusal(
      async () => {
        await sendJson<{ username: string }>('POST', copy.path, { username, password });
        navigate('/folders');
      },
      (failure) => {
        setSentences(failure.sentences);
        setBusy(false);
      },
    );
  }

  return (
    <main className="auth">
      <form className="auth-form surface" onSubmit={submit} aria-labelledby={`${id}-title`} noValidate>
        <h1 id={`${id}-title`} className="auth-title">{copy.title}</h1>
        <label className="field-label" htmlFor={`${id}-username`}>Username</label>
        <input
          id={`${id}-username`}
          className="field"
          type="text"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby={`${id}-status`}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
        <label className="field-label" htmlFor={`${id}-password`}>Password</label>
        <input
          id={`${id}-password`}
          className="field"
          type="password"
          name="password"
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          aria-describedby={`${id}-status`}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Button primary type="submit" disabled={busy}>{copy.title}</Button>
        <div id={`${id}-status`} role="status">
          {sentences.length > 0 ? (
            <Notice tone="error">{sentences.map((sentence) => <p key={sentence}>{sentence}</p>)}</Notice>
          ) : null}
        </div>
      </form>
    </main>
  );
}
