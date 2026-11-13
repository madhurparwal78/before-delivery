import { useEffect, useMemo, type ReactNode } from "react";
import { rateOf } from "../../shared/rational";
import { timecode } from "../../shared/timecode";
import { errorCopy } from "../../shared/copy";
import { CaptionsDialog, CompareDialog, ExportDialog, FrameSizeDialog, MembersDialog, NameCutDialog, ShareDialog } from "../dialogs/ProjectDialogs";
import { useLayout } from "../lib/router";
import { useShell } from "../lib/session";
import { GlobalNav, Notices, useDialogState } from "../ui";
import { CommentActions, Comments, NoteProvider } from "../project/Comments";
import { ProjectContext, useProject } from "../project/context";
import { ExportsTable } from "../project/Exports";
import { Inspector } from "../project/Inspector";
import { Loupe, loupeSourceOf } from "../project/Loupe";
import { ClipsList, Scrubber } from "../project/Review";
import { Stage } from "../project/Stage";
import { canEdit, lastFrame, rateOfState } from "../project/state";
import { ProjectStore } from "../project/store";
import { Timeline } from "../project/Timeline";
import { useStore } from "../lib/store";
import type { Panel } from "../project/address";

export function ProjectPage({ projectId }: { projectId: string }): ReactNode {
  const { socket, session } = useShell();
  const store = useMemo(() => new ProjectStore(projectId, socket, session.person), [projectId, socket, session.person]);

  useEffect(() => {
    void store.load(window.location.search);
    const detach = store.attach();
    const popped = (): void => store.restoreFromAddress(window.location.search);
    window.addEventListener("popstate", popped);
    return () => {
      detach();
      window.removeEventListener("popstate", popped);
    };
  }, [store]);

  const state = useStore(store.state);
  if (state.status === "missing") {
    return (
      <>
        <header className="band">
          <GlobalNav />
        </header>
        <Notices />
        <main className="plain">
          <p>{errorCopy("not_found")}</p>
        </main>
      </>
    );
  }
  if (state.status === "removed") {
    return (
      <>
        <header className="band">
          <GlobalNav />
        </header>
        <Notices />
        <main className="plain">
          <p>{`You no longer have access to ${state.project.title}.`}</p>
        </main>
      </>
    );
  }
  if (state.status === "loading") return <div className="boot" aria-busy="true" />;
  return (
    <ProjectContext.Provider value={store}>
      <NoteProvider>
        <Workspace />
      </NoteProvider>
    </ProjectContext.Provider>
  );
}

