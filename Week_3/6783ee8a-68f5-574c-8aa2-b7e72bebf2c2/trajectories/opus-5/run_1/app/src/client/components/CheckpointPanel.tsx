import { useEffect, useRef, useState } from 'react';
import type { Cell, Checkpoint, CompareResult, DiffLine } from '../../shared/types.js';
import { compareHeading } from '../../shared/compare.js';
import { apiGet, apiSend } from '../api.js';
import { Dialog } from './Dialog.js';

interface CheckpointPanelProps {
  notebookId: string;
  checkpoints: Checkpoint[];
  canEdit: boolean;
  onClose: () => void;
  onReverted: (label: string) => void;
  /** The comparison needs the whole width for its 50/50 split. */
  onComparing: (comparing: boolean) => void;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function DiffLines({ lines, side }: { lines: DiffLine[]; side: 'checkpoint' | 'current' }): JSX.Element {
  const kept = lines.filter((line) => (side === 'checkpoint' ? line.op !== 'added' : line.op !== 'removed'));
  return (
    <pre className="diff">
      {kept.map((line, index) => (
        <span key={index} className={`diff-line diff-${line.op}`}>
          {`${line.line}\n`}
        </span>
      ))}
    </pre>
  );
}

function CellSide({ cell, diff, side }: { cell: Cell | null; diff: DiffLine[]; side: 'checkpoint' | 'current' }): JSX.Element {
  if (!cell) return <div className="row-side row-empty">—</div>;
  return (
    <div className="row-side">
      <p className="row-kind">{cell.cell_type === 'code' ? 'Code' : 'Markdown'}</p>
      {diff.length > 0 ? <DiffLines lines={diff} side={side} /> : <pre className="diff">{cell.source}</pre>}
    </div>
  );
}

export function CheckpointPanel({
  notebookId,
  checkpoints,
  canEdit,
  onClose,
  onReverted,
  onComparing,
}: CheckpointPanelProps): JSX.Element {
  const [comparing, setComparing] = useState<Checkpoint | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [revert, setRevert] = useState<{ checkpoint: Checkpoint; cellId: string | null } | null>(null);
  const chosenRef = useRef<HTMLButtonElement | null>(null);

  const cascade = checkpoints.slice(0, 3);
  const older = checkpoints.slice(3);

  const openComparison = async (checkpoint: Checkpoint): Promise<void> => {
    const answer = await apiGet<CompareResult>(
      `/api/notebooks/${notebookId}/checkpoints/${checkpoint.id}/compare`,
    );
    setResult(answer);
    setComparing(checkpoint);
    onComparing(true);
  };

  const closeComparison = (): void => {
    setComparing(null);
    setResult(null);
    onComparing(false);
    chosenRef.current?.focus();
  };

  useEffect(() => {
    if (comparing === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeComparison();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [comparing]);

  const runRevert = async (): Promise<void> => {
    if (!revert) return;
    await apiSend('POST', `/api/notebooks/${notebookId}/checkpoints/${revert.checkpoint.id}/revert`, {
      ...(revert.cellId === null ? {} : { cell_id: revert.cellId }),
    });
    onReverted(revert.checkpoint.label);
    setRevert(null);
    setComparing(null);
    setResult(null);
    onComparing(false);
  };

  const windowButton = (checkpoint: Checkpoint, index: number, inCascade: boolean): JSX.Element => (
    <button
      key={checkpoint.id}
      type="button"
      className={inCascade ? 'checkpoint-window' : 'checkpoint-older'}
      style={
        inCascade
          ? {
              left: `${(cascade.length - 1 - index) * 30}px`,
              top: `${(cascade.length - 1 - index) * 10}px`,
              zIndex: cascade.length - index,
            }
          : undefined
      }
      aria-label={`Compare #${checkpoint.number} ${checkpoint.label}`}
      onClick={(event) => {
        chosenRef.current = event.currentTarget;
        void openComparison(checkpoint);
      }}
    >
      <span className="window-bar">
        <span className="window-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="window-label">{checkpoint.label}</span>
        <span className="window-number">{`#${checkpoint.number}`}</span>
      </span>
      <span className="window-body">
        <span className="window-time">{timeLabel(checkpoint.created_at)}</span>
        <span className="window-saved">Saved</span>
        <span className="window-lines" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </span>
    </button>
  );

  return (
    <aside className="checkpoint-panel">
      <div className="panel-head">
        <h2>Checkpoints</h2>
        <button type="button" className="button-plain" onClick={onClose}>
          Close panel
        </button>
      </div>

      {comparing === null || result === null ? (
        <section className="cascade" aria-label="Checkpoints">
          {checkpoints.length === 0 ? <p className="notice">No checkpoints yet.</p> : null}
          <div className="cascade-stack" style={{ height: `${130 + cascade.length * 12}px` }}>
            {cascade.map((checkpoint, index) => windowButton(checkpoint, index, true)).reverse()}
          </div>
          {older.length > 0 ? (
            <ul className="older-list" aria-label="Older checkpoints">
              {older.map((checkpoint, index) => (
                <li key={checkpoint.id}>{windowButton(checkpoint, index, false)}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : (
        <section className="comparison" aria-label="Checkpoint comparison">
          <h2>{compareHeading(result.counts)}</h2>
          <div className="diptych">
            <div className="diptych-half" role="region" aria-label={`Checkpoint #${comparing.number}`}>
              <h3>{`#${comparing.number} ${comparing.label}`}</h3>
            </div>
            <div className="diptych-half" role="region" aria-label="Current notebook">
              <h3>Current notebook</h3>
            </div>
          </div>
          <div className="comparison-rows">
            {result.rows.map((row, index) => (
              <div
                className="comparison-row"
                key={`${row.checkpoint_cell?.id ?? ''}-${row.current_cell?.id ?? ''}-${index}`}
                role="group"
                aria-label={`Row ${index + 1}: ${row.tag}`}
              >
                <p className="row-tag">{row.tag}</p>
                {row.output_changed ? <p className="row-output">Output changed</p> : null}
                <div className="row-pair">
                  <CellSide cell={row.checkpoint_cell} diff={row.source_diff} side="checkpoint" />
                  <CellSide cell={row.current_cell} diff={row.source_diff} side="current" />
                </div>
                {canEdit ? (
                  <button
                    type="button"
                    className="button-embossed"
                    onClick={() =>
                      setRevert({
                        checkpoint: comparing,
                        cellId: (row.checkpoint_cell ?? row.current_cell)?.id ?? null,
                      })
                    }
                  >
                    Revert this cell
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <div className="button-row">
            {canEdit ? (
              <button
                type="button"
                className="button-embossed"
                onClick={() => setRevert({ checkpoint: comparing, cellId: null })}
              >
                Revert notebook
              </button>
            ) : null}
            <button type="button" className="button-plain" onClick={closeComparison}>
              Close comparison
            </button>
          </div>
        </section>
      )}

      {revert ? (
        <Dialog name={`Revert to ${revert.checkpoint.label}?`} onClose={() => setRevert(null)}>
          <h2>{`Revert to ${revert.checkpoint.label}?`}</h2>
          <p>A checkpoint named Before revert is saved first.</p>
          <div className="button-row">
            <button
              type="button"
              className="button-embossed"
              onClick={() => {
                void runRevert();
              }}
            >
              Revert
            </button>
            <button type="button" className="button-plain" onClick={() => setRevert(null)}>
              Cancel
            </button>
          </div>
        </Dialog>
      ) : null}
    </aside>
  );
}
