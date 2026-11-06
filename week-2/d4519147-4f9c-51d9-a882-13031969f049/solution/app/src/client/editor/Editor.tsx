import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { plainLabel } from "../../shared/label.ts";
import { LIMITS, type Derived, type PageDoc, type Point } from "../../shared/model.ts";
import { announce, AnnouncementsRegion } from "../announce.tsx";
import { readJson, request, resume } from "../api.ts";
import { icons } from "../icons.tsx";
import { useLayout } from "../layout.ts";
import { focusables, Modal, useModalDepth } from "../modal.tsx";
import { landingHint, navigate, setLeaveGuard } from "../router.ts";
import { NotFound } from "../screens/NotFound.tsx";
import { Canvas } from "./Canvas.tsx";
import { addShape, addZone, align, connect, duplicate, group, layer, moveItems, remove, ungroup, type Edge, type LayerDirection } from "./edits.ts";
import { FilesDialog } from "./FilesDialog.tsx";
import { ImportDialog, type Imported } from "./ImportDialog.tsx";
import { InspectorBody, type InspectorActions } from "./Inspector.tsx";
import { LibraryBody, type LibraryKind } from "./Library.tsx";
import { ShareDialog } from "./ShareDialog.tsx";
import { PageStore, useStore, ZOOM_MAX, ZOOM_MIN } from "./store.ts";

interface DiagramInfo {
  id: string;
  title: string;
  role: "owner" | "editor" | "viewer";
  ownerName: string;
  pages: { id: string; name: string; version: number }[];
}

const STATUS_MS = 10_000;

/** The diagram-level shell: loads the diagram, watches file storage, and hosts one page editor at a time. */
export function Editor({ diagramId, pageId }: { diagramId: string; pageId: string | null }) {
  const [diagram, setDiagram] = useState<DiagramInfo | null>(null);
  const [missing, setMissing] = useState(false);
  const [storageDown, setStorageDown] = useState(false);
  const layout = useLayout();

  useEffect(() => {
    let live = true;
    void (async () => {
      const res = await request({ method: "GET", path: `/api/diagrams/${diagramId}` });
      if (!live) return;
      if (!res.ok) {
        if (res.status === 404) setMissing(true);
        return;
      }
      const d = (await readJson<{ diagram: DiagramInfo }>(res)).diagram;
      setDiagram(d);
      if (pageId === null && d.pages[0]) void navigate(`/d/${d.id}/p/${d.pages[0].id}`, { replace: true, force: true, hint: landingHint });
    })();
    return () => {
      live = false;
    };
  }, [diagramId]);

  useEffect(() => {
    const check = async () => {
      const res = await request({ method: "GET", path: "/api/status" });
      if (res.ok) setStorageDown((await readJson<{ storage: string }>(res)).storage === "down");
    };
    void check();
    const timer = window.setInterval(() => void check(), STATUS_MS);
    return () => clearInterval(timer);
  }, []);

  if (missing || (diagram && pageId !== null && !diagram.pages.some((p) => p.id === pageId))) return <NotFound kind="diagram" />;

  return (
    <div className={`editor layout-${layout}`}>
      {diagram && pageId !== null ? (
        <PageLoader
          key={pageId}
          diagram={diagram}
          pageId={pageId}
          layout={layout}
          storageDown={storageDown}
          onStorageDown={() => setStorageDown(true)}
          onMissing={() => setMissing(true)}
          onDiagram={setDiagram}
        />
      ) : (
        <div className="editor-loading" aria-hidden="true" />
      )}
      <div className="status-strip"><AnnouncementsRegion /></div>
    </div>
  );
}

interface PageProps {
  diagram: DiagramInfo;
  pageId: string;
  layout: ReturnType<typeof useLayout>;
  storageDown: boolean;
  onStorageDown(): void;
  onMissing(): void;
  onDiagram(d: DiagramInfo): void;
}

