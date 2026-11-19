import { ChevronLeft, ChevronRight, CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { displayNumber, plural } from "../../shared/display.js";
import { Jar } from "../components/Jar.js";
import { useShell } from "../shell/ProjectShell.js";
import { ListView, JsonView, TableView } from "./Views.js";
import type { DocumentsState, QueryAnswer, ViewName } from "./useDocuments.js";

/** The results pane: View switch, Query status and plan, error, the chosen view, pager and the writers' buttons. */

const VIEWS: [ViewName, string][] = [
  ["list", "List"],
  ["table", "Table"],
  ["json", "JSON"],
];

interface Actions {
  insert: (opener: HTMLElement) => void;
  loadFile: () => void;
  download: () => void;
  saveQuery: () => void;
}

export function Results({ state, actions }: { state: DocumentsState; actions: Actions }): ReactNode {
  const { role, collection } = useShell();
  const writer = role !== "reader";
  const { outcome, view } = state;
  const answer: QueryAnswer | null = outcome.state === "ok" ? outcome.answer : outcome.state === "pending" ? outcome.previous : null;
  const status =
    outcome.state === "pending" ? "Running query"
    : outcome.state === "refused" ? "Query not run"
    : outcome.answer.matched === 0 ? "No documents matched"
    : `${plural(outcome.answer.matched, "document")} matched, ${displayNumber(outcome.answer.documents.length)} shown`;
  const pages = answer ? Math.max(1, Math.ceil(answer.matched / answer.page_size)) : 1;
  const page = answer?.page ?? 1;
  const empty = outcome.state === "ok" && outcome.answer.matched === 0 && collection?.count === 0;
  const pending = outcome.state === "pending";

  return (
    <section className="results" aria-label="Results" aria-busy={pending || undefined}>
      <div className="results-head">
        <div role="radiogroup" aria-label="View" className="radio-group">
          {VIEWS.map(([key, label]) => (
            <label key={key} className="pill-radio">
              <input type="radio" name="results-view" checked={view === key} onChange={() => state.setView(key)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <div className="toolbar">
          {writer && !empty ? (
            <button type="button" className="btn" onClick={(event) => actions.insert(event.currentTarget)}>
              Insert document
            </button>
          ) : null}
          {writer && !empty ? (
            <button type="button" className="btn" onClick={actions.loadFile}>
              Load file
            </button>
          ) : null}
          <button type="button" className="btn" onClick={actions.download}>
            Download
          </button>
          {writer ? (
            <button type="button" className="btn" onClick={actions.saveQuery}>
              Save query
            </button>
          ) : null}
        </div>
      </div>
      <div className="results-meta">
        <p className="status-line" role="status" aria-label="Query status">
          {status}
        </p>
        <p className="plan code-pane" role="status" aria-label="Query plan" data-plan-kind={answer?.plan.kind} data-plan-index={answer ? (answer.plan.index ?? "") : undefined}>
          {answer ? (
            <>
              <span>{answer.plan.kind === "index" ? `Used index ${answer.plan.index}` : "Full scan"}</span>
              <span>
                Examined {plural(answer.plan.docs_examined, "document")}, returned {displayNumber(answer.plan.returned)}
              </span>
            </>
          ) : null}
        </p>
      </div>
      {outcome.state === "refused" ? (
        <p className="error-chip error-block" role="alert" aria-label="Query error">
          <CircleAlert size={18} aria-hidden="true" />
          {outcome.message}
        </p>
      ) : null}
      {empty ? (
        <div className="empty view">
          <Jar />
          <h2 className="giant">NOTHING IN THIS JAR YET</h2>
          {writer ? (
            <div className="actions">
              <button type="button" className="btn btn-ink" onClick={actions.loadFile}>
                Load file
              </button>
              <button type="button" className="btn btn-ink" onClick={(event) => actions.insert(event.currentTarget)}>
                Insert document
              </button>
            </div>
          ) : null}
        </div>
      ) : pending && !answer ? (
        <div className="skeleton-stack" aria-hidden="true">
          <div className="skeleton-block" />
          <div className="skeleton-block" />
          <div className="skeleton-block" />
        </div>
      ) : answer ? (
        <div className="view">
          {view === "list" ? <ListView page={answer} open={state.openDocument} /> : null}
          {view === "table" ? <TableView page={answer} open={state.openDocument} /> : null}
          {view === "json" ? <JsonView page={answer} open={state.openDocument} /> : null}
        </div>
      ) : null}
      <div className="pager">
        <button type="button" className="btn btn-icon-text" disabled={page <= 1} onClick={() => state.goToPage(page - 1)}>
          <ChevronLeft size={18} aria-hidden="true" />
          <span className="visually-hidden">Previous page</span>
        </button>
        <span className="pager-text">
          Page {displayNumber(page)} of {displayNumber(pages)}
        </span>
        <button type="button" className="btn btn-icon-text" disabled={page >= pages} onClick={() => state.goToPage(page + 1)}>
          <span className="visually-hidden">Next page</span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
