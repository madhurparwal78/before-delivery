import { type ReactNode, useRef, useState } from "react";
import { Dialog, useOverlay } from "../components/Dialog.js";
import { Separator } from "../components/Separator.js";
import { type TabName, Tabs } from "../components/Tabs.js";
import { DownloadDialog, LoadFileDialog, SaveQueryDialog } from "../documents/Dialogs.js";
import { Editor } from "../documents/Editor.js";
import { QueryBar } from "../documents/QueryBar.js";
import { Results } from "../documents/Results.js";
import { type DocumentsState, useDocuments } from "../documents/useDocuments.js";
import { type Layout, useLayout } from "../hooks.js";
import { PipelineBuilder } from "../pipeline/PipelineBuilder.js";
import type { Route } from "../router.js";

/** The Documents and Pipeline workspaces at the three published layouts (rail, list and editor side by side; stacked; tabs). */

type CollectionRoute = Extract<Route, { name: "collection" }>;

export function Workspace({ route }: { route: CollectionRoute }): ReactNode {
  const layout = useLayout();
  if (layout !== "phone" && route.section === "pipeline") {
    return (
      <>
        <h1 className="visually-hidden">Pipeline</h1>
        <PipelineBuilder />
      </>
    );
  }
  return <DocumentsWorkspace route={route} layout={layout} />;
}

function EditorHost({ state, layout }: { state: DocumentsState; layout: Layout }): ReactNode {
  if (!state.editorOpen) {
    return layout === "desktop" ? (
      <section className="editor-column" role="region" aria-label="Document editor">
        <p className="placeholder">Open a document to see it here</p>
      </section>
    ) : null;
  }
  const editor = (
    <Editor
      key={state.did ?? "new"}
      did={state.did}
      asDialog={layout === "phone"}
      preload={state.preload.current}
      onClose={state.closeEditor}
      onSaved={state.documentSaved}
      onDeleted={state.documentDeleted}
    />
  );
  if (layout === "phone") {
    return (
      <Dialog name="Document" variant="full" onClose={state.closeEditor}>
        {editor}
      </Dialog>
    );
  }
  return (
    <section className="editor-column" role="region" aria-label="Document editor">
      {editor}
    </section>
  );
}

function DocumentsWorkspace({ route, layout }: { route: CollectionRoute; layout: Layout }): ReactNode {
  const state = useDocuments(route.did);
  const dialog = useOverlay<"save" | "load" | "download">();
  const [split, setSplit] = useState(30);
  const [tab, setTab] = useState<TabName>(route.section === "pipeline" ? "Pipeline" : "Query");
  const [focusRequest, setFocusRequest] = useState<{ tab: TabName } | null>(null);
  const column = useRef<HTMLDivElement>(null);

  const run = (): void => {
    state.run();
    if (layout === "phone") {
      setTab("Results");
      setFocusRequest({ tab: "Results" });
    }
  };
  const query = <QueryBar form={state.form} onChange={state.setForm} onRun={run} />;
  const results = (
    <Results
      state={state}
      actions={{ insert: (opener) => state.startInsert(opener), loadFile: () => dialog.open("load"), download: () => dialog.open("download"), saveQuery: () => dialog.open("save") }}
    />
  );
  const dialogs = (
    <>
      {dialog.slot?.value === "save" ? <SaveQueryDialog key={dialog.slot.id} form={state.form} onClose={dialog.closeFor(dialog.slot.id)} /> : null}
      {dialog.slot?.value === "load" ? <LoadFileDialog key={dialog.slot.id} onClose={dialog.closeFor(dialog.slot.id)} /> : null}
      {dialog.slot?.value === "download" ? <DownloadDialog key={dialog.slot.id} applied={state.applied.current} onClose={dialog.closeFor(dialog.slot.id)} /> : null}
    </>
  );

  if (layout === "phone") {
    return (
      <>
        <h1 className="visually-hidden">Documents</h1>
        <Tabs
          selected={tab}
          onSelect={(next, focus) => {
            setTab(next);
            setFocusRequest(focus ? { tab: next } : null);
          }}
          focusRequest={focusRequest}
          panels={{ Query: query, Results: results, Pipeline: <PipelineBuilder /> }}
        />
        <EditorHost state={state} layout={layout} />
        {dialogs}
      </>
    );
  }
  const stacked = layout === "tablet";
  return (
    <>
      <h1 className="visually-hidden">Documents</h1>
      <div className={stacked ? "docs docs-stacked" : "docs docs-wide"}>
        <div className="docs-column" ref={column}>
          <div className="query-pane" style={stacked ? { minHeight: `${split * 0.7}vh` } : { height: `${split}%` }}>
            {query}
          </div>
          <Separator name="Resize query pane" value={split} onChange={setSplit} container={column} orientation="horizontal" />
          <div className="results-pane">{results}</div>
        </div>
        <EditorHost state={state} layout={layout} />
      </div>
      {dialogs}
    </>
  );
}
