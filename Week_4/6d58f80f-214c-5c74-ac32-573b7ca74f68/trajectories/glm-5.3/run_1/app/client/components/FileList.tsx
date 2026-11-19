import { useEffect, useRef, useState } from 'preact/hooks';
import type { DriveFile, Folder } from '../lib/types.js';
import { formatSize, formatPhoenixTime } from '../lib/format.js';
import { Icon } from './Icon.tsx';
import { announce } from './Announcements.tsx';

export type ListItem = { kind: 'folder'; folder: Folder } | { kind: 'file'; file: DriveFile };

interface Props {
  items: ListItem[];
  view: 'list' | 'grid';
  selection: Set<string>;
  cutSet: Set<string>;
  anchor: string | null;
  focusId: string | null;
  stayedIds: Set<string>;
  onSelectionChange: (ids: Set<string>, anchor: string | null, focusId: string | null) => void;
  onOpenFolder: (folder: Folder) => void;
  onOpenFile: (file: DriveFile) => void;
  onContextMenu?: (item: ListItem) => void;
  onDragStart?: (item: ListItem, e: DragEvent) => void;
}

export function FileList(props: Props): preact.JSX.Element {
  const { items, view, selection, cutSet, anchor, focusId, stayedIds } = props;
  const [focusedId, setFocusedId] = useState<string | null>(props.focusId);
  const listRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ text: '', at: 0 });

  useEffect(() => {
    if (props.focusId !== null) setFocusedId(props.focusId);
  }, [props.focusId]);

  const setSelection = (ids: Set<string>, newAnchor: string | null, newFocus: string | null): void => {
    setFocusedId(newFocus);
    props.onSelectionChange(ids, newAnchor, newFocus);
    if (ids.size === 0) announce('Selection cleared');
    else announce(`${ids.size} selected`);
  };

  const visibleIds = items.map(i => (i.kind === 'folder' ? i.folder.id : i.file.id));

  const moveFocus = (delta: number, extend: boolean, toggleMode: boolean): void => {
    const idx = focusedId ? visibleIds.indexOf(focusedId) : -1;
    let next = idx === -1 ? (delta > 0 ? 0 : visibleIds.length - 1) : idx + delta;
    next = Math.max(0, Math.min(next, visibleIds.length - 1));
    const nextId = visibleIds[next] ?? null;
    if (!nextId) return;
    if (extend && anchor !== null) {
      const a = visibleIds.indexOf(anchor);
      const b = next;
      const range = visibleIds.slice(Math.min(a, b), Math.max(a, b) + 1);
      setSelection(new Set(range), anchor, nextId);
    } else if (toggleMode) {
      setFocusedId(nextId);
      props.onSelectionChange(selection, anchor, nextId);
    } else {
      setSelection(new Set([nextId]), nextId, nextId);
    }
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight' && view === 'grid') {
      e.preventDefault(); moveFocus(1, e.shiftKey, e.ctrlKey || e.metaKey);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' && view === 'grid') {
      e.preventDefault(); moveFocus(-1, e.shiftKey, e.ctrlKey || e.metaKey);
    } else if (e.key === 'Home') {
      e.preventDefault();
      const first = visibleIds[0];
      if (first) setSelection(new Set([first]), first, first);
    } else if (e.key === 'End') {
      e.preventDefault();
      const last = visibleIds[visibleIds.length - 1];
      if (last) setSelection(new Set([last]), last, last);
    } else if (e.key === ' ') {
      e.preventDefault();
      const target = e.ctrlKey || e.metaKey ? undefined : focusedId;
      if (e.ctrlKey || e.metaKey && focusedId) {
        const next = new Set(selection);
        if (next.has(focusedId)) next.delete(focusedId); else next.add(focusedId);
        setSelection(next, focusedId, focusedId);
      } else if (focusedId) {
        setSelection(new Set([focusedId]), focusedId, focusedId);
      }
    } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setSelection(new Set(visibleIds), anchor ?? visibleIds[0] ?? null, focusedId);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items.find(i => (i.kind === 'folder' ? i.folder.id : i.file.id) === focusedId);
      if (item) {
        if (item.kind === 'folder') props.onOpenFolder(item.folder);
        else props.onOpenFile(item.file);
      }
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      if (now - typeahead.current.at > 500) typeahead.current.text = '';
      typeahead.current.text += e.key.toLowerCase();
      typeahead.current.at = now;
      const match = items.find(i => {
        const name = i.kind === 'folder' ? i.folder.name : i.file.name;
        return name.toLowerCase().startsWith(typeahead.current.text);
      });
      if (match) {
        const id = match.kind === 'folder' ? match.folder.id : match.file.id;
        setFocusedId(id);
        props.onSelectionChange(selection, anchor, id);
      }
    }
  };

  const clickItem = (item: ListItem, e: MouseEvent): void => {
    const id = item.kind === 'folder' ? item.folder.id : item.file.id;
    if (e.shiftKey && anchor !== null) {
      const a = visibleIds.indexOf(anchor);
      const b = visibleIds.indexOf(id);
      const range = visibleIds.slice(Math.min(a, b), Math.max(a, b) + 1);
      setSelection(new Set(range), anchor, id);
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(selection);
      if (next.has(id)) next.delete(id); else next.add(id);
      setSelection(next, id, id);
    } else {
      setSelection(new Set([id]), id, id);
    }
  };

  const doubleClick = (item: ListItem): void => {
    if (item.kind === 'folder') props.onOpenFolder(item.folder);
    else props.onOpenFile(item.file);
  };

  const isCut = (id: string): boolean => cutSet.has(id);

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Files"
      aria-multiselectable="true"
      tabindex="0"
      class={view === 'grid' ? 'filegrid' : 'filelist'}
      onKeyDown={onKeyDown}
    >
      {items.map(item => {
        const id = item.kind === 'folder' ? item.folder.id : item.file.id;
        const name = item.kind === 'folder' ? item.folder.name : item.file.name;
        const selected = selection.has(id ?? '');
        const isFocused = focusedId === id;
        return (
          <div
            key={id}
            role="option"
            aria-selected={selected ? 'true' : 'false'}
            aria-label={name}
            data-item-id={id}
            class={[
              view === 'grid' ? 'gridcell' : 'filerow',
              selected ? 'sel' : '',
              item.kind === 'file' && isCut(id ?? '') ? 'cut' : '',
              isFocused ? 'focused' : '',
            ].filter(Boolean).join(' ')}
            onMouseDown={e => clickItem(item, e)}
            onDblClick={() => doubleClick(item)}
            draggable={item.kind === 'file'}
            onDragStart={e => props.onDragStart?.(item, e)}
          >
            {view === 'list' ? (
              <>
                <span class="fline1" style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
                  <span class="ficon"><Icon name={item.kind === 'folder' ? 'folder' : iconFor(item.kind === 'file' ? item.file : null)} size={16} /></span>
                  <span class="fname">{name}</span>
                  {item.kind === 'file' && item.file.locked && <span class="badge locked">Locked</span>}
                  {stayedIds.has(id ?? '') && <span class="badge stayed">Stayed</span>}
                </span>
                <span class="fline2" style="display:flex;gap:10px;">
                  {item.kind === 'file' ? (
                    <>
                      <span class="fmeta">{formatSize(item.file.size)}</span>
                      <span class="fmodified">{formatPhoenixTime(item.file.modifiedAt)}</span>
                    </>
                  ) : (
                    <span class="fmeta">{item.folder.fileCount} {item.folder.fileCount === 1 ? 'file' : 'files'}</span>
                  )}
                </span>
              </>
            ) : (
              <>
                <span class="gicon"><Icon name={item.kind === 'folder' ? 'folder' : iconFor(item.kind === 'file' ? item.file : null)} size={32} /></span>
                <span class="gname">{name}</span>
                {item.kind === 'file' && <span class="mono" style="font-size:11px;color:var(--ink-soft);">{formatSize(item.file.size)}</span>}
                {item.kind === 'file' && item.file.locked && <span class="badge locked">Locked</span>}
              </>
            )}
          </div>
        );
      })}
      {items.length === 0 && <div class="empty-state" style="grid-column:1/-1;">This folder is empty.</div>}
    </div>
  );
}

function iconFor(file: DriveFile | null): string {
  if (!file) return 'file';
  if (file.contentType.startsWith('image/')) return 'image';
  if (file.contentType === 'application/pdf') return 'file-text';
  return 'file';
}
