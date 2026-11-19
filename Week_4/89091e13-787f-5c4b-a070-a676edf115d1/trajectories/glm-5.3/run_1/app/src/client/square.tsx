// The data square grid: keyboard navigation, share panel and reveal timing.
// Exactly one cell is in the tab order; arrows move, Enter opens the panel.

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { bytesToHex, hexToBytes, sequenceLengthOf } from "../shared/domain.js";
import type { ShareBody } from "./api.js";

export interface CellMeta {
  row: number;
  col: number;
  quadrant: string;
  namespace: string;
  kind: string;
  share: string | null;
  mine: boolean;
  label: string;
}

export function cellLabel(share: ShareBody, namespaceNames: Map<string, string>): string {
  if (share.kind === "withheld") return "Withheld";
  if (share.kind === "padding") return "Padding";
  if (share.kind === "parity") return "Parity";
  return namespaceNames.get(share.namespace) ?? "Blob";
}

export function squareCells(
  rows: ShareBody[][],
  mineBlobIds: Set<string>,
  blobPositions: Map<string, [number, number][]>,
  namespaceNames: Map<string, string>,
): CellMeta[] {
  const cells: CellMeta[] = [];
  const minePositions = new Set<string>();
  for (const [blobId, positions] of blobPositions) {
    if (!mineBlobIds.has(blobId)) continue;
    for (const [row, col] of positions) minePositions.add(`${row},${col}`);
  }
  for (const row of rows) {
    for (const share of row) {
      cells.push({
        row: share.row,
        col: share.col,
        quadrant: share.quadrant,
        namespace: share.namespace,
        kind: share.kind,
        share: share.share,
        mine: minePositions.has(`${share.row},${share.col}`),
        label: cellLabel(share, namespaceNames),
      });
    }
  }
  return cells;
}

export interface SquareGridProps {
  height: number;
  k: number;
  cells: CellMeta[];
  focus: { row: number; col: number } | null;
  onFocusChange: (focus: { row: number; col: number }) => void;
  onOpenShare: (cell: CellMeta) => void;
  revealedRows: Set<number>;
  revealMs: number;
  reducedMotion: boolean;
}

