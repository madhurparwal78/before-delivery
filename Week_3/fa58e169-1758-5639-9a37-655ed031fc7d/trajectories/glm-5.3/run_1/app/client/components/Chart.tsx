import type { CellData, PatternData, RowData, TokenData } from "../lib/api";
import { sideForRow } from "../lib/api";
import { stitchGlyph } from "../lib/glyphs";
import { symbolByKey } from "../../common/symbols";
import { useRef } from "react";
import type { JSX, PointerEvent as ReactPointerEvent } from "react";

export interface PaintTarget {
  row: number;
  col: number;
}

/** The chart grid. Server-owned values are rendered, never computed here. */
export function StitchGrid(props: {
  pattern: PatternData;
  cursor: { row: number; col: number } | null;
  onCursor?: (row: number, col: number) => void;
  onPaint?: (cells: PaintTarget[]) => void;
  onSelectDrag?: (area: { fromRow: number; fromCol: number; toRow: number; toCol: number }) => void;
  selection: { fromRow: number; fromCol: number; toRow: number; toCol: number } | null;
  peers: Record<string, { row: number; col: number }>;
  readOnly?: boolean;
  tool?: "Paint" | "Select";
  followRow?: number | null;
  liftedCols?: number[];
  liftedTokens?: Set<string>;
  flashCells?: Set<string>;
  reducedMotion?: boolean;
  gridName?: string;
  diffByCell?: Map<string, string>;
}): JSX.Element {
  const side = (row: number) => sideForRow(props.pattern.mode, row);
  const lifted = new Set((props.liftedCols ?? []).map(String));
  const rowsDescending: number[] = [];
  for (let row = props.pattern.height; row >= 1; row--) rowsDescending.push(row);

  // Pointer and touch painting: a press paints one cell, a drag paints every
  // cell entered, and cells skipped between two events are filled along the
  // straight line between them. The whole drag is one undo step and one request.
  const drag = useRef<{ last: PaintTarget; touched: Map<string, PaintTarget> } | null>(null);

  const cellFromPoint = (clientX: number, clientY: number): PaintTarget | null => {
    const element = document.elementFromPoint(clientX, clientY);
    const cell = element?.closest?.("[data-col]") as HTMLElement | null;
    if (!cell) return null;
    const row = Number(cell.getAttribute("data-row"));
    const col = Number(cell.getAttribute("data-col"));
    if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
    return { row, col };
  };

  const onPointerDown = (event: ReactPointerEvent): void => {
    if (props.readOnly) return;
    const target = cellFromPoint(event.clientX, event.clientY);
    if (!target) return;
    if (props.tool === "Select") {
      const touched = new Map<string, PaintTarget>([[`${target.row}:${target.col}`, target]]);
      drag.current = { last: target, touched };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      props.onCursor?.(target.row, target.col);
      return;
    }
    const touched = new Map<string, PaintTarget>();
    touched.set(`${target.row}:${target.col}`, target);
    drag.current = { last: target, touched };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    props.onCursor?.(target.row, target.col);
    props.onPaint?.([target]);
  };

  const onPointerMove = (event: ReactPointerEvent): void => {
    if (!drag.current || props.readOnly) return;
    const target = cellFromPoint(event.clientX, event.clientY);
    if (!target) return;
    const state = drag.current;
    if (state.last.row === target.row && state.last.col === target.col) return;
    const between: PaintTarget[] = [];
    const rowStep = Math.sign(target.row - state.last.row);
    const colStep = Math.sign(target.col - state.last.col);
    const rows = Math.abs(target.row - state.last.row);
    const cols = Math.abs(target.col - state.last.col);
    const steps = Math.max(rows, cols);
    for (let step = 1; step <= steps; step++) {
      const row = state.last.row + rowStep * Math.round((rows * step) / steps);
      const col = state.last.col + colStep * Math.round((cols * step) / steps);
      const entry = { row, col };
      between.push(entry);
      state.touched.set(`${row}:${col}`, entry);
    }
    state.last = target;
    if (props.tool === "Select") {
      const first = state.touched.values().next().value as PaintTarget | undefined;
      if (first) {
        props.onSelectDrag?.({ fromRow: first.row, fromCol: first.col, toRow: target.row, toCol: target.col });
      }
      return;
    }
    if (between.length > 0) props.onPaint?.(between);
  };

  const onPointerUp = (): void => {
    drag.current = null;
  };

  const repeatByCol = (row: number, col: number): string => {
    const box = props.pattern.repeats.find(
      (entry) => row >= entry.fromRow && row <= entry.toRow && col >= entry.fromCol && col <= entry.toCol,
    );
    return box ? box.id : "";
  };

  const cellLabel = (cell: CellData, sideName: string): string => {
    const def = symbolByKey(props.pattern.craft, cell.stitch);
    const name = def?.name ?? "No stitch";
    const repeat = repeatByCol(cell.row, cell.col);
    const base = `Row ${cell.row}, column ${cell.col}: ${name}, colour ${cell.colour}`;
    return repeat ? `${base}, repeat ${repeat}` : base;
  };

  return (
    <div
      className="grid-scroll"
      role="grid"
      aria-label={props.gridName ?? "Stitch chart"}
      aria-rowcount={props.pattern.height}
      aria-colcount={props.pattern.width}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{ touchAction: "manipulation" }}
    >
      <table className="grid-table">
        <tbody>
          {rowsDescending.map((row) => {
            const rowInfo = props.pattern.rows[row - 1];
            const isFollowCurrent = props.followRow === row;
            // cells render in column order: column 1 is the leftmost cell
            const order: number[] = [];
            for (let col = 1; col <= props.pattern.width; col++) order.push(col);
            const rowCells = props.pattern.cells.filter((cell) => cell.row === row);
            const byCol = new Map(rowCells.map((cell) => [cell.col, cell]));
            return (
              <div
                key={row}
                role="row"
                className="grid-motion-row"
                data-row={row}
                data-side={side(row)}
                data-used={rowInfo?.used ?? 0}
                data-made={rowInfo?.made ?? 0}
                data-count-state={rowInfo?.state ?? "empty"}
                data-notes={(rowInfo?.notes ?? 0) > 0 ? String(rowInfo.notes) : undefined}
                data-follow={
                  props.followRow === null || props.followRow === undefined
                    ? undefined
                    : isFollowCurrent
                      ? "current"
                      : row < props.followRow
                        ? "done"
                        : "todo"
                }
              >
                <span role="rowheader" className="rowhead">
                  {props.pattern.mode === "round" ? `Rnd ${row}` : `Row ${row}`}
                </span>
                {order.map((col) => {
                  const cell = byCol.get(col)!;
                  const repeat = repeatByCol(row, col);
                  const isCursor = props.cursor?.row === row && props.cursor?.col === col;
                  const selected =
                    props.selection &&
                    row >= Math.min(props.selection.fromRow, props.selection.toRow) &&
                    row <= Math.max(props.selection.fromRow, props.selection.toRow) &&
                    col >= Math.min(props.selection.fromCol, props.selection.toCol) &&
                    col <= Math.max(props.selection.fromCol, props.selection.toCol);
                  const peerEntry = Object.entries(props.peers).find(
                    ([, position]) => position.row === row && position.col === col,
                  );
                  const glyph = stitchGlyph(cell.stitch);
                  const diff = props.diffByCell?.get(`${row}:${col}`);
                  return (
                    <div
                      key={col}
                      role="gridcell"
                      className="cell"
                      data-row={row}
                      data-col={col}
                      data-stitch={cell.stitch}
                      data-colour={cell.colour}
                      data-repeat={repeat}
                      data-rev={cell.rev}
                      data-cursor={isCursor ? "true" : undefined}
                      tabIndex={isCursor ? 0 : -1}
                      aria-label={cellLabel(cell, side(row))}
                      aria-selected={selected ? "true" : undefined}
                      data-lift={lifted.has(String(col)) ? "twin" : undefined}
                      data-motion={props.flashCells?.has(`${row}:${col}`) && !props.reducedMotion ? "flash" : undefined}
                      data-outline={
                        props.flashCells?.has(`${row}:${col}`) && props.reducedMotion ? "static" : undefined
                      }
                      data-diff={diff}
                      onFocus={() => props.onCursor?.(row, col)}
                    >
                      {peerEntry ? (
                        <span className="cursor-peer" data-peer={peerEntry[0]} aria-hidden="true" />
                      ) : null}
                      {cell.stitch !== "ns" ? (
                        <svg viewBox="0 0 20 20" aria-hidden="true">
                          <path d={glyph.path} stroke="currentColor" strokeWidth="1.4" fill="none" />
                        </svg>
                      ) : null}
                    </div>
                  );
                })}
                <span role="gridcell" className="count-cell" data-count>
                  {rowInfo?.made ?? 0}
                </span>
              </div>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Written lines, one row card per non-empty row. */
export function WrittenLines(props: {
  pattern: PatternData;
  onEdit?: (row: number) => void;
  onPin?: (row: number) => void;
  pinnedRows?: Set<number>;
  liftedToken?: { row: number; tokenIndex: number } | null;
  onTokenLift?: (row: number, tokenIndex: number, cols: number[]) => void;
  onTokenLeave?: () => void;
  readOnly?: boolean;
}): JSX.Element {
  const rows = props.pattern.rows.filter((row: RowData) => row.state !== "empty");
  return (
    <ul className="panel-list" aria-label="Written instructions" role="list">
      {rows.map((row) => {
        const tokens = (row as RowData & { tokens?: TokenData[] }).tokens ?? [];
        const isPinned = props.pinnedRows?.has(row.row);
        const isLiftedRow = props.liftedToken?.row === row.row;
        return (
          <li key={row.row} className="line-card" data-row={row.row} data-lift={isLiftedRow ? "twin" : undefined}>
            <span className="line-tile" data-side={row.side === "RS" ? "RS" : "WS"}>
              {row.side === "RND" ? "Rnd" : row.side}
            </span>
            <span className="line-text" data-line>
              {tokens.length > 0 ? renderTokens(row, tokens, props) : row.text}
            </span>
            {props.onEdit && !props.readOnly ? (
              <button type="button" className="button-plain" onClick={() => props.onEdit?.(row.row)}>
                {`Edit row ${row.row}`}
              </button>
            ) : null}
            <button
              type="button"
              className="pin-arrow"
              aria-label={`Pin row ${row.row}`}
              data-pinned={isPinned ? "true" : undefined}
              data-lift={isLiftedRow ? "true" : undefined}
              onClick={() => props.onPin?.(row.row)}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M3 10h13M12.5 5.5 17 10l-4.5 4.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
              </svg>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function renderTokens(
  row: RowData,
  tokens: TokenData[],
  props: {
    liftedToken?: { row: number; tokenIndex: number } | null;
    onTokenLift?: (row: number, tokenIndex: number, cols: number[]) => void;
    onTokenLeave?: () => void;
  },
): JSX.Element {
  const parts: JSX.Element[] = [];
  let index = 0;
  const text = row.text;
  let consumed = 0;
  for (const token of tokens) {
    const position = text.indexOf(token.text, consumed);
    if (position > consumed) {
      parts.push(<span key={`gap-${parts.length}`}>{text.slice(consumed, position)}</span>);
    }
    const isLifted = props.liftedToken?.row === row.row && props.liftedToken?.tokenIndex === index;
    parts.push(
      <span
        key={`token-${index}`}
        data-token=""
        data-lift={isLifted ? "twin" : undefined}
        tabIndex={index === 0 ? 0 : -1}
        data-index={index}
        onMouseEnter={() => props.onTokenLift?.(row.row, index, token.cols)}
        onFocus={() => props.onTokenLift?.(row.row, index, token.cols)}
        onMouseLeave={() => props.onTokenLeave?.()}
        onBlur={() => props.onTokenLeave?.()}
        aria-current={isLifted ? "true" : undefined}
      >
        {token.text}
      </span>,
    );
    consumed = position + token.text.length;
    index++;
  }
  if (consumed < text.length) {
    parts.push(<span key={`tail-${parts.length}`}>{text.slice(consumed)}</span>);
  }
  return <>{parts}</>;
}
