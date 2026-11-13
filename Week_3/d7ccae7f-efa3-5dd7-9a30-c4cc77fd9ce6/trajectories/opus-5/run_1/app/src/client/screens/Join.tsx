import { useState } from 'react';
import type { JoinResult } from '../../shared/protocol';
import { api } from '../lib/api';
import { copy, joinFailureMessage } from '../lib/copy';
import { Link, useRouter } from '../lib/router';
import { rememberRejoinToken } from '../lib/seat';
import { FieldError, StatusRegion, describedBy } from '../components';

export function Join(): JSX.Element {
  const { navigate } = useRouter();
  const [pin, setPin] = useState('');
  const [nickname, setNickname] = useState('');
  const [status, setStatus] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFields({});
    setStatus(copy.joining);
    const result = await api.post<JoinResult>('/api/rooms/join', { pin, nickname });
    if (result.ok) {
      rememberRejoinToken(result.data.roomId, result.data.rejoinToken);
      navigate(`/play/${result.data.roomId}`);
      return;
    }
    setBusy(false);
    setFields(result.failure.fields);
    setStatus(joinFailureMessage(result.failure));
  };

  return (
    <main className="column">
      <h1 className="wordmark">Lastbell</h1>
      <p className="sub">Trivia night, one thumb at a time.</p>
      <form className="form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="join-pin">Room PIN</label>
          <input
            id="join-pin"
            className="pin-input"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9]*"
            maxLength={6}
            value={pin}
            aria-describedby={describedBy('join-pin-error', fields['pin'])}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
          />
          <FieldError id="join-pin-error" message={fields['pin']} />
        </div>
        <div className="field">
          <label htmlFor="join-nickname">Nickname</label>
          <input
            id="join-nickname"
            type="text"
            autoComplete="off"
            maxLength={20}
            value={nickname}
            aria-describedby={describedBy('join-nickname-error', fields['nickname'])}
            onChange={(event) => setNickname(event.target.value)}
          />
          <FieldError id="join-nickname-error" message={fields['nickname']} />
        </div>
        <button className="button button-primary" type="submit" disabled={busy}>
          Join the night
        </button>
      </form>
      <StatusRegion label="Join status" text={status} />
      <p className="footer-link">
        <Link to="/host/login">Quizmaster sign in</Link>
      </p>
    </main>
  );
}
