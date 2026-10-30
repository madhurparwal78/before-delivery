// The drawn empty state: a lattice fragment, one sentence, and the next action when there is one.
import { navigate } from "../router.ts";

export function EmptyState({ text, action, compact = false }: { text: string; action?: string; compact?: boolean }) {
  return (
    <div className={compact ? "empty empty--compact" : "empty"}>
      {!compact && <svg viewBox="0 0 120 64" aria-hidden="true" className="empty__art">
        <path d="M8 52 L56 12 L112 12 L64 52 Z" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M30 36 H70 M44 26 H96" stroke="#C8F031" strokeWidth="6" strokeLinecap="square" />
      </svg>}
      <p>{text}</p>
      {action && <a className="button button--primary" href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>{action}</a>}
    </div>
  );
}
