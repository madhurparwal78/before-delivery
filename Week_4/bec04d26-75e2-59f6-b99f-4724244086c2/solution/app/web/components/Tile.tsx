import { foldedReturnSvg } from "../../shared/tile";
import type { ReturnView } from "../../shared/types";

/** The data attributes every shown return carries. */
export function returnData(r: ReturnView) {
  return {
    "data-return-id": r.id, "data-status": r.status, "data-overdue": String(r.overdue), "data-due-at": r.due_at,
    "data-state": r.state, "data-version": r.version, "data-rate": r.edition.rate, "data-edition": r.edition.effective_date,
  };
}

/** One flat coloured tile holding the drawn, folded return, with the return's data attributes. */
export function ReturnTile({ view, className = "" }: { view: ReturnView; className?: string }) {
  return (
    <div className={`tile tone-${view.tone} ${className}`} {...returnData(view)}
      dangerouslySetInnerHTML={{ __html: foldedReturnSvg(view.state, view.period_label, view.tone) }} />
  );
}

export function EmptyTile({ children }: { children: string }) {
  return (
    <div className="empty">
      <div className="tile tone-sage" aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}
