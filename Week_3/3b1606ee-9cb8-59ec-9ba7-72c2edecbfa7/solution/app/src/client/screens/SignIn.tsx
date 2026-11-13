import { useState, type FormEvent } from 'react';
import { ApiFailure } from '../store/api';
import { navigate } from '../store/router';
import { restoreAccount } from '../store/runtime';
import { Slip } from '../ui/Field';
import { Link } from '../ui/Link';
import { Sheet } from '../ui/Sheet';

export function SignIn() {
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function restore(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await restoreAccount(username.trim().toLowerCase(), code);
      navigate('/letters', true);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 429) setProblem('Too many tries. Wait a minute and try again.');
      else if (error instanceof ApiFailure && (error.status === 401 || error.status === 422)) setProblem("That username and recovery code don't match.");
      else setProblem('Something went wrong. Try again.');
    }
    setBusy(false);
  }

  return (
    <main className="auth">
      <Sheet className="sheet--auth">
        <header className="auth__head">
          <Link to="/" className="monogram" aria-label="Hp, Halfpenny Post Co.">
            Hp
          </Link>
          <h1>Sign in</h1>
        </header>
        <form className="panel" onSubmit={(event) => void restore(event)}>
          <label className="field" htmlFor="restore-username">
            Username
          </label>
          <div className="well">
            <input id="restore-username" type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={username} onChange={(event) => setUsername(event.target.value)} />
          </div>
          <label className="field" htmlFor="restore-code">
            Recovery code
          </label>
          <div className="well">
            <input id="restore-code" type="text" autoCapitalize="characters" autoCorrect="off" spellCheck={false} value={code} aria-describedby={problem ? 'restore-problem' : undefined} onChange={(event) => setCode(event.target.value)} />
          </div>
          {problem && <Slip id="restore-problem">{problem}</Slip>}
          <button type="submit" className="button button--ink" aria-busy={busy || undefined} disabled={busy}>
            Restore account
          </button>
        </form>
      </Sheet>
    </main>
  );
}

export function SignedOut() {
  return (
    <main className="auth">
      <Sheet className="sheet--auth">
        <header className="auth__head">
          <h1>Signed out</h1>
        </header>
        <div className="panel">
          <p>This account was restored in another browser, so this browser is signed out.</p>
          <Link to="/signin" className="button button--ink">
            Sign in
          </Link>
        </div>
      </Sheet>
    </main>
  );
}
