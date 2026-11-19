import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import type { BlockDetail, BlockShares, NamespaceInfo, ShareCell } from "../../shared/api.ts";
import { parseShare } from "../../shared/share.ts";
import { display } from "../lib/config.ts";
import { cssVarsOf } from "../lib/cssVars.ts";
import { namespaceStyle } from "../lib/namespaceStyle.ts";
import { useReducedMotion } from "../lib/motion.ts";
import { Dialog } from "./Dialog.tsx";

/** Rows of a newly arrived square appear top to bottom at the published pace; reduced motion shows them all at once. */
function useRevealedRows(height: number, rows: number): number {
  const reduced = useReducedMotion();
  const [state, setState] = useState({ height, count: rows, animating: false });
  const current = state.height === height ? state : { height, count: reduced ? rows : 1, animating: !reduced && rows > 1 };
  if (state.height !== height) setState(current);

  useEffect(() => {
    if (!current.animating) return;
    const timers: number[] = [];
    for (let row = 1; row < rows; row++) {
      timers.push(window.setTimeout(() => {
        flushSync(() => setState((old) => (old.height === height ? { ...old, count: Math.max(old.count, row + 1) } : old)));
      }, row * display.squareRowRevealMs));
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [height, rows, current.animating]);

  return Math.min(current.count, rows);
}

function cellLabel(cell: ShareCell, namespaces: NamespaceInfo[]): string {
  if (cell.kind === "withheld") return "Withheld";
  if (cell.kind === "parity") return "Parity";
  if (cell.kind === "padding") return "Padding";
  return namespaces.find((namespace) => namespace.hex === cell.namespace)?.name ?? cell.namespace;
}

function SharePanel({ cell, onClose }: { cell: ShareCell; onClose: () => void }) {
  const share = cell.share === null ? null : parseShare(cell.share, cell.quadrant === "Q0");
  return (
    <Dialog label={`Share ${cell.row}, ${cell.col}`} onClose={onClose} className="share-panel">
      <h2 className="dialog__title">Share {cell.row}, {cell.col}</h2>
      <p>Namespace <code>{cell.namespace}</code></p>
      {share === null ? (
        <p>This share was withheld by the producer, so its bytes are not served.</p>
      ) : (
        <>
          <p>Info byte <code>{share.infoByte}</code></p>
          {share.sequenceLength !== null && <p>Sequence length {share.sequenceLength} bytes</p>}
          <p>Data <code className="wrap">{share.dataHex}</code></p>
        </>
      )}
      <button type="button" className="pill pill--outline" onClick={onClose}>Close</button>
    </Dialog>
  );
}

interface SquareGridProps {
  block: BlockDetail;
  shares: BlockShares;
  namespaces: NamespaceInfo[];
  meId: string;
  /** Positions ("r,c") drawn with an outline: this blob's cells on the blob page. */
  outline?: ReadonlySet<string>;
}

export function SquareGrid({ block, shares, namespaces, meId, outline }: SquareGridProps) {
  const size = shares.k * 2;
  const revealed = useRevealedRows(block.height, size);
  const grid = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState({ row: 0, col: 0 });
  const [open, setOpen] = useState<ShareCell | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  const mine = new Set(block.blobs.filter((blob) => blob.sender === meId).flatMap((blob) => blob.positions.map(([r, c]) => `${r},${c}`)));

  useLayoutEffect(() => {
    const box = frame.current as HTMLDivElement;
    const measure = () => setScrolls(box.scrollWidth > box.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [size]);

  const moveTo = (row: number, col: number) => {
    setFocus({ row, col });
    grid.current?.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const { row, col } = focus;
    const last = size - 1;
    const keys: Record<string, [number, number]> = {
      ArrowUp: [Math.max(0, row - 1), col],
      ArrowDown: [Math.min(last, row + 1), col],
      ArrowLeft: [row, Math.max(0, col - 1)],
      ArrowRight: [row, Math.min(last, col + 1)],
      Home: event.ctrlKey ? [0, 0] : [row, 0],
      End: event.ctrlKey ? [last, last] : [row, last],
    };
    const target = keys[event.key];
    if (target) {
      event.preventDefault();
      moveTo(target[0], target[1]);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(shares.rows[row]?.[col] ?? null);
    }
  };

  return (
    <>
    <div ref={frame} className="square-frame" data-scrolls={scrolls ? "true" : undefined}>
      <div ref={grid} role="grid" aria-label={`Data square, block ${block.height}`} className="square" onKeyDown={onKeyDown}
        style={cssVarsOf({ "--n": size })} aria-rowcount={size} aria-colcount={size}>
        {shares.rows.map((cells, r) => (
          <div key={r} role="row" data-row={r} data-revealed={String(r < revealed)} className="square__row">
            {cells.map((cell) => {
              const isMine = mine.has(`${cell.row},${cell.col}`);
              return (
                <div key={cell.col} role="gridcell" className="cell" tabIndex={focus.row === cell.row && focus.col === cell.col ? 0 : -1}
                  aria-label={`Share ${cell.row}, ${cell.col}: ${cellLabel(cell, namespaces)}`}
                  data-row={cell.row} data-col={cell.col} data-quadrant={cell.quadrant} data-namespace={cell.namespace}
                  data-kind={cell.kind} data-share={cell.share ?? ""} data-mine={isMine ? "true" : undefined}
                  data-outlined={outline?.has(`${cell.row},${cell.col}`) ? "true" : undefined}
                  style={cell.kind === "blob" ? namespaceStyle(cell.namespace) : undefined}
                  onFocus={() => setFocus({ row: cell.row, col: cell.col })}
                  onClick={(event) => {
                    event.currentTarget.focus();
                    setOpen(cell);
                  }} />
              );
            })}
          </div>
        ))}
      </div>
      {open && <SharePanel cell={open} onClose={() => setOpen(null)} />}
    </div>
    {scrolls && <p className="square-caption">Scroll sideways to see all shares</p>}
    </>
  );
}

export function sharesSeedText(shares: BlockShares, namespace: string): string {
  return shares.rows.flat().filter((cell) => cell.namespace === namespace && cell.share).map((cell) => cell.share).join("");
}