function usePlayback(): void {
  const { store, state } = useProject();
  useEffect(() => {
    if (!state.playing) return undefined;
    const rate = rateOf(state.project.frame_rate);
    const perMs = Number(rate.num) / Number(rate.den) / 1000;
    let start = store.s.playhead;
    let begin = performance.now();
    let frame = 0;
    const tick = (now: number): void => {
      const { in: low, out: high } = store.s.range;
      let next = start + Math.floor((now - begin) * perMs);
      if (low !== null && high !== null && high > low && next >= high) {
        start = low;
        begin = now;
        next = low;
      } else if (next >= lastFrame(store.s)) {
        store.playTo(lastFrame(store.s));
        store.setPlaying(false);
        return;
      }
      if (next !== store.s.playhead) store.playTo(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state.playing, store, state.project.frame_rate]);
}

function Workspace(): ReactNode {
  const { state } = useProject();
  const layout = useLayout();
  usePlayback();
  const loading = state.status === "loading";

  const body = (
    <>
      <header className="band project-band">
        <GlobalNav />
        <ProjectBar layout={layout} />
      </header>
      <Notices />
      <div role="status" aria-label="Project activity" className="visually-hidden">
        {state.activity.map((entry) => (
          <p key={entry.id}>{entry.text}</p>
        ))}
      </div>
      <main data-layout={layout} className={`project project-${layout}${loading ? " loading" : ""}`}>
        {layout === "editor" ? (
          <>
            <div className="col-stage">
              <Stage interactive />
            </div>
            <div className="col-inspector">
              <PanelToggle panel="inspector" label="Inspector" />
              <Inspector />
            </div>
            <div className="col-comments">
              <PanelToggle panel="comments" label="Comments" />
              <Comments inlineActions showHeading={false} />
            </div>
            <div className="col-timeline">
              <Timeline />
            </div>
            <div className="col-exports">
              <PanelToggle panel="exports" label="Exports" />
              <ExportsTable />
            </div>
          </>
        ) : (
          <ReviewLayout layout={layout} />
        )}
      </main>
    </>
  );
  return (
    <>
      {layout === "review-list" ? (
        <>
          <div className="page-scroll">{body}</div>
          <div className="bottom-bar">
            <CommentActions />
          </div>
        </>
      ) : (
        body
      )}
      {state.skim && layout !== "editor" ? <Loupe state={loupeSourceOf(state)} skim={state.skim} anchor={null} /> : null}
    </>
  );
}

function PanelToggle({ panel, label }: { panel: Panel; label: string }): ReactNode {
  const { store, state } = useProject();
  const open = state.panel === panel;
  return (
    <button type="button" className="panel-toggle" aria-pressed={open} aria-label={`${open ? "Close" : "Open"} ${label}`} onClick={() => store.setPanel(open ? "none" : panel)}>
      {label}
    </button>
  );
}

function ReviewLayout({ layout }: { layout: "review-list" | "two-pane" }): ReactNode {
  const { store, state } = useProject();
  const left = (
    <>
      <Stage interactive={false} />
      <Scrubber
        frame={state.playhead}
        last={lastFrame(state)}
        rate={state.project.frame_rate}
        onChange={(frame) => store.movePlayhead(frame)}
        onHold={(held) =>
          store.setSkim(held ? { pointer: held, frame: store.s.playhead, snapped: false, pinned: false, returnTo: null } : null)
        }
      />
      <ClipsList
        clips={state.clips}
        rows={state.rows}
        rate={state.project.frame_rate}
        onPick={(clip) => {
          store.movePlayhead(clip.start_frame);
          store.setCurrent(clip.id);
        }}
      />
    </>
  );
  if (layout === "two-pane") {
    return (
      <>
        <div className="pane-left">{left}</div>
        <div className="pane-right">
          <Comments inlineActions showHeading />
        </div>
      </>
    );
  }
  return (
    <>
      {left}
      <Comments inlineActions={false} showHeading />
    </>
  );
}

function ProjectBar({ layout }: { layout: "review-list" | "two-pane" | "editor" }): ReactNode {
  const { store, state } = useProject();
  const owner = state.role === "owner";
  const editor = canEdit(state.role);
  const editorLayout = layout === "editor";
  const name = useDialogState();
  const share = useDialogState();
  const exporting = useDialogState();
  const compare = useDialogState();
  const captions = useDialogState();
  const members = useDialogState();
  const frame = useDialogState();
  const rate = rateOfState(state);

  const open = (dialog: ReturnType<typeof useDialogState>): ((event: { currentTarget: Element }) => void) => (event) => dialog.show(event.currentTarget);
  return (
    <div className="band-row project-row">
      <span className="project-title">{state.project.title}</span>
      <span className="muted tnum">{state.project.frame_rate} fps</span>
      <span className="muted tnum">{state.project.aspect_ratio}</span>
      <span data-playhead-timecode="" className="tnum">
        {timecode(rate, state.skim ? state.skim.frame : state.playhead)}
      </span>
      <div className="project-actions">
        {owner ? (
          <button type="button" className="gold" onClick={open(exporting)}>
            Export
          </button>
        ) : null}
        {owner ? (
          <button type="button" onClick={open(name)}>
            Name cut
          </button>
        ) : null}
        {owner ? (
          <button type="button" onClick={open(share)}>
            Share
          </button>
        ) : null}
        <button type="button" onClick={open(compare)}>
          Compare cuts
        </button>
        {editor && editorLayout ? (
          <button type="button" onClick={open(captions)}>
            Captions
          </button>
        ) : null}
        {owner ? (
          <button type="button" onClick={open(members)}>
            Members
          </button>
        ) : null}
        {owner ? (
          <button type="button" onClick={open(frame)}>
            Frame size
          </button>
        ) : null}
        {editor && editorLayout ? (
          <>
            <button type="button" onClick={() => void store.history("undo")}>
              Undo
            </button>
            <button type="button" onClick={() => void store.history("redo")}>
              Redo
            </button>
          </>
        ) : null}
      </div>
      {name.open ? <NameCutDialog opener={name.opener} onClose={name.hide} /> : null}
      {share.open ? <ShareDialog opener={share.opener} onClose={share.hide} /> : null}
      {exporting.open ? <ExportDialog opener={exporting.opener} onClose={exporting.hide} /> : null}
      {compare.open ? <CompareDialog opener={compare.opener} onClose={compare.hide} /> : null}
      {captions.open ? <CaptionsDialog opener={captions.opener} onClose={captions.hide} /> : null}
      {members.open ? <MembersDialog opener={members.opener} onClose={members.hide} /> : null}
      {frame.open ? <FrameSizeDialog opener={frame.opener} onClose={frame.hide} /> : null}
    </div>
  );
}