function PageLoader(props: PageProps) {
  const [store, setStore] = useState<PageStore | null>(null);
  const { diagram, pageId, onMissing, onDiagram } = props;
  const diagramRef = useRef(diagram);
  diagramRef.current = diagram;

  useEffect(() => {
    let live = true;
    let made: PageStore | null = null;
    const fetchPage = () => request({ method: "GET", path: `/api/diagrams/${diagram.id}/pages/${pageId}` });
    void (async () => {
      const res = await fetchPage();
      if (!live) return;
      if (!res.ok) {
        if (res.status === 404) onMissing();
        return;
      }
      const body = await readJson<{ page: PageDoc; derived: Derived }>(res);
      made = new PageStore(body.page, body.derived, diagram.role === "viewer", {
        diagramId: diagram.id,
        onNotFound: onMissing,
        onForbidden: () => {
          onDiagram({ ...diagramRef.current, role: "viewer" });
          void fetchPage().then(async (again) => {
            if (again.ok) {
              const fresh = await readJson<{ page: PageDoc; derived: Derived }>(again);
              made?.becomeReadOnly(fresh.page, fresh.derived);
            } else if (again.status === 404) onMissing();
          });
        },
      });
      setStore(made);
    })();
    return () => {
      live = false;
      made?.dispose();
    };
  }, []);

  if (!store) return <div className="editor-loading" aria-hidden="true" />;
  return <PageEditor {...props} store={store} />;
}

const isTextField = (el: Element) =>
  el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ||
  (el instanceof HTMLInputElement && !["button", "checkbox", "radio", "file", "submit"].includes(el.type)) ||
  (el instanceof HTMLElement && el.isContentEditable);

const ARROWS: Record<string, Point> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const EDGES: Record<string, Edge> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "top", ArrowDown: "bottom" };

function zoomStep(zoom: number, direction: 1 | -1): number {
  const percent = Math.round(zoom * 10000) / 100;
  const next = direction > 0 ? Math.floor(percent / 25 + 1e-9) * 25 + 25 : Math.ceil(percent / 25 - 1e-9) * 25 - 25;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next / 100));
}

