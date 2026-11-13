import { useEffect, useRef } from 'react';
import type { RowAnalysis } from '../../../src/domain/types';

export interface EditingRow {
  row: number;
  text: string;
  error: string;
  position: number | null;
  rowChanged: boolean;
}

interface InstructionsProps {
  rows: RowAnalysis[];
  lines: Map<number, string>;
  liftedTokens: Set<string>;
  pinnedTokens: Set<string>;
  editable: boolean;
  editing: EditingRow | null;
  onTokenHover: (token: { row: number; index: number } | null) => void;
  onTokenFocus: (token: { row: number; index: number } | null) => void;
  onPinToken: (row: number, index: number) => void;
  onPinRow: (row: number) => void;
  onEdit?: (row: number) => void;
  onEditText?: (text: string) => void;
  onApply?: () => void;
  onCancelEdit?: () => void;
}

interface Piece {
  literal?: string;
  token?: { text: string; index: number };
}

/** The printed line split into its literal text and its tokens, in printed order. */
function splitLine(text: string, tokens: { text: string }[]): Piece[] {
  const pieces: Piece[] = [];
  let at = 0;
  tokens.forEach((token, index) => {
    const found = text.indexOf(token.text, at);
    if (found < 0) return;
    if (found > at) pieces.push({ literal: text.slice(at, found) });
    pieces.push({ token: { text: token.text, index } });
    at = found + token.text.length;
  });
  if (at < text.length) pieces.push({ literal: text.slice(at) });
  return pieces;
}

function tileLabel(side: string): string {
  if (side === 'RND') return 'Rnd';
  return side;
}

export function Instructions(props: InstructionsProps): JSX.Element {
  const {
    rows,
    lines,
    liftedTokens,
    pinnedTokens,
    editable,
    editing,
    onTokenHover,
    onTokenFocus,
    onPinToken,
    onPinRow,
    onEdit,
    onEditText,
    onApply,
    onCancelEdit,
  } = props;
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) return;
    box.current?.focus();
  }, [editing?.row]);

  useEffect(() => {
    if (!editing || editing.position === null) return;
    const place = Math.max(0, editing.position - 1);
    box.current?.focus();
    box.current?.setSelectionRange(place, place);
  }, [editing?.error, editing?.position]);

  const onLineKeys = (event: React.KeyboardEvent<HTMLSpanElement>, row: number, index: number): void => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const line = (event.currentTarget.closest('[data-line]') as HTMLElement | null) ?? null;
      const tokens = [...(line?.querySelectorAll<HTMLElement>('[data-token]') ?? [])];
      const step = event.key === 'ArrowRight' ? 1 : -1;
      const next = tokens[index + step];
      next?.focus();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      onPinToken(row, index);
    }
  };

  return (
    <ul aria-label="Written instructions" className="instructions">
      {rows
        .filter((row) => row.state !== 'empty')
        .map((row) => {
          const text = lines.get(row.row) ?? row.text;
          const pieces = splitLine(text, row.tokens);
          return (
            <li key={row.row} className="card row-card" data-row={row.row}>
              <span className={`tile tile-${row.side.toLowerCase()}`} aria-hidden="true">
                {tileLabel(row.side)}
              </span>
              <span className="line" data-line="">
                {pieces.map((piece, position) =>
                  piece.literal !== undefined ? (
                    <span key={`l${position}`}>{piece.literal}</span>
                  ) : (
                    <span
                      key={`t${piece.token!.index}`}
                      data-token=""
                      className="token"
                      tabIndex={piece.token!.index === 0 ? 0 : -1}
                      data-lift={liftedTokens.has(`${row.row}:${piece.token!.index}`) ? 'twin' : undefined}
                      aria-current={
                        pinnedTokens.has(`${row.row}:${piece.token!.index}`) ? 'true' : undefined
                      }
                      onPointerEnter={() => onTokenHover({ row: row.row, index: piece.token!.index })}
                      onPointerLeave={() => onTokenHover(null)}
                      onFocus={() => onTokenFocus({ row: row.row, index: piece.token!.index })}
                      onBlur={() => onTokenFocus(null)}
                      onKeyDown={(event) => onLineKeys(event, row.row, piece.token!.index)}
                    >
                      {piece.token!.text}
                    </span>
                  ),
                )}
              </span>
              {editable ? (
                <button type="button" className="line-button" onClick={() => onEdit?.(row.row)}>
                  {`Edit row ${row.row}`}
                </button>
              ) : null}
              <button
                type="button"
                className="pin-arrow"
                aria-label={`Pin row ${row.row}`}
                onClick={() => onPinRow(row.row)}
              >
                <span aria-hidden="true">&rarr;</span>
              </button>
              {editing && editing.row === row.row ? (
                <div className="row-editor">
                  <textarea
                    ref={box}
                    aria-label={`Row ${row.row} instructions`}
                    aria-invalid={editing.error !== '' ? 'true' : undefined}
                    value={editing.text}
                    onChange={(event) => onEditText?.(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        onApply?.();
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        onCancelEdit?.();
                      }
                    }}
                  />
                  <button type="button" onClick={() => onApply?.()}>
                    Apply text
                  </button>
                  <p role="alert" aria-label="Text error" className="alert">
                    {editing.error}
                  </p>
                  <p role="status" aria-label="Row changed" className="status-line">
                    {editing.rowChanged ? `Row ${row.row} changed while you were typing.` : ''}
                  </p>
                </div>
              ) : null}
            </li>
          );
        })}
    </ul>
  );
}
