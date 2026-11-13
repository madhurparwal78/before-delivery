import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { api } from '../api';
import type { PageProps } from '../main';
import { useShell } from '../shell';
import type { Entry, Program } from '../types';
import { Dialog, Field, GridLines, StatusLabel, useFeedback, usePending } from '../ui';

export function DirectorCategory({ params }: PageProps): JSX.Element {
  const feedback = useFeedback();
  const [pending, run] = usePending();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [program, setProgram] = useState<Program | null>(null);
  const [categoryName, setCategoryName] = useState('Category');
  const [disqualifying, setDisqualifying] = useState<Entry | null>(null);
  const [reason, setReason] = useState('');
  const [embargo, setEmbargo] = useState('');
  const [confirmPublish, setConfirmPublish] = useState(false);

  const load = async (): Promise<void> => {
    const body = await api<{ entries: Entry[] }>('GET', `/api/categories/${params.id}/entries`);
    setEntries(body.entries);
    const programs = await api<{ programs: Program[] }>('GET', '/api/programs');
    for (const candidate of programs.programs) {
      const found = candidate.categories.find((category) => category.id === params.id);
      if (found !== undefined) {
        setProgram(candidate);
        setCategoryName(found.name);
      }
    }
  };

  useEffect(() => {
    void load();
  }, [params.id]);

  useShell(categoryName, null);

  const screen = async (entry: Entry, decision: 'pass' | 'disqualify'): Promise<void> => {
    feedback.say(decision === 'pass' ? 'Passing…' : 'Disqualifying…');
    const result = await run(() =>
      api('POST', `/api/entries/${entry.id}/screen`, { decision, reason }),
    );
    setDisqualifying(null);
    setReason('');
    if (result === undefined) return;
    feedback.say(
      decision === 'pass'
        ? `Entry ${entry.entryNumber} passed screening.`
        : `Entry ${entry.entryNumber} disqualified.`,
    );
    await load();
  };

  const reinstate = async (entry: Entry): Promise<void> => {
    feedback.say('Reinstating…');
    const result = await run(() => api('POST', `/api/entries/${entry.id}/reinstate`, {}));
    if (result === undefined) return;
    feedback.say(`Entry ${entry.entryNumber} reinstated.`);
    await load();
  };

  const publish = async (): Promise<void> => {
    feedback.say('Publishing…');
    const result = await run(() =>
      api<{ category: { embargoLabel: string } }>('POST', `/api/categories/${params.id}/publish`, {
        embargoAt: embargo,
      }),
    );
    setConfirmPublish(false);
    if (result === undefined) return;
    feedback.say(`Results scheduled for ${result.category.embargoLabel}.`);
  };

  return (
    <div class="grid">
      <GridLines />
      <div class="span-12">
        <h1 class="category-header">{categoryName}</h1>
      </div>
      <div class="span-12">
        <div class="ranked">
          <table aria-label="Entries">
            <thead>
              <tr>
                <th scope="col">Entry</th>
                <th scope="col">Studio</th>
                <th scope="col">Credits</th>
                <th scope="col">Status</th>
                <th scope="col">Screening</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td class="rank-cell">{entry.entryNumber}</td>
                  <td>
                    <strong>{entry.title}</strong>
                    <span class="fold-under">
                      {entry.studioName} · {entry.studioEmail}
                    </span>
                  </td>
                  <td>{entry.credits}</td>
                  <td>
                    <StatusLabel state={entry.state} label={entry.statusLabel} />
                    {entry.disqualifyReason === null ? null : (
                      <span class="fold-under">Reason: {entry.disqualifyReason}</span>
                    )}
                  </td>
                  <td>
                    <div class="row-flex">
                      {entry.state === 'submitted' ? (
                        <button
                          class="btn btn--quiet"
                          type="button"
                          disabled={pending}
                          onClick={() => void screen(entry, 'pass')}
                        >
                          Pass Entry {entry.entryNumber}
                        </button>
                      ) : null}
                      {entry.state === 'submitted' || entry.state === 'screened' ? (
                        <button
                          class="btn btn--danger"
                          type="button"
                          onClick={() => setDisqualifying(entry)}
                        >
                          Disqualify Entry {entry.entryNumber}
                        </button>
                      ) : null}
                      {entry.state === 'disqualified' ? (
                        <button
                          class="btn btn--quiet"
                          type="button"
                          disabled={pending}
                          onClick={() => void reinstate(entry)}
                        >
                          Reinstate Entry {entry.entryNumber}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <form
        class="span-6 stack"
        onSubmit={(event) => {
          event.preventDefault();
          setConfirmPublish(true);
        }}
      >
        <h2>Publish</h2>
        <Field label={`Embargo time (${program?.timeZone ?? 'UTC'})`} id="embargo-at">
          <input
            id="embargo-at"
            type="text"
            aria-label={`Embargo time (${program?.timeZone ?? 'UTC'})`}
            placeholder="2026-06-01T19:00:00+05:30"
            value={embargo}
            onInput={(event) => setEmbargo((event.target as HTMLInputElement).value)}
          />
        </Field>
        <div>
          <button class="btn" type="submit" disabled={pending}>
            {pending ? 'Publishing…' : 'Publish results'}
          </button>
        </div>
      </form>

      {disqualifying !== null ? (
        <Dialog
          title={`Disqualify Entry ${disqualifying.entryNumber}`}
          labelledBy="disqualify-title"
          onClose={() => setDisqualifying(null)}
        >
          <Field label="Reason" id="disqualify-reason">
            <input
              id="disqualify-reason"
              type="text"
              value={reason}
              onInput={(event) => setReason((event.target as HTMLInputElement).value)}
            />
          </Field>
          <div class="dialog-actions">
            <button class="btn btn--quiet" type="button" onClick={() => setDisqualifying(null)}>
              Cancel
            </button>
            <button
              class="btn btn--danger"
              type="button"
              onClick={() => void screen(disqualifying, 'disqualify')}
            >
              Disqualify
            </button>
          </div>
        </Dialog>
      ) : null}

      {confirmPublish ? (
        <Dialog
          title={`Publish ${categoryName} results?`}
          labelledBy="publish-title"
          onClose={() => setConfirmPublish(false)}
        >
          <p>Results stay hidden until the embargo time passes.</p>
          <div class="dialog-actions">
            <button class="btn btn--quiet" type="button" data-safe="true" onClick={() => setConfirmPublish(false)}>
              Cancel
            </button>
            <button class="btn" type="button" onClick={() => void publish()}>
              Publish
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
