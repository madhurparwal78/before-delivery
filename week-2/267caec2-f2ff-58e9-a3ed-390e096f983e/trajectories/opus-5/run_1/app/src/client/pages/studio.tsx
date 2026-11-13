import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { api } from '../api';
import type { PageProps } from '../main';
import { useShell } from '../shell';
import type { Entry, Program } from '../types';
import { GridLines, money, StatusLabel } from '../ui';

/** The program accepting entries whose deadline comes soonest, as in Business rules. */
export function openProgramOf(programs: Program[]): Program | null {
  const open = programs
    .filter((program) => program.entriesOpen)
    .sort((a, b) => new Date(a.deadlineAt).getTime() - new Date(b.deadlineAt).getTime());
  return open[0] ?? null;
}

export function StudioEntries({ navigate }: PageProps): JSX.Element {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);

  useEffect(() => {
    void api<{ entries: Entry[] }>('GET', '/api/entries').then((body) => setEntries(body.entries));
    void api<{ programs: Program[] }>('GET', '/api/programs').then((body) => setPrograms(body.programs));
  }, []);

  const open = openProgramOf(programs);
  const context = open ?? programs[0] ?? null;
  useShell(context?.name ?? 'Cutline Jury Desk', open?.deadlineAt ?? null);

  return (
    <div class="grid">
      <GridLines />
      <div class="span-12">
        <h1>Your entries</h1>
      </div>
      <div class="span-12 row-flex">
        {open === null ? (
          <p>Entries are closed.</p>
        ) : (
          <>
            <button
              class="btn"
              type="button"
              onClick={() => navigate('/studio/entries/new')}
            >
              New entry
            </button>
            <span class="hint">Entries close {open.deadlineLabel}</span>
          </>
        )}
      </div>
      <div class="span-12">
        <div class="ranked">
          <table aria-label="Your entries">
            <thead>
              <tr>
                <th scope="col">Entry number</th>
                <th scope="col">Title</th>
                <th scope="col">Category</th>
                <th scope="col">Status</th>
                <th scope="col" class="score-cell">
                  Fee
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td class="rank-cell">{entry.entryNumber}</td>
                  <td>
                    <a
                      href={`/studio/entries/${entry.id}`}
                      onClick={(event) => {
                        event.preventDefault();
                        navigate(`/studio/entries/${entry.id}`);
                      }}
                    >
                      {entry.title}
                    </a>
                  </td>
                  <td>{entry.categoryName}</td>
                  <td>
                    <StatusLabel state={entry.state} label={entry.statusLabel} />
                  </td>
                  <td class="score-cell">{entry.fee === null ? '—' : `$${money(entry.fee.amountCents)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {entries.length === 0 ? <p class="hint">No entries yet.</p> : null}
      </div>
    </div>
  );
}
