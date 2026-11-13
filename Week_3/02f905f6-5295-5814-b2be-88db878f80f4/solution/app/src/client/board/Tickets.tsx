// The ticket column: queued pieces as booklet stubs, oldest first. A stub that leaves collapses out
// and the column closes up; a stub that comes back opens in.
import { useLayoutEffect, useRef, useState } from "react";
import type { Piece } from "../../shared/api";
import { EmptySlip } from "../components/EmptySlip";
import { money } from "../format";
import { DURATION, prefersReducedMotion, tween } from "../motion";

interface Row {
  piece: Piece;
  phase: "in" | "enter" | "exit";
}

function Stub({ row, mismatch, disabled, selected, onPick, onGone }: { row: Row; mismatch: string | null; disabled: boolean; selected: boolean; onPick: (piece: Piece, element: HTMLElement) => void; onGone: (number: string) => void }) {
  const ref = useRef<HTMLLIElement>(null);
  const { piece, phase } = row;
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || phase === "in") return;
    const height = element.scrollHeight;
    element.style.overflow = "hidden";
    const finish = () => {
      element.style.removeProperty("height");
      element.style.removeProperty("overflow");
      element.style.removeProperty("opacity");
      element.style.removeProperty("transform");
      if (phase === "exit") onGone(piece.number);
    };
    return tween(
      DURATION.stubExit,
      (p) => {
        const t = phase === "exit" ? 1 - p : p;
        element.style.height = `${height * t}px`;
        element.style.opacity = String(t);
        element.style.transform = `translateX(${(1 - t) * 24}px)`;
      },
      finish,
    );
  }, [phase]);
  const sides = piece.sides_in;
  const sizes = piece.shape === "rectangular" ? `${sides.length} × ${sides.width} × ${sides.height} in` : `⌀ ${sides.diameter} × ${sides.height} in`;
  return (
    <li ref={ref} className={`stub-item${phase === "exit" ? " leaving" : ""}`}>
      <button
        type="button"
        className={`stub stub-button${selected ? " is-selected" : ""}${mismatch ? " is-mismatch" : ""}`}
        aria-label={`Pick Piece ${piece.number}`}
        aria-disabled={disabled || phase === "exit" ? true : undefined}
        tabIndex={phase === "exit" ? -1 : 0}
        data-stub={piece.number}
        onClick={(event) => {
          if (!disabled && phase !== "exit") onPick(piece, event.currentTarget);
        }}
      >
        <span className="stub-top">
          <span className="num-strong stub-number">{piece.number}</span>
          <span className="num stub-fee">{money(piece.fee_cents)}</span>
        </span>
        <span className="num stub-sizes">{sizes}</span>
        <span className="stub-stage">{piece.stage === "glaze" ? <>Glaze · <span className="num">cone {piece.cone}</span></> : "Bisque"}</span>
        {mismatch ? <span className="stub-note">{mismatch}</span> : null}
      </button>
    </li>
  );
}

export function Tickets({ queue, loaded, firingStage, canPick, selected, onPick }: { queue: Piece[]; loaded: boolean; firingStage: string | null; canPick: boolean; selected: string | null; onPick: (piece: Piece, element: HTMLElement) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const first = useRef(true);

  useLayoutEffect(() => {
    if (!loaded) return;
    const animate = !first.current && !prefersReducedMotion();
    first.current = false;
    setRows((current) => {
      const incoming = new Set(queue.map((p) => p.number));
      const known = new Map(current.map((r) => [r.piece.number, r]));
      const next: Row[] = queue.map((piece) => {
        const was = known.get(piece.number);
        return { piece, phase: was && was.phase !== "exit" ? was.phase : animate ? "enter" : "in" };
      });
      if (animate) {
        for (const row of current) if (!incoming.has(row.piece.number)) next.push({ piece: row.piece, phase: "exit" });
      }
      return next.sort((a, b) => a.piece.number.localeCompare(b.piece.number));
    });
  }, [queue, loaded]);

  const gone = (number: string) => setRows((current) => current.filter((r) => !(r.piece.number === number && r.phase === "exit")));
  const live = rows.filter((r) => r.phase !== "exit").length;

  return (
    <section className="tickets" aria-labelledby="tickets-title">
      <div className="tickets-head">
        <h2 id="tickets-title">Tickets</h2>
        <span className="muted small">
          <span className="num">{live}</span> waiting
        </span>
      </div>
      {!canPick && live > 0 ? <p className="small muted">Create a firing on this kiln to start packing.</p> : null}
      {loaded && live === 0 ? <EmptySlip>The queue is empty. New tickets arrive from the intake bench and the counter.</EmptySlip> : null}
      <ul className="stub-list" aria-label="Queued pieces">
        {rows.map((row) => (
          <Stub
            key={`${row.piece.number}-${row.phase === "exit" ? "x" : "i"}`}
            row={row}
            mismatch={firingStage && row.piece.stage !== firingStage ? `Needs a ${row.piece.stage} firing` : null}
            disabled={!canPick}
            selected={selected === row.piece.number}
            onPick={onPick}
            onGone={gone}
          />
        ))}
      </ul>
    </section>
  );
}
