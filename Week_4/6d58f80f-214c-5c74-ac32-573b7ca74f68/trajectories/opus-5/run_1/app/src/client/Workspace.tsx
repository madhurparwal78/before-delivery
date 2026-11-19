import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  FileItem,
  Folder,
  MoveResult,
  PathSegment,
  Person,
  ServerEvent,
  SharedItem,
  SortKey,
} from '../shared/types.js';
import {
  EMPTY_FOLDER,
  FOLDER_UNAVAILABLE,
  GENERIC_FAILURE,
  MOVE_FAILED,
  SELECTION_CLEARED,
  SHARED_EMPTY,
  STORAGE_OUTAGE,
  daysLeftText,
  files as filesCopy,
  lockedFiles,
  lockedNotRenamed,
  noticeGone,
  noticeWriteForbidden,
} from '../shared/copy.js';
import { ApiFailure, api } from './lib/api.js';
import { navigate, type Address } from './lib/address.js';
import { useAddress, useViewport } from './lib/hooks.js';
import { announce, addNotice, setState, useGlobal } from './lib/store.js';
import { onReconnect, onServerEvent } from './lib/events.js';
import { FilePlus2, FolderPlus, Plus } from 'lucide-react';
import { ancestorChain, FolderTree } from './components/FolderTree.js';
import { FileList, type ListEntry, type ListShortcut } from './components/FileList.js';
import { PathBar, StorageMeter, TopBar, ViewToolbar } from './components/Chrome.js';
import { Announcements, Notices, ServiceStatusBanner } from './components/Feedback.js';
import { DetailsBody, type DetailsItem } from './components/Details.js';
import { UploadsPanel } from './components/Uploads.js';
import { Modal } from './components/Modal.js';
import {
  HandoverDialog,
  MoveDialog,
  NameDialog,
  ShareDialog,
} from './components/Dialogs.js';
import { flyHome, type Chip } from './lib/homing.js';
import { loadUnfinishedUploads, startUploads } from './lib/uploads.js';
import { BinScreen } from './screens/BinScreen.js';
import { HandoversScreen } from './screens/HandoversScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';

type Dialog =
  | { kind: 'move' }
  | { kind: 'rename'; file: FileItem }
  | { kind: 'new-folder' }
  | { kind: 'share'; itemType: 'folder' | 'file'; itemId: string; itemName: string }
  | { kind: 'handover'; folder: Folder }
  | { kind: 'details' }
  | { kind: 'navigation' }
  | null;

interface WorkspaceProps {
  person: Person;
  onSignedOut: () => void;
}

