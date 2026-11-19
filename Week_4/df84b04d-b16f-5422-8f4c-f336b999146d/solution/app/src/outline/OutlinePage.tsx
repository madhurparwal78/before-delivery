import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { hiddenCount } from "../../shared/copy";
import type { Bullet } from "../../shared/types";
import { Twig } from "../lib/icons";
import { Link } from "../lib/router";
import { currentMe, setMe, useMe } from "../lib/session";
import { bulletLabel } from "../../shared/text";
import { zoomOrigin, zoomOut } from "./actions";
import { Board } from "./Board";
import { BulletToolbar } from "./BulletToolbar";
import { OutlineController } from "./controller";
import { DeleteDialog, ShareDialog } from "./Dialogs";
import { LiveLink } from "./live";
import { playMotion } from "./motion";
import { NotFoundPage } from "./NotFound";
import { Toolbar } from "./Toolbar";
import { Rows } from "./Tree";

function Title({ controller, root }: { controller: OutlineController; root: Bullet | null }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const request = useSyncExternalStore(controller.subscribe, () => controller.state.titleRequest);
  const handled = useRef(0);
  const key = root === null ? "" : controller.textKey(root);
  const draft = useSyncExternalStore((listener) => controller.subscribeDraft(key, listener), () => controller.draftSnapshot(key));

  useLayoutEffect(() => {
    if (request === 0 || request === handled.current) return;
    handled.current = request;
    const element = area.current;
    if (element === null) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
    controller.consumeTitle();
  }, [request, root?.id, controller]);

  if (root === null) return <h1 className="title">Home</h1>;
  const text = draft ?? root.text;
  return (
    <h1 className="title">
      <span className="title-cell">
        <span className="sizer" aria-hidden="true">{text}{"​"}</span>
        <textarea
          ref={area} data-title="" rows={1} aria-label="Branch title" value={text} spellCheck={false} autoComplete="off"
          onChange={(event) => controller.edit(root, event.target.value.replace(/[\r\n]+/g, " "))}
          onBlur={() => controller.flush(key)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "Enter") {
              event.preventDefault();
              const first = controller.rows().rows[0];
              if (first !== undefined) controller.requestFocus(first.key, "end");
              else if (event.key === "Enter") controller.addFirstBullet();
            } else if (event.key === "Escape") event.currentTarget.blur();
          }}
        />
      </span>
    </h1>
  );
}

export function OutlinePage({ rootId, search }: { rootId: string | null; search: string }) {
  const me = useMe();
  const controller = useMemo(() => new OutlineController(currentMe, setMe), []);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const board = new URLSearchParams(search).get("view") === "board";
  const page = useRef<HTMLDivElement>(null);
  const hide = me?.user.hideCompleted;

  useEffect(() => {
    const origin = zoomOrigin.rect;
    zoomOrigin.rect = null;
    void controller.open(rootId, { fromRect: origin });
  }, [controller, rootId]);

  useEffect(() => {
    if (hide !== undefined) controller.adoptHideCompleted(hide);
  }, [controller, hide]);

  useEffect(() => {
    if (state.phase !== "ready") return;
    const link = new LiveLink(rootId, {
      onMessage: (message) => controller.receive(message),
      onPaused: (paused) => controller.setPaused(paused),
      seq: controller.seq,
    });
    return () => link.close();
  }, [controller, rootId, state.phase === "ready"]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "z" && !event.altKey) {
        if (target?.closest("[data-native-undo]") !== null && target !== null) return;
        event.preventDefault();
        event.stopPropagation();
        controller.undoOrRedo(event.shiftKey ? "redo" : "undo");
      } else if (event.altKey && event.key === "ArrowLeft" && target?.closest(".window") != null) {
        event.preventDefault();
        event.stopPropagation();
        zoomOut(controller);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [controller]);

  useLayoutEffect(() => {
    if (state.motion === null || page.current === null) return;
    playMotion(state.motion, page.current);
    controller.clearMotion();
  }, [controller, state.motion]);

  useEffect(() => {
    const root = state.view.root;
    document.title = `${root === null ? "Home" : bulletLabel(root.text)} · Twigline`;
  }, [state.view.root]);

  if (state.phase === "missing") return <NotFoundPage />;

  const { rows, hidden } = controller.rows();
  const empty = controller.topIds().length === 0;
  const loading = state.phase === "loading";
  const revoked = state.phase === "revoked";
  const zoomRoot = state.view.rootId ?? "home";

  return (
    <div className="column" ref={page}>
      <section className="window" aria-label="Outline pane">
        <Toolbar controller={controller} state={state} board={board} />
        {!board && !loading && !revoked && <BulletToolbar controller={controller} state={state} />}
        <div className="window-body">
          {!loading && <Title controller={controller} root={state.view.root} />}
          {state.paused && !revoked && (
            <div role="region" aria-label="Live sync" className="notice">
              <p>Live sync paused. Your edits are saved and other tabs will catch up when it returns.</p>
              <button type="button" className="pill pill-sky" onClick={() => void controller.refresh()}>Reload branch</button>
            </div>
          )}
          {revoked ? (
            <div role="region" aria-label="Live sync" className="notice notice-block">
              <Twig />
              <p>This branch is no longer shared with you.</p>
              <Link to="/" className="pill pill-sky">Back to Home</Link>
            </div>
          ) : loading ? (
            <div role="tree" aria-label="Outline" aria-busy="true" data-zoom-root={zoomRoot} className="skeleton">
              {[0, 1, 2].map((index) => <div key={index} className="skeleton-row"><span /><span /><span /></div>)}
            </div>
          ) : board ? (
            <Board controller={controller} state={state} />
          ) : (
            <>
              <div role="tree" aria-label="Outline" aria-busy="false" data-zoom-root={zoomRoot} data-tree="" className="tree">
                <Rows nodes={rows} controller={controller} focused={state.focusKey} rootId={state.view.rootId} />
              </div>
              {state.hideCompleted && state.search.result === null && (
                <p className="hidden-note">{hiddenCount(hidden)}</p>
              )}
              {empty && (
                <div className="empty">
                  <Twig />
                  <p>{state.view.root === null ? "Your outline is empty. Start with one thought." : "Nothing inside this bullet yet."}</p>
                  <button type="button" className="pill pill-sky" onClick={() => controller.addFirstBullet()}>
                    {state.view.root === null ? "Add first bullet" : "Add bullet"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>
      {state.deleting !== null && <DeleteDialog controller={controller} id={state.deleting} />}
      {state.sharing && state.view.rootId !== null && <ShareDialog controller={controller} bulletId={state.view.rootId} />}
    </div>
  );
}

