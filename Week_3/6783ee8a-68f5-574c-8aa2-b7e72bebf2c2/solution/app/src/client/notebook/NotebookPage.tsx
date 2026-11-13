import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { FileQuestion } from "lucide-react";
import { Link } from "../components/Link";
import { SiteHeader } from "../components/SiteHeader";
import { useNarrow } from "../useNarrow";
import { CheckpointPanel, Comparison } from "./Checkpoints";
import { Announcer, Contents, NotebookHeader, Outage, Toolbar } from "./Chrome";
import { Cells } from "./Cells";
import { ConflictDialog, DrawerDialog, PaletteDialog, RestartDialog, RevertDialog, ShareDialog, SheetDialog } from "./Dialogs";
import { useNotebookKeys } from "./keys";
import { NotebookStore } from "./store";

function NotFoundScreen(): ReactNode {
  return (
    <>
      <SiteHeader />
      <main className="band empty-screen">
        <div className="container empty">
          <FileQuestion size={56} strokeWidth={1.5} aria-hidden="true" />
          <h1>Notebook not found</h1>
          <p>
            <Link className="btn" to="/notebooks">Back to your notebooks</Link>
          </p>
        </div>
      </main>
    </>
  );
}

/** One open notebook: header, toolbar, contents, cells, and the panels and dialogs on top. */
export function NotebookPage({ id }: { id: string }): ReactNode {
  const store = useMemo(() => new NotebookStore(id), [id]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const narrow = useNarrow();
  useNotebookKeys(store);

  useEffect(() => {
    void store.load();
    return () => store.dispose();
  }, [store]);

  if (state.phase === "notfound") return <NotFoundScreen />;
  if (state.phase !== "ready" || !state.meta) {
    return (
      <>
        <SiteHeader />
        <main className="band"><div className="container"><p className="muted">{state.phase === "failed" ? "This notebook could not be opened." : "Loading…"}</p></div></main>
      </>
    );
  }

  const dialog = state.dialog;
  return (
    <div className="nb-app">
      <NotebookHeader store={store} state={state} narrow={narrow} />
      <Announcer state={state} />
      <Toolbar store={store} state={state} />
      <Outage state={state} />
      <div className={`nb-main${state.panelOpen ? " panel-open" : ""}`}>
        {!narrow && (
          <aside className="nb-toc">
            <Contents store={store} state={state} />
          </aside>
        )}
        <main className="nb-cells">
          {narrow && (
            <button type="button" className="btn toc-open" onClick={() => store.open({ kind: "drawer" })} aria-label="Show table of contents">
              Contents
            </button>
          )}
          <Cells store={store} state={state} narrow={narrow} />
        </main>
        {state.panelOpen && <CheckpointPanel store={store} state={state} />}
        {state.comparison && <Comparison store={store} state={state} />}
      </div>
      {dialog?.kind === "restart" && <RestartDialog store={store} state={state} />}
      {dialog?.kind === "conflict" && <ConflictDialog store={store} state={state} />}
      {dialog?.kind === "revert" && <RevertDialog store={store} state={state} />}
      {dialog?.kind === "drawer" && <DrawerDialog store={store} state={state} />}
      {dialog?.kind === "sheet" && <SheetDialog store={store} state={state} />}
      {dialog?.kind === "palette" && <PaletteDialog store={store} />}
      {dialog?.kind === "share" && <ShareDialog store={store} state={state} />}
    </div>
  );
}
