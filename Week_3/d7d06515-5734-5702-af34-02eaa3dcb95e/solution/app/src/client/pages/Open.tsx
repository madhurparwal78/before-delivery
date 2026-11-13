// /open: opens a pasted share link or a bare token (brief: Pages).
import { useState, type FormEvent } from 'react';
import { navigate } from '../router.tsx';
import { TextField } from '../ui/Field.tsx';
import { LINK_END_HEADINGS } from './LinkEnded.tsx';
import { PublicShell } from './PublicShell.tsx';

const TOKEN = /^[A-Za-z0-9_-]+$/;
const LINK_PATH = /\/s\/([A-Za-z0-9_-]+)/;

function tokenOf(input: string): string | null {
  const text = input.trim();
  const inLink = LINK_PATH.exec(text);
  if (inLink?.[1]) return inLink[1];
  return TOKEN.test(text) ? text : null;
}

export function Open() {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const token = tokenOf(value);
    if (token) navigate(`/s/${token}`);
    else setError(LINK_END_HEADINGS.invalid);
  };

  return (
    <PublicShell>
      <h1>Open a shared drawing</h1>
      <p className="muted lead">Paste the link from your invite email.</p>
      <form aria-label="Open a shared drawing" noValidate onSubmit={submit} className="form">
        <TextField label="Share link" value={value} onChange={(next) => { setValue(next); setError(''); }} error={error} />
        <button type="submit" className="btn btn-primary btn-wide">Open</button>
      </form>
    </PublicShell>
  );
}
