import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { sharedEditScope, tokenUses } from "../../shared/apply.js";
import { notice } from "../../shared/notices.js";
import { inheritingThrough, reach, resolve, valueText } from "../../shared/styles.js";
import { defaultName, insertSlot, keyboardMove, locateOnPage, moveProblem, treeOrder, TYPE_LABEL } from "../../shared/tree.js";
import {
  BREAKPOINTS,
  type Breakpoint,
  type CommentThread,
  type Created,
  type DocBody,
  type EditOp,
  type ImageRecord,
  type Member,
  type PublishStatus,
  type Role,
  type VersionSummary,
  type WorkspaceDoc,
} from "../../shared/types.js";
import { api } from "../api.js";
import { announce } from "../ui/announcer.js";
import { flash, prefersReducedMotion, Reversible, type MotionState } from "../ui/motion.js";
import { Canvas } from "./Canvas.js";
import {
  EditorContext,
  type DialogState,
  type DragState,
  type EditorActions,
  type EditorState,
  type EditorValue,
  type Layout,
  type Panel,
  type PhoneSheet,
} from "./context.js";
import { Dialogs } from "./dialogs.js";
import { editorContext } from "./drag.js";
import { classifyFocus } from "./keys.js";
import { Navigator } from "./Navigator.js";
import { PhoneToolbar } from "./Phone.js";
import { Sheet } from "./panels/Sheet.js";
import { StylePanel } from "./StylePanel.js";
import { Sync, type Me } from "./sync.js";
import { TopBar } from "./TopBar.js";

const PANELS: readonly Panel[] = ["tokens", "collection", "images", "history", "comments", "publish"];
const STYLE_PANEL_MS = 200;
const FAN_MS = 420;
const EFFECT_MS = 160;

interface Boot {
  sync: Sync;
  members: Member[];
}

function readUrl() {
  const q = new URLSearchParams(location.search);
  const bp = q.get("bp");
  const panel = q.get("panel");
  return {
    page: q.get("page"),
    bp: (BREAKPOINTS as readonly string[]).includes(bp ?? "") ? (bp as Breakpoint) : "desktop",
    panel: panel === "publish" ? ("publish" as const) : null,
    version: q.get("version"),
  };
}

function useLayout(): Layout {
  const read = (): Layout => (window.matchMedia("(min-width: 1280px)").matches ? "desktop" : window.matchMedia("(min-width: 768px)").matches ? "tablet" : "phone");
  const [layout, setLayout] = useState<Layout>(read);
  useEffect(() => {
    const queries = [window.matchMedia("(min-width: 1280px)"), window.matchMedia("(min-width: 768px)")];
    const update = () => setLayout(read());
    queries.forEach((q) => q.addEventListener("change", update));
    return () => queries.forEach((q) => q.removeEventListener("change", update));
  }, []);
  return layout;
}

export function Editor({ workspaceId }: { workspaceId: string }) {
  const [boot, setBoot] = useState<Boot | "missing" | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [me, doc, members] = await Promise.all([
        api<{ user: { id: string; name: string }; workspaces: { id: string; role: Role }[] }>("GET", "/api/me"),
        api<WorkspaceDoc>("GET", `/api/workspaces/${workspaceId}/document`),
        api<{ members: Member[] }>("GET", `/api/workspaces/${workspaceId}/members`),
      ]);
      if (cancelled) return;
      if (!me.ok) return location.assign(`/signin?next=${encodeURIComponent(location.pathname + location.search)}`);
      const role = me.data.workspaces.find((w) => w.id === workspaceId)?.role;
      if (!doc.ok || !members.ok || !role) return setBoot("missing");
      const person: Me = { id: me.data.user.id, name: me.data.user.name, role };
      setBoot({ sync: new Sync(doc.data, person), members: members.data.members });
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);
  if (boot === "missing") return <NotFoundView />;
  if (!boot) return <LoadingView />;
  return <Workspace workspaceId={workspaceId} boot={boot} />;
}

function NotFoundView() {
  return (
    <main className="pl-ground pl-message">
      <div>
        <h1>{"Not found."}</h1>
        <p>It may have been removed, or you may not have access.</p>
      </div>
    </main>
  );
}

function LoadingView() {
  return (
    <div className="pl-loading" aria-busy="true">
      <div className="pl-skeleton-bar" />
      <div className="pl-skeleton-body">
        <div className="pl-skeleton-col">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="pl-skeleton-row" style={{ width: `${60 + ((i * 17) % 35)}%` }} />
          ))}
        </div>
        <div className="pl-ground pl-skeleton-canvas" />
      </div>
    </div>
  );
}

