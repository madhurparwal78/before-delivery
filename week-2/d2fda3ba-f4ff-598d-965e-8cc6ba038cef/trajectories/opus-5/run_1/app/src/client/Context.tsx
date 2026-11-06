import { useState, type JSX } from 'react';
import { analyseGraph, distinctTargets, MAX_HOP } from '../shared/boundary';
import { formatDisplayTime } from '../shared/time';
import { Icon } from './icons';
import { PublishWorkbench } from './Publish';
import { candidateOf, store } from './state';
import type { StoredNote } from './db';
import { Dialog, useCairn } from './ui';

function backlinksOf(notes: readonly StoredNote[], note: StoredNote): StoredNote[] {
  const names = [note.title, ...note.aliases]
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);
  if (names.length === 0) return [];
  return notes.filter(
    (candidate) =>
      candidate.id !== note.id &&
      distinctTargets(candidate.body).some((target) => names.includes(target.toLowerCase())),
  );
}

function Backlinks({ note }: { note: StoredNote }): JSX.Element {
  const state = useCairn();
  const notes = store.notesOf(state.currentNotebookId);
  const backlinks = backlinksOf(notes, note);
  return (
    <div className="tab-panel">
      {backlinks.length === 0 ? <p className="muted">No note links here yet.</p> : null}
      <ul className="link-list" aria-label="Backlinks">
        {backlinks.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#note/${entry.id}`}
              onClick={(event) => {
                event.preventDefault();
                store.selectNote(entry.id);
              }}
            >
              {entry.title.length > 0 ? entry.title : 'Untitled'}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function History({ note }: { note: StoredNote }): JSX.Element {
  const state = useCairn();
  const [pending, setPending] = useState<number | null>(null);
  const zone = state.account?.time_zone ?? 'UTC';
  const revisions = state.history?.noteId === note.id ? state.history.revisions : [];

  if (!store.currentNotebook()?.vaultId) {
    return (
      <div className="tab-panel">
        <p className="muted">This notebook is local only, so it has no server revisions yet.</p>
      </div>
    );
  }

  return (
    <div className="tab-panel">
      <p className="status-line" role="status" aria-label="Restore status">
        {state.restoreStatus ?? ''}
      </p>
      <ul className="revision-list" aria-label="Revisions">
        {revisions.map((revision) => (
          <li key={revision.rev}>
            <span className="mono rev">r{revision.rev}</span>
            <span className="device">{revision.device_name}</span>
            <span className="mono when">{formatDisplayTime(new Date(revision.created_at), zone)}</span>
            {revision.restored_from !== null ? (
              <span className="restored">restored from r{revision.restored_from}</span>
            ) : null}
            <button type="button" onClick={() => setPending(revision.rev)}>
              Restore r{revision.rev}
            </button>
          </li>
        ))}
      </ul>
      {pending !== null ? (
        <Dialog name="Restore revision" onClose={() => setPending(null)}>
          <p className="dialog-question">Restore r{pending} as a new revision?</p>
          <div className="dialog-actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                const rev = pending;
                setPending(null);
                void store.restoreRevision(note.id, rev);
              }}
            >
              Restore
            </button>
            <button type="button" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

function Graph({ note }: { note: StoredNote }): JSX.Element {
  const state = useCairn();
  const notes = store.notesOf(state.currentNotebookId);
  const graph = analyseGraph(notes.map(candidateOf), note.id);
  const size = 320;
  const centre = size / 2;
  const rings = [0, 1, 2, 3, 4];

  const placed = [...graph.hops.entries()].filter(([, hop]) => hop <= MAX_HOP);
  const byHop = new Map<number, string[]>();
  for (const [noteId, hop] of placed) {
    const list = byHop.get(hop) ?? [];
    list.push(noteId);
    byHop.set(hop, list);
  }

  return (
    <div className="tab-panel">
      <svg className="graph-canvas" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Note graph">
        {rings.slice(1).map((hop) => (
          <circle key={hop} cx={centre} cy={centre} r={(hop / MAX_HOP) * (centre - 16)} className="hop-ring" />
        ))}
        {[...byHop.entries()].flatMap(([hop, ids]) =>
          ids.map((noteId, index) => {
            const radius = (hop / MAX_HOP) * (centre - 16);
            const angle = (index / Math.max(1, ids.length)) * Math.PI * 2 - Math.PI / 2;
            const x = centre + Math.cos(angle) * radius;
            const y = centre + Math.sin(angle) * radius;
            const title = notes.find((entry) => entry.id === noteId)?.title ?? 'Untitled';
            return (
              <g key={noteId}>
                <circle cx={x} cy={y} r={hop === 0 ? 7 : 5} className={hop === 0 ? 'graph-node root' : 'graph-node'} />
                <title>{title}</title>
              </g>
            );
          }),
        )}
      </svg>
      <p className="muted">
        {placed.length} notes within {MAX_HOP} hops of this note.
      </p>
    </div>
  );
}

export function ContextPane(): JSX.Element {
  const state = useCairn();
  const note = store.note(state.currentNoteId);
  const tabs = ['backlinks', 'history', 'graph', 'publish'] as const;
  const labels: Record<(typeof tabs)[number], string> = {
    backlinks: 'Backlinks',
    history: 'History',
    graph: 'Graph',
    publish: 'Publish',
  };

  return (
    <aside className="context-pane" aria-label="Context">
      <div className="context-head">
        <div className="tablist" role="tablist" aria-label="Context">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`tab-${tab}`}
              aria-selected={state.contextTab === tab}
              aria-controls={`panel-${tab}`}
              className={state.contextTab === tab ? 'tab selected' : 'tab'}
              onClick={() => store.setContextTab(tab)}
            >
              {labels[tab]}
            </button>
          ))}
        </div>
        <button type="button" className="only-sheet close-sheet" onClick={() => store.setContextOpen(false)}>
          <Icon name="x" />
          Close
        </button>
      </div>

      <div className="context-body" role="tabpanel" id={`panel-${state.contextTab}`} aria-labelledby={`tab-${state.contextTab}`}>
        {note === null ? (
          <p className="muted">Open a note to see its context.</p>
        ) : state.contextTab === 'backlinks' ? (
          <Backlinks note={note} />
        ) : state.contextTab === 'history' ? (
          <History note={note} />
        ) : state.contextTab === 'graph' ? (
          <Graph note={note} />
        ) : (
          <PublishWorkbench note={note} />
        )}
      </div>
    </aside>
  );
}
