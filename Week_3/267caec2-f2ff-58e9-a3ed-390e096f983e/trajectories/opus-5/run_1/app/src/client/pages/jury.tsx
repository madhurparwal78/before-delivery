import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { api } from '../api';
import type { PageProps } from '../main';
import { useShell } from '../shell';
import type { JurorRound, Studio } from '../types';
import { Field, GridLines, useFeedback, usePending } from '../ui';

export function JuryHome({ navigate }: PageProps): JSX.Element {
  useShell('Jury', null);
  const [rounds, setRounds] = useState<JurorRound[]>([]);

  useEffect(() => {
    void api<{ rounds: JurorRound[] }>('GET', '/api/juror/rounds').then((body) => setRounds(body.rounds));
  }, []);

  return (
    <div class="grid">
      <GridLines />
      <div class="span-12">
        <h1>Your rounds</h1>
      </div>
      <div class="span-12 stack">
        {rounds.length === 0 ? <p class="hint">No open rounds right now.</p> : null}
        {rounds.map((round) => (
          <div key={round.id} class="region">
            <h3>
              <a
                href={`/jury/rounds/${round.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(`/jury/rounds/${round.id}`);
                }}
              >
                {round.categoryName} — {round.name}
              </a>
            </h3>
            <p class="hint">Ballot deadline {round.ballotDeadlineLabel}</p>
            <p class="mono">{round.remaining} left to score</p>
          </div>
        ))}
        <p>
          <a
            href="/jury/conflicts"
            onClick={(event) => {
              event.preventDefault();
              navigate('/jury/conflicts');
            }}
          >
            Conflicts
          </a>
        </p>
      </div>
    </div>
  );
}

interface Conflict {
  studioId: string;
  studioName: string;
  note: string | null;
  declaredAt: string;
}

export function Conflicts(): JSX.Element {
  useShell('Jury', null);
  const feedback = useFeedback();
  const [pending, run] = usePending();
  const [studios, setStudios] = useState<Studio[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [studioId, setStudioId] = useState('');
  const [note, setNote] = useState('');

  const load = async (): Promise<void> => {
    const body = await api<{ conflicts: Conflict[] }>('GET', '/api/conflicts');
    setConflicts(body.conflicts);
  };

  useEffect(() => {
    void api<{ studios: Studio[] }>('GET', '/api/studios').then((body) => setStudios(body.studios));
    void load();
  }, []);

  const declare = async (event: Event): Promise<void> => {
    event.preventDefault();
    feedback.say('Recording conflict…');
    const result = await run(() =>
      api<{ conflict: Conflict; removedAssignments: number }>('POST', '/api/conflicts', { studioId, note }),
    );
    if (result === undefined) return;
    feedback.say(
      `Conflict with ${result.conflict.studioName} recorded. ${result.removedAssignments} assignments removed.`,
    );
    setNote('');
    await load();
  };

  return (
    <div class="grid">
      <GridLines />
      <div class="span-12">
        <h1>Conflicts</h1>
      </div>
      <form class="span-6 stack" onSubmit={(event) => void declare(event)}>
        <Field label="Studio" id="conflict-studio">
          <select
            id="conflict-studio"
            aria-label="Studio"
            value={studioId}
            onChange={(event) => setStudioId((event.target as HTMLSelectElement).value)}
          >
            <option value="">Choose a studio</option>
            {studios.map((studio) => (
              <option key={studio.id} value={studio.id}>
                {studio.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Note" id="conflict-note">
          <input
            id="conflict-note"
            type="text"
            value={note}
            onInput={(event) => setNote((event.target as HTMLInputElement).value)}
          />
        </Field>
        <div>
          <button class="btn" type="submit" disabled={pending}>
            {pending ? 'Recording conflict…' : 'Declare conflict'}
          </button>
        </div>
      </form>
      <div class="span-6">
        <ul class="asset-list" aria-label="Declared conflicts">
          {conflicts.map((conflict) => (
            <li key={conflict.studioId}>
              <strong>{conflict.studioName}</strong>
              <span class="hint">{conflict.note ?? ''}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
