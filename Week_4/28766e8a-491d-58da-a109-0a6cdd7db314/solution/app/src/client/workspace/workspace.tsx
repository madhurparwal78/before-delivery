// The diagram workspace (brief: Screens and layout, Public screens and controls, Keyboard).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { copy } from "../../shared/copy";
import { canAlign, canDistribute, insertionLayer } from "../../shared/geometry";
import { canEdit, isOwner } from "../../shared/rules";
import type { ShapeKind } from "../../shared/types";
import { useTrap } from "../dialog";
import { Icon, type IconName } from "../icons";
import { NotFound } from "../pages/not-found";
import { Canvas, insertShape, openShapeActions, resetZoom, zoomStep } from "./canvas";
import {
  addPage, alignSelection, deleteSelection, distributeSelection, duplicateSelection, selectedShapes, zStep,
} from "./commands";
import { DeletePageDialog, ExportDialog, SaveVersionDialog, ShareDialog, SignInDialog } from "./dialogs";
import { Menu, type MenuItem } from "./menu";
import { settleEase, useRail } from "./motion";
import { OutlinePanel } from "./outline";
import { CommentsPanel, HistoryPanel, InspectorPanel } from "./panels";
import { LayersList, PagesList } from "./rails";
import { WorkspaceStore, type Tab } from "./store";

type Layout = "desktop" | "tablet" | "phone";

function layoutFor(width: number): Layout {
  return width >= 1280 ? "desktop" : width >= 768 ? "tablet" : "phone";
}

type Modal =
  | { kind: "share" | "export" | "save" | "outline"; opener: HTMLElement | null }
  | { kind: "delete"; pageId: string; opener: HTMLElement | null };

const SWIPE_PX = 30;
/** Sheets slide this far, so their controls are usable from the first frame. */
const SHEET_TRAVEL = 32;
const SHAPE_KINDS: { kind: ShapeKind; label: string; icon: IconName }[] = [
  { kind: "rectangle", label: "Rectangle", icon: "rectangle" },
  { kind: "ellipse", label: "Ellipse", icon: "ellipse" },
  { kind: "diamond", label: "Diamond", icon: "diamond" },
  { kind: "text", label: "Text", icon: "text" },
];

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