function PageEditor({ diagram, pageId, layout, storageDown, onStorageDown, onDiagram, store }: PageProps & { store: PageStore }) {
  useStore(store);
  const modalDepth = useModalDepth();
  const paneRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const inspectorPaneRef = useRef<HTMLElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<null | "share" | "files" | "import">(null);
  const [drawer, setDrawer] = useState<null | "plain" | "label">(null);
  const [sheet, setSheet] = useState(false);
  const [labelFocus, setLabelFocus] = useState(0);
  const [otherFailure, setOtherFailure] = useState(false);
  const focusInPane = useRef(false);
  const prevLayout = useRef(layout);
  const inert = modalDepth > 0;
  const editable = !store.readOnly;
  const isOwner = diagram.role === "owner";
  const path = `/d/${diagram.id}/p/${pageId}`;

  useEffect(() => {
    setLeaveGuard({ path, pending: () => store.pending, settle: () => store.settle() });
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (store.pending) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      setLeaveGuard(null);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [store, path]);

  useLayoutEffect(() => {
    if (landingHint === "focus-canvas") paneRef.current?.focus();
    if (landingHint === "focus-tab") tabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  }, []);

  /* Layout changes: widening turns the open drawer into the pane; narrowing moves focus out of the pane. */
  useLayoutEffect(() => {
    const was = prevLayout.current;
    prevLayout.current = layout;
    if (was === layout) return;
    if (layout === "desktop" && drawer) {
      setDrawer(null);
      queueMicrotask(() => {
        const first = inspectorPaneRef.current ? focusables(inspectorPaneRef.current)[0] : null;
        first?.focus();
      });
    } else if (was === "desktop" && focusInPane.current) {
      const selected = [...store.selection][0];
      const el = selected ? paneRef.current?.querySelector<HTMLElement>(`[data-item="${CSS.escape(selected)}"]`) : null;
      (el ?? paneRef.current)?.focus();
    }
    if (layout !== "phone") setSheet(false);
  }, [layout]);

  useEffect(() => {
    if (!labelFocus) return;
    labelRef.current?.focus();
  }, [labelFocus]);

  const openLabel = useCallback((id: string) => {
    store.select([id]);
    if (layout === "desktop") setLabelFocus((n) => n + 1);
    else setDrawer("label");
  }, [store, layout]);

  const paneCenter = (): Point => {
    const rect = paneRef.current!.getBoundingClientRect();
    const v = store.view;
    return [v.x + rect.width / 2 / v.zoom, v.y + rect.height / 2 / v.zoom];
  };

  const place = (item: LibraryKind, center: Point) => {
    setSheet(false);
    const made = item.type === "system" ? addShape(store.doc, item.kind, center) : addZone(store.doc, item.kind, center);
    store.edit(made.doc);
    store.select([made.id]);
    store.requestFocus(made.id);
  };

  const actions: InspectorActions = {
    align: (edge) => {
      const next = align(store.doc, store.selection, edge);
      if (next) store.edit(next);
    },
    layer: (direction: LayerDirection) => {
      const result = layer(store.doc, store.selection, direction);
      if (!result) return;
      if (result.doc) store.edit(result.doc);
      announce(result.sentence);
    },
    group: () => {
      const next = group(store.doc, store.selection);
      if (next) store.edit(next);
    },
    ungroup: () => {
      const next = ungroup(store.doc, store.selection);
      if (next) store.edit(next);
    },
    duplicate: () => {
      const result = duplicate(store.doc, store.selection);
      if (!result) return;
      store.edit(result.doc);
      store.select(result.ids);
    },
    remove: () => {
      const next = remove(store.doc, store.selection);
      if (next) store.edit(next);
    },
    labelDone: (id) => {
      setDrawer(null);
      store.requestFocus(id);
    },
  };

  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  /* Keyboard: every canvas shortcut works from the canvas region, the top bar and the inspector's buttons, never from a text field. */
  useEffect(() => {
    const readingOrder = (onlyShapes = false): HTMLElement[] => {
      const pane = paneRef.current;
      if (!pane) return [];
      const doc = store.display;
      const items: { id: string; x: number; y: number; rank: number }[] = onlyShapes
        ? doc.shapes.map((s) => ({ id: s.id, x: s.x, y: s.y, rank: 1 }))
        : [
          ...doc.zones.map((z) => ({ id: z.id, x: z.x, y: z.y, rank: 0 })),
          ...doc.shapes.map((s) => ({ id: s.id, x: s.x, y: s.y, rank: 1 })),
          ...doc.connectors.map((c) => ({ id: c.id, x: c.points[0]![0], y: c.points[0]![1], rank: 2 })),
        ];
      items.sort((a, b) => a.y - b.y || a.x - b.x || a.rank - b.rank || (a.id < b.id ? -1 : 1));
      return items.map((i) => pane.querySelector<HTMLElement>(`[data-item="${CSS.escape(i.id)}"]`)).filter((el): el is HTMLElement => !!el);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (modalDepth > 0 || resume.open) return;
      const t = e.target as HTMLElement;
      const pane = paneRef.current;
      if (!pane || !t.closest(".editor-region")) return;
      if (isTextField(t)) return;
      const inCanvas = pane.contains(t);
      const itemEl = inCanvas ? t.closest<HTMLElement>("[data-item]") : null;
      const item = itemEl?.dataset.item ?? null;
      const kind = itemEl?.dataset.kind;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const a = actionsRef.current;
      const label = (id: string) => plainLabel(store.doc.shapes.find((s) => s.id === id)?.label ?? "");

      if (store.connectFrom) {
        const from = store.connectFrom;
        if (e.key === "Escape") {
          e.preventDefault();
          store.setConnectFrom(null);
          store.requestFocus(from);
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          const shapes = readingOrder(true).filter((el) => el.dataset.item !== from);
          if (!shapes.length) return;
          const i = shapes.findIndex((el) => el === itemEl);
          const next = i === -1 ? (e.shiftKey ? shapes[shapes.length - 1] : shapes[0]) : shapes[(i + (e.shiftKey ? -1 : 1) + shapes.length) % shapes.length];
          next?.focus();
          return;
        }
        if (e.key === "Enter" && item && kind === "shape" && item !== from) {
          e.preventDefault();
          const made = connect(store.doc, from, item);
          store.setConnectFrom(null);
          store.edit(made.doc);
          announce(`Connected ${label(from)} to ${label(item)}.`);
          return;
        }
      }

      if (mod && !e.altKey) {
        let handled = true;
        if (key === "z" && !e.shiftKey) store.undo();
        else if ((key === "z" && e.shiftKey) || key === "y") store.redo();
        else if (key === "s") store.saveNow();
        else if (key === "g") (e.shiftKey ? a.ungroup : a.group)();
        else if (key === "d") a.duplicate();
        else if (e.key === "]" || e.code === "BracketRight") a.layer("forward");
        else if (e.key === "[" || e.code === "BracketLeft") a.layer("backward");
        else handled = false;
        if (handled) e.preventDefault();
        return;
      }
      if (e.altKey && e.shiftKey && EDGES[e.key]) {
        e.preventDefault();
        a.align(EDGES[e.key]!);
        return;
      }
      if (ARROWS[e.key] && !e.altKey) {
        if (t.closest('[role="tablist"]')) return;
        e.preventDefault();
        if (item && !store.selection.has(item)) store.select([item]);
        if (store.readOnly || store.selection.size === 0) return;
        const step = e.shiftKey ? 24 : 8;
        const [dx, dy] = ARROWS[e.key]!;
        const next = moveItems(store.doc, store.selection, dx * step, dy * step);
        if (next === "overlap") announce("Zones can't overlap.");
        else store.edit(next);
        return;
      }
      if (e.key === "Escape") {
        store.clearSelection();
        return;
      }
      if (e.key === "Tab" && inCanvas) {
        const order = readingOrder();
        const i = itemEl ? order.indexOf(itemEl) : -1;
        if (!e.shiftKey) {
          e.preventDefault();
          if (i + 1 < order.length) order[i + 1]!.focus();
          else {
            const all = focusables(document.body);
            const after = all.find((el) => !pane.contains(el) && (pane.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
            (after ?? pane).focus();
          }
        } else if (i > 0) {
          e.preventDefault();
          order[i - 1]!.focus();
        } else if (i === 0) {
          e.preventDefault();
          pane.focus();
        }
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && (inCanvas || t.closest(".topbar"))) {
        e.preventDefault();
        a.remove();
        return;
      }
      if (!item) return;
      if (e.key === " ") {
        e.preventDefault();
        if (e.shiftKey) store.toggle(item);
        else store.select([item]);
      } else if ((e.key === "Enter" || e.key === "F2") && (kind === "shape" || kind === "connector")) {
        e.preventDefault();
        openLabel(item);
      } else if (key === "c" && kind === "shape" && !store.readOnly) {
        e.preventDefault();
        store.setConnectFrom(item);
        announce("Choose a shape to connect to. Press Escape to cancel.");
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [store, modalDepth, openLabel]);

  const zoomBy = (direction: 1 | -1) => {
    const rect = paneRef.current!.getBoundingClientRect();
    const v = store.view;
    const zoom = zoomStep(v.zoom, direction);
    if (zoom === v.zoom) return;
    const cx = v.x + rect.width / 2 / v.zoom, cy = v.y + rect.height / 2 / v.zoom;
    store.setView({ x: cx - rect.width / 2 / zoom, y: cy - rect.height / 2 / zoom, zoom });
  };

  const goTo = (to: string) => void navigate(to);
  const fail = () => setOtherFailure(true);
  const onImported = (result: Imported) => {
    setDialog(null);
    onDiagram({ ...diagram, pages: [...diagram.pages, { id: result.pageId, name: result.pageName, version: 1 }] });
    void navigate(`/d/${diagram.id}/p/${result.pageId}`, { hint: "focus-tab" });
  };

  const tool = (name: string, icon: ReactNode, onClick: () => void, disabled = false, text?: string) => (
    <button type="button" className={`tool${text ? " tool-text" : ""}`} aria-label={text ? undefined : name} disabled={disabled} onClick={onClick}>
      {icon}{text && <span>{text}</span>}
    </button>
  );

  const tabs = (
    <div className="page-tabs" role="tablist" aria-label="Pages" ref={tabsRef} onKeyDown={(e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const list = [...(tabsRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
      const i = list.indexOf(document.activeElement as HTMLElement);
      list[(i + (e.key === "ArrowRight" ? 1 : -1) + list.length) % list.length]?.focus();
    }}>
      {diagram.pages.map((p) => (
        <button key={p.id} type="button" role="tab" aria-selected={p.id === pageId} tabIndex={p.id === pageId ? 0 : -1} className="page-tab" onClick={() => p.id !== pageId && goTo(`/d/${diagram.id}/p/${p.id}`)}>
          {p.name}
        </button>
      ))}
    </div>
  );

  const saveState = <span className="save-state" role="status" aria-label="Save state">{store.saveState}</span>;
  const zoomControls = (
    <div className="zoom">
      {tool("Zoom out", icons.zoomOut, () => zoomBy(-1))}
      <span className="zoom-level mono" role="status" aria-label="Zoom level">{Math.floor(store.view.zoom * 100 + 0.5)}%</span>
      {tool("Zoom in", icons.zoomIn, () => zoomBy(1))}
    </div>
  );
  const history = (
    <div className="history">
      {tool("Undo", icons.undo, () => store.undo(), !store.canUndo)}
      {tool("Redo", icons.redo, () => store.redo(), !store.canRedo)}
      {tool("Save", icons.save, () => store.saveNow(), !editable)}
    </div>
  );
  const allDiagrams = (
    <a className="back-link" href="/" aria-label="All diagrams" onClick={(e) => {
      e.preventDefault();
      goTo("/");
    }}>
      {icons.back}
    </a>
  );
  const title = <h1 className="diagram-title">{diagram.title}</h1>;
  const files = tool("Files", icons.files, () => setDialog("files"), false, layout === "phone" ? undefined : "Files");
  const share = isOwner ? tool("Share", icons.share, () => setDialog("share"), false, layout === "phone" ? undefined : "Share") : null;
  const importButton = editable && diagram.role !== "viewer" ? tool("Import", icons.importFile, () => setDialog("import"), false, "Import") : null;

  const banners = (
    <div className="banners">
      {storageDown && <div role="alert" className="banner">File storage is unavailable. Diagram edits still save, but exports and imports are paused until it returns.</div>}
      {store.downgraded && <div role="alert" className="banner">Your role on this diagram is now viewer. Your last change was not saved.</div>}
      {store.failure === "conflict" && (
        <div role="alert" className="banner banner-action">
          <span>Someone else saved this page. Reload to see their changes.</span>
          <button type="button" className="btn btn-small" onClick={() => void store.reload()}>Reload page</button>
        </div>
      )}
      {(store.failure === "generic" || otherFailure) && <div role="alert" className="banner">Something went wrong. Try again.</div>}
    </div>
  );

  const library = (
    <LibraryBody
      disabled={!editable}
      zonesFull={store.doc.zones.length >= LIMITS.zones}
      onAdd={(item) => place(item, paneCenter())}
      onDrop={(item, client) => {
        const rect = paneRef.current!.getBoundingClientRect();
        const v = store.view;
        place(item, [v.x + (client[0] - rect.left) / v.zoom, v.y + (client[1] - rect.top) / v.zoom]);
      }}
    />
  );

  const inspector = <InspectorBody store={store} actions={actions} labelRef={labelRef} />;

  return (
    <>
      <header role="banner" className="topbar editor-region" inert={inert}>
        {layout === "phone" ? (
          <>
            <div className="topbar-row">{allDiagrams}{title}{saveState}{files}{share}</div>
            {tabs}
          </>
        ) : layout === "tablet" ? (
          <>
            <div className="topbar-row">{allDiagrams}{title}{saveState}<span className="spacer" />{importButton}{files}{share}{tool("Inspector", icons.inspector, () => setDrawer("plain"), false, "Inspector")}</div>
            <div className="topbar-row topbar-row-2">{tabs}{history}{zoomControls}</div>
          </>
        ) : (
          <div className="topbar-row">{allDiagrams}{title}{tabs}{saveState}{history}{zoomControls}{importButton}{files}{share}</div>
        )}
      </header>
      {layout !== "phone" && (
        <aside className="library editor-library" aria-label="Shape library" inert={inert}>{library}</aside>
      )}
      <main className="canvas-column editor-region" inert={inert} onPointerDown={() => setOtherFailure(false)}>
        <Canvas store={store} paneRef={paneRef} />
        {banners}
      </main>
      {layout === "desktop" && (
        <aside className="inspector editor-region" aria-label="Inspector" ref={inspectorPaneRef} inert={inert}
          onFocus={() => (focusInPane.current = true)} onBlur={() => (focusInPane.current = false)}>
          {inspector}
        </aside>
      )}
      {layout === "phone" && (
        <div className="toolbar editor-region" role="toolbar" aria-label="Editor tools" inert={inert}>
          {tool("Shapes", icons.shapes, () => setSheet(true), false, "Shapes")}
          {tool("Inspector", icons.inspector, () => setDrawer("plain"), false, "Inspector")}
          {tool("Undo", icons.undo, () => store.undo(), !store.canUndo)}
          {tool("Redo", icons.redo, () => store.redo(), !store.canRedo)}
          {tool("Save", icons.save, () => store.saveNow(), !editable)}
        </div>
      )}
      {drawer && layout !== "desktop" && (
        <Modal kind="drawer" label="Inspector" onClose={() => setDrawer(null)} initialFocus={drawer === "label" ? labelRef : undefined} className={`drawer ${layout === "phone" ? "drawer-full" : ""}`}>
          <header className="dialog-head">
            <h2>Inspector</h2>
            <button type="button" className="tool" aria-label="Close inspector" onClick={() => setDrawer(null)}>{icons.close}</button>
          </header>
          {inspector}
        </Modal>
      )}
      {sheet && layout === "phone" && (
        <Modal kind="sheet" label="Shape library" onClose={() => setSheet(false)} className="sheet">
          <header className="dialog-head">
            <h2>Shape library</h2>
            <button type="button" className="tool" aria-label="Close shape library" onClick={() => setSheet(false)}>{icons.close}</button>
          </header>
          {library}
        </Modal>
      )}
      {dialog === "share" && <ShareDialog diagramId={diagram.id} ownerName={diagram.ownerName} onClose={() => setDialog(null)} onFailure={fail} />}
      {dialog === "files" && <FilesDialog diagramId={diagram.id} canExport={diagram.role !== "viewer"} onClose={() => setDialog(null)} onStorageDown={onStorageDown} onFailure={fail} />}
      {dialog === "import" && <ImportDialog diagramId={diagram.id} onClose={() => setDialog(null)} onImported={onImported} onStorageDown={onStorageDown} onFailure={fail} />}
    </>
  );
}
