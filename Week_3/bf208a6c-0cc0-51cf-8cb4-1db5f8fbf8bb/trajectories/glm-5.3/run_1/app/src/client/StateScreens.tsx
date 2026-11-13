import { useState } from 'react';
import type { JSX } from 'react';

interface StateScreenProps {
  navigate: (path: string) => void;
  me: { id: string; display_name: string } | null;
}

export function NotFoundScreen({ navigate, me }: StateScreenProps): JSX.Element {
  return (
    <main className="not-found">
      <h1>Board not found</h1>
      <p>This board doesn't exist, or you don't have access to it.</p>
      <p>
        <a href="/">Go home</a>
      </p>
      {me && (
        <button
          className="btn secondary"
          name="Sign out"
          onClick={() => {
            void fetch('/api/auth/signout', { method: 'POST' }).then(() => {
              navigate('/');
              location.reload();
            });
          }}
        >
          Sign out
        </button>
      )}
    </main>
  );
}

export function PasswordScreen({
  onSubmit,
  alert,
}: {
  onSubmit: (password: string) => void;
  alert: string;
}): JSX.Element {
  const [password, setPassword] = useState('');
  return (
    <main className="password-screen">
      <h1>This board is password protected</h1>
      <label>
        <span className="hint">Board password</span>
        <input
          className="field"
          name="Board password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit(password);
          }}
        />
      </label>
      <button className="btn" name="Open board" onClick={() => onSubmit(password)}>
        Open board
      </button>
      <div className="alert" data-shown={alert ? 'true' : 'false'} role="alert">
        {alert}
      </div>
    </main>
  );
}
