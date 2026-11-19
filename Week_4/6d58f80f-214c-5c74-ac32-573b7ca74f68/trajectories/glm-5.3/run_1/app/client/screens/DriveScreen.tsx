import { useEffect, useRef, useState } from 'preact/hooks';
import { api, ApiError } from '../lib/api.js';
import { announce } from '../components/Announcements.tsx';
import { Icon } from '../components/Icon.tsx';
import { useStore } from '../lib/store.js';
import type { DriveFile, Folder, MoveResult, PathSegment } from '../lib/types.js';
import { formatSize } from '../lib/format.js';
import { SORT_OPTIONS } from '../lib/address.js';
import { FolderTree } from '../components/FolderTree.tsx';
import { FileList, type ListItem } from '../components/FileList.tsx';
import { DetailsPanel } from '../components/DetailsPanel.tsx';
import { Dialog, DialogActions } from '../components/Dialog.tsx';
import { PeoplePicker } from '../components/PeoplePicker.tsx';
import { iconPath } from '../lib/format.js';

interface Props {
  address: { folder: string | null; view: 'list' | 'grid'; sort: string; q: string };
  onNavigate: (patch: { folder?: string | null; view?: 'list' | 'grid'; sort?: string; q?: string }) => void;
}

interface HomingChip {
  id: string;
  name: string;
  fromRect: DOMRect;
}

