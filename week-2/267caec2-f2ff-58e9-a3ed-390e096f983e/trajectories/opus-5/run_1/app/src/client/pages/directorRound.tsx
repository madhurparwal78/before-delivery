import type { JSX } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { api } from '../api';
import type { PageProps } from '../main';
import { useShell } from '../shell';
import { RankedTable, type ShuffleRow } from '../shuffle';
import type { Juror, PanelMember, Round, Standings } from '../types';
import { AwardMarker, CutMarker, Dialog, Field, GridLines, useFeedback, usePending } from '../ui';

export function DirectorRound({ params }: PageProps): JSX.Element {
  const feedback = useFeedback();
  const [pending, run] = usePending();
  const [round, setRound] = useState<Round | null>(null);
  const [panel, setPanel] = useState<PanelMember[]>([]);
  const [standings, setStandings] = useState<Standings | null>(null);
  const [jurors, setJurors] = useState<Juror[]>([]);
  const [categoryName, setCategoryName] = useState('Round');
  const [chosenJuror, setChosenJuror] = useState('');
  const [ballotDeadline, setBallotDeadline] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const refresh = useCallback(async () => {
    const body = await api<{ round: Round; panel: PanelMember[] }>('GET', `/api/rounds/${params.id}`);
    setRound(body.round);
    setPanel(body.panel);
    const table = await api<Standings>('GET', `/api/rounds/${params.id}/standings`);
    setStandings(table);
    return body.round;
  }, [params.id]);

  useEffect(() => {
    void refresh();
    void api<{ jurors: Juror[] }>('GET', '/api/jurors').then((body) => setJurors(body.jurors));
  }, [refresh]);

  useEffect(() => {
    void (async () => {
      const programs = await api<{ programs: { categories: { id: string; name: string }[] }[] }>(
        'GET',
        '/api/programs',
      );
      for (const program of programs.programs) {
        const found = program.categories.find((category) => category.id === round?.categoryId);
        if (found !== undefined) setCategoryName(found.name);
      }
    })();
  }, [round?.categoryId]);

  useEffect(() => {
    if (round?.state !== 'open') return undefined;
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [round?.state, refresh]);

  useShell(
    round === null ? 'Director' : `${categoryName} — ${round.name}`,
    round?.state === 'open' ? round.ballotDeadlineAt : null,
  );

  const act = async (label: string, task: () => Promise<unknown>, done: string): Promise<void> => {
    feedback.say(label);
    const result = await run(task);
    if (result === undefined) return;
    feedback.say(done);
    await refresh();
  };

  const addJuror = async (): Promise<void> => {
    const juror = jurors.find((item) => item.id === chosenJuror);
    feedback.say('Adding juror…');
    const result = await run(() =>
      api<{ panel: PanelMember[] }>('POST', `/api/rounds/${params.id}/jurors`, { jurorId: chosenJuror }),
    );
    if (result === undefined) return;
    const row = result.panel.find((member) => member.jurorId === chosenJuror);
    feedback.say(`${juror?.name ?? 'Juror'} added to the panel with ${row?.assigned ?? 0} entries.`);
    await refresh();
  };

  const rows: ShuffleRow[] = (standings?.rows ?? []).map((row) => ({
    id: row.entryId,
    entryNumber: row.entryNumber,
    rank: row.rank,
    score: row.score,
    cut: row.cut,
    cells: (view) => (
      <>
        <td class="rank-cell">{row.rank}</td>
        <td>
          <span>
            Entry {row.entryNumber} — {row.title}
          </span>
          <span class="fold-under">{row.categoryName}</span>
          {view.delta}
        </td>
        <td class="fold-cell">{row.categoryName}</td>
        <td class="score-cell">{view.score ?? '—'}</td>
        <td>
          <CutMarker cut={view.cut} />
          {row.award === null ? null : <AwardMarker award={row.award} />}
        </td>
      </>
    ),
  }));

  return (
    <div class="grid">
      <GridLines />
      <div class="span-12">
        <h1>
          {categoryName} — {round?.name ?? ''}
        </h1>
        <p class="hint">
          State: {round?.state ?? ''}
          {round?.ballotDeadlineLabel === null || round === null
            ? ''
            : ` · ballot deadline ${round.ballotDeadlineLabel}`}
        </p>
      </div>

      <div class="span-6 stack">
        <h2>Panel</h2>
        <form
          class="row-flex"
          onSubmit={(event) => {
            event.preventDefault();
            void addJuror();
          }}
        >
          <div>
            <label for="add-juror">Add juror</label>
            <select
              id="add-juror"
              aria-label="Add juror"
              value={chosenJuror}
              onChange={(event) => setChosenJuror((event.target as HTMLSelectElement).value)}
            >
              <option value="">Choose a juror</option>
              {jurors.map((juror) => (
                <option key={juror.id} value={juror.id}>
                  {juror.name}
                </option>
              ))}
            </select>
          </div>
          <button class="btn" type="submit" disabled={pending}>
            {pending ? 'Adding juror…' : 'Add to panel'}
          </button>
        </form>
        <div class="ranked">
          <table aria-label="Panel">
            <thead>
              <tr>
                <th scope="col">Juror</th>
                <th scope="col">Assigned</th>
                <th scope="col">Scored</th>
                <th scope="col">Remaining</th>
                <th scope="col">Ballot</th>
              </tr>
            </thead>
            <tbody>
              {panel.map((member) => (
                <tr key={member.jurorId}>
                  <td>{member.name}</td>
                  <td class="rank-cell">{member.assigned}</td>
                  <td class="rank-cell">{member.scored}</td>
                  <td class="rank-cell">{member.remaining}</td>
                  <td>{member.ballotSubmitted ? 'Submitted' : 'In progress'}</td>
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
          void act(
            'Opening round…',
            () => api('POST', `/api/rounds/${params.id}/open`, { ballotDeadline }),
            `Round opened for ${panel.length} jurors.`,
          );
        }}
      >
        <h2>Round actions</h2>
        <Field label="Ballot deadline" id="ballot-deadline">
          <input
            id="ballot-deadline"
            type="date"
            aria-label="Ballot deadline"
            value={ballotDeadline}
            onInput={(event) => setBallotDeadline((event.target as HTMLInputElement).value)}
          />
        </Field>
        <div class="row-flex">
          <button class="btn" type="submit" disabled={pending}>
            {pending ? 'Opening round…' : 'Open round'}
          </button>
          <button class="btn" type="button" onClick={() => setConfirmClose(true)}>
            Close round
          </button>
          <button
            class="btn"
            type="button"
            disabled={pending}
            onClick={() =>
              void act(
                'Confirming…',
                () => api('POST', `/api/rounds/${params.id}/confirm`, {}),
                `Standings confirmed: ${(standings?.rows ?? []).filter((row) => row.cut === 'above').length} above the cut, ${
                  (standings?.rows ?? []).filter((row) => row.cut === 'below').length
                } below.`,
              )
            }
          >
            Confirm standings
          </button>
        </div>
      </form>

      <div class="span-12">
        <h2>Standings</h2>
        {standings?.provisional === true && round?.state === 'open' ? <p><strong>Provisional</strong></p> : null}
        <div role="status" aria-label="Standings updates" aria-live="polite">
          {announcement}
        </div>
        <RankedTable
          label="Standings"
          cut={standings?.cut ?? 0}
          cutLabel={standings?.cutLabel === '' ? 'Shortlist cut' : (standings?.cutLabel ?? 'Shortlist cut')}
          rows={rows}
          onAnnounce={setAnnouncement}
          columns={
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Entry</th>
              <th scope="col" class="fold-cell">
                Category
              </th>
              <th scope="col" class="score-cell">
                Score
              </th>
              <th scope="col">Status</th>
            </tr>
          }
        />
      </div>

      {confirmClose && round !== null ? (
        <Dialog title={`Close ${round.name}?`} labelledBy="close-round" onClose={() => setConfirmClose(false)}>
          <p>Scores are stored and the ballot locks for every juror.</p>
          <div class="dialog-actions">
            <button class="btn btn--quiet" type="button" data-safe="true" onClick={() => setConfirmClose(false)}>
              Cancel
            </button>
            <button
              class="btn"
              type="button"
              onClick={() => {
                setConfirmClose(false);
                void act(
                  'Closing round…',
                  async () => {
                    const body = await api<{ standings: Standings }>(
                      'POST',
                      `/api/rounds/${params.id}/close`,
                      {},
                    );
                    return body;
                  },
                  `Round closed. Scores stored for ${(standings?.rows ?? []).length} entries.`,
                );
              }}
            >
              Close round
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