function Workspace({ workspaceId, boot }: { workspaceId: string; boot: Boot }) {
  const { sync } = boot;
  const layout = useLayout();
  const initial = useMemo(readUrl, []);
  const [, setTick] = useState(0);
  const [pageId, setPageId] = useState<string>(() => (sync.view.pages.some((p) => p.id === initial.page) ? (initial.page as string) : [...sync.view.pages].sort((a, b) => a.order - b.order)[0].id));
  const [bp, setBpState] = useState<Breakpoint>(initial.bp);
  const [panel, setPanel] = useState<Panel | null>(initial.panel);
  const [versionId, setVersionId] = useState<string | null>(initial.version);
  const [preview, setPreview] = useState<{ id: string; name: string; doc: WorkspaceDoc } | null>(null);
  const [missingVersion, setMissingVersion] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsedSet] = useState<ReadonlySet<string>>(new Set());
  const [focusRowId, setFocusRowId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [stylePanelOpen, setStylePanelOpen] = useState(true);
  const [fan, setFan] = useState<MotionState>("closed");
  const [updatedTags, setUpdatedTags] = useState<ReadonlySet<Breakpoint>>(new Set());
  const [storageDown, setStorageDown] = useState(false);
  const [busy, setBusy] = useState({ publish: false, upload: false, restore: false });
  const [publishFailed, setPublishFailed] = useState(false);
  const [publishStatus, setPublishStatus] = useState<PublishStatus | null>(null);
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [members, setMembers] = useState<Member[]>(boot.members);
  const [phoneSheet, setPhoneSheet] = useState<PhoneSheet>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [composerFor, setComposerFor] = useState(0);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef<() => void>(() => undefined);
  const focusQueue = useRef<(() => HTMLElement | null | undefined) | null>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  const menuOpener = useRef<HTMLElement | null>(null);
  const panelOpener = useRef<HTMLElement | null>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  const role = sync.me.role;
  const readOnly = role === "viewer" || preview !== null;
  const liveDoc = sync.view;
  const doc = preview?.doc ?? liveDoc;
  const page = doc.pages.find((p) => p.id === pageId) ?? [...doc.pages].sort((a, b) => a.order - b.order)[0];
  const ownerName = members.find((m) => m.role === "owner")?.name ?? "the owner";

  const state: EditorState = {
    workspaceId,
    doc,
    page,
    bp,
    layout,
    role,
    meId: sync.me.id,
    ownerName,
    readOnly,
    preview: preview && { id: preview.id, name: preview.name },
    selectedId,
    collapsed,
    focusRowId,
    renamingId,
    panel,
    menuOpen,
    dialog,
    drawerOpen,
    stylePanelOpen,
    fan,
    updatedTags,
    storageDown,
    busy,
    publishFailed,
    publishStatus,
    threads,
    images,
    versions,
    members,
    phoneSheet,
    drag,
    composerFor,
  };
  const stateRef = useRef(state);
  stateRef.current = state;
  editorContext.doc = () => sync.view;
  editorContext.pageId = () => stateRef.current.page.id;

  // ── Focus ──────────────────────────────────────────────────────────────────────────────────────
  const focusLater = useCallback((target: () => HTMLElement | null | undefined) => {
    focusQueue.current = target;
    setTick((t) => t + 1);
  }, []);
  const rowElement = (id: string) => document.querySelector<HTMLElement>(`[role="tree"] [data-row-id="${id}"]`);
  const navigatorVisible = () => {
    const s = stateRef.current;
    return s.layout === "desktop" || (s.layout === "tablet" && s.drawerOpen);
  };
  /** Row focus at tablet widths: the row while the Navigator shows, else the canvas. */
  const focusRowOrCanvas = (id: string | null) => {
    if (id && navigatorVisible()) {
      setFocusRowId(id);
      focusLater(() => rowElement(id));
    } else focusLater(() => canvasRef.current);
  };

  useLayoutEffect(() => {
    const queued = focusQueue.current;
    if (queued) {
      const element = queued();
      if (element) {
        element.focus({ preventScroll: element.closest("#canvas") !== null && element.id !== "canvas" });
        focusQueue.current = null;
      }
    } else if (document.activeElement === document.body && lastFocused.current && !lastFocused.current.isConnected) {
      const s = stateRef.current;
      const row = lastFocused.current.getAttribute("role") === "treeitem" && s.selectedId ? rowElement(s.selectedId) : null;
      (row ?? canvasRef.current)?.focus();
    }
    layoutRef.current();
  });

  useEffect(() => {
    const onFocus = (e: FocusEvent) => (lastFocused.current = e.target as HTMLElement);
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, []);

  // ── Motion ─────────────────────────────────────────────────────────────────────────────────────
  const fanMotion = useMemo(
    () =>
      new Reversible(
        FAN_MS,
        false,
        (motionState, progress) => {
          const canvas = canvasRef.current;
          canvas?.setAttribute("data-fan", motionState);
          canvas?.setAttribute("data-fan-progress", progress.toFixed(2));
          setFan((current) => (current === motionState ? current : motionState));
          layoutRef.current();
        },
        (end) => {
          if (end !== "closed") return;
          const s = stateRef.current;
          focusRowOrCanvas(s.selectedId);
        },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const panelMotion = useMemo(
    () =>
      new Reversible(STYLE_PANEL_MS, true, (motionState, progress) => {
        const element = document.getElementById("style-panel");
        element?.setAttribute("data-motion", motionState);
        element?.setAttribute("data-progress", progress.toFixed(2));
        document.querySelector<HTMLElement>(".pl-editor")?.style.setProperty("--style-progress", String(progress));
        layoutRef.current();
      }),
    [],
  );

  // ── Live connection ────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    sync.events = {
      joined: (person) => announce(notice.joined(person.name)),
      conflict: (m) => announce(notice.conflict(m.winner.name, m.property, m.value)),
      role: (next) => {
        if (next === "viewer" || next === "editor") announce(notice.roleChanged(next));
        setMenuOpen(false);
      },
      removed: () => location.assign("/"),
      comment: (thread) => {
        setThreads((list) => (thread.pageId !== stateRef.current.page.id ? list : list.some((t) => t.id === thread.id) ? list.map((t) => (t.id === thread.id ? thread : t)) : [...list, thread]));
      },
      restored: (by, versionName) => {
        announce(notice.restored(by.name, versionName), by.id === sync.me.id);
        setBusy((b) => ({ ...b, restore: false }));
      },
      changed: () => {
        const s = stateRef.current;
        if (s.panel === "publish" || s.layout === "phone") void refreshStatus();
        if (s.selectedId && !locateOnPage(sync.view, s.selectedId)) {
          const parent = lastParent.current.get(s.selectedId);
          setSelectedId(parent && locateOnPage(sync.view, parent) ? parent : null);
        }
      },
    };
    sync.connect();
    const unlisten = sync.listen(() => setTick((t) => t + 1));
    return () => {
      unlisten();
      sync.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync]);

  /** Parents of nodes, so a remotely deleted selection can move to its parent. */
  const lastParent = useRef(new Map<string, string>());
  useEffect(() => {
    const map = new Map<string, string>();
    for (const p of liveDoc.pages) for (const n of treeOrder(p.root)) for (const c of n.children) map.set(c.id, n.id);
    lastParent.current = map;
  });

  // ── Server reads ───────────────────────────────────────────────────────────────────────────────
  const refreshStatus = useCallback(async () => {
    const r = await api<PublishStatus>("GET", `/api/pages/${stateRef.current.page.id}/publish`);
    if (r.ok) setPublishStatus(r.data);
  }, []);
  useEffect(() => {
    void refreshStatus();
    void api<{ threads: CommentThread[] }>("GET", `/api/workspaces/${workspaceId}/comments?pageId=${page.id}`).then((r) => r.ok && setThreads(r.data.threads));
  }, [page.id, workspaceId, refreshStatus]);
  useEffect(() => {
    void api<{ status: string }>("GET", `/api/workspaces/${workspaceId}/storage`).then((r) => r.ok && r.data.status === "unavailable" && setStorageDown(true));
  }, [workspaceId]);
  const loadImages = useCallback(() => {
    void api<{ images: ImageRecord[] }>("GET", `/api/workspaces/${workspaceId}/images`).then((r) => r.ok && setImages(r.data.images));
  }, [workspaceId]);
  const loadVersions = useCallback(() => {
    void api<{ versions: VersionSummary[] }>("GET", `/api/workspaces/${workspaceId}/versions`).then((r) => r.ok && setVersions(r.data.versions));
  }, [workspaceId]);
  const loadMembers = useCallback(() => {
    void api<{ members: Member[] }>("GET", `/api/workspaces/${workspaceId}/members`).then((r) => r.ok && setMembers(r.data.members));
  }, [workspaceId]);

  // ── Version preview ────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!versionId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    void api<VersionSummary & { document: DocBody }>("GET", `/api/versions/${versionId}`).then((r) => {
      if (cancelled) return;
      if (!r.ok) return setMissingVersion(true);
      setPreview({ id: r.data.id, name: r.data.name, doc: { ...r.data.document, seq: r.data.seq } });
    });
    return () => {
      cancelled = true;
    };
  }, [versionId]);

  // ── Address ────────────────────────────────────────────────────────────────────────────────────
  const writeUrl = useCallback((next: { page?: string; bp?: Breakpoint; panel?: Panel | null; version?: string | null }, push = false) => {
    const s = stateRef.current;
    const q = new URLSearchParams();
    if (next.version !== undefined ? next.version : versionIdRef.current) q.set("version", (next.version !== undefined ? next.version : versionIdRef.current) as string);
    q.set("page", next.page ?? s.page.id);
    const bpNext = next.bp ?? s.bp;
    if (bpNext !== "desktop") q.set("bp", bpNext);
    if ((next.panel !== undefined ? next.panel : s.panel) === "publish") q.set("panel", "publish");
    const url = `${location.pathname}?${q.toString()}`;
    if (push) history.pushState(null, "", url);
    else history.replaceState(null, "", url);
  }, []);
  const versionIdRef = useRef(versionId);
  versionIdRef.current = versionId;
  useEffect(() => {
    const onPop = () => {
      const u = readUrl();
      if (u.page) setPageId(u.page);
      setBpState(u.bp);
      setVersionId(u.version);
      if (u.panel) setPanel("publish");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────────────────────────────
  const view = () => sync.view;
  const nodeName = (id: string) => locateOnPage(view(), id)?.node.name ?? "";
  const reject = (error: { code: string; message: string }, fallbackName?: string) => {
    if (error.code === "forbidden_role") {
      announce(notice.roleRefused, true);
      sync.me = { ...sync.me, role: "viewer" };
      setTick((t) => t + 1);
    } else if (error.code === "invalid_move" && fallbackName) announce(notice.refusedMove(fallbackName), true);
    else announce(error.message, true);
  };
  const sharedAfter = (nodeId: string, structural: boolean) => {
    const scope = sharedEditScope(view(), nodeId, structural);
    if (scope) announce(notice.sharedEdit(scope.instances, scope.name), true);
  };
  const send = (op: EditOp, onApplied?: (created: Created | undefined) => void, name?: string) => {
    sync.send(op, { onApplied, onRejected: (e) => reject(e, name) });
  };
  const mark = (selectors: string[], attribute: string) => flash(selectors.length ? [...document.querySelectorAll<HTMLElement>(selectors.join(","))] : [], attribute, EFFECT_MS);

  const act: EditorActions = {
    select(id, options) {
      setSelectedId(id);
      sync.sendSelection(id);
      if (id) {
        const found = locateOnPage(stateRef.current.doc, id);
        if (found) setCollapsedSet((set) => (found.ancestors.some((a) => set.has(a.id)) ? new Set([...set].filter((x) => !found.ancestors.some((a) => a.id === x))) : set));
        if (!options?.fromCanvas)
          window.requestAnimationFrame(() =>
            document.querySelector(`#canvas [data-frame="${stateRef.current.bp}"] [data-node-id="${id}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" }),
          );
      }
    },
    setPage(id) {
      setPageId(id);
      setSelectedId(null);
      setFocusRowId(null);
      writeUrl({ page: id }, true);
      sync.sendCursor(id, null, null);
    },
    setBp(next, options) {
      setBpState(next);
      writeUrl({ bp: next });
      if (options?.focusFrame) focusLater(() => document.querySelector<HTMLElement>(`#canvas [data-frame="${next}"]`));
    },
    openPanel(next, options) {
      panelOpener.current = document.activeElement as HTMLElement;
      setPanel(next);
      setMenuOpen(false);
      writeUrl({ panel: next });
      if (next === "images") loadImages();
      if (next === "history") loadVersions();
      if (next === "publish") void refreshStatus();
      if (next === "comments" && options?.focusComposer) {
        setComposerFor((n) => n + 1);
        focusLater(() => document.querySelector<HTMLElement>("#comments-composer"));
      } else focusLater(() => document.querySelector<HTMLElement>(`#sheet-${next} [data-sheet-heading]`));
    },
    closePanel() {
      const s = stateRef.current;
      if (!s.panel) return;
      const opener = panelOpener.current;
      const label = { tokens: "Tokens", collection: "Collection", images: "Images", history: "History", comments: "Comments", publish: "Publish" }[s.panel];
      setPanel(null);
      writeUrl({ panel: null });
      focusLater(() => (opener?.isConnected && !opener.closest(".pl-sheet") ? opener : document.querySelector<HTMLElement>(`header [data-panel-button="${label}"]`)) ?? canvasRef.current);
    },
    openMenu() {
      if (stateRef.current.readOnly) return;
      menuOpener.current = document.activeElement as HTMLElement;
      setMenuOpen(true);
    },
    closeMenu() {
      setMenuOpen(false);
      const opener = menuOpener.current;
      focusLater(() => (opener?.isConnected ? opener : canvasRef.current));
    },
    insert(dragged, slotGiven) {
      const s = stateRef.current;
      setMenuOpen(false);
      const doc = view();
      const livePage = doc.pages.find((p) => p.id === s.page.id);
      if (!livePage) return;
      const type = dragged.kind === "type" ? dragged.type : doc.components.find((c) => c.id === dragged.componentId)?.root.type;
      if (!type) return;
      const slot = slotGiven ?? insertSlot(doc, livePage, s.selectedId, type);
      if (!slot) return announce(notice.refusedMove(TYPE_LABEL[type]), true);
      if (dragged.kind === "type" && type === "image") {
        loadImages();
        setDialog({ kind: "placeImage", parentId: slot.parentId, index: slot.index });
        return;
      }
      const after = (created: { nodeId?: string } | undefined, name: string) => {
        if (!created?.nodeId) return;
        act.select(created.nodeId);
        focusRowOrCanvas(created.nodeId);
        announce(notice.inserted(name), true);
        sharedAfter(slot.parentId, false);
      };
      if (dragged.kind === "component") {
        const component = doc.components.find((c) => c.id === dragged.componentId);
        send({ kind: "insert_instance", pageId: livePage.id, parentId: slot.parentId, index: slot.index, componentId: dragged.componentId }, (c) => after(c, component?.root.name ?? ""));
        return;
      }
      const name = defaultName(livePage.root, type);
      send({ kind: "insert_node", pageId: livePage.id, parentId: slot.parentId, index: slot.index, type, name }, (c) => after(c, name), TYPE_LABEL[type]);
    },
    drop(dragged, slot) {
      if (dragged.kind !== "node") return act.insert(dragged, slot);
      const doc = view();
      const name = nodeName(dragged.nodeId);
      const found = locateOnPage(doc, dragged.nodeId);
      const target = locateOnPage(doc, slot.parentId);
      if (!found || !target || !found.parent) return announce(notice.refusedMove(name), true);
      if (moveProblem(doc, dragged.nodeId, slot.parentId, slot.index)) return announce(notice.refusedMove(name), true);
      const total = target.node.children.filter((c) => c.id !== dragged.nodeId).length + 1;
      send({ kind: "move_node", nodeId: dragged.nodeId, parentId: slot.parentId, index: slot.index }, undefined, name);
      announce(notice.moved(name, slot.index + 1, total, target.node.name), true);
      sharedAfter(dragged.nodeId, true);
    },
    keyMove(nodeId, move) {
      const doc = view();
      const name = nodeName(nodeId);
      const slot = keyboardMove(doc, nodeId, move);
      if (!slot) {
        announce(notice.refusedMove(name), true);
        focusLater(() => rowElement(nodeId));
        return;
      }
      const target = locateOnPage(doc, slot.parentId);
      const found = locateOnPage(doc, nodeId);
      const total = (target?.node.children.filter((c) => c.id !== nodeId).length ?? 0) + 1;
      const parentName = target?.node.name ?? "";
      send({ kind: "move_node", nodeId, parentId: slot.parentId, index: slot.index }, undefined, name);
      announce(notice.moved(name, slot.index + 1, total, parentName), true);
      if (found) sharedAfter(nodeId, true);
      setCollapsedSet((set) => (set.has(slot.parentId) ? new Set([...set].filter((x) => x !== slot.parentId)) : set));
      setFocusRowId(nodeId);
      focusLater(() => rowElement(nodeId));
    },
    startRename(id) {
      if (stateRef.current.readOnly) return;
      setRenamingId(id);
    },
    commitRename(id, name) {
      setRenamingId(null);
      setFocusRowId(id);
      focusLater(() => rowElement(id));
      const current = locateOnPage(view(), id);
      if (!current || current.node.name === name || !name.trim()) return;
      send({ kind: "rename_node", nodeId: id, name: name.slice(0, 80) });
      sharedAfter(id, true);
    },
    cancelRename(id) {
      setRenamingId(null);
      focusLater(() => rowElement(id));
    },
    requestDelete(id) {
      const found = locateOnPage(view(), id);
      if (!found || !found.parent || stateRef.current.readOnly) return;
      setDialog({ kind: "delete", nodeId: id, name: found.node.name });
    },
    confirmDelete(id) {
      const doc = view();
      const found = locateOnPage(doc, id);
      setDialog(null);
      if (!found || !found.parent) return;
      const next = found.parent.children[found.index + 1]?.id ?? found.parent.id;
      const scope = sharedEditScope(doc, id, true);
      send({ kind: "delete_node", nodeId: id });
      announce(notice.deleted(found.node.name), true);
      if (scope) announce(notice.sharedEdit(scope.instances, scope.name), true);
      act.select(next);
      focusRowOrCanvas(next);
    },
    duplicate(id) {
      const found = locateOnPage(view(), id);
      if (!found || !found.parent || stateRef.current.readOnly) return;
      send({ kind: "duplicate_node", nodeId: id }, (created) => {
        if (!created?.nodeId) return;
        act.select(created.nodeId);
        focusRowOrCanvas(created.nodeId);
        sharedAfter(id, true);
      });
    },
    setStyle(nodeId, key, value) {
      const s = stateRef.current;
      const found = locateOnPage(view(), nodeId);
      if (!found) return;
      const before = structuredClone(found.node.styles);
      const fanOpen = fanMotion.heading;
      send({ kind: "set_style", nodeId, breakpoint: s.bp, property: key, value });
      if (fanOpen) {
        const r = reach(before, s.bp, key);
        announce(notice.cascade(key, s.bp, r.inherited, r.kept), true);
        if (prefersReducedMotion()) setUpdatedTags(new Set(r.inherited));
        else {
          setUpdatedTags(new Set());
          mark(r.inherited.map((b) => `#canvas [data-frame="${b}"]`), "data-ripple");
          mark(r.kept.map((b) => `#style-panel [aria-label="${key}"] [data-pip="${b}"]`), "data-pulse");
        }
      } else setUpdatedTags(new Set());
      sharedAfter(nodeId, false);
    },
    clearStyle(nodeId, key) {
      const s = stateRef.current;
      const found = locateOnPage(view(), nodeId);
      if (!found) return;
      const after = structuredClone(found.node.styles);
      delete after[s.bp][key];
      const fanOpen = fanMotion.heading;
      send({ kind: "clear_style", nodeId, breakpoint: s.bp, property: key });
      announce(notice.overrideCleared(key, s.bp, valueText(resolve(after, s.bp, key)?.value)), true);
      const through = inheritingThrough(after, s.bp, key);
      if (fanOpen && prefersReducedMotion()) setUpdatedTags(new Set(through));
      else {
        setUpdatedTags(new Set());
        if (fanOpen) mark(through.map((b) => `#canvas [data-frame="${b}"]`), "data-ripple");
      }
      sharedAfter(nodeId, false);
      focusLater(() => document.querySelector<HTMLElement>(`#style-panel [aria-label="${key} value"]`));
    },
    setProp(nodeId, prop, value) {
      send({ kind: "set_prop", nodeId, prop, value });
      sharedAfter(nodeId, false);
    },
    bind(nodeId, prop, field) {
      send({ kind: "bind_prop", nodeId, prop, field });
      sharedAfter(nodeId, false);
    },
    createComponent(nodeId, name) {
      setDialog(null);
      send({ kind: "create_component", nodeId, name }, () => focusRowOrCanvas(nodeId));
      focusRowOrCanvas(nodeId);
    },
    detach(nodeId) {
      send({ kind: "detach_instance", nodeId });
    },
    placeImage(parentId, index, imageId, alt) {
      const s = stateRef.current;
      setDialog(null);
      const name = defaultName(s.page.root, "image");
      send({ kind: "insert_node", pageId: s.page.id, parentId, index, type: "image", name, props: { imageId, alt, focalX: 50, focalY: 50 } }, (created) => {
        if (!created?.nodeId) return;
        act.select(created.nodeId);
        focusRowOrCanvas(created.nodeId);
        announce(notice.inserted(name), true);
        sharedAfter(parentId, false);
      });
    },
    toggleFan() {
      const s = stateRef.current;
      if (!s.selectedId || s.layout === "phone") return;
      fanMotion.toggle();
    },
    toggleStylePanel() {
      const open = !panelMotion.heading;
      setStylePanelOpen(open);
      panelMotion.set(open);
    },
    toggleDrawer(open) {
      const next = open ?? !stateRef.current.drawerOpen;
      setDrawerOpen(next);
      if (next) {
        const s = stateRef.current;
        const target = s.focusRowId ?? s.selectedId ?? s.page.root.id;
        focusLater(() => rowElement(target) ?? document.querySelector<HTMLElement>('[role="tree"] [tabindex="0"]'));
      } else focusLater(() => document.querySelector<HTMLElement>('header [data-navigator-toggle]'));
    },
    setCollapsed(id, value) {
      setCollapsedSet((set) => {
        const next = new Set(set);
        if (value) next.add(id);
        else next.delete(id);
        return next;
      });
    },
    setFocusRow: setFocusRowId,
    focusRow(id) {
      focusRowOrCanvas(id);
    },
    openDialog(next) {
      setMenuOpen(false);
      if (next.kind === "share") loadMembers();
      setDialog(next);
    },
    closeDialog() {
      setDialog(null);
    },
    undo() {
      sync.send({ kind: "undo" }, { onRejected: (e) => announce(e.message, true) });
    },
    redo() {
      sync.send({ kind: "redo" }, { onRejected: (e) => announce(e.message, true) });
    },
    publish() {
      if (busyRef.current.publish) return;
      const s = stateRef.current;
      const p = s.page;
      busyRef.current = { ...busyRef.current, publish: true };
      setBusy((b) => ({ ...b, publish: true }));
      setDialog(null);
      setPanel("publish");
      writeUrl({ page: p.id, panel: "publish" });
      focusLater(() => document.getElementById("publish-state"));
      announce(notice.publishing(p.name), true);
      void api<PublishStatus>("POST", `/api/pages/${p.id}/publish`, undefined, { "Idempotency-Key": `${p.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}` }).then((r) => {
        busyRef.current = { ...busyRef.current, publish: false };
        setBusy((b) => ({ ...b, publish: false }));
        if (r.ok) {
          setPublishStatus(r.data);
          setPublishFailed(false);
          setStorageDown(false);
          announce(notice.published(p.name, r.data.url ?? ""), true);
        } else {
          setPublishFailed(true);
          if (r.status === 503) setStorageDown(true);
          announce(notice.publishFailed(p.name), true);
          void refreshStatus();
        }
      });
    },
    unpublish() {
      const p = stateRef.current.page;
      void api<PublishStatus>("POST", `/api/pages/${p.id}/unpublish`).then((r) => {
        if (r.ok) {
          setPublishStatus(r.data);
          announce(notice.unpublished(p.name), true);
          focusLater(() => document.getElementById("publish-state"));
        } else announce(r.error.message, true);
      });
    },
    upload(files) {
      void (async () => {
        for (const file of files) {
          setBusy((b) => ({ ...b, upload: true }));
          announce(notice.uploading(file.name), true);
          const form = new FormData();
          form.append("file", file, file.name);
          const r = await api<ImageRecord>("POST", `/api/workspaces/${workspaceId}/images`, form);
          setBusy((b) => ({ ...b, upload: false }));
          if (r.ok) {
            setStorageDown(false);
            setImages((list) => [...list.filter((i) => i.id !== r.data.id), r.data]);
            announce(notice.uploaded(file.name), true);
          } else if (r.error.code === "unsupported_image") announce(notice.wrongType, true);
          else if (r.error.code === "image_too_large") announce(notice.tooBig, true);
          else {
            if (r.status === 503) setStorageDown(true);
            announce(notice.uploadOutage(file.name), true);
          }
        }
      })();
    },
    saveVersion(name) {
      setDialog(null);
      void api<VersionSummary>("POST", `/api/workspaces/${workspaceId}/versions`, name.trim() ? { name: name.trim() } : {}).then((r) => {
        if (r.ok) {
          announce(notice.versionSaved(r.data.name), true);
          loadVersions();
        } else announce(r.error.message, true);
      });
    },
    restore() {
      const s = stateRef.current;
      if (!s.preview || busyRef.current.restore) return;
      const target = s.preview;
      setDialog(null);
      busyRef.current = { ...busyRef.current, restore: true };
      setBusy((b) => ({ ...b, restore: true }));
      announce(notice.restoring(target.name), true);
      void api<{ seq: number }>("POST", `/api/versions/${target.id}/restore`).then((r) => {
        busyRef.current = { ...busyRef.current, restore: false };
        setBusy((b) => ({ ...b, restore: false }));
        if (!r.ok) return announce(r.error.message, true);
        setVersionId(null);
        writeUrl({ version: null });
        loadVersions();
        focusLater(() => canvasRef.current);
      });
    },
    leavePreview() {
      setVersionId(null);
      writeUrl({ version: null }, true);
      focusLater(() => canvasRef.current);
    },
    openVersion(id) {
      setVersionId(id);
      setPanel(null);
      writeUrl({ version: id, panel: null }, true);
    },
    loadImages,
    loadVersions,
    loadMembers,
    sendToken(op) {
      const doc = view();
      if (op.kind === "set_token") {
        const existing = doc.tokens.find((t) => t.name === op.name);
        send(op as EditOp, () => {
          const token = view().tokens.find((t) => t.name === op.name);
          if (existing && token) {
            const text = token.kind === "color" ? token.value : `${token.value}${token.unit}`;
            announce(notice.token(token.name, text, tokenUses(view(), token.name)), true);
          }
        });
        return;
      }
      send(op as EditOp);
    },
    setFields(fields) {
      send({ kind: "set_fields", fields });
    },
    putEntry(entryId, values) {
      send(entryId ? { kind: "put_entry", entryId, values } : { kind: "put_entry", values });
    },
    moveEntry(entryId, index) {
      send({ kind: "move_entry", entryId, index });
    },
    deleteEntry(entryId) {
      send({ kind: "delete_entry", entryId });
    },
    addPage(name) {
      setDialog(null);
      send({ kind: "add_page", name }, (created) => created?.pageId && act.setPage(created.pageId));
    },
    async postComment(body) {
      const s = stateRef.current;
      const target = s.selectedId ? locateOnPage(s.doc, s.selectedId) : null;
      if (!target) return false;
      const r = await api<CommentThread & { mentionFailures?: string[] }>("POST", `/api/workspaces/${workspaceId}/comments`, { pageId: s.page.id, nodeId: target.node.id, body });
      if (!r.ok) {
        announce(r.error.fields.body ?? r.error.message, true);
        return false;
      }
      const { mentionFailures, ...thread } = r.data;
      setThreads((list) => (list.some((t) => t.id === thread.id) ? list.map((t) => (t.id === thread.id ? thread : t)) : [...list, thread]));
      announce(notice.commentPosted(target.node.name), true);
      for (const email of mentionFailures ?? []) announce(notice.mentionFailed(email), true);
      focusLater(() => document.querySelector<HTMLElement>(`[data-thread="${thread.id}"] [data-reply]`));
      return true;
    },
    async postReply(threadId, body) {
      const r = await api<{ mentionFailures?: string[] }>("POST", `/api/comments/${threadId}/replies`, { body });
      if (!r.ok) {
        announce(r.error.fields.body ?? r.error.message, true);
        return false;
      }
      for (const email of r.data.mentionFailures ?? []) announce(notice.mentionFailed(email), true);
      return true;
    },
    setThreadStatus(threadId, status) {
      void api<CommentThread>("POST", `/api/comments/${threadId}/${status === "resolved" ? "resolve" : "reopen"}`).then((r) => {
        if (r.ok) {
          const thread = r.data;
          setThreads((list) => list.map((t) => (t.id === thread.id ? thread : t)));
          focusLater(() => document.querySelector<HTMLElement>(`[data-thread="${thread.id}"] [data-status-toggle]`));
        } else announce(r.error.message, true);
      });
    },
    setDrag,
    setPhoneSheet(sheet) {
      setPhoneSheet(sheet);
      if (sheet === "publish") void refreshStatus();
    },
    pointer: (() => {
      let last = -Infinity;
      let timer = 0;
      let latest: [number | null, number | null] = [null, null];
      const flush = () => {
        last = performance.now();
        timer = 0;
        sync.sendCursor(stateRef.current.page.id, latest[0], latest[1]);
      };
      return (x: number | null, y: number | null) => {
        latest = [x, y];
        const wait = 50 - (performance.now() - last);
        if (wait <= 0) flush();
        else if (!timer) timer = window.setTimeout(flush, wait);
      };
    })(),
  };
  const actRef = useRef(act);
  actRef.current = act;

  // ── Keys ───────────────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const s = stateRef.current;
      const a = actRef.current;
      const where = classifyFocus(event.target as Element | null);
      const key = event.key.toLowerCase();
      if (event.key === "Escape") {
        if (where === "dialog" || where === "menu") return;
        if (s.panel) {
          event.preventDefault();
          return a.closePanel();
        }
        if (s.layout === "tablet" && s.drawerOpen) {
          event.preventDefault();
          return a.toggleDrawer(false);
        }
        if (fanMotion.heading) {
          event.preventDefault();
          fanMotion.set(false);
        }
        return;
      }
      if (where !== "row" && where !== "canvas" && where !== "control") return;
      const target = where === "row" ? (event.target as HTMLElement).getAttribute("data-row-id") : s.selectedId;
      const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
      const editing = !s.readOnly && s.layout !== "phone";
      if ((where === "row" || where === "canvas") && plain && key === "delete" && target && editing) {
        event.preventDefault();
        return a.requestDelete(target);
      }
      if ((where === "row" || where === "canvas") && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && key === "d") {
        event.preventDefault();
        if (target && editing) a.duplicate(target);
        return;
      }
      if (plain && !event.shiftKey && key === "a" && editing) {
        event.preventDefault();
        return a.openMenu();
      }
      if (plain && !event.shiftKey && key === "f" && s.layout !== "phone") {
        event.preventDefault();
        return a.toggleFan();
      }
      if (plain && !event.shiftKey && key === "m") {
        event.preventDefault();
        return s.layout === "phone" ? a.setPhoneSheet("comments") : a.openPanel("comments", { focusComposer: true });
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.code === "KeyZ") {
        event.preventDefault();
        if (s.readOnly) return;
        return event.shiftKey ? a.redo() : a.undo();
      }
      if (event.ctrlKey && event.altKey && !event.shiftKey) {
        if (event.code === "KeyH" && s.layout !== "phone") {
          event.preventDefault();
          return a.openPanel("history");
        }
        if (event.code === "KeyP" && editing) {
          event.preventDefault();
          return a.openPanel("publish");
        }
        if (event.code === "KeyK" && editing && s.selectedId) {
          event.preventDefault();
          const found = locateOnPage(s.doc, s.selectedId);
          if (found?.parent) a.openDialog({ kind: "component", nodeId: s.selectedId, name: found.node.name });
          return;
        }
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey && /^Digit[123]$/.test(event.code) && s.layout !== "phone") {
        event.preventDefault();
        const next = BREAKPOINTS[Number(event.code.slice(5)) - 1];
        return a.setBp(next, { focusFrame: fanMotion.heading });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fanMotion]);

  // A selection that vanished (deleted elsewhere, page switch) never blocks the Fan.
  useEffect(() => {
    if (!selectedId && fanMotion.heading) fanMotion.set(false);
  }, [selectedId, fanMotion]);

  const value: EditorValue = {
    state,
    act,
    sync,
    canvasRef,
    layoutFrames: () => layoutRef.current(),
  };

  if (missingVersion) return <NotFoundView />;
  const stylePanelVisible = layout !== "phone" && !preview;
  return (
    <EditorContext.Provider value={value}>
      <div
        className={`pl-editor pl-layout-${layout}${readOnly ? " pl-readonly" : ""}${stylePanelOpen ? "" : " pl-style-closed"}`}
        style={{ ["--style-progress" as string]: String(panelMotion.progress) }}
      >
        <TopBar />
        <div className="pl-work">
          {layout !== "phone" && <Navigator />}
          <Canvas registerLayout={(fn) => (layoutRef.current = fn)} />
          {stylePanelVisible && <StylePanel motion={panelMotion} />}
          {panel && layout !== "phone" && PANELS.includes(panel) && <Sheet panel={panel} />}
        </div>
        {layout === "phone" && <PhoneToolbar />}
        <Dialogs />
      </div>
    </EditorContext.Provider>
  );
}