export function SquareGrid({
  height,
  k,
  cells,
  focus,
  onFocusChange,
  onOpenShare,
  revealedRows,
  revealMs,
  reducedMotion,
}: SquareGridProps): JSX.Element {
  const width = 2 * k;
  const cellAt = (row: number, col: number): CellMeta | undefined => cells[row * width + col];
  const [tabIndex] = useState(0);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!focus) return;
    const { row, col } = focus;
    let next: { row: number; col: number } | null = null;
    switch (event.key) {
      case "ArrowUp":
        next = { row: Math.max(0, row - 1), col };
        break;
      case "ArrowDown":
        next = { row: Math.min(width - 1, row + 1), col };
        break;
      case "ArrowLeft":
        next = { row, col: Math.max(0, col - 1) };
        break;
      case "ArrowRight":
        next = { row, col: Math.min(width - 1, col + 1) };
        break;
      case "Home":
        next = event.ctrlKey ? { row: 0, col: 0 } : { row, col: 0 };
        break;
      case "End":
        next = event.ctrlKey ? { row: width - 1, col: width - 1 } : { row, col: width - 1 };
        break;
      case "Enter": {
        const cell = cellAt(row, col);
        if (cell) onOpenShare(cell);
        event.preventDefault();
        return;
      }
      default:
        return;
    }
    event.preventDefault();
    if (next) onFocusChange(next);
  };

  return (
    <div className="square-frame">
      <div
        role="grid"
        aria-label={`Data square, block ${height}`}
        className="square-grid"
        style={{ gridTemplateColumns: `repeat(${width}, auto)` }}
        onKeyDown={handleKeyDown}
      >
        {Array.from({ length: width }, (_, rowIndex) => (
          <div
            key={rowIndex}
            role="row"
            data-row={rowIndex}
            data-revealed={revealedRows.has(rowIndex) || reducedMotion ? "true" : "false"}
            style={{ display: "contents" }}
          >
            {Array.from({ length: width }, (_, colIndex) => {
              const cell = cellAt(rowIndex, colIndex)!;
              const isFocus = focus?.row === rowIndex && focus?.col === colIndex;
              const inTabOrder = rowIndex === 0 && colIndex === 0;
              return (
                <div
                  key={colIndex}
                  role="gridcell"
                  aria-label={`Share ${rowIndex}, ${colIndex}: ${cell.label}`}
                  tabIndex={inTabOrder ? tabIndex : -1}
                  data-row={rowIndex}
                  data-col={colIndex}
                  data-quadrant={cell.quadrant}
                  data-namespace={cell.namespace}
                  data-kind={cell.kind}
                  data-share={cell.share ?? ""}
                  data-mine={cell.mine ? "true" : undefined}
                  ref={isFocus ? (element) => element?.focus() : undefined}
                  onClick={() => {
                    onFocusChange({ row: rowIndex, col: colIndex });
                    onOpenShare(cell);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === " " || event.key === "Enter") {
                      onOpenShare(cell);
                      event.preventDefault();
                    }
                  }}
                  style={{
                    background:
                      cell.kind === "withheld"
                        ? "#1c1a26"
                        : cell.kind === "parity"
                          ? "rgba(111,127,184,0.35)"
                          : cell.kind === "padding"
                            ? "rgba(169,164,188,0.2)"
                            : `hsl(${hueOf(cell.namespace)}, 70%, ${cell.mine ? 64 : 46}%)`,
                    outline: isFocus ? "2px solid #f2f0fa" : "none",
                    outlineOffset: "-2px",
                    opacity: revealedRows.has(rowIndex) || reducedMotion ? 1 : 0.15,
                    transition: `opacity ${revealMs}ms ease`,
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function hueOf(namespace: string): number {
  const bytes = hexToBytes(namespace);
  const value = bytes[8] ?? 0;
  return 250 + ((value % 60) - 30);
}

export interface SharePanelProps {
  cell: CellMeta | null;
  onClose: () => void;
}

export function SharePanel({ cell, onClose }: SharePanelProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!cell) return;
    const node = ref.current;
    node?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key === "Tab" && node) {
        const focusables = node.querySelectorAll<HTMLElement>("[href], button");
        if (focusables.length === 0) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cell, onClose]);

  if (!cell) return <></>;
  const share = cell.share ? hexToBytes(cell.share) : null;
  const infoByte = share ? bytesToHex(share.subarray(9, 10)) : "";
  const firstShare = share ? (share[9] ?? 0) & 0x01 : 0;
  const sequenceLength = firstShare && share ? sequenceLengthOf(share) : null;
  const dataHex = share ? bytesToHex(share.subarray(firstShare ? 14 : 10)) : "";
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={`Share ${cell.row}, ${cell.col}`}
      tabIndex={-1}
      className="panel"
      style={{ marginTop: 16 }}
    >
      <h3>
        Share {cell.row}, {cell.col}
      </h3>
      <p className="mono">Namespace {cell.namespace}</p>
      <p className="mono">Info byte {infoByte}</p>
      {sequenceLength !== null && <p className="mono">Sequence length {sequenceLength} bytes</p>}
      <p className="mono" style={{ wordBreak: "break-all" }}>
        Data {dataHex}
      </p>
      <button type="button" className="pill" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

/** Rows reveal one by one at the configured pace; reduced motion shows all at once. */
export function useRowReveal(blockHeight: number, width: number, revealMs: number, reducedMotion: boolean): Set<number> {
  const [revealed, setRevealed] = useState<Set<number>>(() => new Set(reducedMotion ? range(width) : [0]));
  useEffect(() => {
    if (reducedMotion) {
      setRevealed(new Set(range(width)));
      return;
    }
    setRevealed(new Set([0]));
    const timers: number[] = [];
    for (let row = 1; row < width; row++) {
      timers.push(
        window.setTimeout(() => {
          setRevealed((previous) => new Set([...previous, row]));
        }, row * revealMs),
      );
    }
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [blockHeight, width, revealMs, reducedMotion]);
  return revealed;
}

function range(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function squareRows(cells: CellMeta[], width: number): CellMeta[][] {
  const rows: CellMeta[][] = [];
  for (let i = 0; i < cells.length; i += width) {
    rows.push(cells.slice(i, i + width));
  }
  return rows;
}

export function useMemoCells(
  shares: ShareBody[][] | null,
  mineBlobIds: Set<string>,
  blobPositions: Map<string, [number, number][]>,
  namespaceNames: Map<string, string>,
): CellMeta[] {
  return useMemo(() => {
    if (!shares) return [];
    return squareCells(shares, mineBlobIds, blobPositions, namespaceNames);
  }, [shares, mineBlobIds, blobPositions, namespaceNames]);
}

export type { ReactNode };
