import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { ContestRecord, Guess } from '../../shared/api';
import { apiPath, request } from '../api';
import { FIELD_COPY, OUTAGE_COPY, refusalCopy } from '../copy';
import { grouped, venueCutoff } from '../format';
import { useLiveRefresh, useTitle } from '../hooks';
import { signInPath, useRouter } from '../router';
import { useApp } from '../state';
import { Loading } from '../components/chrome';
import { ErrorSummary, Field, wholeNumber, type FieldErrors } from '../components/forms';

const GUESS_MAX = 100_000_000;
const PRIZES = [
  ['1st Place', '10,000 credits'],
  ['2nd Place', '5,000 credits'],
  ['3rd Place', '1,000 credits'],
] as const;

function OwnGuess({ guess }: { guess: Guess | null }) {
  return guess ? <p className="own-guess">Your guess: {grouped(guess.value)} TPS</p> : null;
}

export function RecordPage() {
  useTitle('Call the number');
  const { auth, viewer, dropAuth } = useApp();
  const { place, navigate } = useRouter();
  const token = auth?.token ?? null;
  const [record, setRecord] = useState<ContestRecord | null>(null);
  const [outage, setOutage] = useState(false);
  const [value, setValue] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const fetchRecord = useCallback(async () => {
    const result = await request<ContestRecord>(apiPath('/record'), { token });
    if (result.ok) {
      setRecord(result.data);
      setOutage(false);
    } else setOutage(true);
  }, [token]);

  useEffect(() => {
    void fetchRecord();
  }, [fetchRecord]);
  useLiveRefresh(() => {
    if (!sending) void fetchRecord();
  }, true);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;
    if (!auth) {
      navigate(signInPath(place));
      return;
    }
    const guess = wholeNumber(value);
    if (guess === null || guess < 1 || guess > GUESS_MAX) {
      setErrors({ value: FIELD_COPY.wholeGuess });
      setAttempt((count) => count + 1);
      return;
    }
    setErrors({});
    setSending(true);
    setMessage('Sending guess…');
    const result = await request<{ guess: Guess }>(apiPath('/record/guesses'), { method: 'POST', token: auth.token, body: { value: guess } });
    if (result.ok) {
      setMessage('Guess received. Good luck.');
    } else if (result.error.code === 'invalid') {
      setMessage('');
      setErrors({ value: result.error.fields?.value ?? FIELD_COPY.wholeGuess });
      setAttempt((count) => count + 1);
    } else {
      if (result.error.code === 'unauthenticated') dropAuth();
      setMessage(result.error.code === 'unavailable' ? OUTAGE_COPY : refusalCopy(result.error.code));
    }
    await fetchRecord();
    setSending(false);
  };

  const mayGuess = viewer !== 'organiser';
  return (
    <section className="record-page">
      <header className="record-hero">
        <p className="eyebrow eyebrow-dark">TPS Record</p>
        <p className="record-headline">Live at Keel Outpost, we're going after our own record.</p>
        <p className="record-body">
          On July 4th we pushed the network to 6M+ transactions per second through a live experiment. On day one of Keel Outpost we run
          it again, live, on the main stage.
        </p>
      </header>
      {!record && <div className="page">{outage ? <p className="helper">{OUTAGE_COPY}</p> : <Loading />}</div>}
      {record && (
      <div className="page record-main">
        <div className="record-intro">
          <h1 className="contest-title">Call the number</h1>
          <p className="helper">Submit one guess. Closest to the final figure takes first place.</p>
          <ol className="prizes">
            {PRIZES.map(([place_, prize]) => (
              <li key={place_}>
                <span className="prize-place">{place_}</span> <span className="prize-amount">{prize}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="record-state">
          <p className="contest-messages" role="status" aria-label="Contest messages">
            {message}
          </p>
          {record.status === 'open' && (
            <>
              <p className="closing-line">Guessing closes {venueCutoff(record.closes_at)} Port Ashby time.</p>
              {record.my_guess ? (
                <OwnGuess guess={record.my_guess} />
              ) : (
                mayGuess && (
                  <form className="guess-form" noValidate onSubmit={(event) => void submit(event)}>
                    <ErrorSummary errors={errors} ids={{ value: 'guess-value' }} attempt={attempt} />
                    <Field
                      id="guess-value"
                      label="Your guess"
                      inputMode="numeric"
                      autoComplete="off"
                      value={value}
                      error={errors.value}
                      onChange={(event) => setValue(event.target.value)}
                    />
                    <button type="submit" className="btn btn-primary" aria-disabled={sending ? 'true' : undefined}>
                      Submit your guess
                    </button>
                  </form>
                )
              )}
            </>
          )}
          {record.status === 'closed' && (
            <>
              <OwnGuess guess={record.my_guess} />
              <p className="closed-line">Guessing has closed. The result is coming soon.</p>
            </>
          )}
          {record.status === 'revealed' && (
            <>
              <OwnGuess guess={record.my_guess} />
              <p className="final-figure">Final figure: {grouped(record.final_figure ?? 0)} TPS</p>
              {record.leaderboard.length === 0 ? (
                <p className="helper">No guesses were submitted.</p>
              ) : (
                <table className="leaderboard" aria-label="Closest guesses">
                  <thead>
                    <tr>
                      <th scope="col">Rank</th>
                      <th scope="col">Name</th>
                      <th scope="col">Guess</th>
                    </tr>
                  </thead>
                  <tbody>
                    {record.leaderboard.map((leader) => (
                      <tr key={leader.rank}>
                        <td>{leader.rank}</td>
                        <td>{leader.display_name}</td>
                        <td>{grouped(leader.value)} TPS</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
      )}
    </section>
  );
}
