import { useEffect, useState } from 'react';
import { lengthFromInput, lengthToInput } from '../../shared/units.js';
import { readDraft, writeDraft, writeView } from '../lib/viewState.js';
import { useStore } from '../store.js';

export function ConflictSheet(): JSX.Element | null {
  const { session, view, actions } = useStore();
  const conflict =
    session?.conflicts
      .filter((entry) => entry.state === 'Open')
      .find((entry) => !view.train || entry.train_id === view.train) ??
    session?.conflicts.filter((entry) => entry.state === 'Open').slice(-1)[0] ??
    null;
  const [note, setNote] = useState(() => readDraft('conflict-note'));

  useEffect(() => {
    writeDraft('conflict-note', note);
  }, [note]);

  if (!session) return null;
  const train = session.trains.find((entry) => entry.id === conflict?.train_id);
  const other = session.trains.find((entry) => entry.id === conflict?.other_train_id);
  const block = session.blocks.find((entry) => entry.id === conflict?.block_id);

  return (
    <div
      role="dialog"
      aria-label="Conflict"
      data-testid="conflict-sheet"
      className="floating-card"
    >
      <div className="sheet-head" style={{ padding: 0 }}>
        <h2>Conflict</h2>
        <button className="mini" onClick={() => writeView({ sheet: null })}>
          Close
        </button>
      </div>
      <p>
        {train ? `Train ${train.number}` : 'No train'} refused at {block?.name ?? '—'}
        {other ? `: held by Train ${other.number}.` : ': out of service.'}
      </p>
      <label className="field">
        <span>Dispatcher note</span>
        <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div className="row-actions">
        <button
          className="mini strong"
          disabled={!conflict}
          onClick={() => conflict && void actions.saveNote(conflict.id, note)}
        >
          Save note
        </button>
        <button
          className="mini"
          disabled={!conflict}
          onClick={() => conflict && void actions.withdraw(conflict.id)}
        >
          Withdraw request
        </button>
        <button
          className="mini"
          disabled={!train}
          onClick={() => train && void actions.backToLoop(train.id)}
        >
          Back to loop
        </button>
        <button
          className="mini"
          disabled={!train}
          onClick={() => train && void actions.recall(train.id)}
        >
          Recall train
        </button>
      </div>
    </div>
  );
}

export function DeadlockSheet(): JSX.Element | null {
  const { session, actions } = useStore();
  const deadlock = session?.deadlocks.find((entry) => entry.state === 'Open') ?? null;
  if (!session) return null;
  return (
    <div
      role="dialog"
      aria-label="Deadlock"
      data-testid="deadlock-sheet"
      className="floating-card"
    >
      <div className="sheet-head" style={{ padding: 0 }}>
        <h2>Deadlock</h2>
        <button className="mini" onClick={() => writeView({ sheet: null })}>
          Close
        </button>
      </div>
      {deadlock ? (
        <p>Trains {deadlock.train_numbers.join(', ')} are waiting on each other.</p>
      ) : (
        <p>No deadlock is open.</p>
      )}
      {(deadlock?.train_numbers ?? []).map((number) => {
        const train = session.trains.find((entry) => entry.number === number);
        const labelId = `deadlock-member-${number}`;
        return (
          <div key={number} className="sheet-row">
            <div className="sheet-row-head">
              <h3 id={labelId}>Train {number}</h3>
            </div>
            <div className="row-actions">
              <button
                className="mini strong"
                aria-describedby={labelId}
                disabled={!train}
                onClick={() => train && void actions.backToLoop(train.id)}
              >
                Back to loop
              </button>
              <button
                className="mini"
                aria-describedby={labelId}
                disabled={!train}
                onClick={() => train && void actions.recall(train.id)}
              >
                Recall train
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function PieceInspector(): JSX.Element | null {
  const { layout, view, actions, standards } = useStore();
  const units = standards?.display_units ?? 'in';
  const piece = layout?.content.modules
    .flatMap((module) => module.pieces)
    .find((entry) => entry.id === view.piece);

  const [rise, setRise] = useState('0');
  const [blockId, setBlockId] = useState('');
  const [note, setNote] = useState(() => readDraft(`piece-note:${view.piece ?? ''}`));
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    if (!piece || loadedFor === piece.id) return;
    setRise(lengthToInput(piece.rise_mm, units));
    setBlockId(piece.block_id ?? '');
    const draft = readDraft(`piece-note:${piece.id}`);
    setNote(draft === '' ? piece.note : draft);
    setLoadedFor(piece.id);
  }, [piece, loadedFor, units]);

  useEffect(() => {
    if (!piece) return;
    writeDraft(`piece-note:${piece.id}`, note === piece.note ? '' : note);
  }, [note, piece]);

  if (!layout || !piece) return null;

  return (
    <div
      role="dialog"
      aria-label="Piece inspector"
      data-testid="piece-inspector"
      className="floating-card"
      style={{ right: 12, bottom: 96 }}
    >
      <div className="sheet-head" style={{ padding: 0 }}>
        <h2>Piece inspector</h2>
        <button
          className="mini"
          onClick={() => writeView({ sheet: null, piece: null })}
        >
          Close
        </button>
      </div>
      <p className="hash">{piece.id}</p>
      <label className="field">
        <span>Rise</span>
        <input
          type="number"
          step={units === 'in' ? 0.001 : 1}
          value={rise}
          onChange={(event) => setRise(event.target.value)}
        />
      </label>
      <label className="field">
        <span>Block</span>
        <select value={blockId} onChange={(event) => setBlockId(event.target.value)}>
          <option value="">No block</option>
          {layout.content.blocks.map((block) => (
            <option key={block.id} value={block.id}>
              Block {block.number} {block.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Piece note</span>
        <textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div className="row-actions">
        <button
          className="mini strong"
          onClick={() => {
            void actions
              .applyPiece(piece.id, {
                rise_mm: lengthFromInput(Number(rise), units),
                block_id: blockId === '' ? null : blockId,
                note,
              })
              .then(() => {
                writeDraft(`piece-note:${piece.id}`, '');
                setLoadedFor(null);
              });
          }}
        >
          Apply
        </button>
        <button className="mini" onClick={() => void actions.removePiece(piece.id)}>
          Remove piece
        </button>
      </div>
    </div>
  );
}
