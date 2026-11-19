// The centre pane for Drive, Recent and Shared with me: path bar, toolbar or selection bar, the file list and the
// details panel; moves with the homing flight; cut, paste, drag and the keyboard shortcuts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, call, ApiError, newKey, query } from "../api";
import { announce } from "../announce";
import {
  changes, coalesce, currentFolder, cut, folders as folderStore, isStaff, plusBadge, pushNotice, refreshFolders,
  serviceStatus, session,
} from "../data";
import { events } from "../live";
import { useStore } from "../store";
import { useMedia, PHONE, TABLET } from "../media";
import { driveHref, navigate, readAddress, useLocation, withAddress, type DriveAddress } from "../router";
import {
  binCopy, EMPTY_FOLDER, lostSentence, moveCopy, MOVE_FAILED, noLongerAvailable, noLongerEditable, NOTHING_SHARED,
  selectedCopy, SOMETHING_WRONG, STORAGE_OUTAGE, UNAVAILABLE_FOLDER,
} from "../copy";
import { Icon } from "../icons";
import { FileList, optionId, type Entry, type Selection } from "./FileList";
import { Details, type DetailsTarget } from "./Details";
import { HandOverDialog, MoveDialog, RenameDialog, ShareDialog } from "./dialogs";
import { fly, reducedMotion, type Flyer } from "./homing";
import { MenuButton, type MenuItem } from "../widgets/Menu";
import { Dialog } from "../widgets/Dialog";
import { addFiles } from "../uploads/manager";
import { EmptyDrawing } from "../drawings";
import { Notices, ServiceBanner } from "../shell/Frame";
import { mayShare } from "../../shared/rules";
import { SORT_KEYS, type DriveFile, type Folder, type MoveResult, type Named, type SharedItem, type SortKey } from "../../shared/api";

type Screen = "drive" | "recent" | "shared";

const SORT_LABELS: Record<SortKey, string> = {
  "name-asc": "Name A–Z", "name-desc": "Name Z–A", "modified-desc": "Newest first",
  "modified-asc": "Oldest first", "size-desc": "Largest first", "size-asc": "Smallest first",
};

type Source =
  | { kind: "projects" }
  | { kind: "folder"; id: string }
  | { kind: "search"; q: string }
  | { kind: "recent" }
  | { kind: "shared" };

function sourceOf(screen: Screen, address: DriveAddress): Source {
  if (screen === "recent") return { kind: "recent" };
  if (screen === "shared") return { kind: "shared" };
  if (address.q) return { kind: "search", q: address.q };
  if (address.folder) return { kind: "folder", id: address.folder };
  return { kind: "projects" };
}

const fileEntry = (file: DriveFile): Entry => ({ kind: "file", id: file.id, name: file.name, file });
const folderEntry = (folder: Folder): Entry => ({ kind: "folder", id: folder.id, name: folder.name, folder });