export function Workspace({ diagramId }: { diagramId: string }) {
  const store = useMemo(() => new WorkspaceStore(diagramId), [diagramId]);
  const [, setVersion] = useState(0);
  const [layout, setLayout] = useState<Layout>(layoutFor(innerWidth));
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [layersOpen, setLayersOpen] = useState(false);
  const [modal, setModal] = useState<Modal | null>(null);
  const [align, setAlign] = useState<HTMLElement | null>(null);
  const swipe = useRef<{ x: number; id: number } | null>(null);
  // Workspace shortcuts read the latest render's state through this ref; the listener is registered once.
  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined);

  useEffect(() => {
    const off = store.subscribe(() => setVersion((v) => v + 1));
    void store.load();
    const onPop = () => void store.readAddress();
    const onResize = () => setLayout(layoutFor(innerWidth));
    const onKey = (e: KeyboardEvent) => keys.current(e);
    addEventListener("popstate", onPop);
    addEventListener("resize", onResize);
    document.addEventListener("keydown", onKey);
    return () => {
      off();
      store.dispose();
      removeEventListener("popstate", onPop);
      removeEventListener("resize", onResize);
      document.removeEventListener("keydown", onKey);
    };
  }, [store]);

  useEffect(() => {
    if (layout !== "tablet") setLayersOpen(false);
    if (layout !== "phone") store.sheet = null;
  }, [layout]);

  useEffect(() => {
    if (store.preview && layout !== "phone") store.tab = "history";
  }, [store.preview?.version.id]);

  useLayoutEffect(() => {
    if (!store.focusKey) return;
    const el = document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(store.focusKey)}"]`);
    if (el) {
      el.focus();
      store.focusKey = null;
    }
  });

  const inspectorRail = useRail(inspectorOpen);
  const layersRail = useRail(layersOpen);

  if (store.notFound) return <NotFound />;
  const doc = store.doc;
  const page = store.page;
  if (!doc || !page || !store.me) {
    return <main class="plain-page"><p class="muted">Opening diagram…</p></main>;
  }

  const pages = [...doc.pages].sort((a, b) => a.order - b.order);
  const pageIndex = pages.findIndex((p) => p.id === page.id);
  const editable = store.editable;
  const others = store.presence.filter((p) => p.userId !== store.me?.id);
  const latestExport = store.exports.find((x) => x.status === "ready");
  const myLatest = store.exports.find((x) => x.requestedBy === store.me?.id);
  const selection = selectedShapes(store);
  const canInsert = editable && !!insertionLayer(page);

  function stepPage(delta: 1 | -1) {
    const next = pages[pageIndex + delta];
    if (next) store.setPage(next.id);
  }

  function openTab(tab: Tab) {
    if (layout === "phone") store.sheet = tab;
    else {
      store.tab = tab;
      setInspectorOpen(true);
    }
    store.emit();
  }

  // Workspace shortcuts work from any workspace control unless the person is typing.
  keys.current = (e: KeyboardEvent) => {
    if (typing(e.target) || modal || store.menu || store.signInOpen || store.editing) return;
    if (e.key === "Escape" && layout === "tablet" && layersOpen && !document.getElementById("canvas")?.contains(e.target as Node)) {
      e.preventDefault();
      setLayersOpen(false);
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    const run = (fn: () => void) => {
      e.preventDefault();
      fn();
    };
    if (e.altKey && e.shiftKey && !ctrl) {
      const sides: Record<string, Parameters<typeof alignSelection>[1]> = { KeyL: "left", KeyC: "centre", KeyR: "right", KeyT: "top", KeyM: "middle", KeyB: "bottom" };
      const side = sides[e.code];
      if (side) return run(() => alignSelection(store, side));
      if (e.code === "KeyH") return run(() => distributeSelection(store, "horizontal"));
      if (e.code === "KeyV") return run(() => distributeSelection(store, "vertical"));
    }
    if (!ctrl) return;
    if (e.code === "KeyZ" && !e.altKey) return run(() => (store.editable ? (e.shiftKey ? store.redo() : store.undo()) : undefined));
    if (e.altKey && !e.shiftKey) {
      if (e.code === "KeyN") return run(() => addPage(store));
      if (e.code === "KeyO") return run(() => setModal({ kind: "outline", opener: document.activeElement as HTMLElement }));
      if (e.code === "KeyH") return run(() => openTab("history"));
      if (e.code === "KeyS" && store.editable) return run(() => setModal({ kind: "save", opener: document.activeElement as HTMLElement }));
    }
    if (e.shiftKey && e.code === "KeyE" && store.editable) return run(() => setModal({ kind: "export", opener: document.activeElement as HTMLElement }));
    if (e.key === "PageDown" || e.key === "PageUp") return run(() => stepPage(e.key === "PageDown" ? 1 : -1));
    if (e.code === "Equal" || e.key === "+") return run(() => zoomStep(store, 1));
    if (e.code === "Minus") return run(() => zoomStep(store, -1));
    if (e.code === "Digit0") return run(() => resetZoom(store));
  };

  const alignItems: MenuItem[] = [
    ...(["left", "centre", "right", "top", "middle", "bottom"] as const).map((side) => ({
      label: `Align ${side}`, disabled: !canAlign(selection), run: () => alignSelection(store, side),
    })),
    { label: "Distribute horizontally", disabled: !canDistribute(selection), run: () => distributeSelection(store, "horizontal") },
    { label: "Distribute vertically", disabled: !canDistribute(selection), run: () => distributeSelection(store, "vertical") },
  ];
  const focusCanvas = () => {
    store.focusKey = store.focusId ? `shape:${store.keyFor(store.focusId)}` : "canvas";
  };
  const shapeActionItems: MenuItem[] = [
    {
      label: "Comment", run: () => {
        store.commentTarget = selection[0]?.id ?? null;
        openTab("comments");
        store.composerFocus++;
        store.emit();
      },
    },
    ...(editable ? [
      { label: "Duplicate", run: () => duplicateSelection(store) },
      { label: "Delete", run: () => { deleteSelection(store); focusCanvas(); store.emit(); } },
      { label: "Bring forward", run: () => zStep(store, "forward") },
      { label: "Send backward", run: () => zStep(store, "backward") },
    ] : []),
  ];
  const insertItems: MenuItem[] = SHAPE_KINDS.map(({ kind, label }) => ({ label, run: () => insertShape(store, kind) }));

  const tabs = (
    <div role="tablist" aria-label="Panels" class="tabs">
      {(["inspector", "comments", "history"] as const).map((tab) => (
        <button key={tab} type="button" role="tab" id={`tab-${tab}`} aria-selected={store.tab === tab} aria-controls={`panel-${tab}`}
          tabIndex={store.tab === tab ? 0 : -1} onClick={() => {
            store.tab = tab;
            store.emit();
          }}
          onKeyDown={(e) => {
            const list = ["inspector", "comments", "history"] as const;
            const i = list.indexOf(tab);
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              e.preventDefault();
              store.tab = list[(i + (e.key === "ArrowRight" ? 1 : 2)) % 3] as Tab;
              store.focusKey = `tab:${store.tab}`;
              store.emit();
            }
          }} data-focus-key={`tab:${tab}`}>
          {tab === "inspector" ? "Inspector" : tab === "comments" ? "Comments" : "History"}
        </button>
      ))}
    </div>
  );
  const panel = (tab: Tab) => tab === "inspector" ? <InspectorPanel store={store} />
    : tab === "comments" ? <CommentsPanel store={store} />
      : <HistoryPanel store={store} onSave={(opener) => setModal({ kind: "save", opener })} />;

  const banners = (
    <div class="banner-row">
      {store.role === "viewer" && !store.preview && <p class="banner"><Icon name="eye" size={16} /> {copy.viewOnly(store.ownerName)}</p>}
      {store.preview && <p class="banner"><Icon name="history" size={16} /> {copy.preview(store.preview.version.displayName)}</p>}
      <div role="status" aria-label="Connection" aria-live="off" class={`banner connection${store.connection === "ended" || store.offlineBanner || store.savedBanner ? "" : " empty"}`}>
        {store.connection === "ended" ? (
          <>
            <span>{copy.sessionEnded(store.waiting)}</span>
            <button type="button" class="ghost" onClick={(e) => store.openSignIn(e.currentTarget)}>Sign in again</button>
          </>
        ) : store.offlineBanner && store.connection !== "online" ? <span>{copy.offline(store.waiting)}</span>
          : store.savedBanner ? <span>{copy.saved}</span> : null}
      </div>
      {myLatest?.status === "storage_unavailable" && <p class="banner"><Icon name="alert" size={16} /> {copy.exportPaused}</p>}
    </div>
  );

  const viewControls = (
    <div class="view-plate" id="view-controls">
      <div role="group" aria-label="View" class="view-group">
        <button type="button" class="icon-button" aria-label="Zoom out" onClick={() => zoomStep(store, -1)}><Icon name="zoomOut" /></button>
        <span id="zoom-readout" role="status" aria-label="Zoom" aria-live="off" class="mono readout">{Math.round(store.zoom * 100)}%</span>
        <button type="button" class="icon-button" aria-label="Zoom in" onClick={() => zoomStep(store, 1)}><Icon name="zoomIn" /></button>
        <button type="button" class="icon-button" aria-label="Reset zoom" onClick={() => resetZoom(store)}><Icon name="reset" /></button>
        {layout === "tablet" && (
          <button type="button" class="icon-button" aria-label="Layers" aria-expanded={layersOpen} onClick={() => setLayersOpen(!layersOpen)}><Icon name="layers" /></button>
        )}
        {layout !== "phone" && (
          <button type="button" class="icon-button" aria-label="Toggle inspector" aria-expanded={inspectorOpen} onClick={() => setInspectorOpen(!inspectorOpen)}><Icon name="panel" /></button>
        )}
      </div>
    </div>
  );

  const pageStrip = (
    <div id="page-strip" class="page-strip"
      onPointerDown={(e) => {
        swipe.current = { x: e.clientX, id: e.pointerId };
      }}
      onPointerUp={(e) => {
        const start = swipe.current;
        swipe.current = null;
        if (!start || start.id !== e.pointerId || e.pointerType !== "touch") return;
        const dx = e.clientX - start.x;
        if (Math.abs(dx) >= SWIPE_PX) stepPage(dx < 0 ? 1 : -1);
      }}>
      <button type="button" class="icon-button" aria-label="Previous page" disabled={pageIndex <= 0} onClick={() => stepPage(-1)}><Icon name="prev" /></button>
      <p class="strip-text"><span class="strip-name">{page.name}</span>{" · "}<span class="mono">{pageIndex + 1} of {pages.length}</span></p>
      <button type="button" class="icon-button" aria-label="Next page" disabled={pageIndex >= pages.length - 1} onClick={() => stepPage(1)}><Icon name="next" /></button>
    </div>
  );

  const railStyle = (progress: number) => ({ width: `${Math.round(296 * settleEase(progress))}px` });
  const inspectorClosed = inspectorRail.motion === "closing" || inspectorRail.motion === "closed";
  const layersClosed = layersRail.motion === "closing" || layersRail.motion === "closed";

  return (
    <div class={`workspace layout-${layout}`}>
      <header class="top-bar">
        <h1 class="title">{store.title}</h1>
        <div class="presence">
          {others.map((p) => (
            <button key={p.userId} type="button" class="avatar" aria-label={copy.presence(p.name, canEdit(p.role))} title={copy.presence(p.name, canEdit(p.role))}>
              {initials(p.name)}
            </button>
          ))}
        </div>
        <div class="top-actions">
          {latestExport && (
            <a class="top-link" href={`/api/exports/${latestExport.id}/file`} download aria-label="Download latest export">
              <Icon name="download" /><span class="label-text">Download latest export</span>
            </a>
          )}
          <button type="button" class="top-button" aria-label="Outline" onClick={(e) => setModal({ kind: "outline", opener: e.currentTarget })}>
            <Icon name="outline" /><span class="label-text">Outline</span>
          </button>
          {editable && (
            <button type="button" class="top-button" aria-label="Export" onClick={(e) => setModal({ kind: "export", opener: e.currentTarget })}>
              <Icon name="export" /><span class="label-text">Export</span>
            </button>
          )}
          {isOwner(store.role) && (
            <button type="button" class="top-button primary-top" aria-label="Share" onClick={(e) => setModal({ kind: "share", opener: e.currentTarget })}>
              <Icon name="share" /><span class="label-text">Share</span>
            </button>
          )}
        </div>
      </header>
      {banners}
      <div class="panes">
        {layout !== "phone" && (
          <aside id="left-rail" class={`left-rail${layout === "tablet" ? ` overlay${editable ? " under-tools" : ""}` : ""}`}
            hidden={layout === "tablet" && layersRail.motion === "closed"}
            style={layout === "tablet" ? { transform: `translateX(${-248 * (1 - settleEase(layersRail.progress))}px)` } : undefined}>
            <div class="rail-content" inert={layout === "tablet" && layersClosed} aria-hidden={layout === "tablet" && layersClosed ? "true" : undefined}
              style={layout === "tablet" && layersClosed ? { visibility: "hidden" } : undefined}>
              <PagesList store={store} onDelete={(pageId, opener) => setModal({ kind: "delete", pageId, opener })} />
              <LayersList store={store} />
            </div>
          </aside>
        )}
        <section class="canvas-pane">
          {editable && layout !== "phone" && (
            <div role="toolbar" aria-label="Tools" class="toolbar">
              {SHAPE_KINDS.map(({ kind, label, icon }) => (
                <button key={kind} type="button" class="icon-button" aria-label={label} title={label} disabled={!canInsert}
                  onClick={() => insertShape(store, kind)}><Icon name={icon} /></button>
              ))}
              <span class="sep" aria-hidden="true" />
              <button type="button" class="icon-button" aria-label="Snap to grid" title="Snap to grid" aria-pressed={store.snap}
                onClick={() => {
                  store.snap = !store.snap;
                  store.emit();
                }}><Icon name="snap" /></button>
              <button type="button" class="icon-button" aria-label="Align" title="Align" aria-haspopup="menu" aria-expanded={!!align}
                onClick={(e) => setAlign(e.currentTarget)}><Icon name="align" /></button>
              <span class="sep" aria-hidden="true" />
              <button type="button" class="icon-button" aria-label="Undo" title="Undo" onClick={() => store.undo()}><Icon name="undo" /></button>
              <button type="button" class="icon-button" aria-label="Redo" title="Redo" onClick={() => store.redo()}><Icon name="redo" /></button>
            </div>
          )}
          <Canvas store={store} />
          {viewControls}
          {pageStrip}
        </section>
        {layout !== "phone" && (
          <aside id="inspector-rail" class="inspector-rail" data-motion={inspectorRail.motion} data-progress={inspectorRail.progress.toFixed(2)}
            style={railStyle(inspectorRail.progress)} hidden={inspectorRail.motion === "closed"}>
            <div class="rail-inner" inert={inspectorClosed} aria-hidden={inspectorClosed ? "true" : undefined} style={inspectorClosed ? { visibility: "hidden" } : undefined}>
              {tabs}
              <div role="tabpanel" id={`panel-${store.tab}`} aria-labelledby={`tab-${store.tab}`} class="tab-panel">{panel(store.tab)}</div>
            </div>
          </aside>
        )}
      </div>
      {layout === "phone" && (
        <nav id="bottom-toolbar" class="bottom-toolbar" aria-label="Workspace">
          {([["layers", "Layers", "layers", "Layers"], ["inspector", "Inspector", "inspector", "Inspector"], ["comments", "Comments", "comment", "Comments"],
            ["history", "History", "history", "History"]] as const).map(([sheet, name, icon, text]) => (
            <button key={sheet} type="button" aria-label={name} aria-expanded={store.sheet === sheet} onClick={() => {
              store.sheet = sheet;
              store.emit();
            }}><Icon name={icon} /><span>{text}</span></button>
          ))}
          <button type="button" aria-label="Shape actions" onClick={(e) => openShapeActions(store, e.currentTarget)}><Icon name="more" /><span>Actions</span></button>
          {editable && (
            <button type="button" id="insert-button" aria-label="Insert" disabled={!canInsert} onClick={(e) => {
              const b = e.currentTarget.getBoundingClientRect();
              store.menu = { kind: "insert", anchor: { x: b.left, y: b.top, w: b.width, h: b.height }, opener: e.currentTarget };
              store.emit();
            }}><Icon name="plus" /><span>Insert</span></button>
          )}
        </nav>
      )}
      {layout === "phone" && store.sheet && (
        <Sheet label={store.sheet === "layers" ? "Layers" : store.sheet === "inspector" ? "Inspector" : store.sheet === "comments" ? "Comments" : "History"}
          onClose={() => {
            store.sheet = null;
            store.emit();
          }}>
          {store.sheet === "layers" ? (
            <>
              <PagesList store={store} onDelete={(pageId, opener) => setModal({ kind: "delete", pageId, opener })} />
              <LayersList store={store} />
            </>
          ) : panel(store.sheet)}
        </Sheet>
      )}
      {align && (
        <Menu label="Align" anchor={(() => {
          const b = align.getBoundingClientRect();
          return { x: b.left, y: b.top, w: b.width, h: b.height };
        })()} items={alignItems} returnTo={align} onClose={() => setAlign(null)} />
      )}
      {store.menu && (
        <Menu label={store.menu.kind === "insert" ? "Insert" : "Shape actions"} anchor={store.menu.anchor}
          items={store.menu.kind === "insert" ? insertItems : shapeActionItems} returnTo={store.menu.opener}
          onClose={() => {
            store.menu = null;
            store.emit();
          }} />
      )}
      {modal?.kind === "share" && <ShareDialog store={store} opener={modal.opener} onClose={() => setModal(null)} />}
      {modal?.kind === "export" && <ExportDialog store={store} opener={modal.opener} onClose={() => setModal(null)} />}
      {modal?.kind === "save" && <SaveVersionDialog store={store} opener={modal.opener} onClose={() => setModal(null)} />}
      {modal?.kind === "outline" && <OutlinePanel store={store} opener={modal.opener} onClose={() => setModal(null)} />}
      {modal?.kind === "delete" && <DeletePageDialog store={store} pageId={modal.pageId} opener={modal.opener} onClose={() => setModal(null)} />}
      {store.signInOpen && <SignInDialog store={store} />}
    </div>
  );
}

function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: preact.ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => setShown(true), []);
  const rail = useRail(shown);
  useTrap(ref, onClose);
  return (
    <div class="sheet-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={label} class="sheet" style={{ transform: `translateY(${Math.round((1 - settleEase(rail.progress)) * SHEET_TRAVEL)}px)` }}>
        <header class="dialog-head">
          <h2>{label}</h2>
          <button type="button" class="icon-button" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </header>
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}