export const Workspace = ({ person, onSignedOut }: WorkspaceProps): JSX.Element => {
  const address = useAddress();
  const viewport = useViewport();
  const folders = useGlobal((state) => state.folders);
  const storage = useGlobal((state) => state.storage);
  const storageStatus = useGlobal((state) => state.status.storage);

  const [listing, setListing] = useState<{ folders: Folder[]; files: FileItem[] }>({
    folders: [],
    files: [],
  });
  const [path, setPath] = useState<PathSegment[]>([]);
  const [sharedItems, setSharedItems] = useState<SharedItem[]>([]);
  const [recent, setRecent] = useState<FileItem[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [cut, setCut] = useState<string[]>([]);
  const [stayed, setStayed] = useState<string[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [stepped, setStepped] = useState<Set<string>>(new Set());
  const [detailsToken, setDetailsToken] = useState(0);
  const ownMoves = useRef<Set<string>>(new Set());
  const uploadInput = useRef<HTMLInputElement>(null);

  const isStaff = person.kind === 'staff';
  const openFolder = address.folder;

  /* ---------- data ---------- */

  const refreshFolders = useCallback(() => {
    void api
      .folders()
      .then((result) => setState({ folders: result.folders }))
      .catch(() => undefined);
  }, []);

  const refreshStorage = useCallback(() => {
    if (!isStaff) return;
    void api
      .storage()
      .then((totals) => setState({ storage: totals }))
      .catch(() => undefined);
  }, [isStaff]);

  const loadScreen = useCallback(() => {
    setUnavailable(false);
    if (address.screen === 'recent') {
      void api
        .recent()
        .then((result) => setRecent(result.files))
        .catch(() => undefined);
      return;
    }
    if (address.screen === 'shared') {
      void api
        .shared()
        .then((result) => setSharedItems(result.items))
        .catch(() => undefined);
      return;
    }
    if (address.screen !== 'drive') return;
    if (address.q !== '') {
      void api
        .files({ q: address.q, sort: address.sort })
        .then((result) => {
          setListing(result);
          setPath([]);
        })
        .catch(() => undefined);
      return;
    }
    void api
      .files({ folderId: openFolder, sort: address.sort })
      .then((result) => setListing(result))
      .catch((failure: unknown) => {
        if (failure instanceof ApiFailure && failure.status === 404) setUnavailable(true);
      });
    if (openFolder === null) {
      setPath([]);
      return;
    }
    void api
      .folder(openFolder)
      .then((result) => setPath(result.path))
      .catch(() => setUnavailable(true));
  }, [address.screen, address.q, address.sort, openFolder]);

  useEffect(() => {
    refreshFolders();
    refreshStorage();
    void loadUnfinishedUploads().catch(() => undefined);
  }, [refreshFolders, refreshStorage]);

  useEffect(() => {
    loadScreen();
  }, [loadScreen]);

  useEffect(() => {
    setSelection([]);
    setStayed([]);
    setDetailsId(null);
    setSelectionMode(false);
  }, [address.screen, openFolder, address.q]);

  const applyCounts = useCallback((counts: Record<string, number>) => {
    setState((current) => ({
      folders: current.folders.map((folder) =>
        counts[folder.id] === undefined
          ? folder
          : { ...folder, fileCount: counts[folder.id] ?? folder.fileCount },
      ),
    }));
    setStepped(new Set(Object.keys(counts)));
    window.setTimeout(() => setStepped(new Set()), 240);
  }, []);

  /* ---------- live updates ---------- */

  const liveHandler = useRef<(event: ServerEvent) => void>(() => undefined);
  const reconnectHandler = useRef<() => void>(() => undefined);

  useEffect(() => {
    const stop = onServerEvent((event) => liveHandler.current(event));
    const stopReconnect = onReconnect(() => reconnectHandler.current());
    return () => {
      stop();
      stopReconnect();
    };
  }, []);

  liveHandler.current = (event: ServerEvent): void => {
    switch (event.type) {
      case 'folder_created':
      case 'folder_updated':
        refreshFolders();
        break;
      case 'file_created':
        applyCounts(event.data.folderCounts);
        if (event.data.file.folderId === openFolder && address.q === '') {
          setListing((current) =>
            current.files.some((file) => file.id === event.data.file.id)
              ? current
              : { ...current, files: [...current.files, event.data.file] },
          );
        }
        refreshStorage();
        setDetailsToken((value) => value + 1);
        break;
      case 'file_updated':
        setListing((current) => ({
          ...current,
          files: current.files.map((file) =>
            file.id === event.data.file.id ? event.data.file : file,
          ),
        }));
        setRecent((current) =>
          current.map((file) => (file.id === event.data.file.id ? event.data.file : file)),
        );
        setDetailsToken((value) => value + 1);
        break;
      case 'files_removed': {
        const gone = new Set(event.data.fileIds);
        setListing((current) => ({
          ...current,
          files: current.files.filter((file) => !gone.has(file.id)),
        }));
        setRecent((current) => current.filter((file) => !gone.has(file.id)));
        setSelection((current) => {
          const next = current.filter((id) => !gone.has(id));
          if (next.length === 0 && current.length > 0) {
            announce(SELECTION_CLEARED);
            setSelectionMode(false);
          }
          return next;
        });
        applyCounts(event.data.folderCounts);
        refreshStorage();
        break;
      }
      case 'moved':
        handleMovedEvent(event.data);
        break;
      case 'access_changed':
        refreshFolders();
        loadScreen();
        setDetailsToken((value) => value + 1);
        break;
      case 'clock':
        loadScreen();
        break;
      default:
        break;
    }
  };

  reconnectHandler.current = (): void => {
    refreshFolders();
    refreshStorage();
    loadScreen();
  };

  const handleMovedEvent = (data: {
    toFolder: { id: string | null; name: string };
    actor: { id: string; name: string };
    items: { fileId: string; fromFolderId: string | null; file: FileItem | null }[];
    folderCounts: Record<string, number>;
  }): void => {
    const fresh = data.items.filter(
      (item) => !ownMoves.current.has(`${item.fileId}:${data.toFolder.id ?? ''}`),
    );
    if (fresh.length === 0) return;
    const visibleRows = fresh.filter((item) =>
      listing.files.some((file) => file.id === item.fileId),
    );
    const arriving = fresh.filter(
      (item) => item.file !== null && item.file.folderId === openFolder,
    );
    const chain = data.toFolder.id === null ? [] : ancestorChain(folders, data.toFolder.id);
    const chips: Chip[] = visibleRows.map((item) => ({
      fileId: item.fileId,
      name: listing.files.find((file) => file.id === item.fileId)?.name ?? '',
      chain,
    }));
    const settle = (): void => {
      setListing((current) => {
        const movedAway = new Set(
          fresh
            .filter((item) => item.file === null || item.file.folderId !== openFolder)
            .map((item) => item.fileId),
        );
        const added = arriving
          .map((item) => item.file)
          .filter((file): file is FileItem => file !== null)
          .filter((file) => !current.files.some((existing) => existing.id === file.id));
        return {
          ...current,
          files: [...current.files.filter((file) => !movedAway.has(file.id)), ...added],
        };
      });
      applyCounts(data.folderCounts);
      setDetailsToken((value) => value + 1);
    };
    if (chips.length === 0) {
      settle();
      return;
    }
    flyHome({ chips, target: { chain }, onLanded: settle });
  };

  /* ---------- derived ---------- */

  const entries: ListEntry[] = useMemo(() => {
    if (address.screen === 'recent') {
      return recent.map((file) => ({ kind: 'file' as const, id: file.id, name: file.name, file }));
    }
    if (address.screen === 'shared') {
      return sharedItems.flatMap<ListEntry>((item) => {
        if (item.folder !== null) {
          return [
            {
              kind: 'folder',
              id: item.folder.id,
              name: item.folder.name,
              folder: item.folder,
            },
          ];
        }
        if (item.file !== null) {
          return [{ kind: 'file', id: item.file.id, name: item.file.name, file: item.file }];
        }
        return [];
      });
    }
    return [
      ...listing.folders.map((folder) => ({
        kind: 'folder' as const,
        id: folder.id,
        name: folder.name,
        folder,
      })),
      ...listing.files.map((file) => ({
        kind: 'file' as const,
        id: file.id,
        name: file.name,
        file,
      })),
    ];
  }, [address.screen, listing, recent, sharedItems]);

  const fileById = useCallback(
    (id: string): FileItem | null => {
      const inListing = listing.files.find((file) => file.id === id);
      if (inListing !== undefined) return inListing;
      const inRecent = recent.find((file) => file.id === id);
      if (inRecent !== undefined) return inRecent;
      const inShared = sharedItems.find((item) => item.file?.id === id)?.file ?? null;
      return inShared;
    },
    [listing.files, recent, sharedItems],
  );

  const selectedFiles = useMemo(
    () => selection.map(fileById).filter((file): file is FileItem => file !== null),
    [selection, fileById],
  );

  const detailsItem: DetailsItem | null = useMemo(() => {
    const id = detailsId ?? selection[selection.length - 1] ?? null;
    if (id === null) return null;
    const file = fileById(id);
    if (file !== null) return { kind: 'file', file };
    const folder =
      listing.folders.find((candidate) => candidate.id === id) ??
      folders.find((candidate) => candidate.id === id) ??
      null;
    return folder === null ? null : { kind: 'folder', folder };
  }, [detailsId, selection, fileById, listing.folders, folders]);

  const detailsOwner = useMemo(() => {
    if (detailsItem === null) return '';
    if (detailsItem.kind === 'folder') return detailsItem.folder.owner.name;
    const folderId = detailsItem.file.folderId;
    if (folderId === null) return '';
    return folders.find((folder) => folder.id === folderId)?.owner.name ?? '';
  }, [detailsItem, folders]);

  /* ---------- navigation ---------- */

  const go = (changes: Partial<Address>, mode: 'push' | 'replace' = 'push'): void => {
    navigate({ ...address, ...changes }, mode);
  };

  const openFolderById = (folderId: string): void => {
    go({ screen: 'drive', folder: folderId, q: '' });
    setDialog(null);
  };

  /* ---------- selection ---------- */

  const changeSelection = (ids: string[], nextAnchor: string | null, focus: string): void => {
    const unique = [...new Set(ids)];
    setSelection(unique);
    setAnchor(nextAnchor);
    setFocusId(focus);
    if (unique.length === 0) {
      announce(SELECTION_CLEARED);
      setSelectionMode(false);
    } else {
      announce(`${unique.length} selected`);
    }
    setStayed([]);
  };

  /* ---------- actions ---------- */

  const folderOfFile = (file: FileItem): string | null => file.folderId;

  /** Refusals the person should hear about by name, as set out in Feedback states. */
  const reportRefusal = (failure: unknown, itemName: string): void => {
    if (failure instanceof ApiFailure && failure.status === 403) {
      const text = noticeWriteForbidden(itemName);
      addNotice({ id: `${Date.now()}-forbidden`, kind: 'write_forbidden', text });
      announce(text);
      return;
    }
    if (failure instanceof ApiFailure && failure.status === 404) {
      const text = noticeGone(itemName);
      addNotice({ id: `${Date.now()}-gone`, kind: 'gone', text });
      announce(text);
      loadScreen();
      return;
    }
    announce(GENERIC_FAILURE);
  };

  const moveFiles = async (fileIds: string[], toFolderId: string): Promise<void> => {
    const items = fileIds
      .map((id) => {
        const file = fileById(id);
        const from = file === null ? null : folderOfFile(file);
        return from === null ? null : { fileId: id, fromFolderId: from };
      })
      .filter((item): item is { fileId: string; fromFolderId: string } => item !== null);
    if (items.length === 0) return;
    if (items.every((item) => item.fromFolderId === toFolderId)) return;

    setPending(items.map((item) => item.fileId));
    for (const item of items) ownMoves.current.add(`${item.fileId}:${toFolderId}`);
    const destination = folders.find((folder) => folder.id === toFolderId);
    let result: MoveResult;
    try {
      result = await api.move(toFolderId, items, crypto.randomUUID());
    } catch {
      setPending([]);
      announce(MOVE_FAILED);
      return;
    }
    window.setTimeout(() => ownMoves.current.clear(), 5_000);

    const names = new Map(items.map((item) => [item.fileId, fileById(item.fileId)?.name ?? '']));
    const sentences: string[] = [];
    const folderName = result.toFolder.name !== '' ? result.toFolder.name : destination?.name ?? '';
    sentences.push(
      result.moved.length === 0
        ? 'No files moved'
        : `Moved ${filesCopy(result.moved.length)} to ${folderName}`,
    );
    if (result.stayed.length > 0) sentences.push(`${lockedFiles(result.stayed.length)} stayed`);
    const lostSentences = result.lostTo
      .slice(0, 3)
      .map(
        (lost) =>
          `${names.get(lost.fileId) ?? ''} was already moved to ${lost.folder.name} by ${lost.by.name}`,
      );
    sentences.push(...lostSentences);
    if (result.lostTo.length > 3) {
      sentences.push(`${result.lostTo.length - 3} more were moved by others first`);
    }
    announce(sentences.join('. '));
    for (const sentence of lostSentences) {
      addNotice({ id: `${sentence}-${Date.now()}`, kind: 'gone', text: sentence });
    }

    setPending([]);
    setStayed(result.stayed.map((entry) => entry.fileId));
    setCut([]);

    const chips: Chip[] = [
      ...result.moved.map((moved) => ({
        fileId: moved.fileId,
        name: names.get(moved.fileId) ?? '',
        chain: ancestorChain(folders, toFolderId),
      })),
      ...result.lostTo.map((lost) => ({
        fileId: lost.fileId,
        name: names.get(lost.fileId) ?? '',
        chain: lost.folder.id === '' ? [] : ancestorChain(folders, lost.folder.id),
      })),
    ];
    const gone = new Set(chips.map((chip) => chip.fileId));
    const settle = (): void => {
      if (toFolderId !== openFolder) {
        setListing((current) => ({
          ...current,
          files: current.files.filter((file) => !gone.has(file.id)),
        }));
      }
      setSelection((current) => current.filter((id) => !gone.has(id)));
      applyCounts(result.folderCounts);
      setDetailsToken((value) => value + 1);
    };
    if (chips.length === 0) {
      settle();
      return;
    }
    flyHome({ chips, target: { chain: ancestorChain(folders, toFolderId) }, onLanded: settle });
  };

  const renameFile = async (file: FileItem, name: string): Promise<void> => {
    setRenameError(null);
    try {
      const result = await api.rename(file.id, name);
      announce(`Renamed to ${result.file.name}`);
      setDialog(null);
      loadScreen();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'locked') {
        const current = fileById(file.id) ?? file;
        announce(lockedNotRenamed(current.name));
        setDialog(null);
        return;
      }
      if (failure instanceof ApiFailure && failure.status === 422) {
        const message = Object.values(failure.fields)[0] ?? GENERIC_FAILURE;
        setRenameError(message);
        announce(message);
        return;
      }
      reportRefusal(failure, file.name);
    }
  };

  const setLocks = async (lock: boolean): Promise<void> => {
    const targets = selectedFiles.filter((file) => file.locked !== lock);
    for (const file of targets) {
      try {
        if (lock) await api.lock(file.id);
        else await api.unlock(file.id);
      } catch (failure) {
        reportRefusal(failure, file.name);
        return;
      }
    }
    announce(`${lock ? 'Locked' : 'Unlocked'} ${filesCopy(targets.length)}`);
    loadScreen();
  };

  const binSelection = async (): Promise<void> => {
    if (selectedFiles.length === 0) return;
    try {
      const result = await api.binFiles(selectedFiles.map((file) => file.id));
      const sentences = [`Moved ${filesCopy(result.binned.length)} to the bin`];
      if (result.stayed.length > 0) sentences.push(`${lockedFiles(result.stayed.length)} stayed`);
      announce(sentences.join('. '));
      setStayed(result.stayed.map((entry) => entry.fileId));
      setSelection([]);
    } catch (failure) {
      reportRefusal(failure, selectedFiles[0]?.name ?? '');
    }
  };

  const downloadSelection = async (): Promise<void> => {
    if (storageStatus === 'down') {
      announce(STORAGE_OUTAGE);
      return;
    }
    for (const file of selectedFiles) {
      try {
        const link = await api.link(file.id, 'download');
        const anchor = document.createElement('a');
        anchor.href = link.url;
        anchor.download = file.name;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
      } catch (failure) {
        if (failure instanceof ApiFailure && failure.code === 'storage_unavailable') {
          announce(STORAGE_OUTAGE);
          return;
        }
        announce(GENERIC_FAILURE);
        return;
      }
    }
  };

  const createFolder = async (name: string): Promise<void> => {
    setNameError(null);
    try {
      const result = await api.createFolder(openFolder, name);
      announce(`Created ${result.folder.name}`);
      setDialog(null);
      refreshFolders();
      loadScreen();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 422) {
        const message = Object.values(failure.fields)[0] ?? GENERIC_FAILURE;
        setNameError(message);
        announce(message);
        return;
      }
      reportRefusal(failure, name);
    }
  };

  const onShortcut = (shortcut: ListShortcut): void => {
    switch (shortcut) {
      case 'cut': {
        const ids = selectedFiles.map((file) => file.id);
        if (ids.length === 0) return;
        setCut(ids);
        announce(`${filesCopy(ids.length)} cut`);
        return;
      }
      case 'paste':
        if (cut.length > 0 && openFolder !== null) void moveFiles(cut, openFolder);
        return;
      case 'rename': {
        const file = selectedFiles[0];
        if (selectedFiles.length === 1 && file !== undefined) {
          setRenameError(null);
          setDialog({ kind: 'rename', file });
        }
        return;
      }
      case 'delete':
        if (isStaff) void binSelection();
        return;
      case 'escape':
        setCut([]);
        setSelection([]);
        setSelectionMode(false);
        announce(SELECTION_CLEARED);
        return;
      case 'select-all':
        changeSelection(
          entries.map((entry) => entry.id),
          entries[0]?.id ?? null,
          focusId ?? entries[0]?.id ?? '',
        );
        return;
      case 'download':
        void downloadSelection();
        return;
    }
  };

  /* ---------- rail ---------- */

  const canEditHere =
    openFolder === null
      ? isStaff
      : folders.find((folder) => folder.id === openFolder)?.access === 'editor';


  const destinations = [
    { href: '/drive', label: 'Projects', show: isStaff },
    { href: '/recent', label: 'Recent', show: true },
    { href: '/shared', label: 'Shared with me', show: !isStaff },
    { href: '/bin', label: 'Bin', show: isStaff },
    { href: '/handovers', label: 'Handovers', show: isStaff },
    { href: '/settings', label: 'Settings', show: person.staffRole === 'admin' },
  ].filter((entry) => entry.show);

  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const railContent = (
    <>
      <div>
        {canEditHere ? (
          <button
            type="button"
            className="primary"
            aria-haspopup="menu"
            aria-expanded={newMenuOpen}
            onClick={() => setNewMenuOpen((open) => !open)}
          >
            <Plus size={14} aria-hidden="true" />
            New
          </button>
        ) : null}
        {newMenuOpen ? (
          <div role="menu" aria-label="New">
            <button
              type="button"
              role="menuitem"
              className="quiet"
              onClick={() => {
                setNewMenuOpen(false);
                uploadInput.current?.click();
              }}
            >
              <FilePlus2 size={14} aria-hidden="true" />
              Upload files
            </button>
            <button
              type="button"
              role="menuitem"
              className="quiet"
              onClick={() => {
                setNewMenuOpen(false);
                setNameError(null);
                setDialog({ kind: 'new-folder' });
              }}
            >
              <FolderPlus size={14} aria-hidden="true" />
              New folder
            </button>
          </div>
        ) : null}
        <label className="visually-hidden" htmlFor="upload-input">
          Upload files
        </label>
        <input
          id="upload-input"
          ref={uploadInput}
          className="visually-hidden"
          type="file"
          multiple
          aria-label="Upload files"
          onChange={(event) => {
            const chosen = [...(event.target.files ?? [])];
            if (openFolder !== null && chosen.length > 0) void startUploads(chosen, openFolder);
            event.target.value = '';
          }}
        />
      </div>
      <nav aria-label="Drive" className="rail-destinations">
        <ul>
          {destinations.map((entry) => (
            <li key={entry.href}>
              <a
                href={entry.href}
                aria-current={`/${address.screen}` === entry.href ? 'page' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  setDialog(null);
                  navigate({
                    screen: entry.href.slice(1) as Address['screen'],
                    folder: null,
                    view: 'list',
                    sort: 'name-asc',
                    q: '',
                  });
                }}
              >
                {entry.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="tree-pane">
        <FolderTree
          label="Folders"
          folders={folders}
          openFolderId={openFolder}
          onOpen={openFolderById}
          onDropFiles={(folderId) => {
            const ids = selection.length > 0 ? selectedFiles.map((file) => file.id) : [];
            if (ids.length > 0) void moveFiles(ids, folderId);
          }}
          onPasteInto={(folderId) => {
            if (cut.length > 0) void moveFiles(cut, folderId);
          }}
          steppedCounts={stepped}
        />
      </div>
      {isStaff && storage !== null ? <StorageMeter totals={storage} /> : <div />}
    </>
  );

  /* ---------- centre ---------- */

  const rootLabel = isStaff ? 'Projects' : 'Shared with me';

  const sharedMeta = (entry: ListEntry): string | null => {
    if (address.screen !== 'shared') {
      if (address.screen === 'recent' && entry.kind === 'file') return entry.file.folderName;
      return null;
    }
    const item = sharedItems.find(
      (candidate) => candidate.folder?.id === entry.id || candidate.file?.id === entry.id,
    );
    if (item === undefined) return null;
    return `${item.role} · Ends ${item.endDate} · ${daysLeftText(item.daysLeft)}`;
  };

  const emptyMessage = (): string | null => {
    if (entries.length > 0) return null;
    if (address.screen === 'shared') return SHARED_EMPTY;
    if (address.screen === 'drive' && address.q !== '') return `No files match ${address.q}.`;
    if (address.screen === 'drive') return EMPTY_FOLDER;
    return null;
  };

  const compactBar = viewport === 'phone';
  const secondary = compactBar && !moreOpen ? { display: 'none' } : undefined;

  const selectionBar = selection.length > 0 && (
    <div role="toolbar" aria-label="Selection actions" className="selection-bar">
      {canEditHere || isStaff ? (
        <button type="button" onClick={() => setDialog({ kind: 'move' })}>
          Move to
        </button>
      ) : null}
      {isStaff && selection.length === 1 ? (
        <button
          type="button"
          onClick={() => {
            const id = selection[0];
            if (id === undefined) return;
            const file = fileById(id);
            setDialog({
              kind: 'share',
              itemType: file === null ? 'folder' : 'file',
              itemId: id,
              itemName: file?.name ?? entries.find((entry) => entry.id === id)?.name ?? '',
            });
          }}
        >
          Share
        </button>
      ) : null}
      <button type="button" onClick={() => void downloadSelection()}>
        Download
      </button>
      {compactBar ? (
        <button type="button" onClick={() => setMoreOpen((open) => !open)}>
          More
        </button>
      ) : null}
      {selectedFiles.length === 1 && canEditHere ? (
        <button
          type="button"
          style={secondary}
          onClick={() => {
            const file = selectedFiles[0];
            if (file === undefined) return;
            setRenameError(null);
            setDialog({ kind: 'rename', file });
          }}
        >
          Rename
        </button>
      ) : null}
      {person.staffRole === 'controller' && selectedFiles.some((file) => !file.locked) ? (
        <button type="button" style={secondary} onClick={() => void setLocks(true)}>
          Lock
        </button>
      ) : null}
      {person.staffRole === 'controller' && selectedFiles.some((file) => file.locked) ? (
        <button type="button" style={secondary} onClick={() => void setLocks(false)}>
          Unlock
        </button>
      ) : null}
      {isStaff ? (
        <button type="button" style={secondary} onClick={() => void binSelection()}>
          Move to bin
        </button>
      ) : null}
      <button
        type="button"
        style={secondary}
        onClick={() => {
          setDetailsId(selection[selection.length - 1] ?? null);
          if (viewport !== 'desktop') setDialog({ kind: 'details' });
        }}
      >
        Details
      </button>
      <button
        type="button"
        style={secondary}
        onClick={() => {
          setSelection([]);
          setSelectionMode(false);
          announce(SELECTION_CLEARED);
        }}
      >
        Clear selection
      </button>
    </div>
  );

  const centre = (): JSX.Element => {
    if (address.screen === 'bin') return <BinScreen canDelete={person.staffRole === 'controller'} />;
    if (address.screen === 'handovers') return <HandoversScreen person={person} />;
    if (address.screen === 'settings') return <SettingsScreen />;
    return (
      <>
        <PathBar
          rootLabel={rootLabel}
          segments={path}
          onOpenRoot={() => go({ screen: isStaff ? 'drive' : 'shared', folder: null, q: '' })}
          onOpen={openFolderById}
          onDropFiles={(folderId) => {
            const ids = selectedFiles.map((file) => file.id);
            if (ids.length > 0) void moveFiles(ids, folderId);
          }}
        />
        <Notices />
        <ServiceStatusBanner />
        {selection.length > 0 ? (
          selectionBar
        ) : (
          <ViewToolbar
            view={address.view}
            sort={address.sort}
            onView={(view) => go({ view })}
            onSort={(sort: SortKey) => go({ sort })}
          />
        )}
        <div
          id="files"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            const dropped = [...(event.dataTransfer?.files ?? [])];
            if (dropped.length > 0 && openFolder !== null) {
              event.preventDefault();
              void startUploads(dropped, openFolder);
            }
          }}
          style={{ minHeight: 0, overflow: 'auto' }}
        >
          {unavailable ? (
            <p style={{ padding: 'calc(var(--step) * 2)' }}>{FOLDER_UNAVAILABLE}</p>
          ) : (
            <>
              {address.screen === 'drive' && openFolder === null && address.q === '' ? (
                <h1 style={{ padding: 'calc(var(--step) * 2)' }}>Projects</h1>
              ) : null}
              {address.screen === 'shared' ? (
                <h1 style={{ padding: 'calc(var(--step) * 2)' }}>Shared with me</h1>
              ) : null}
              {address.screen === 'recent' ? (
                <h1 style={{ padding: 'calc(var(--step) * 2)' }}>Recent</h1>
              ) : null}
              <FileList
                entries={entries}
                view={address.view}
                selection={selection}
                focusId={focusId}
                anchor={anchor}
                cut={cut}
                stayed={stayed}
                pending={pending}
                locationOf={sharedMeta}
                selectionMode={selectionMode}
                onSelection={(change) =>
                  changeSelection(change.ids, change.anchor, change.focus)
                }
                onOpenFolder={openFolderById}
                onOpenFile={(id) => {
                  setDetailsId(id);
                  if (viewport === 'phone') setDialog({ kind: 'details' });
                }}
                onShortcut={onShortcut}
                onDropOnFolder={(folderId) => {
                  const ids = selectedFiles.map((file) => file.id);
                  if (ids.length > 0) void moveFiles(ids, folderId);
                }}
                onLongPress={(id) => {
                  setSelectionMode(true);
                  changeSelection([id], id, id);
                }}
              />
              {emptyMessage() === null ? null : (
                <p style={{ padding: 'calc(var(--step) * 2)' }}>{emptyMessage()}</p>
              )}
            </>
          )}
        </div>
        <UploadsPanel />
      </>
    );
  };

  /* ---------- frame ---------- */

  return (
    <div className="shell">
      <a className="skip-link" href="#files">
        Skip to files
      </a>
      <Announcements />
      <TopBar
        person={person}
        query={address.q}
        onSearch={(text) => {
          if (text === address.q) return;
          go({ screen: 'drive', q: text });
        }}
        onSignOut={() => {
          void api.signOut().then(onSignedOut, onSignedOut);
        }}
        onOpenNavigation={() => setDialog({ kind: 'navigation' })}
      />
      <div className="panes">
        <aside className="rail rail-pane">{railContent}</aside>
        <main className="centre">{centre()}</main>
        {viewport === 'desktop' ? (
          <aside aria-label="Details" className="details details-pane">
            <DetailsBody
              person={person}
              item={detailsItem}
              ownerName={detailsOwner}
              refreshToken={detailsToken}
              onHandover={(folder) => setDialog({ kind: 'handover', folder })}
            />
          </aside>
        ) : null}
      </div>

      {dialog?.kind === 'move' ? (
        <MoveDialog
          folders={folders}
          onMove={(folderId) => {
            setDialog(null);
            void moveFiles(selectedFiles.map((file) => file.id), folderId);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === 'rename' ? (
        <NameDialog
          label="Rename"
          fieldLabel="Name"
          submitLabel="Save"
          initial={dialog.file.name}
          error={renameError}
          onSubmit={(name) => void renameFile(dialog.file, name)}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === 'new-folder' ? (
        <NameDialog
          label="New folder"
          fieldLabel="Folder name"
          submitLabel="Create"
          initial=""
          error={nameError}
          onSubmit={(name) => void createFolder(name)}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === 'share' ? (
        <ShareDialog
          itemType={dialog.itemType}
          itemId={dialog.itemId}
          itemName={dialog.itemName}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === 'handover' ? (
        <HandoverDialog
          folder={dialog.folder}
          onClose={() => setDialog(null)}
          onOffered={() => refreshFolders()}
        />
      ) : null}
      {dialog?.kind === 'details' ? (
        <Modal label="Details" sheet onClose={() => setDialog(null)}>
          <DetailsBody
            person={person}
            item={detailsItem}
            ownerName={detailsOwner}
            refreshToken={detailsToken}
            onHandover={(folder) => setDialog({ kind: 'handover', folder })}
          />
          <div className="dialog-actions">
            <button type="button" onClick={() => setDialog(null)}>
              Close
            </button>
          </div>
        </Modal>
      ) : null}
      {dialog?.kind === 'navigation' ? (
        <Modal
          label="Navigation"
          className="drawer-dialog"
          onClose={() => setDialog(null)}
        >
          <div className="rail drawer">
            <button type="button" onClick={() => setDialog(null)}>
              Close navigation
            </button>
            {railContent}
          </div>
        </Modal>
      ) : null}
    </div>
  );
};