function same(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

/** Keeps rows that are still leaving (a flight or a pending move) in place while fresh data arrives. */
function merge(next: Entry[], previous: Entry[], keep: Set<string>): Entry[] {
  if (!keep.size) return next;
  const ids = new Set(next.map((e) => e.id));
  const out = [...next];
  previous.forEach((entry, i) => {
    if (keep.has(entry.id) && !ids.has(entry.id)) out.splice(Math.min(i, out.length), 0, entry);
  });
  return out;
}

interface Loaded {
  entries: Entry[];
  folder: Folder | null;
  path: Named[];
  status: "loading" | "ready" | "unavailable";
}

const lastFocus = new Map<string, string>();

export function Browser({ screen }: { screen: Screen }) {
  const url = useLocation();
  const address = readAddress(url);
  const me = useStore(session);
  const staff = isStaff(me);
  const status = useStore(serviceStatus);
  const allFolders = useStore(folderStore);
  const cutItems = useStore(cut);
  const phone = useMedia(PHONE);
  const tablet = useMedia(TABLET);
  const source = sourceOf(screen, address);
  const sourceKey = `${source.kind}:${"id" in source ? source.id : ""}:${"q" in source ? source.q : ""}:${address.sort}`;

  const [loaded, setLoaded] = useState<Loaded>({ entries: [], folder: null, path: [], status: "loading" });
  const [selection, setSelectionState] = useState<Selection>({ ids: new Set(), anchor: null });
  const [focusId, setFocusId] = useState<string | null>(null);
  const [stayed, setStayed] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [detailsTarget, setDetailsTarget] = useState<DetailsTarget>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [dialog, setDialog] = useState<null | { kind: "move" } | { kind: "rename"; file: DriveFile } | { kind: "share"; entry: Entry } | { kind: "handover"; folder: Folder }>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [pathOpen, setPathOpen] = useState(false);

  const state = useRef({ loaded, selection, leaving: new Set<string>(), pending: new Set<string>(), sourceKey, announceSearch: null as string | null, mounted: false });
  state.current.loaded = loaded;
  state.current.selection = selection;
  state.current.pending = pending;
  state.current.sourceKey = sourceKey;

  /** Applies a selection; each change of selection is announced once. */
  const setSelection = useCallback((next: Selection, options: { quiet?: boolean } = {}) => {
    const before = state.current.selection;
    state.current.selection = next;
    setSelectionState(next);
    if (!options.quiet) {
      setStayed(new Set());
      if (!same(before.ids, next.ids)) announce(selectedCopy(next.ids.size));
    }
    if (next.ids.size === 1) {
      const only = state.current.loaded.entries.find((e) => next.ids.has(e.id));
      if (only) setDetailsTarget({ kind: only.kind, id: only.id });
    }
    if (!next.ids.size) setSelectionMode(false);
  }, []);

  const load = useCallback(async () => {
    const key = state.current.sourceKey;
    try {
      let next: Omit<Loaded, "status">;
      if (source.kind === "recent") {
        const body = await api<{ files: DriveFile[] }>("GET", "/api/files/recent");
        next = { entries: body.files.map(fileEntry), folder: null, path: [] };
      } else if (source.kind === "shared") {
        const body = await api<{ items: SharedItem[] }>("GET", "/api/shared");
        next = {
          entries: body.items.flatMap((item): Entry[] => {
            const share = { role: item.role, endDate: item.endDate, daysLeft: item.daysLeft };
            if (item.folder) return [{ ...folderEntry(item.folder), share }];
            if (item.file) return [{ ...fileEntry(item.file), share }];
            return [];
          }),
          folder: null, path: [],
        };
      } else if (source.kind === "search") {
        const body = await api<{ files: DriveFile[] }>("GET", `/api/files${query({ q: source.q.slice(0, 100), sort: address.sort })}`);
        next = { entries: body.files.map(fileEntry), folder: null, path: [] };
      } else if (source.kind === "folder") {
        const [meta, list] = await Promise.all([
          api<{ folder: Folder; path: Named[] }>("GET", `/api/folders/${encodeURIComponent(source.id)}`),
          api<{ folders: Folder[]; files: DriveFile[] }>("GET", `/api/files${query({ folderId: source.id, sort: address.sort })}`),
        ]);
        next = { entries: [...list.folders.map(folderEntry), ...list.files.map(fileEntry)], folder: meta.folder, path: meta.path };
      } else {
        const body = await api<{ folders: Folder[] }>("GET", "/api/files");
        next = { entries: body.folders.map(folderEntry), folder: null, path: [] };
      }
      if (key !== state.current.sourceKey) return;
      if (source.kind === "search" && !next.entries.length && state.current.announceSearch === key) announce(`No files match ${source.q}.`);
      state.current.announceSearch = null;
      const keep = new Set([...state.current.leaving, ...state.current.pending]);
      const entries = merge(next.entries, state.current.loaded.entries, keep);
      setLoaded({ ...next, entries, status: "ready" });
      state.current.loaded = { ...next, entries, status: "ready" };
      const present = new Set(entries.map((e) => e.id));
      const sel = state.current.selection;
      const kept = new Set([...sel.ids].filter((id) => present.has(id)));
      if (kept.size !== sel.ids.size) setSelection({ ids: kept, anchor: kept.has(sel.anchor ?? "") ? sel.anchor : null }, { quiet: kept.size > 0 });
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      if (key !== state.current.sourceKey) return;
      if (failure.status === 404) {
        setLoaded({ entries: [], folder: null, path: [], status: "unavailable" });
        state.current.loaded = { entries: [], folder: null, path: [], status: "unavailable" };
        const sel = state.current.selection;
        if (sel.ids.size) setSelection({ ids: new Set(), anchor: null });
      }
    }
  }, [sourceKey]); // the source and sort are part of sourceKey

  const reload = useRef<() => void>(() => undefined);
  reload.current = () => void load();

  useEffect(() => {
    if (state.current.mounted) state.current.announceSearch = state.current.sourceKey;
    state.current.mounted = true;
    state.current.leaving = new Set();
    setLoaded({ entries: [], folder: null, path: [], status: "loading" });
    state.current.loaded = { entries: [], folder: null, path: [], status: "loading" };
    setSelectionState({ ids: new Set(), anchor: null });
    state.current.selection = { ids: new Set(), anchor: null };
    setFocusId(lastFocus.get(state.current.sourceKey) ?? null);
    setStayed(new Set());
    setPending(new Set());
    setSelectionMode(false);
    setDetailsTarget(null);
    setSheetOpen(false);
    void load();
  }, [load]);

  useEffect(() => {
    const again = coalesce(() => reload.current());
    return changes.on("change", (kind) => {
      if (kind !== "moved") again();
    });
  }, []);

  useEffect(() => {
    currentFolder.set(source.kind === "folder" && loaded.status === "ready" ? loaded.folder : null);
  }, [source.kind, loaded.folder, loaded.status]);

  useEffect(() => () => currentFolder.set(null), []);

  // Partners land on Shared with me; staff never see it.
  useEffect(() => {
    if (!me) return;
    if (screen === "drive" && !staff && source.kind === "projects") navigate("/shared", { replace: true });
    if (screen === "shared" && staff) navigate("/drive", { replace: true });
  }, [me, staff, screen, source.kind]);

  const entries = loaded.entries;
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const nameOf = (id: string) => byId.get(id)?.name ?? "A file";
  const selected = entries.filter((e) => selection.ids.has(e.id));
  const selectedFiles = selected.flatMap((e) => (e.kind === "file" ? [e.file] : []));
  const single = selected.length === 1 ? selected[0] : undefined;
  const singleFile = single?.kind === "file" ? single.file : undefined;
  const folderById = useMemo(() => new Map(allFolders.map((f) => [f.id, f])), [allFolders]);
  const controller = staff && me?.staffRole === "controller";

  const projectOwner = (folderId: string | null): string | null => {
    for (let f = folderId ? folderById.get(folderId) : undefined; f; f = f.parentId ? folderById.get(f.parentId) : undefined) {
      if (!f.parentId) return f.owner.id;
    }
    return null;
  };
  const canShare = (entry: Entry | undefined): boolean =>
    !!entry && !!me && mayShare(me, projectOwner(entry.kind === "folder" ? entry.id : entry.file.folderId));
  const editable = (file: DriveFile) => staff || file.access === "editor";

  // ---- moves and the homing flight ----

  const finishFlight = useCallback((ids: string[]) => {
    for (const id of ids) state.current.leaving.delete(id);
    void refreshFolders();
    reload.current();
  }, []);

  const flyRows = useCallback((items: { fileId: string; folderId: string | null }[], destination: string | null) => {
    const flyers: Flyer[] = items.map((item) => ({
      fileId: item.fileId, name: state.current.loaded.entries.find((e) => e.id === item.fileId)?.name ?? "",
      row: document.getElementById(optionId(item.fileId)), folderId: item.folderId,
    }));
    for (const f of flyers) if (f.row) state.current.leaving.add(f.fileId);
    if (reducedMotion()) {
      const gone = new Set(items.map((i) => i.fileId));
      const entriesLeft = state.current.loaded.entries.filter((e) => !gone.has(e.id));
      state.current.loaded = { ...state.current.loaded, entries: entriesLeft };
      setLoaded((l) => ({ ...l, entries: l.entries.filter((e) => !gone.has(e.id)) }));
    }
    fly(flyers, destination, () => finishFlight(items.map((i) => i.fileId)));
  }, [finishFlight]);

  const performMove = useCallback(async (to: string, items: { fileId: string; fromFolderId: string }[]) => {
    if (!items.length) return;
    const ids = new Set(items.map((i) => i.fileId));
    state.current.pending = new Set([...state.current.pending, ...ids]);
    setPending(new Set(state.current.pending));
    const clearPending = () => {
      for (const id of ids) state.current.pending.delete(id);
      setPending(new Set(state.current.pending));
    };
    let result: MoveResult;
    try {
      result = await api<MoveResult>("POST", "/api/moves", { toFolderId: to, items }, { "Idempotency-Key": newKey() });
    } catch (failure) {
      clearPending();
      if (failure instanceof ApiError && failure.code === "forbidden") {
        pushNotice(noLongerEditable(folderById.get(to)?.name ?? "this folder"));
      }
      announce(MOVE_FAILED);
      return;
    }
    const names = new Map(items.map((i) => [i.fileId, nameOf(i.fileId)]));
    const flying = [
      ...result.moved.map((m) => ({ fileId: m.fileId, folderId: result.toFolder.id })),
      ...result.lostTo.map((l) => ({ fileId: l.fileId, folderId: l.folder.id })),
    ];
    for (const f of flying) state.current.leaving.add(f.fileId);
    clearPending();
    setStayed(new Set(result.stayed.map((s) => s.fileId)));
    const stayedIds = new Set(result.stayed.map((s) => s.fileId).filter((id) => state.current.loaded.entries.some((e) => e.id === id)));
    setSelection({ ids: stayedIds, anchor: null }, { quiet: true });
    cut.set([]);
    announce(moveCopy(result, (id) => names.get(id) ?? nameOf(id)));
    for (const lost of result.lostTo.slice(0, 3)) pushNotice(lostSentence(names.get(lost.fileId) ?? nameOf(lost.fileId), lost.folder.name, lost.by.name));
    flyRows(flying, result.toFolder.id);
  }, [byId, folderById, flyRows, setSelection]);

  // Someone else's move: the same flight from this screen's own rows, without an announcement.
  useEffect(() => events.on("moved", (data) => {
    const mine = data.items.filter((i) => state.current.loaded.entries.some((e) => e.id === i.fileId)
      && !state.current.pending.has(i.fileId) && !state.current.leaving.has(i.fileId));
    if (!mine.length) {
      void refreshFolders();
      reload.current();
      return;
    }
    if (data.toFolder.id === null) {
      const gone = new Set(mine.map((i) => i.fileId));
      for (const id of gone) document.getElementById(optionId(id))?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reducedMotion() ? 0 : 180, fill: "forwards" });
      void refreshFolders();
      reload.current();
      return;
    }
    flyRows(mine.map((i) => ({ fileId: i.fileId, folderId: data.toFolder.id })), data.toFolder.id);
  }), [flyRows]);

  const moveSelection = (to: string) => {
    const items = selectedFiles.filter((f) => f.folderId).map((f) => ({ fileId: f.id, fromFolderId: f.folderId ?? "" }));
    void performMove(to, items);
  };

  const paste = (to: string | null) => {
    const items = cut.get();
    if (!to || !items.length) return;
    void performMove(to, items);
  };

  // ---- other actions ----

  const binSelection = async () => {
    if (!staff || !selectedFiles.length) return;
    try {
      const body = await api<{ binned: string[]; stayed: { fileId: string }[] }>("POST", "/api/bin", { fileIds: selectedFiles.map((f) => f.id) });
      announce(binCopy(body.binned.length, body.stayed.length));
      setSelection({ ids: new Set(body.stayed.map((s) => s.fileId)), anchor: null }, { quiet: true });
      setStayed(new Set(body.stayed.map((s) => s.fileId)));
      void refreshFolders();
      reload.current();
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      announce(SOMETHING_WRONG);
    }
  };

  const setLocks = async (locked: boolean) => {
    const targets = selectedFiles.filter((f) => f.locked !== locked);
    let done = 0;
    for (const file of targets) {
      try {
        await call(locked ? "POST" : "DELETE", `/api/files/${file.id}/lock`);
        done += 1;
      } catch (failure) {
        if (!(failure instanceof ApiError)) throw failure;
      }
    }
    announce(`${locked ? "Locked" : "Unlocked"} ${done === 1 ? "1 file" : `${done} files`}`);
    reload.current();
  };

  const download = async (file: DriveFile) => {
    if (status.storage === "down") {
      announce(STORAGE_OUTAGE);
      return;
    }
    try {
      const link = await api<{ url: string }>("POST", `/api/files/${file.id}/links`, { purpose: "download" });
      const a = document.createElement("a");
      a.href = link.url;
      a.download = file.name;
      document.body.append(a);
      a.click();
      a.remove();
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      if (failure.code === "storage_unavailable") announce(STORAGE_OUTAGE);
      else if (failure.status === 404) pushNotice(noLongerAvailable(file.name));
      else announce(SOMETHING_WRONG);
    }
  };

  const openEntry = (entry: Entry) => {
    if (entry.kind === "folder") {
      navigate(withAddress(url, { folder: entry.id, q: null }));
      return;
    }
    setDetailsTarget({ kind: "file", id: entry.id });
    if (phone || tablet) setSheetOpen(true);
  };

  const cutSelection = () => {
    const files = selectedFiles.filter((f) => f.folderId && editable(f));
    if (!files.length) return;
    cut.set(files.map((f) => ({ fileId: f.id, fromFolderId: f.folderId ?? "" })));
    announce(`${files.length === 1 ? "1 file" : `${files.length} files`} cut`);
  };

  // Shortcuts work in the tree, the list, the path bar and the selection bar, never in a text field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target || target.closest("input, textarea, select, [contenteditable=true], [role=dialog], [role=alertdialog]")) return;
      if (!target.closest("[data-shortcuts]")) return;
      const ctrl = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (ctrl && key === "x") cutSelection();
      else if (ctrl && key === "v") {
        const node = target.closest<HTMLElement>("[data-tree='Folders'] [data-folder-node]");
        paste(node?.dataset.folderNode ?? (source.kind === "folder" ? source.id : null));
      } else if (event.key === "F2" && singleFile && !singleFile.locked && editable(singleFile)) setDialog({ kind: "rename", file: singleFile });
      else if (event.key === "Delete" && staff) void binSelection();
      else if (event.key === "Escape") {
        cut.set([]);
        if (state.current.selection.ids.size) setSelection({ ids: new Set(), anchor: null });
      } else return;
      event.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // Drag a row onto a tree node, a folder row or a path segment.
  const onDrag = (ids: string[], at: { x: number; y: number } | null, drop: boolean) => {
    let chip = document.getElementById("drag-chip");
    const hit = at ? document.elementFromPoint(at.x, at.y)?.closest<HTMLElement>("[data-drop-folder]") : null;
    const folderId = hit?.dataset.dropFolder ?? null;
    if (!drop && at) {
      if (!chip) {
        chip = document.createElement("div");
        chip.id = "drag-chip";
        chip.className = "drag-chip";
        chip.setAttribute("aria-hidden", "true");
        document.body.append(chip);
      }
      chip.textContent = ids.length === 1 ? nameOf(ids[0] ?? "") : `${ids.length} files`;
      chip.style.transform = `translate(${at.x + 12}px, ${at.y + 10}px)`;
      setDropTarget(folderId);
      return;
    }
    chip?.remove();
    setDropTarget(null);
    if (!drop || !folderId) return;
    const items = ids.flatMap((id) => {
      const entry = byId.get(id);
      return entry?.kind === "file" && entry.file.folderId && entry.file.folderId !== folderId
        ? [{ fileId: id, fromFolderId: entry.file.folderId }] : [];
    });
    void performMove(folderId, items);
  };

  useEffect(() => {
    document.querySelectorAll(".is-drop-target").forEach((el) => el.classList.remove("is-drop-target"));
    if (dropTarget) document.querySelectorAll(`[data-drop-folder="${CSS.escape(dropTarget)}"]`).forEach((el) => el.classList.add("is-drop-target"));
  }, [dropTarget]);

  // ---- path bar ----

  const rootLabel = staff ? "Projects" : "Shared with me";
  const rootHref = staff ? "/drive" : "/shared";
  const segments: { id: string; name: string; href: string | null }[] = (() => {
    if (screen === "recent") return [{ id: "", name: "Recent", href: "/recent" }];
    if (screen === "shared") return [{ id: "", name: "Shared with me", href: "/shared" }];
    const out: { id: string; name: string; href: string | null }[] = [{ id: "", name: rootLabel, href: rootHref }];
    for (const p of loaded.path) out.push({ id: p.id, name: p.name, href: driveHref({ ...address, folder: p.id, q: null }) });
    if (source.kind === "search") out.push({ id: "", name: `Results for “${source.q}”`, href: null });
    return out;
  })();
  const collapsed = phone && segments.length > 2 && !pathOpen;
  const first = segments[0], last = segments[segments.length - 1];
  const shownSegments = collapsed && first && last ? [first, null, last] : segments;
  const badge = useStore(plusBadge);

  const emptyText = loaded.status !== "ready" || entries.length ? null
    : source.kind === "search" ? `No files match ${source.q}.`
    : source.kind === "shared" ? NOTHING_SHARED
    : source.kind === "recent" ? "Nothing has happened to your files yet."
    : source.kind === "projects" ? "There are no projects yet." : EMPTY_FOLDER;

  // ---- selection bar ----

  interface Action { label: string; icon: Parameters<typeof Icon>[0]["name"]; run: () => void; show: boolean; primary?: boolean }
  const actions: Action[] = [
    { label: "Move to", icon: "move", run: () => setDialog({ kind: "move" }), show: selectedFiles.length > 0 && selectedFiles.every(editable) && screen !== "shared", primary: true },
    { label: "Rename", icon: "pencil", run: () => singleFile && setDialog({ kind: "rename", file: singleFile }), show: !!singleFile && !singleFile.locked && editable(singleFile) },
    { label: "Share", icon: "share", run: () => single && setDialog({ kind: "share", entry: single }), show: canShare(single) && selected.length === 1, primary: true },
    { label: "Lock", icon: "lock", run: () => void setLocks(true), show: controller && selectedFiles.some((f) => !f.locked) },
    { label: "Unlock", icon: "lockOpen", run: () => void setLocks(false), show: controller && selectedFiles.some((f) => f.locked) },
    { label: "Move to bin", icon: "trash", run: () => void binSelection(), show: staff && selectedFiles.length > 0 },
    { label: "Download", icon: "download", run: () => singleFile && void download(singleFile), show: !!singleFile && selected.length === 1, primary: true },
    { label: "Details", icon: "info", run: () => {
      if (single) setDetailsTarget({ kind: single.kind, id: single.id });
      if (phone || tablet) setSheetOpen(true);
      else document.getElementById("details-pane")?.focus();
    }, show: selected.length > 0 },
    { label: "Clear selection", icon: "x", run: () => setSelection({ ids: new Set(), anchor: null }), show: true },
  ];
  const shown = actions.filter((a) => a.show);
  const barMain = phone ? shown.filter((a) => a.primary) : shown;
  const barMore = phone ? shown.filter((a) => !a.primary) : [];

  const detailsPanel = (onClose?: () => void) => (
    <Details target={detailsTarget} onClose={onClose}
      onGone={() => {
        setDetailsTarget(null);
        setSheetOpen(false);
      }}
      onHandOver={(folder) => setDialog({ kind: "handover", folder })} />
  );

  const showToolbar = selection.ids.size === 0;
  const canSort = screen === "drive";

  return (
    <>
      <main className="centre">
      <Notices />
      <ServiceBanner />
      <nav aria-label="Folder path" className="pathbar" data-shortcuts="">
        <ol>
          {shownSegments.map((segment, i) => segment === null ? (
            <li key="more">
              <button type="button" className="path-more" aria-label="Show the whole path" onClick={() => setPathOpen(true)}>…</button>
            </li>
          ) : (
            <li key={`${segment.id}-${i}`}>
              {segment.href ? (
                <a href={segment.href} data-path-segment={segment.id} data-drop-folder={segment.id || undefined}
                  aria-current={i === shownSegments.length - 1 ? "page" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    if (segment.href) navigate(segment.href);
                  }}>
                  {segment.name}
                  {badge && phone && (badge.folderId ?? "") === segment.id && <span className="plus-badge num">+{badge.n}</span>}
                </a>
              ) : <span aria-current="page" className="path-here">{segment.name}</span>}
            </li>
          ))}
        </ol>
      </nav>
      <div className={`toolbar${showToolbar ? "" : " is-hidden"}`}>
        <div role="radiogroup" aria-label="View" className="segmented view-switch">
          {(["list", "grid"] as const).map((view) => (
            <label key={view} className="segment">
              <input type="radio" name="view" value={view} checked={address.view === view}
                onChange={() => navigate(withAddress(url, { view }))} />
              <Icon name={view === "list" ? "list" : "grid"} />
              {view === "list" ? "List" : "Grid"}
            </label>
          ))}
        </div>
        {canSort && (
          <label className="sort">
            <span className="visually-hidden">Sort by</span>
            <select aria-label="Sort by" className="field-input compact" value={address.sort}
              onChange={(e) => {
                const sort = SORT_KEYS.find((k) => k === e.target.value);
                if (sort) navigate(withAddress(url, { sort }));
              }}>
              {SORT_KEYS.map((key) => <option key={key} value={key}>{SORT_LABELS[key]}</option>)}
            </select>
          </label>
        )}
        {source.kind === "folder" && loaded.folder && <span className="toolbar-note num">{entries.filter((e) => e.kind === "file").length === 1 ? "1 file" : `${entries.filter((e) => e.kind === "file").length} files`}</span>}
      </div>
      <div className="list-wrap"
        onDragOver={(e) => {
          if (source.kind === "folder" && e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          if (source.kind !== "folder" || !e.dataTransfer.files.length) return;
          e.preventDefault();
          addFiles([...e.dataTransfer.files], source.id);
        }}>
        {loaded.status === "unavailable" ? (
          <div className="empty unavailable">
            <EmptyDrawing />
            <p>{UNAVAILABLE_FOLDER}</p>
          </div>
        ) : (
          <FileList entries={entries} view={address.view} selection={selection} focusId={focusId}
            onFocusId={(id) => {
              setFocusId(id);
              lastFocus.set(sourceKey, id);
              if (!state.current.selection.ids.size && !state.current.selection.anchor) {
                state.current.selection = { ids: new Set(), anchor: id };
                setSelectionState(state.current.selection);
              }
            }}
            onSelect={(next) => {
              if (phone && next.ids.size) setSelectionMode(true);
              setSelection(next);
            }}
            onOpen={openEntry} pending={pending} stayed={stayed} cutIds={new Set(cutItems.map((c) => c.fileId))}
            showLocation={screen === "recent"} phone={phone} selectionMode={selectionMode}
            onLongPress={(entry) => {
              setSelectionMode(true);
              setSelection({ ids: new Set([entry.id]), anchor: entry.id });
            }}
            onDrag={onDrag} empty={emptyText} busy={loaded.status === "loading"} />
        )}
      </div>
      {!showToolbar && (
        <div role="toolbar" aria-label="Selection actions" className="selection-bar" data-shortcuts="">
          <span className="selection-count num" aria-hidden="true">{selection.ids.size} selected</span>
          {barMain.map((action) => action.label === "Clear selection" && !phone ? (
            <button key={action.label} type="button" className="bar-button ghost bar-clear" aria-label={action.label} title={action.label} onClick={action.run}>
              <Icon name={action.icon} />
            </button>
          ) : (
            <button key={action.label} type="button" className="bar-button" title={action.label} onClick={action.run}>
              <Icon name={action.icon} /><span className="bar-label">{action.label}</span>
            </button>
          ))}
          {barMore.length > 0 && (
            <MenuButton label="More" menuLabel="More actions" up align="end" className="bar-more"
              items={barMore.map((a): MenuItem => ({ label: a.label, onSelect: a.run }))}>
              <Icon name="more" /><span>More</span>
            </MenuButton>
          )}
        </div>
      )}
      </main>
      {!phone && !tablet && (
        <aside aria-label="Details" id="details-pane" className="details" tabIndex={-1}>{detailsPanel()}</aside>
      )}
      {(phone || tablet) && sheetOpen && (
        <Dialog title="Details" hideTitle className={phone ? "sheet sheet-full" : "sheet sheet-half"} onClose={() => setSheetOpen(false)}>
          {detailsPanel(() => setSheetOpen(false))}
        </Dialog>
      )}
      {dialog?.kind === "move" && (
        <MoveDialog from={source.kind === "folder" ? source.id : selectedFiles[0]?.folderId ?? null} onClose={() => setDialog(null)} onMove={moveSelection} />
      )}
      {dialog?.kind === "rename" && (
        <RenameDialog fileId={dialog.file.id} name={dialog.file.name}
          currentName={() => state.current.loaded.entries.find((e) => e.id === dialog.file.id)?.name ?? dialog.file.name}
          onClose={() => setDialog(null)} onDone={() => reload.current()} />
      )}
      {dialog?.kind === "share" && (
        <ShareDialog item={{ type: dialog.entry.kind, id: dialog.entry.id, name: dialog.entry.name }} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "handover" && <HandOverDialog folder={dialog.folder} onClose={() => setDialog(null)} />}
    </>
  );
}
