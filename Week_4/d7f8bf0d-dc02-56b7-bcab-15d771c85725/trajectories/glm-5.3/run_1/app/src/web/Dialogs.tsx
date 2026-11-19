import React, { useCallback, useEffect, useState } from 'react';
import { api, newKey, ApiFailure } from './apiClient';
import type { ViewUrlState } from './store/types';
import type { StoreState } from './store/store';
import type { SessionSnapshot } from '../shared/domain';

interface DialogProps {
  url: ViewUrlState;
  session: SessionSnapshot | null;
  store: StageOverlaysLike['store'];
  announceFor: (actionId: string, message: string) => void;
  setError: (message: string | null) => void;
}

interface StageOverlaysLike {
  store: ReturnType<typeof import('./store/store').useStore>;
}

/** Piece inspector: keeps its typed values, focus and caret through live edits. */
export function PieceInspector({ url, layout, store, announceFor, setError, setUrl }: {
  url: ViewUrlState;
  layout: StoreState['layout'];
  store: StageOverlaysLike['store'];
  announceFor: (actionId: string, message: string) => void;
  setError: (message: string | null) => void;
  setUrl: (patch: Partial<ViewUrlState>) => void;
}): React.ReactElement | null {
  const piece = layout?.content.modules.flatMap((m) => m.pieces).find((p) => p.id === url.piece) ?? null;
  const [rise, setRise] = useState('0');
  const [blockId, setBlockId] = useState('');
  const [note, setNote] = useState('');

  // The unsaved note comes back from browser storage on a refresh.
  useEffect(() => {
    const stored = window.localStorage.getItem(`piece-note-${url.piece}`);
    if (stored !== null) setNote(stored);
  }, [url.piece]);

  useEffect(() => {
    if (piece) {
      setRise(String(piece.rise_mm));
      if (!blockId) setBlockId(piece.block_id ?? '');
    }
    // Values once typed stay as they are until Apply or Close.
  }, [piece?.id]);

  const apply = useCallback(async () => {
    if (!layout || !piece) return;
    announceFor('apply-piece', 'Saving piece.');
    try {
      await api('PATCH', `/api/workspaces/${url.workspace}/layouts/${layout.id}/modules/${layout.content.modules.find((m) => m.pieces.some((p) => p.id === piece.id))?.id}/pieces/${piece.id}`, {
        revision: layout.revision,
        rise_mm: Number(rise) || 0,
        block_id: blockId || null,
        note,
      }, newKey());
      await store.loadLayout(url.workspace ?? '', layout.id);
      window.localStorage.removeItem(`piece-note-${url.piece}`);
      announceFor('apply-piece', 'Piece saved.');
    } catch (e) {
      if (e instanceof ApiFailure) {
        const findings = (e.extra as { findings?: { message: string }[] } | undefined)?.findings;
        if (findings && findings.length > 0) {
          setError(findings.map((f) => f.message).join(' '));
        } else {
          setError(e.message);
        }
        announceFor('apply-piece', e.message);
      }
    }
  }, [layout, piece, rise, blockId, note, url, store, announceFor, setError]);

  const remove = useCallback(async () => {
    if (!layout || !piece) return;
    announceFor('remove-piece', 'Removing piece.');
    try {
      const moduleId = layout.content.modules.find((m) => m.pieces.some((p) => p.id === piece.id))?.id;
      if (!moduleId) return;
      await api('POST', `/api/workspaces/${url.workspace}/layouts/${layout.id}/modules/${moduleId}/pieces/${piece.id}/remove`, {
        revision: layout.revision,
      }, newKey());
      await store.loadLayout(url.workspace ?? '', layout.id);
      announceFor('remove-piece', 'Piece removed.');
      setUrl({ dialog: null, piece: null });
    } catch (e) {
      if (e instanceof ApiFailure) {
        announceFor('remove-piece', e.message);
        if (e.code === 'piece_has_followers') setError(e.message);
      }
    }
  }, [layout, piece, url, store, announceFor, setError, setUrl]);

  if (!piece || !layout) return null;

  return (
    <div className="dialog-backdrop" style={{ zIndex: 78, background: 'transparent', alignItems: 'flex-end', justifyContent: 'flex-start', pointerEvents: 'none' }}>
      <div className="dialog" role="dialog" aria-label="Piece inspector" data-testid="piece-inspector" style={{ pointerEvents: 'auto', margin: '0 0 90px 14px', width: 320 }}>
        <h2>Piece inspector</h2>
        <p style={{ margin: '0 0 10px', fontSize: 13 }}>{piece.kind} · {piece.length_mm} mm · <code>{piece.id}</code></p>
        <div className="field">
          <label htmlFor="piece-rise">Rise</label>
          <input id="piece-rise" type="number" role="spinbutton" step={0.125} value={rise} onChange={(e) => setRise(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="piece-block">Block</label>
          <select id="piece-block" value={blockId} onChange={(e) => setBlockId(e.target.value)}>
            <option value="">No block</option>
            {layout.content.blocks.map((b) => (
              <option key={b.id} value={b.id}>Block {b.number} {b.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="piece-note">Piece note</label>
          <input
            id="piece-note"
            type="textbox"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              window.localStorage.setItem(`piece-note-${url.piece}`, e.target.value);
            }}
          />
        </div>
        <div className="actions">
          <button className="lipped orange" onClick={remove}>Remove piece</button>
          <button className="lipped" onClick={apply}>Apply</button>
          <button className="lipped pale" onClick={() => setUrl({ dialog: null, piece: null })}>Close</button>
        </div>
      </div>
    </div>
  );
}

/** Conflict sheet: non-modal, facts update but the note and focus stay. */
export function ConflictSheet({ url, session, store, announceFor, setError }: DialogProps): React.ReactElement | null {
  const openConflict = session?.conflicts.find((c) => c.state === 'Open' && c.train_id === url.train) ?? session?.conflicts.find((c) => c.state === 'Open') ?? null;
  const [note, setNote] = useState('');

  useEffect(() => {
    const stored = window.localStorage.getItem(`conflict-note-${url.session}`);
    if (stored !== null) setNote(stored);
  }, [url.session]);

  const saveNote = useCallback(async () => {
    if (!session || !openConflict) return;
    announceFor('save-note', 'Saving note.');
    try {
      await api('PATCH', `/api/workspaces/${url.workspace}/sessions/${session.id}/conflicts/${openConflict.id}`, {
        revision: openConflict.revision,
        note,
      }, newKey());
      await store.loadSession(url.workspace ?? '', session.id);
      announceFor('save-note', 'Note saved.');
    } catch (e) {
      if (e instanceof ApiFailure) setError(e.message);
    }
  }, [session, openConflict, note, url, store, announceFor, setError]);

  const withdraw = useCallback(async () => {
    if (!session || !openConflict) return;
    announceFor('withdraw', 'Withdrawing request.');
    try {
      await api('POST', `/api/workspaces/${url.workspace}/sessions/${session.id}/conflicts/${openConflict.id}/withdraw`, {
        revision: openConflict.revision,
      }, newKey());
      await store.loadSession(url.workspace ?? '', session.id);
      announceFor('withdraw', 'Request withdrawn.');
    } catch (e) {
      if (e instanceof ApiFailure) {
        announceFor('withdraw', e.message);
        setError(e.message);
      }
    }
  }, [session, openConflict, url, store, announceFor, setError]);

  const backToLoop = useCallback(async () => {
    if (!session) return;
    const train = session.trains.find((t) => t.id === (openConflict?.train_id ?? url.train));
    if (!train) return;
    announceFor('back-to-loop', `Sending Train ${train.number} back to loop.`);
    try {
      const result = await api<SessionSnapshot>('POST', `/api/workspaces/${url.workspace}/sessions/${session.id}/trains/${train.id}/back-to-loop`, {
        revision: train.revision,
      }, newKey());
      await store.loadSession(url.workspace ?? '', session.id);
      const blockName = result.blocks.find((b) => b.id === train.head_block_id)?.name ?? '';
      announceFor('back-to-loop', `Train ${train.number} is in ${blockName}.`);
    } catch (e) {
      if (e instanceof ApiFailure) {
        announceFor('back-to-loop', e.message);
        setError(e.message);
      }
    }
  }, [session, openConflict, url, store, announceFor, setError]);

  const recallTrain = useCallback(async () => {
    if (!session) return;
    const train = session.trains.find((t) => t.id === (openConflict?.train_id ?? url.train));
    if (!train) return;
    announceFor('recall', `Recalling Train ${train.number}.`);
    try {
      const result = await api<SessionSnapshot>('POST', `/api/workspaces/${url.workspace}/sessions/${session.id}/trains/${train.id}/recall`, {
        revision: train.revision,
      }, newKey());
      await store.loadSession(url.workspace ?? '', session.id);
      const blockName = result.blocks.find((b) => b.id === train.start_block_id)?.name ?? '';
      announceFor('recall', `Train ${train.number} recalled to ${blockName}.`);
    } catch (e) {
      if (e instanceof ApiFailure) {
        announceFor('recall', e.message);
        setError(e.message);
      }
    }
  }, [session, openConflict, url, store, announceFor, setError]);

  if (!session) return null;
  const conflictTrain = session.trains.find((t) => t.id === (openConflict?.train_id ?? url.train));
  const otherTrain = session.trains.find((t) => t.id === openConflict?.other_train_id);
  const conflictBlock = session.blocks.find((b) => b.id === openConflict?.block_id);

  return (
    <div className="dialog-backdrop" style={{ zIndex: 78, background: 'transparent', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <div className="dialog" role="dialog" aria-label="Conflict" data-testid="conflict-sheet" style={{ pointerEvents: 'auto' }}>
        <h2>Conflict</h2>
        {conflictTrain && conflictBlock ? (
          <p>
            Train {conflictTrain.number} was refused at Block {conflictBlock.number} {conflictBlock.name}
            {otherTrain ? <> — held by Train {otherTrain.number}</> : <> — out of service</>}.
          </p>
        ) : (
          <p>A route request was refused.</p>
        )}
        <div className="field">
          <label htmlFor="conflict-note">Dispatcher note</label>
          <input
            id="conflict-note"
            type="textbox"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              window.localStorage.setItem(`conflict-note-${url.session}`, e.target.value);
            }}
          />
        </div>
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="lipped" onClick={saveNote}>Save note</button>
            <button className="lipped pale" onClick={withdraw}>Withdraw request</button>
          </span>
          <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="lipped orange" onClick={backToLoop}>Back to loop</button>
            <button className="lipped orange" onClick={recallTrain}>Recall train</button>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Deadlock sheet: every member with Back to loop and Recall. */
export function DeadlockSheet({ url, session, store, announceFor, setError }: DialogProps): React.ReactElement | null {
  const openDeadlock = session?.deadlocks.find((d) => d.state === 'Open') ?? null;

  const move = useCallback(async (trainId: string, command: 'back-to-loop' | 'recall') => {
    if (!session) return;
    const train = session.trains.find((t) => t.id === trainId);
    if (!train) return;
    const pending = command === 'back-to-loop' ? `Sending Train ${train.number} back to loop.` : `Recalling Train ${train.number}.`;
    announceFor(command, pending);
    try {
      const result = await api<SessionSnapshot>('POST', `/api/workspaces/${url.workspace}/sessions/${session.id}/trains/${trainId}/${command === 'back-to-loop' ? 'back-to-loop' : 'recall'}`, {
        revision: train.revision,
      }, newKey());
      await store.loadSession(url.workspace ?? '', session.id);
      const blockName = result.blocks.find((b) => b.id === (command === 'back-to-loop' ? train.head_block_id : train.start_block_id))?.name ?? '';
      announceFor(command, command === 'back-to-loop' ? `Train ${train.number} is in ${blockName}.` : `Train ${train.number} recalled to ${blockName}.`);
    } catch (e) {
      if (e instanceof ApiFailure) {
        announceFor(command, e.message);
        setError(e.message);
      }
    }
  }, [session, url, store, announceFor, setError]);

  if (!session || !openDeadlock) return null;

  return (
    <div className="dialog-backdrop" style={{ zIndex: 79, background: 'transparent', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <div className="dialog" role="dialog" aria-label="Deadlock" data-testid="deadlock-sheet" style={{ pointerEvents: 'auto' }}>
        <h2>Deadlock</h2>
        <p>Trains {openDeadlock.train_numbers.join(', ')} are waiting on each other.</p>
        {openDeadlock.member_train_ids.map((trainId) => {
          const train = session.trains.find((t) => t.id === trainId);
          if (!train) return null;
          return (
            <div className="row" key={trainId} aria-describedby={`train-${train.number}`}>
              <span id={`train-${train.number}`}>Train {train.number} {train.name}</span>
              <span style={{ display: 'flex', gap: 8 }}>
                <button className="lipped orange" onClick={() => void move(trainId, 'back-to-loop')}>Back to loop</button>
                <button className="lipped orange" onClick={() => void move(trainId, 'recall')}>Recall train</button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
