import { forwardRef } from 'react';
import type { Cell, PublishedLimits } from '../../shared/types.js';
import { MarkdownView } from './MarkdownView.js';
import { OutputView } from './OutputView.js';

function GripIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" className="grip-icon" aria-hidden="true" focusable="false">
      <circle cx="6" cy="4" r="1.3" />
      <circle cx="10" cy="4" r="1.3" />
      <circle cx="6" cy="8" r="1.3" />
      <circle cx="10" cy="8" r="1.3" />
      <circle cx="6" cy="12" r="1.3" />
      <circle cx="10" cy="12" r="1.3" />
    </svg>
  );
}

function DotsIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" className="dots-icon" aria-hidden="true" focusable="false">
      <circle cx="3" cy="8" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="13" cy="8" r="1.5" />
    </svg>
  );
}

export function executionCountLabel(cell: Cell): string {
  if (cell.run_state === 'queued' || cell.run_state === 'running') return '[*]';
  if (cell.execution_count !== null) return `[${cell.execution_count}]`;
  return '[ ]';
}

interface CellViewProps {
  notebookId: string;
  cell: Cell;
  index: number;
  selected: boolean;
  editing: boolean;
  draft: string | null;
  canEdit: boolean;
  lockedBy: string | null;
  skipped: boolean;
  phone: boolean;
  limits: PublishedLimits;
  dropBefore: boolean;
  dropAfter: boolean;
  onSelect: () => void;
  onChange: (text: string) => void;
  onEnterEdit: () => void;
  onAnnounce: (message: string) => void;
  onCellActions: () => void;
  onHandlePointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
}

/** One cell: a white block with its source, count, outputs and labels. */
export const CellView = forwardRef<HTMLTextAreaElement, CellViewProps>(function CellView(
  props,
  editorRef,
): JSX.Element {
  const {
    notebookId,
    cell,
    index,
    selected,
    editing,
    draft,
    canEdit,
    lockedBy,
    skipped,
    phone,
    limits,
    dropBefore,
    dropAfter,
    onSelect,
    onChange,
    onEnterEdit,
    onAnnounce,
    onCellActions,
    onHandlePointerDown,
  } = props;

  const position = index + 1;
  const kindLabel = cell.cell_type === 'code' ? 'Code cell' : 'Markdown cell';
  const source = draft ?? cell.source;
  const readOnly = !canEdit || lockedBy !== null;
  const showEditor = cell.cell_type === 'code' || editing;

  return (
    <>
      {dropBefore ? <div className="drop-line" /> : null}
      <article
        className={`cell cell-${cell.cell_type} ${selected ? 'cell-selected' : ''} ${editing ? 'cell-editing' : ''}`}
        aria-label={`${kindLabel} ${position}`}
        data-cell-id={cell.id}
        tabIndex={selected ? 0 : -1}
        onMouseDown={onSelect}
      >
        <div className="cell-gutter">
          {cell.cell_type === 'code' ? (
            <span className="execution-count">{executionCountLabel(cell)}</span>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              className="icon-button cell-handle"
              aria-label={`Move cell ${position}`}
              onPointerDown={onHandlePointerDown}
            >
              <GripIcon />
            </button>
          ) : null}
          {phone ? (
            <button type="button" className="icon-button" aria-label="Cell actions" onClick={onCellActions}>
              <DotsIcon />
            </button>
          ) : null}
        </div>
        <div className="cell-body">
          {lockedBy !== null ? <p className="cell-lock">{`Being edited by ${lockedBy}`}</p> : null}
          {showEditor ? (
            <textarea
              className="cell-editor"
              aria-label={`Cell ${position} source`}
              ref={editing ? editorRef : undefined}
              value={source}
              readOnly={readOnly}
              aria-readonly={readOnly ? true : undefined}
              spellCheck={false}
              rows={Math.max(2, source.split('\n').length)}
              onChange={(event) => onChange(event.target.value)}
              onFocus={() => {
                onSelect();
                if (!readOnly) onEnterEdit();
              }}
            />
          ) : (
            <div
              className="cell-rendered"
              onDoubleClick={() => {
                if (canEdit && lockedBy === null) onEnterEdit();
              }}
            >
              <MarkdownView source={source} notebookId={notebookId} cellId={cell.id} />
            </div>
          )}
          {skipped ? <p className="cell-skipped">Not run: an earlier cell failed</p> : null}
          {cell.outputs.length > 0 ? (
            <div className="cell-outputs" role="region" aria-label={`Output of cell ${position}`}>
              {cell.outputs.map((output, outputIndex) => (
                <OutputView
                  key={outputIndex}
                  notebookId={notebookId}
                  cell={cell}
                  index={outputIndex}
                  output={output}
                  limits={limits}
                  onAnnounce={onAnnounce}
                />
              ))}
            </div>
          ) : null}
        </div>
      </article>
      {dropAfter ? <div className="drop-line" /> : null}
    </>
  );
});
