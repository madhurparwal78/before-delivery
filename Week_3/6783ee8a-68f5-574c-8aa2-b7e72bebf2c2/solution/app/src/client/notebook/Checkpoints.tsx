import { useEffect, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { Checkpoint, CompareRow } from "../../shared/api";
import { prefersReducedMotion } from "../components/Dialog";
import type { NotebookState } from "./model";
import type { NotebookStore } from "./store";

const when = (iso: string): string => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const windowName = (cp: Checkpoint): string => `Compare #${cp.number} ${cp.label}`;

interface Props {
  store: NotebookStore;
  state: NotebookState;
}

function Window({ cp, store, index, count, chosen }: { cp: Checkpoint; store: NotebookStore; index: number; count: number; chosen: boolean }): ReactNode {
  return (
    <button
      type="button"
      id={`cp-window-${cp.id}`}
      className={`cp-window${chosen ? " chosen" : ""}`}
      style={{ "--depth": count - 1 - index, "--layer": count - index } as React.CSSProperties}
      aria-label={windowName(cp)}
      onClick={() => store.command(() => store.compare(cp))}
    >
      <span className="cp-bar" aria-hidden="true">
        <span className="dots"><i /><i /><i /></span>
        <span className="cp-label">{cp.label}</span>
        <span className="cp-number tabular">{`#${cp.number}`}</span>
      </span>
      <span className="cp-body" aria-hidden="true">
        <span className="cp-line wide" /><span className="cp-line" /><span className="cp-line mid" />
        <span className="cp-meta"><span className="italic">{when(cp.created_at)}</span><span>Saved</span></span>
      </span>
    </button>
  );
}

/** The checkpoint panel: the three newest checkpoints as overlapping windows, older ones in a list. */
export function CheckpointPanel({ store, state }: Props): ReactNode {
  const newest = state.checkpoints.slice(0, 3);
  const older = state.checkpoints.slice(3);
  const last = useRef<string | null>(null);
  const comparing = state.comparison !== null;
  if (state.comparison) last.current = state.comparison.checkpoint.id;

  useEffect(() => {
    if (!comparing && last.current) document.getElementById(`cp-window-${last.current}`)?.focus();
  }, [comparing]);

  return (
    <aside className="cp-panel" inert={comparing}>
      <section role="region" aria-label="Checkpoints" className="cp-region">
        <h2>Checkpoints</h2>
        {state.checkpoints.length === 0 && <p className="muted">No checkpoints yet. Press Ctrl+S to save one.</p>}
        <div className={`cascade${comparing ? " comparing" : ""}`} style={{ "--count": newest.length } as React.CSSProperties}>
          {newest.map((cp, index) => (
            <Window key={cp.id} cp={cp} store={store} index={index} count={newest.length} chosen={state.comparison?.checkpoint.id === cp.id} />
          ))}
        </div>
        {older.length > 0 && (
          <>
            <h3>Older checkpoints</h3>
            <ul aria-label="Older checkpoints" className="cp-older">
              {older.map((cp) => (
                <li key={cp.id}>
                  <button type="button" id={`cp-window-${cp.id}`} className="btn" aria-label={windowName(cp)} onClick={() => store.command(() => store.compare(cp))}>
                    {`${cp.label} #${cp.number}`}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </aside>
  );
}

function SourceView({ row, side }: { row: CompareRow; side: "left" | "right" }): ReactNode {
  const cell = side === "left" ? row.checkpoint_cell : row.current_cell;
  if (!cell) return <p className="muted italic">{side === "left" ? "Not in this checkpoint" : "Not in the current notebook"}</p>;
  if (row.tag !== "Modified") return <pre className="cmp-source">{cell.source || " "}</pre>;
  const keep = side === "left" ? "removed" : "added";
  return (
    <pre className="cmp-source">
      {row.source_diff
        .filter((line) => line.op === "same" || line.op === keep)
        .map((line, index) => (
          <span key={index} className={`diff-line ${line.op}`}>{`${line.op === "same" ? "  " : line.op === "added" ? "+ " : "− "}${line.line}\n`}</span>
        ))}
    </pre>
  );
}

/** The chosen window travelling between its place in the cascade and the left half; the split itself never moves. */
function fly(from: DOMRect, to: DOMRect, label: string, done?: () => void): void {
  if (prefersReducedMotion()) return done?.();
  const box = document.createElement("div");
  box.className = "fly";
  box.setAttribute("aria-hidden", "true");
  box.textContent = label;
  Object.assign(box.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` });
  document.body.append(box);
  const motion = box.animate(
    [{ transform: "none" }, { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})` }],
    { duration: 340, easing: "ease" },
  );
  motion.onfinish = () => {
    box.remove();
    done?.();
  };
}

/** The comparison: the chosen checkpoint on the left, the current notebook on the right, rows paired top to bottom. */
export function Comparison({ store, state }: Props): ReactNode {
  const shown = state.comparison;
  const left = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (!shown || !left.current) return;
    const from = document.getElementById(`cp-window-${shown.checkpoint.id}`)?.getBoundingClientRect();
    if (from) fly(from, left.current.getBoundingClientRect(), shown.checkpoint.label);
  }, [shown?.checkpoint.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!shown) return null;
  const { checkpoint, result } = shown;
  const { counts } = result;

  const close = (): void => {
    const from = document.getElementById(`cp-window-${checkpoint.id}`)?.getBoundingClientRect();
    if (!from || !left.current) return store.closeComparison();
    fly(left.current.getBoundingClientRect(), from, checkpoint.label, () => store.closeComparison());
  };

  return (
    <section role="region" aria-label="Checkpoint comparison" className="comparison">
      <div className="cmp-head">
        <h2>{`${counts.modified} modified, ${counts.added} added, ${counts.removed} removed, ${counts.moved} moved`}</h2>
        <div className="cmp-actions">
          {store.canEdit && <button type="button" className="btn btn-accent" onClick={() => store.open({ kind: "revert", checkpoint, cellId: null })}>Revert notebook</button>}
          <button type="button" className="btn" onClick={close}>Close comparison</button>
        </div>
      </div>
      <div className="split" style={{ "--rows": result.rows.length } as React.CSSProperties}>
        <section role="region" aria-label={`Checkpoint #${checkpoint.number}`} className="half left" ref={left}>
          <h3 className="half-title"><span className="dots" aria-hidden="true"><i /><i /><i /></span>{` ${checkpoint.label} · #${checkpoint.number} `}<span className="italic muted">{when(checkpoint.created_at)}</span></h3>
          {result.rows.map((row, index) => {
            const id = (row.checkpoint_cell ?? row.current_cell)?.id ?? "";
            return (
              <div key={`${id}-${index}`} role="group" aria-label={`Row ${index + 1}: ${row.tag}`} className="row-cell">
                <p className="tag-line"><span className={`tag ${row.tag.toLowerCase()}`}>{row.tag}</span>{row.output_changed && <span className="note">Output changed</span>}</p>
                <SourceView row={row} side="left" />
                {store.canEdit && (
                  <button type="button" className="btn small" disabled={row.tag === "Unchanged" && !row.output_changed} onClick={() => store.open({ kind: "revert", checkpoint, cellId: id })}>
                    Revert this cell
                  </button>
                )}
              </div>
            );
          })}
        </section>
        <section role="region" aria-label="Current notebook" className="half right">
          <h3 className="half-title">Current notebook</h3>
          {result.rows.map((row, index) => (
            <div key={index} className="row-cell">
              <p className="tag-line"><span className="tag-spacer" aria-hidden="true">{row.tag}</span></p>
              <SourceView row={row} side="right" />
            </div>
          ))}
        </section>
      </div>
    </section>
  );
}
