import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { api } from '../api';
import type { PageProps } from '../main';
import { useShell } from '../shell';
import type { Ballot } from '../types';
import { Dialog, Field, GridLines, useFeedback, usePending } from '../ui';

const CRITERIA: ['craft' | 'clarity' | 'idea' | 'story', string][] = [
  ['craft', 'Craft'],
  ['clarity', 'Clarity'],
  ['idea', 'Idea'],
  ['story', 'Story'],
];

type Draft = Record<string, { craft: string; clarity: string; idea: string; story: string }>;

export function BallotPage({ params }: PageProps): JSX.Element {
  const feedback = useFeedback();
  const [pending, run] = usePending();
  const [ballot, setBallot] = useState<Ballot | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [recusing, setRecusing] = useState<string | null>(null);
  const [recuseNote, setRecuseNote] = useState('');
  const [confirmSubmit, setConfirmSubmit] = useState(false);

  const load = async (): Promise<void> => {
    const body = await api<Ballot>('GET', `/api/rounds/${params.id}/ballot`);
    setBallot(body);
    const next: Draft = {};
    for (const entry of body.entries) {
      next[entry.entryId] = {
        craft: entry.scores === null ? '' : String(entry.scores.craft),
        clarity: entry.scores === null ? '' : String(entry.scores.clarity),
        idea: entry.scores === null ? '' : String(entry.scores.idea),
        story: entry.scores === null ? '' : String(entry.scores.story),
      };
    }
    setDraft(next);
  };

  useEffect(() => {
    void load();
  }, [params.id]);

  useShell(
    ballot === null ? 'Jury' : `${ballot.round.categoryName} — ${ballot.round.name}`,
    ballot?.round.ballotDeadlineAt ?? null,
  );

  if (ballot === null) return <p>Loading…</p>;

  const scored = ballot.entries.filter((entry) => {
    const values = draft[entry.entryId];
    return entry.scores !== null && values !== undefined;
  }).length;

  const saveScores = async (entryId: string, entryNumber: number): Promise<void> => {
    const values = draft[entryId];
    feedback.say('Saving scores…');
    const result = await run(() =>
      api<{ remaining: number }>('PUT', `/api/rounds/${params.id}/scores/${entryId}`, {
        craft: Number(values.craft),
        clarity: Number(values.clarity),
        idea: Number(values.idea),
        story: Number(values.story),
      }),
    );
    if (result === undefined) return;
    await load();
    feedback.say(`Scores saved for Entry ${entryNumber}. ${result.remaining} left to score.`);
  };

  const recuse = async (entryId: string, entryNumber: number): Promise<void> => {
    feedback.say('Recusing…');
    const result = await run(() =>
      api<{ remaining: number }>('POST', `/api/rounds/${params.id}/entries/${entryId}/recuse`, {
        note: recuseNote,
      }),
    );
    setRecusing(null);
    setRecuseNote('');
    if (result === undefined) return;
    await load();
    feedback.say(`You've recused from Entry ${entryNumber}.`);
  };

  const submitBallot = async (): Promise<void> => {
    feedback.say('Submitting your ballot…');
    const result = await run(() =>
      api<{ counted: number }>('POST', `/api/rounds/${params.id}/ballot/submit`, {}),
    );
    setConfirmSubmit(false);
    if (result === undefined) return;
    await load();
    feedback.say(`Ballot submitted. ${result.counted} entries scored.`);
  };

  return (
    <div class="grid">
      <GridLines />
      <div class="span-12">
        <h1>
          {ballot.round.categoryName} — {ballot.round.name}
        </h1>
        <p class="hint">Ballot deadline {ballot.round.ballotDeadlineLabel}</p>
        {ballot.submitted ? <p><strong>Ballot submitted</strong></p> : null}
      </div>

      {ballot.entries.map((entry) => (
        <article key={entry.entryId} class="span-12 entry-block grid" aria-label={`Entry ${entry.entryNumber}`}>
          <div class="span-7 stack">
            <h2>
              Entry {entry.entryNumber} — {entry.title}
            </h2>
            <p>{entry.summary}</p>
            {entry.images.map((image, index) => (
              <img
                key={image.url}
                src={image.url}
                alt={`Entry ${entry.entryNumber} image ${index + 1}`}
                width={image.width}
                height={image.height}
              />
            ))}
          </div>
          <div class="span-5 stack">
            <div role="group" aria-label={`Scores for Entry ${entry.entryNumber}`} class="score-grid">
              {CRITERIA.map(([key, label]) => (
                <Field key={key} label={label} id={`score-${entry.entryNumber}-${key}`}>
                  <input
                    id={`score-${entry.entryNumber}-${key}`}
                    type="number"
                    min={1}
                    max={10}
                    step={1}
                    aria-label={label}
                    disabled={ballot.submitted}
                    value={draft[entry.entryId]?.[key] ?? ''}
                    onKeyDown={(event) => {
                      if (event.key === 'Home' || event.key === 'End') {
                        event.preventDefault();
                        setDraft((current) => ({
                          ...current,
                          [entry.entryId]: {
                            ...current[entry.entryId],
                            [key]: event.key === 'Home' ? '1' : '10',
                          },
                        }));
                      }
                    }}
                    onInput={(event) =>
                      setDraft((current) => ({
                        ...current,
                        [entry.entryId]: {
                          ...current[entry.entryId],
                          [key]: (event.target as HTMLInputElement).value,
                        },
                      }))
                    }
                  />
                </Field>
              ))}
            </div>
            <div class="row-flex">
              <button
                class="btn"
                type="button"
                disabled={pending || ballot.submitted}
                onClick={() => void saveScores(entry.entryId, entry.entryNumber)}
              >
                Save scores for Entry {entry.entryNumber}
              </button>
              <button class="btn btn--quiet" type="button" onClick={() => setRecusing(entry.entryId)}>
                Recuse from Entry {entry.entryNumber}
              </button>
            </div>
          </div>
          {recusing === entry.entryId ? (
            <Dialog
              title={`Recuse from Entry ${entry.entryNumber}?`}
              labelledBy={`recuse-${entry.entryNumber}`}
              onClose={() => setRecusing(null)}
            >
              <p>Your scores for this entry will not count.</p>
              <Field label="Note" id={`recuse-note-${entry.entryNumber}`}>
                <input
                  id={`recuse-note-${entry.entryNumber}`}
                  type="text"
                  value={recuseNote}
                  onInput={(event) => setRecuseNote((event.target as HTMLInputElement).value)}
                />
              </Field>
              <div class="dialog-actions">
                <button class="btn btn--quiet" type="button" onClick={() => setRecusing(null)}>
                  Cancel
                </button>
                <button
                  class="btn btn--danger"
                  type="button"
                  onClick={() => void recuse(entry.entryId, entry.entryNumber)}
                >
                  Recuse
                </button>
              </div>
            </Dialog>
          ) : null}
        </article>
      ))}

      <div class="ballot-bar span-12">
        <span class="mono">
          {scored} of {ballot.assigned} scored
        </span>
        <button
          class="btn"
          type="button"
          disabled={ballot.submitted || ballot.remaining > 0 || pending}
          onClick={() => setConfirmSubmit(true)}
        >
          Submit final ballot
        </button>
      </div>

      {confirmSubmit ? (
        <Dialog title="Submit final ballot?" labelledBy="submit-ballot" onClose={() => setConfirmSubmit(false)}>
          <p>You can't change scores after submitting.</p>
          <div class="dialog-actions">
            <button class="btn btn--quiet" type="button" data-safe="true" onClick={() => setConfirmSubmit(false)}>
              Keep scoring
            </button>
            <button class="btn" type="button" onClick={() => void submitBallot()}>
              Submit ballot
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