export function DriveScreen({ address, onNavigate }: Props): preact.JSX.Element {
  const person = useStore(s => s.person)!;
  const services = useStore(s => s.services);
  const folders = useStore(s => s.folders);
  const [listItems, setListItems] = useState<ListItem[]>([]);
  const [path, setPath] = useState<PathSegment[]>([]);
  const [currentFolder, setCurrentFolder] = useState<Folder | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [cutSet, setCutSet] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [stayedIds, setStayedIds] = useState<Set<string>>(new Set());
  const [detailsFile, setDetailsFile] = useState<DriveFile | null>(null);
  const [detailsFolder, setDetailsFolder] = useState<Folder | null>(null);
  const [detailsPath, setDetailsPath] = useState<PathSegment[]>([]);
  const [chips, setChips] = useState<HomingChip[]>([]);
  const [dialog, setDialog] = useState<'none' | 'move' | 'rename' | 'newfolder' | 'share' | 'handover' | 'deleteforever'>('none');
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [newFolderValue, setNewFolderValue] = useState('');
  const [newFolderError, setNewFolderError] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<Folder | DriveFile | null>(null);
  const [shareGrants, setShareGrants] = useState<Array<{ id: string; name: string; firm: string; role: 'viewer' | 'editor'; endDate: string }>>([]);
  const [shareRole, setShareRole] = useState<'viewer' | 'editor'>('viewer');
  const [shareEndDate, setShareEndDate] = useState('');
  const [shareDefaults, setShareDefaults] = useState<{ today: string; defaultEndDate: string; maxEndDate: string } | null>(null);
  const [handoverFolder, setHandoverFolder] = useState<Folder | null>(null);
  const [handoverDays, setHandoverDays] = useState(7);
  const [handoverTo, setHandoverTo] = useState<{ id: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [dragStack, setDragStack] = useState<{ x: number; y: number; count: number } | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const chipsHostRef = useRef<HTMLDivElement>(null);
  const recentTimer = useRef<number | null>(null);

  const openFolderId = address.folder;

  useEffect(() => {
    void refresh();
  }, [openFolderId, address.sort, address.q, folders.length]);

  useEffect(() => {
    const onDayChange = (): void => { void refresh(); };
    document.addEventListener('lintel:day-change', onDayChange);
    return () => document.removeEventListener('lintel:day-change', onDayChange);
  }, [openFolderId, address.sort, address.q]);

  async function refresh(): Promise<void> {
    try {
      if (address.q.length > 0) {
        const res = await api.files({ q: address.q, sort: address.sort });
        setListItems(res.files.map(f => ({ kind: 'file' as const, file: f })));
        setPath([]);
        setCurrentFolder(null);
        setUnavailable(false);
        return;
      }
      if (!openFolderId) {
        const res = await api.files({});
        setListItems(res.folders.map(f => ({ kind: 'folder' as const, folder: f })));
        setPath([]);
        setCurrentFolder(null);
        setUnavailable(false);
        return;
      }
      const folderRes = await api.folder(openFolderId);
      setCurrentFolder(folderRes.folder);
      setPath(folderRes.path);
      const res = await api.files({ folderId: openFolderId, sort: address.sort });
      const items: ListItem[] = [
        ...res.folders.map(f => ({ kind: 'folder' as const, folder: f })),
        ...res.files.map(f => ({ kind: 'file' as const, file: f })),
      ];
      setListItems(items);
      setUnavailable(false);
      const stillVisible = new Set(items.map(i => (i.kind === 'folder' ? i.folder.id : i.file.id) ?? ''));
      setSelection(prev => {
        const next = new Set([...prev].filter(id => stillVisible.has(id)));
        if (next.size !== prev.size && next.size === 0) announce('Selection cleared');
        return next;
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setUnavailable(true);
        setListItems([]);
        setCurrentFolder(null);
        setPath([]);
      }
    }
  }

  useEffect(() => {
    const onMove = (e: Event): void => {
      const detail = (e as CustomEvent).detail as { result: MoveResult; fileIds: Array<{ id: string; fromFolderId: string }>; fileNames: string[] };
      void handleExternalMove(detail.result);
    };
    document.addEventListener('lintel:files-moved-remote', onMove);
    return () => document.removeEventListener('lintel:files-moved-remote', onMove);
  }, [openFolderId]);

  async function handleExternalMove(result: MoveResult): Promise<void> {
    if (result.toFolder.id === openFolderId || result.moved.some(m => m.fromFolderId === openFolderId)) {
      await refresh();
    }
  }

  const selectedFiles = listItems
    .filter(i => i.kind === 'file' && selection.has(i.file.id ?? ''))
    .map(i => (i as { kind: 'file'; file: DriveFile }).file);

  const selectedFolder = listItems.find(i => i.kind === 'folder' && selection.has(i.folder.id ?? ''));

  const runHomingFlight = (moved: Array<{ fileId: string }>, toFolderId: string | null): void => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const n = moved.length;
      showPlusBadge(toFolderId, n);
      return;
    }
    const destination = document.querySelector(`[data-folder-id="${toFolderId}"]`) ?? document.querySelector('[data-folder-id] .tname');
    const destRect = (destination as HTMLElement | null)?.getBoundingClientRect();
    const flight: HomingChip[] = [];
    for (const m of moved.slice(0, 8)) {
      const row = document.querySelector(`[data-item-id="${m.fileId}"]`);
      if (row) flight.push({ id: m.fileId, name: '', fromRect: row.getBoundingClientRect() });
    }
    const restCount = moved.length - 8;
    if (restCount > 0) {
      const lastRow = moved[7] ? document.querySelector(`[data-item-id="${moved[7].fileId}"]`) : null;
      if (lastRow) flight.push({ id: 'more', name: `+${restCount}`, fromRect: lastRow.getBoundingClientRect() });
    }
    setChips(chips => [...chips, ...flight]);
    setTimeout(() => {
      const chipsNodes = document.querySelectorAll('.homing-chip');
      chipsNodes.forEach((node, i) => {
        const chip = flight[i];
        if (!chip || !destRect) return;
        const dx = destRect.left + destRect.width / 2 - (chip.fromRect.left + chip.fromRect.width / 2);
        const dy = destRect.top + destRect.height / 2 - (chip.fromRect.top + chip.fromRect.height / 2);
        (node as HTMLElement).style.setProperty('--dx', `${dx}px`);
        (node as HTMLElement).style.setProperty('--dy', `${dy}px`);
        const distance = Math.hypot(dx, dy);
        const bow = Math.max(distance * 0.12, 20);
        (node as HTMLElement).style.animationDuration = '420ms';
        (node as HTMLElement).dataset.bow = String(bow);
      });
      setTimeout(() => {
        setChips([]);
        const rows = moved.map(m => document.querySelector(`[data-item-id="${m.fileId}"]`));
        rows.forEach(r => r?.classList.add('collapsing'));
        setTimeout(() => { void refresh(); }, 190);
        stepCounts(toFolderId);
      }, 460 + Math.max(0, moved.length - 1) * 40);
    }, 30);
  };

  const showPlusBadge = (toFolderId: string | null, n: number): void => {
    const node = document.querySelector(`[data-folder-id="${toFolderId}"]`);
    if (node) {
      const badge = document.createElement('span');
      badge.className = 'plus-badge';
      badge.dataset.reducedBadge = 'true';
      badge.textContent = `+${n}`;
      node.appendChild(badge);
      const remove = (): void => {
        badge.remove();
        document.removeEventListener('focusin', remove, true);
      };
      document.addEventListener('focusin', remove, { once: true, capture: true });
    }
  };

  const stepCounts = (toFolderId: string | null): void => {
    if (!toFolderId) return;
    const node = document.querySelector(`[data-folder-id="${toFolderId}"] .tcount`);
    if (node) {
      node.classList.add('count-stepping');
      setTimeout(() => node.classList.remove('count-stepping'), 200);
    }
  };

  async function doMove(toFolderId: string, files: DriveFile[]): Promise<void> {
    if (files.length === 0) return;
    const idempotencyKey = `move-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const movedIds = new Set(files.map(f => f.id));
    setSelection(new Set());
    try {
      const result = await api.move(toFolderId, files.map(f => ({ fileId: f.id, fromFolderId: f.folderId ?? '' })), idempotencyKey);
      const movedNames = result.moved.map(m => files.find(f => f.id === m.fileId)?.name ?? 'file');
      const stayedCount = result.stayed.length;
      const lost = result.lostTo.slice(0, 3);
      let message = movedNames.length === 0
        ? 'No files moved'
        : `Moved ${movedNames.length} ${movedNames.length === 1 ? 'file' : 'files'} to ${result.toFolder.name}`;
      if (movedNames.length > 0 && stayedCount > 0) message += `. ${stayedCount} locked ${stayedCount === 1 ? 'file' : 'files'} stayed`;
      for (const l of lost) {
        const name = files.find(f => f.id === l.fileId)?.name ?? 'file';
        message += `. ${name} was already moved to ${l.folder.name} by ${l.by.name}`;
      }
      if (result.lostTo.length > 3) message += `. ${result.lostTo.length - 3} more were moved by others first`;
      announce(message);
      for (const l of result.lostTo) {
        const name = files.find(f => f.id === l.fileId)?.name ?? 'file';
        storeAddNotice(`${name} was already moved to ${l.folder.name} by ${l.by.name}`);
      }
      if (result.moved.length > 0) {
        runHomingFlight(result.moved, result.toFolder.id);
      }
      const newStayed = new Set(result.stayed.map(s => s.fileId));
      setStayedIds(prev => new Set([...prev, ...newStayed]));
      void refresh();
    } catch (err) {
      announce('Move failed. Nothing was moved.');
      setSelection(new Set([...movedIds]));
    }
  }

  const onCut = (): void => {
    const ids = new Set(selectedFiles.map(f => f.id));
    setCutSet(ids);
    announce(`${ids.size} ${ids.size === 1 ? 'file' : 'files'} cut`);
  };

  const onPaste = async (targetFolderId: string | null): void => {
    if (cutSet.size === 0) return;
    const files = cutSet.size > 0
      ? listItems.filter(i => i.kind === 'file' && cutSet.has(i.file.id ?? '')).map(i => (i as { kind: 'file'; file: DriveFile }).file)
      : [];
    const targetId = targetFolderId ?? openFolderId;
    if (!targetId) return;
    await doMove(targetId, files);
    setCutSet(new Set());
  };

  const onOpenFolder = (folder: Folder): void => {
    onNavigate({ folder: folder.id ?? null });
  };

  const onOpenFile = async (file: DriveFile): Promise<void> => {
    setDetailsFile(file);
    setDetailsFolder(null);
    try {
      const res = await api.file(file.id);
      setDetailsPath(res.path);
    } catch { setDetailsPath([]); }
  };

  const pathSegments = (): Array<{ id: string | null; name: string }> => {
    if (address.q.length > 0) return [{ id: null, name: `Search: ${address.q}` }];
    return path.map(p => ({ id: p.id, name: p.name }));
  };

  const shareItem = async (): Promise<void> => {
    if (!shareTarget) return;
    const itemType = 'id' in shareTarget && 'folderId' in shareTarget ? 'file' : 'folder';
    const itemId = itemType === 'file' ? (shareTarget as DriveFile).id : (shareTarget as Folder).id ?? '';
    try {
      const res = await api.grants(itemType, itemId);
      setShareGrants(res.grants.map(g => ({ id: g.id, name: g.person.name, firm: g.person.firm, role: g.role, endDate: g.endDate })));
    } catch { setShareGrants([]); }
    try {
      const defaults = await api.grantDefaults();
      setShareDefaults(defaults);
      setShareEndDate(defaults.defaultEndDate);
    } catch { setShareDefaults(null); }
  };

  useEffect(() => {
    if (dialog === 'share') void shareItem();
  }, [dialog]);

  useEffect(() => {
    if (dialog === 'newfolder' && currentFolder) { setNewFolderValue(''); setNewFolderError(null); }
  }, [dialog]);

  const submitShare = async (person: { id: string; name: string }): Promise<void> => {
    if (!shareTarget) return;
    const itemType = 'folderId' in shareTarget ? 'file' : 'folder';
    const itemId = itemType === 'file' ? (shareTarget as DriveFile).id : (shareTarget as Folder).id ?? '';
    try {
      const res = await api.createGrant(itemType as 'folder' | 'file', itemId, person.id, shareRole, shareEndDate);
      announce(`Shared ${res.grant.itemName} with ${res.grant.person.name} until ${res.grant.endDate}`);
      setShareGrants(prev => [...prev, { id: res.grant.id, name: res.grant.person.name, firm: res.grant.person.firm, role: res.grant.role, endDate: res.grant.endDate }]);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'grant_exists') {
          announce(`${person.name} already has access to ${(shareTarget as { name: string }).name}. Change it in the list below.`);
        } else if (err.fields?.endDate) {
          announce(err.fields.endDate);
        } else if (err.fields?.personId) {
          announce(err.fields.personId);
        } else {
          announce('Something went wrong. Nothing was changed.');
        }
      }
    }
  };

  const toolbarOrSelbar = selection.size > 0 ? (
    <div class="selbar" role="toolbar" aria-label="Selection actions">
      {person.kind === 'staff' && <button type="button" onClick={() => setDialog('move')}>Move to</button>}
      {person.kind === 'staff' && <button type="button" onClick={() => startRename()}>Rename</button>}
      {person.kind === 'staff' && <button type="button" onClick={() => { setShareTarget(selectedFiles[0] ?? null); setDialog('share'); }}>Share</button>}
      {person.staffRole === 'controller' && selectedFiles.some(f => !f.locked) && <button type="button" onClick={lockSelected}>Lock</button>}
      {person.staffRole === 'controller' && selectedFiles.some(f => f.locked) && <button type="button" onClick={unlockSelected}>Unlock</button>}
      {person.kind === 'staff' && <button type="button" onClick={binSelected}>Move to bin</button>}
      <button type="button" onClick={() => downloadSelected()}>Download</button>
      <button type="button" onClick={() => openDetailsSheet()}>Details</button>
      <button type="button" onClick={() => clearSelection()}>Clear selection</button>
    </div>
  ) : (
    <div class="toolbar">
      <div class="view-switch" role="radiogroup" aria-label="View">
        <label class={address.view === 'list' ? 'on' : ''}>
          <input type="radio" name="view" checked={address.view === 'list'} onClick={() => onNavigate({ view: 'list' })} />
          List
        </label>
        <label class={address.view === 'grid' ? 'on' : ''}>
          <input type="radio" name="view" checked={address.view === 'grid'} onClick={() => onNavigate({ view: 'grid' })} />
          Grid
        </label>
      </div>
      <label for="sortby" class="sr-only">Sort by</label>
      <select id="sortby" class="sort-select" role="combobox" aria-label="Sort by" value={address.sort} onChange={e => onNavigate({ sort: (e.target as HTMLSelectElement).value })}>
        {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </div>
  );

  function startRename(): void {
    const f = selectedFiles[0];
    if (f) { setRenameValue(f.name); setRenameError(null); setDialog('rename'); }
  }

  async function lockSelected(): Promise<void> {
    const targets = selectedFiles.filter(f => !f.locked);
    for (const f of targets) { try { await api.lockFile(f.id); } catch { /* skip */ } }
    announce(`Locked ${targets.length} ${targets.length === 1 ? 'file' : 'files'}`);
    await refresh();
  }

  async function unlockSelected(): Promise<void> {
    const targets = selectedFiles.filter(f => f.locked);
    for (const f of targets) { try { await api.unlockFile(f.id); } catch { /* skip */ } }
    announce(`Unlocked ${targets.length} ${targets.length === 1 ? 'file' : 'files'}`);
    await refresh();
  }

  async function binSelected(): Promise<void> {
    const targets = selectedFiles.filter(f => !f.locked);
    if (targets.length === 0) { announce('No files moved'); return; }
    try {
      const res = await api.binFiles(targets.map(f => f.id));
      let msg = `Moved ${res.binned.length} ${res.binned.length === 1 ? 'file' : 'files'} to the bin`;
      if (res.stayed.length > 0) msg += `. ${res.stayed.length} locked ${res.stayed.length === 1 ? 'file' : 'files'} stayed`;
      announce(msg);
      await refresh();
    } catch { announce('Something went wrong. Nothing was changed.'); }
  }

  async function downloadSelected(): Promise<void> {
    if (services.storage === 'down') {
      announce('File storage is unreachable. Uploads are paused and previews are unavailable until it returns.');
      return;
    }
    for (const f of selectedFiles) {
      try {
        const link = await api.fileLink(f.id, 'download');
        const a = document.createElement('a');
        a.href = link.url;
        a.download = f.name;
        a.click();
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'storage_unavailable') {
          announce('File storage is unreachable. Uploads are paused and previews are unavailable until it returns.');
          break;
        }
      }
    }
  }

  function openDetailsSheet(): void {
    if (detailsFile || detailsFolder) { document.body.classList.add('sheet-open'); }
  }

  function clearSelection(): void {
    setSelection(new Set());
    setAnchor(null);
    announce('Selection cleared');
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
      if (dialog !== 'none') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'x') { e.preventDefault(); onCut(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'v') { e.preventDefault(); void onPaste(openFolderId); }
      else if (e.key === 'F2' && person.kind === 'staff') { e.preventDefault(); startRename(); }
      else if (e.key === 'Delete' && person.kind === 'staff') { e.preventDefault(); void binSelected(); }
      else if (e.key === 'Escape') {
        if (cutSet.size > 0) setCutSet(new Set());
        else clearSelection();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const isPartner = person.kind === 'partner';
  const canUpload = !isPartner && (currentFolder?.access === 'editor' || !currentFolder);

  return (
    <>
      <div class="list-wrap" data-centre-scroll>
        {services.storage === 'down' && (
          <div class="status-banner" role="region" aria-label="Service status">
            <Icon name="alert-triangle" size={16} />
            File storage is unreachable. Uploads are paused and previews are unavailable until it returns.
          </div>
        )}
        {unavailable && <div class="empty-state">This folder is not available to you.</div>}
        {!unavailable && pathSegments().length > 0 && (
          <nav class="pathbar" aria-label="Folder path">
            {isPartner ? <span class="seg">Shared with me</span> : <a class="seg" href="/drive" onClick={e => { e.preventDefault(); onNavigate({ folder: null, q: '' }); }}>Projects</a>}
            {pathSegments().map((seg, i) => (
              <span key={`${seg.id}-${i}`} style="display:inline-flex;align-items:center;gap:4px;">
                <span class="sep">/</span>
                <a class="seg" href={`/drive?folder=${seg.id}`} aria-current={i === pathSegments().length - 1 ? 'page' : undefined} onClick={e => { e.preventDefault(); onNavigate({ folder: seg.id, q: '' }); }}>{seg.name}</a>
              </span>
            ))}
          </nav>
        )}
        {!unavailable && !isPartner && !openFolderId && address.q.length === 0 && <h2 style="padding:12px 16px 4px;font-size:18px;">Projects</h2>}
        {toolbarOrSelbar}
        <FileList
          items={listItems}
          view={address.view}
          selection={selection}
          cutSet={cutSet}
          anchor={anchor}
          focusId={focusId}
          stayedIds={stayedIds}
          onSelectionChange={(ids, newAnchor, newFocus) => { setSelection(ids); setAnchor(newAnchor); setFocusId(newFocus); }}
          onOpenFolder={onOpenFolder}
          onOpenFile={f => void onOpenFile(f)}
          onDragStart={(item, e) => {
            const count = selection.has(item.kind === 'file' ? item.file.id ?? '' : item.folder.id ?? '') ? Math.max(1, selectedFiles.length) : 1;
            setDragStack({ x: e.clientX, y: e.clientY, count });
            e.dataTransfer?.setData('text/plain', 'lintel-move');
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
          }}
        />
        {listItems.length === 0 && address.q.length > 0 && <div class="empty-state">No files match {address.q}.</div>}
      </div>
      <div ref={chipsHostRef}>
        {chips.map(chip => (
          <div key={chip.id + Math.random()} class="homing-chip" data-homing-chip={chip.id} style={`left:${chip.fromRect.left}px;top:${chip.fromRect.top}px;`}>
            {chip.name || ''}
          </div>
        ))}
      </div>
      {dialog === 'move' && (
        <MoveDialog folders={folders} onCancel={() => setDialog('none')} onMoveTo={async folderId => { setDialog('none'); await doMove(folderId, selectedFiles); }} />
      )}
      {dialog === 'rename' && selectedFiles[0] && (
        <Dialog title="Rename" onClose={() => setDialog('none')}>
          <div class="field">
            <label for="rename-name">Name</label>
            <input id="rename-name" type="text" value={renameValue} onInput={e => setRenameValue((e.target as HTMLInputElement).value)} />
            {renameError && <span class="field-error">{renameError}</span>}
          </div>
          <DialogActions
            onCancel={() => setDialog('none')}
            primaryLabel="Save"
            onPrimary={async () => {
              const file = selectedFiles[0]!;
              const trimmed = renameValue.trim();
              if (trimmed.length === 0) { setRenameError('Enter a name.'); return; }
              try {
                const res = await api.renameFile(file.id, trimmed);
                announce(`Renamed to ${res.file.name}`);
                setDialog('none');
                await refresh();
              } catch (err) {
                if (err instanceof ApiError) {
                  if (err.code === 'locked') announce(`${file.name} is locked and was not renamed.`);
                  else if (err.fields?.name) setRenameError(err.fields.name);
                }
              }
            }}
          />
        </Dialog>
      )}
      {dialog === 'newfolder' && (
        <Dialog title="New folder" onClose={() => setDialog('none')}>
          <div class="field">
            <label for="folder-name">Folder name</label>
            <input id="folder-name" type="text" value={newFolderValue} onInput={e => setNewFolderValue((e.target as HTMLInputElement).value)} />
            {newFolderError && <span class="field-error">{newFolderError}</span>}
          </div>
          <DialogActions
            onCancel={() => setDialog('none')}
            primaryLabel="Create"
            onPrimary={async () => {
              try {
                const res = await api.createFolder(openFolderId, newFolderValue);
                announce(`Created ${res.folder.name}`);
                setDialog('none');
                await refresh();
              } catch (err) {
                if (err instanceof ApiError && err.fields?.name) setNewFolderError(err.fields.name);
              }
            }}
          />
        </Dialog>
      )}
      {dialog === 'share' && shareTarget && (
        <Dialog title={`Share ${(shareTarget as { name: string }).name}`} onClose={() => setDialog('none')}>
          <PeoplePicker
            id="Person"
            kind="partner"
            labelText="Person"
            onPick={p => void submitShare(p)}
          />
          <div class="field" role="radiogroup" aria-label="Access">
            <label>Access</label>
            <div style="display:flex;gap:14px;">
              <label style="display:flex;gap:4px;align-items:center;">
                <input type="radio" name="access" checked={shareRole === 'viewer'} onChange={() => setShareRole('viewer')} /> Viewer
              </label>
              <label style="display:flex;gap:4px;align-items:center;">
                <input type="radio" name="access" checked={shareRole === 'editor'} onChange={() => setShareRole('editor')} /> Editor
              </label>
            </div>
          </div>
          <div class="field">
            <label for="access-ends">Access ends</label>
            <input
              id="access-ends"
              type="date"
              value={shareEndDate}
              min={shareDefaults?.today}
              max={shareDefaults?.maxEndDate}
              onInput={e => setShareEndDate((e.target as HTMLInputElement).value)}
            />
          </div>
          <h3 style="font-size:12px;margin:4px 0;">People with access</h3>
          <ul class="access-list" aria-label="People with access">
            {shareGrants.map(g => (
              <li key={g.id} class="access-row">
                <span class="who">{g.name}<br /><span class="firm">Ends {g.endDate}</span></span>
                <select aria-label={`Access for ${g.name}`} value={g.role} onChange={async e => {
                  const role = (e.target as HTMLSelectElement).value as 'viewer' | 'editor';
                  try {
                    await api.updateGrant(g.id, { role });
                    announce(`${g.name} is now ${role} on ${(shareTarget as { name: string }).name}`);
                    setShareGrants(prev => prev.map(x => x.id === g.id ? { ...x, role } : x));
                  } catch { announce('Something went wrong. Nothing was changed.'); }
                }}>
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                </select>
                <button type="button" aria-label={`Remove ${g.name}`} onClick={async () => {
                  try {
                    await api.removeGrant(g.id);
                    announce(`Removed ${g.name} from ${(shareTarget as { name: string }).name}`);
                    setShareGrants(prev => prev.filter(x => x.id !== g.id));
                  } catch { announce('Something went wrong. Nothing was changed.'); }
                }}>Remove</button>
              </li>
            ))}
            {shareGrants.length === 0 && <li class="preview-note">No one yet.</li>}
          </ul>
        </Dialog>
      )}
      {dialog === 'handover' && handoverFolder && (
        <Dialog title={`Hand over ${handoverFolder.name}`} onClose={() => setDialog('none')}>
          <PeoplePicker id="New owner" kind="staff" excludeId={person.id} labelText="New owner" onPick={p => setHandoverTo({ id: p.id, name: p.name })} />
          <div class="field">
            <label for="days-accept">Days to accept</label>
            <input id="days-accept" type="number" min="1" max="14" value={handoverDays} onInput={e => setHandoverDays(Number((e.target as HTMLInputElement).value))} />
          </div>
          <DialogActions
            onCancel={() => setDialog('none')}
            primaryLabel="Offer"
            onPrimary={async () => {
              if (!handoverTo) { announce('Choose a staff member other than the current owner.'); return; }
              try {
                const res = await api.offerHandover(handoverFolder.id ?? '', handoverTo.id, handoverDays);
                announce(`Offered ${handoverFolder.name} to ${handoverTo.name} until ${res.handover.lapseDate}`);
                setDialog('none');
              } catch (err) {
                if (err instanceof ApiError) {
                  if (err.fields?.days) announce(err.fields.days);
                  else if (err.fields?.toPersonId) announce(err.fields.toPersonId);
                  else if (err.code === 'handover_open') announce(`${handoverFolder.name} already has an open handover.`);
                  else announce('Something went wrong. Nothing was changed.');
                }
              }
            }}
          />
        </Dialog>
      )}
      {detailsFile || detailsFolder ? (
        <div class="details sheet-open" id="details-wrap">
          <DetailsPanel
            file={detailsFile}
            folder={detailsFolder}
            path={detailsPath.length > 0 ? detailsPath : path}
            onClose={() => { setDetailsFile(null); setDetailsFolder(null); document.body.classList.remove('sheet-open'); }}
            onOfferHandover={f => { setHandoverFolder(f); setDialog('handover'); }}
            onShare={item => { setShareTarget(item); setDialog('share'); }}
          />
        </div>
      ) : null}
    </>
  );
}

function storeAddNotice(text: string): void {
  document.dispatchEvent(new CustomEvent('lintel:notice', { detail: { text } }));
}

function MoveDialog({ folders, onCancel, onMoveTo }: { folders: Folder[]; onCancel: () => void; onMoveTo: (id: string) => void }): preact.JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(folders.map(f => f.id ?? '')));
  return (
    <Dialog title="Move to" onClose={onCancel}>
      <FolderTree
        folders={folders}
        expanded={expanded}
        focusedId={null}
        activeFolderId={null}
        onToggleExpand={id => setExpanded(prev => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id); else next.add(id);
          return next;
        })}
        onOpen={f => { if (f.id) onMoveTo(f.id); }}
      />
      <DialogActions onCancel={onCancel} primaryLabel="Move here" onPrimary={() => { const first = document.querySelector('[role="treeitem"] .tname') as HTMLElement | null; first?.click(); }} />
    </Dialog>
  );
}
