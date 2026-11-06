import { ReactElement, useEffect, useState } from 'react';
import { ApiCallError, api } from '../api';
import { LiveRegion } from '../components/LiveRegion';
import { UserSummary } from '../types';

type Choice = 'preferred' | 'none' | 'blocked';

const CHOICES: { value: Choice; label: string }[] = [
  { value: 'preferred', label: 'Preferred' },
  { value: 'none', label: 'No preference' },
  { value: 'blocked', label: 'Blocked' },
];

export function Preferences(): ReactElement {
  const [interpreters, setInterpreters] = useState<UserSummary[]>([]);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void api.preferences().then((payload) => {
      setInterpreters(payload.interpreters);
      const next: Record<string, Choice> = {};
      for (const interpreter of payload.interpreters) {
        next[interpreter.id] = payload.preferred.includes(interpreter.id)
          ? 'preferred'
          : payload.blocked.includes(interpreter.id)
            ? 'blocked'
            : 'none';
      }
      setChoices(next);
    });
  }, []);

  const save = async (): Promise<void> => {
    setPending(true);
    setMessage('Saving preferences…');
    const preferred = Object.entries(choices)
      .filter(([, choice]) => choice === 'preferred')
      .map(([id]) => id);
    const blocked = Object.entries(choices)
      .filter(([, choice]) => choice === 'blocked')
      .map(([id]) => id);
    try {
      await api.savePreferences(preferred, blocked);
      setMessage('Preferences saved.');
    } catch (error) {
      const failure = error instanceof ApiCallError ? error.failure : null;
      setMessage(
        failure?.code === 'validation'
          ? 'An interpreter cannot be both preferred and blocked.'
          : 'Those preferences could not be saved.',
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="column">
      <h1>Preferences</h1>
      <p>Dispatch respects your blocks on every match.</p>
      <table className="stack-rows" aria-label="Interpreter preferences">
        <thead>
          <tr>
            <th scope="col">Interpreter</th>
            <th scope="col">Choice</th>
          </tr>
        </thead>
        <tbody>
          {interpreters.map((interpreter) => (
            <tr key={interpreter.id}>
              <td data-label="Interpreter">{interpreter.name}</td>
              <td data-label="Choice">
                <div className="radio-group" role="radiogroup" aria-label={interpreter.name}>
                  {CHOICES.map((choice) => (
                    <label key={choice.value}>
                      <input
                        type="radio"
                        name={`preference-${interpreter.id}`}
                        value={choice.value}
                        checked={(choices[interpreter.id] ?? 'none') === choice.value}
                        onChange={() =>
                          setChoices((current) => ({ ...current, [interpreter.id]: choice.value }))
                        }
                      />
                      {choice.label}
                    </label>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row-actions">
        <button type="button" disabled={pending} onClick={() => void save()}>
          Save preferences
        </button>
      </div>
      <LiveRegion label="Preferences status" message={message} />
    </main>
  );
}
