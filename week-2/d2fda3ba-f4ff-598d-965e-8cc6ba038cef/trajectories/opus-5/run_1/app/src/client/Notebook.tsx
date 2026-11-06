import { useEffect, useMemo, useRef, type JSX } from 'react';
import { buildTitleIndex } from '../shared/boundary';
import { renderMarkdown } from '../shared/markdown';
import { COPY } from './copy';
import { Icon } from './icons';
import { candidateOf, store, type AppState } from './state';
import type { StoredNote } from './db';
import { useCairn } from './ui';

export function syncStatusLine(state: AppState): string {
  const queued = state.queue.length;
  if (!state.account) return COPY.sync.signedOut;
  if (state.device?.approved === false) return COPY.sync.waitingApproval;
  if (state.outage === 'readonly') return COPY.sync.readOnly;
  if (state.outage === 'storage') return COPY.sync.storage(queued);
  if (state.outage === 'billing') return COPY.sync.billing(queued);
  if (!state.online) return COPY.sync.offline(queued);
  if (state.requestsInFlight > 0) return COPY.sync.inFlight(queued);
  return COPY.sync.allSynced;
}

export function TopBar(): JSX.Element {
  const state = useCairn();
  const pending = state.requestsInFlight > 0;
  return (
    <header className="top-bar">
      <div className="top-bar-left">
        <span className="wordmark">Cairn</span>
        <button id="files-button" type="button" className="only-drawer" onClick={() => store.setRailOpen(true)}>
          <Icon name="panel" />
          Files
        </button>
        <button id="context-button" type="button" className="only-sheet" onClick={() => store.setContextOpen(true)}>
          <Icon name="eye" />
          Context
        </button>
      </div>
      <div className="top-bar-right">
        <div className="sync-status" role="status" aria-label="Sync status">
          <span className={pending ? 'pending-dot pulsing' : 'pending-dot'} aria-hidden="true" />
          {syncStatusLine(state)}
        </div>
        <button type="button" onClick={() => void store.syncNow()}>
          Sync now
        </button>
        <button type="button" className="primary" onClick={() => store.setAccountDialogOpen(true)}>
          Account
        </button>
      </div>
    </header>
  );
}

export function Rail(): JSX.Element {
  const state = useCairn();
  const notes = store.notesOf(state.currentNotebookId);
  const notebooks = state.notebooks;

  return (
    <nav className="rail" aria-label="Case files">
      <label className="field">
        <span className="field-label">Notebook</span>
        <select
          aria-label="Notebook"
          value={state.currentNotebookId}
          onChange={(event) => store.selectNotebook(event.target.value)}
        >
          {notebooks.map((notebook) => (
            <option key={notebook.id} value={notebook.id}>
              {notebook.vaultId && !store.hasVaultKey(notebook.vaultId)
                ? `${notebook.name} · locked`
                : notebook.name}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className="primary new-note"
        onClick={() => {
          store.createNote();
          store.setRailOpen(false);
        }}
      >
        <Icon name="plus" />
        New note
      </button>

      {notes.length === 0 ? (
        <button type="button" onClick={() => void store.loadSampleCase()}>
          Load sample case
        </button>
      ) : null}

      <ul className="tree" role="tree" aria-label="Notes">
        {notes.map((note) => (
          <li key={note.id} role="none">
            <button
              type="button"
              role="treeitem"
              aria-selected={note.id === state.currentNoteId}
              className={`tree-item${note.id === state.currentNoteId ? ' selected' : ''}`}
              onClick={() => {
                store.selectNote(note.id);
                store.setRailOpen(false);
              }}
            >
              <span className="tree-title">
                {note.isConflictCopy ? <Icon name="warning" className="brick" /> : <Icon name="note" />}
                <span className="title-text">{note.title.length > 0 ? note.title : 'Untitled'}</span>
                {note.private ? <Icon name="lock" /> : null}
              </span>
              <span className={`badge badge-${note.badge.replace(/ /g, '-')}`}>{note.badge}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function ReadView({ note, notes }: { note: StoredNote; notes: StoredNote[] }): JSX.Element {
  const html = useMemo(() => {
    const index = buildTitleIndex(notes.map(candidateOf));
    return renderMarkdown(note.body, {
      resolveWikilink: (target, label) => {
        const targetId = index.get(target.trim().toLowerCase());
        const targetNote = notes.find((entry) => entry.id === targetId);
        if (!targetNote) return { kind: 'plain', text: label ?? target, className: 'missing-link' };
        return { kind: 'link', href: `#note/${targetNote.id}`, text: label ?? targetNote.title };
      },
    });
  }, [note.body, notes]);

  const open = (event: React.MouseEvent<HTMLDivElement>): void => {
    const target = event.target;
    if (!(target instanceof HTMLAnchorElement)) return;
    const href = target.getAttribute('href') ?? '';
    const match = /^#note\/(.+)$/.exec(href);
    if (!match?.[1]) return;
    event.preventDefault();
    store.selectNote(match[1]);
    window.setTimeout(() => document.querySelector<HTMLElement>('.note-title-input')?.focus(), 0);
  };

  return (
    <div
      className="note-body reading"
      onClick={open}
      // The markup comes from the shared allowlisted renderer, which escapes every note's text.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function NoteColumn(): JSX.Element {
  const state = useCairn();
  const note = store.note(state.currentNoteId);
  const notes = store.notesOf(state.currentNotebookId);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.editing && note && note.title.length === 0) titleRef.current?.focus();
  }, [state.editing, note]);

  if (!note) {
    return (
      <section className="note-column empty">
        <p className="muted">No note open. Make a new note, or load the sample case.</p>
      </section>
    );
  }

  return (
    <section className="note-column">
      <div className="note-header">
        <input
          ref={titleRef}
          className="note-title-input"
          aria-label="Note title"
          value={note.title}
          placeholder="Untitled"
          onChange={(event) => store.editNote(note.id, { title: event.target.value })}
        />
        <div className="note-controls">
          <button type="button" onClick={() => store.setEditing(!state.editing)}>
            {state.editing ? 'Read' : 'Edit'}
          </button>
          <button
            type="button"
            className={note.private ? 'pressed' : ''}
            aria-pressed={note.private}
            onClick={() => store.editNote(note.id, { private: !note.private })}
          >
            <Icon name="lock" />
            {note.private ? 'Private' : 'Pin as private'}
          </button>
          <span className={`badge badge-${note.badge.replace(/ /g, '-')}`} role="status" aria-label="Note sync status">
            {note.badge}
          </span>
        </div>
      </div>

      {note.rejection ? (
        <p className="rejection">
          <Icon name="warning" className="brick" />
          {COPY.rejection(note.rejection)}
        </p>
      ) : null}

      {note.conflictNotice ? (
        <div className="conflict-notice" role="region" aria-label="Conflict">
          <Icon name="unlink" className="brick" />
          <p>{COPY.conflict.notice}</p>
          <a
            href={`#note/${note.conflictCopyId ?? ''}`}
            onClick={(event) => {
              event.preventDefault();
              if (note.conflictCopyId) store.selectNote(note.conflictCopyId);
            }}
          >
            Open conflict copy
          </a>
          <button type="button" onClick={() => store.dismissConflict(note.id)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {state.editing ? (
        <textarea
          className="note-body-input"
          aria-label="Note body"
          value={note.body}
          onChange={(event) => store.editNote(note.id, { body: event.target.value })}
        />
      ) : (
        <ReadView note={note} notes={notes} />
      )}
    </section>
  );
}
