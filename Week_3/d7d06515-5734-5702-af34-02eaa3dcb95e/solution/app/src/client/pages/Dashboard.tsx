// /drawings: the file browser (brief: Dashboard). Files table, toolbar, live list, Welcome panel and the dialogs it opens.
import { LayoutGrid, List, LogOut, Menu as MenuIcon, RefreshCw, Search, Settings2, X } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { COPY, copy, itemsCount } from '../../shared/copy.ts';
import type { AccountEvent, FolderItem, MeResponse } from '../../shared/types.ts';
import { get, post, stream, upload } from '../api.ts';
import { EmptySketch } from '../art/EmptySketch.tsx';
import { Logo } from '../art/Logo.tsx';
import { Link, navigate, useLocation } from '../router.tsx';
import { CommandReferenceDialog } from '../ui/CommandReference.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { LoadingStrokes } from '../ui/LoadingStrokes.tsx';
import { Menu } from '../ui/Menu.tsx';
import { announce } from '../ui/announce.tsx';
import { useMediaQuery } from '../ui/useMediaQuery.ts';
import { DeleteDialog } from './dashboard/DeleteDialog.tsx';
import { FileGrid, FileTable } from './dashboard/FileTable.tsx';
import { FilesNav } from './dashboard/FilesNav.tsx';
import { NewFolderField } from './dashboard/NewFolderField.tsx';
import { ProDialog } from './dashboard/ProDialog.tsx';
import { ShortcutsDialog } from './dashboard/ShortcutsDialog.tsx';
import { SupportFilesDialog } from './dashboard/SupportFilesDialog.tsx';
import { VersionHistoryDialog } from './dashboard/VersionHistoryDialog.tsx';
import { DEFAULT_SORT, firstName, nextSort, viewKey, viewOf, type Column, type Sort } from './dashboard/model.ts';
import { useFileList } from './dashboard/useFileList.ts';
import { GENERIC_ERROR, uploadFailure } from './errors.ts';

const SEARCH_IDLE_MS = 300;
const KEPT_UPLOADS = 6;

type DialogState =
  | { kind: 'pro' }
  | { kind: 'support' }
  | { kind: 'reference' }
  | { kind: 'shortcuts' }
  | { kind: 'delete'; item: FolderItem; anchor: HTMLElement }
  | { kind: 'versions'; item: FolderItem; anchor: HTMLElement };

interface UploadRow {
  id: number;
  name: string;
  state: 'pending' | 'stored' | 'failed';
  lines: string[];
}

interface UploadResponse {
  drawing: { id: string; name: string };
  file_version: number;
  imported: number;
  skipped: number;
}

const toolbarTitle = { recent: 'Recent', samples: 'Sample Files' } as const;

export function Dashboard({ me }: { me: MeResponse }) {
  const { search } = useLocation();
  const view = viewOf(search);
  const key = viewKey(view);
  const phone = useMediaQuery('(max-width: 767px)');

  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [searchText, setSearchText] = useState('');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'list' | 'grid'>('list');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [trial, setTrial] = useState(me.trial);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [menu, setMenu] = useState<{ item: FolderItem; anchor: HTMLElement } | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadSeq = useRef(0);
  const referenceLink = useRef<HTMLAnchorElement>(null);
  const shortcutsLink = useRef<HTMLAnchorElement>(null);

  const list = useFileList(view, sort, view.kind === 'recent' ? '' : query);
  const reloadRef = useRef(list.reload);
  reloadRef.current = list.reload;
  const shownFolder = useRef<string | null>(null);
  shownFolder.current = list.folder?.id ?? null;
  const viewRef = useRef(view.kind);
  viewRef.current = view.kind;

  useEffect(() => {
    setSearchText('');
    setQuery('');
  }, [key]);

  useEffect(() => {
    if (searchText === query) return;
    const timer = setTimeout(() => setQuery(searchText), SEARCH_IDLE_MS);
    return () => clearTimeout(timer);
  }, [searchText, query]);

  useEffect(() => {
    return stream(
      '/api/events',
      (event, data) => {
        const payload = data as AccountEvent['data'];
        if (event === 'files' && 'folder_id' in payload && payload.folder_id === shownFolder.current) reloadRef.current();
        else if (event === 'recent' && viewRef.current === 'recent') reloadRef.current();
        else if (event === 'trial' && 'days_left' in payload) setTrial({ days_left: payload.days_left, ended: payload.ended });
      },
      {
        onOpen: () => {
          // Anything that changed before the stream opened or while it was down is fetched again.
          reloadRef.current();
          get<MeResponse>('/api/me').then((answer) => setTrial(answer.trial), () => undefined);
        },
      },
    );
  }, []);

  const folderId = async (): Promise<string> => {
    if (list.folder && view.kind === 'folder') return list.folder.id;
    const root = await get<{ folder: { id: string } }>('/api/folders/root');
    return root.folder.id;
  };

  const newDrawing = async (): Promise<void> => {
    try {
      const created = await post<{ drawing: { id: string } }>('/api/drawings', { folder_id: await folderId() });
      navigate(`/d/${created.drawing.id}`);
    } catch {
      announce(GENERIC_ERROR);
    }
  };

  const newFolder = (): void => {
    if (view.kind !== 'folder') navigate('/drawings');
    setCreatingFolder(true);
  };

  const createFolder = async (name: string): Promise<void> => {
    await post('/api/folders', { parent_id: await folderId(), name });
    list.reload();
  };

  const runUpload = async (file: File): Promise<void> => {
    uploadSeq.current += 1;
    const id = uploadSeq.current;
    const patch = (row: Partial<UploadRow>): void => setUploads((rows) => rows.map((r) => (r.id === id ? { ...r, ...row } : r)));
    setUploads((rows) => [{ id, name: file.name, state: 'pending' as const, lines: [] }, ...rows].slice(0, KEPT_UPLOADS));
    try {
      const target = view.kind === 'folder' ? view.folderId : 'root';
      const result = await upload<UploadResponse>(`/api/folders/${encodeURIComponent(target)}/uploads`, file);
      const lines = [
        ...(result.file_version > 1 ? [copy.updatedToVersion(result.drawing.name, result.file_version)] : []),
        copy.importSummary(result.imported, result.skipped),
      ];
      patch({ state: 'stored', lines });
      announce([`${file.name}: ${COPY.uploadStored}.`, ...lines].join(' '));
      list.reload();
    } catch (error) {
      const message = uploadFailure(error, file.name);
      patch({ state: 'failed', lines: [message] });
      announce(message);
    }
  };

  const onFiles = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    for (const file of files) await runUpload(file);
  };

  const signOut = async (): Promise<void> => {
    await post('/api/auth/signout').catch(() => undefined);
    navigate('/signin');
  };

  const sortBy = (column: Column): void => setSort((current) => nextSort(current, column));

  const items = list.items === null ? null
    : view.kind === 'recent' && query === '' ? list.items
    : view.kind === 'recent' ? list.items.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()))
    : list.items;
  const isRoot = list.folder?.parent_id === null || (view.kind === 'folder' && view.folderId === 'root');
  const title = view.kind === 'folder' ? list.folder?.name ?? 'My Drawings' : toolbarTitle[view.kind];

  const openRowMenu = (item: FolderItem, anchor: HTMLElement, expanded: boolean): void => setMenu(expanded ? null : { item, anchor });
  const anchorFocus = (anchor: HTMLElement) => (): HTMLElement | null =>
    anchor.isConnected ? anchor : document.querySelector<HTMLElement>('main h1');

  const nav = (
    <FilesNav
      view={view}
      isRoot={isRoot}
      onNewDrawing={() => void newDrawing()}
      onUpload={() => fileInput.current?.click()}
      onNewFolder={newFolder}
      onAction={() => setSheetOpen(false)}
    />
  );

  const emptyCopy = items !== null && items.length === 0 && !creatingFolder
    ? (query !== '' ? copy.noMatch(query) : COPY.filesEmpty)
    : null;

  const folderField: ReactNode = creatingFolder ? <NewFolderField create={createFolder} onClose={() => setCreatingFolder(false)} /> : null;

  return (
    <div className="dash">
      <header className="dash-header">
        {phone ? (
          <button type="button" className="btn btn-outline btn-icon btn-touch dash-menu" aria-label="Files menu" onClick={() => setSheetOpen(true)}>
            <MenuIcon aria-hidden="true" size={20} />
          </button>
        ) : null}
        <Link to="/drawings" className="logo-link dash-logo"><Logo /></Link>
        <div className="dash-status">
          <div role="status" aria-label="Trial" className={`chip ${trial.ended ? 'chip-alert' : ''}`}>{copy.trialLabel(trial.days_left)}</div>
          <button type="button" className="btn btn-outline" onClick={() => setDialog({ kind: 'pro' })}>Get Pro for $12/month</button>
        </div>
        <div className="dash-account">
          <span className="account-name">{me.user.name}</span>
          <button type="button" className="btn btn-primary" onClick={() => void signOut()}>
            <LogOut aria-hidden="true" size={16} />Sign out
          </button>
        </div>
      </header>

      <div className="dash-body">
        {phone ? null : <div className="dash-side">{nav}</div>}

        <main className="dash-main">
          <h1>{title}</h1>
          {view.kind === 'folder' && list.folder?.parent_id ? (
            <p className="folder-up"><Link to={`/drawings?folder=${encodeURIComponent(list.folder.parent_id)}`}>Up one level</Link></p>
          ) : view.kind === 'folder' && view.folderId !== 'root' && items === null ? (
            // Holds the line while the folder loads, so its "Up one level" does not push the toolbar down (layout shift).
            <p className="folder-up" aria-hidden="true">&nbsp;</p>
          ) : null}

          <div className="toolbar">
            <button type="button" className="btn btn-outline" onClick={list.reload}><RefreshCw aria-hidden="true" size={16} />Refresh</button>
            <button type="button" className="btn btn-outline" onClick={() => setDialog({ kind: 'support' })}><Settings2 aria-hidden="true" size={16} />Manage Support Files</button>
            <div className="search">
              <Search aria-hidden="true" size={16} />
              <input
                type="search"
                className="input"
                aria-label="Search this folder"
                placeholder="Search drawings"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div role="radiogroup" aria-label="View" className="view-switch">
              <label>
                <input type="radio" name="view-mode" className="sr-only" checked={mode === 'list'} onChange={() => setMode('list')} />
                <span className="view-option"><List aria-hidden="true" size={16} />List</span>
              </label>
              <label>
                <input type="radio" name="view-mode" className="sr-only" checked={mode === 'grid'} onChange={() => setMode('grid')} />
                <span className="view-option"><LayoutGrid aria-hidden="true" size={16} />Grid</span>
              </label>
            </div>
          </div>

          {uploads.length > 0 ? (
            <ul aria-label="Uploads" className="uploads">
              {uploads.map((row) => (
                <li key={row.id} className={`upload upload-${row.state}`}>
                  {row.state === 'pending' ? <span>{copy.uploading(row.name)}</span> : null}
                  {row.state === 'stored' ? <><span className="upload-name">{row.name}</span> <span className="upload-state">{COPY.uploadStored}</span></> : null}
                  {row.lines.map((line) => <span key={line} className={row.state === 'failed' ? 'field-error' : 'muted'}>{line}</span>)}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="files-area">
            {items === null ? <>{folderField}<LoadingStrokes /></> : null}
            {items !== null && (items.length > 0 || creatingFolder) ? (
              mode === 'list'
                ? <FileTable items={items} sort={sort} sortable={view.kind !== 'recent'} onSort={sortBy} newFolder={folderField} onMore={openRowMenu} openMenuId={menu?.item.id ?? null} />
                : <FileGrid items={items} newFolder={folderField} onMore={openRowMenu} openMenuId={menu?.item.id ?? null} />
            ) : null}
            {emptyCopy ? (
              <div className="empty-state">
                <EmptySketch />
                <p>{emptyCopy}</p>
              </div>
            ) : null}
          </div>
          <div role="status" aria-label="Files status" className="files-status">{itemsCount(items?.length ?? 0)}</div>
        </main>

        <aside aria-label="Welcome" className="dash-welcome">
          <h2>Welcome back, {firstName(me.user.name)}</h2>
          <ul>
            <li><a ref={referenceLink} href="#command-reference" onClick={(event) => { event.preventDefault(); setDialog({ kind: 'reference' }); }}>Command reference</a></li>
            <li><a ref={shortcutsLink} href="#keyboard-shortcuts" onClick={(event) => { event.preventDefault(); setDialog({ kind: 'shortcuts' }); }}>Keyboard shortcuts</a></li>
            <li><Link to="/drawings?view=samples">Sample files</Link></li>
          </ul>
        </aside>
      </div>

      {createPortal(
        <input ref={fileInput} type="file" accept=".dxf" multiple hidden onChange={(event) => void onFiles(event)} />,
        document.body,
      )}

      {menu ? (
        <Menu
          label={`Actions for ${menu.item.name}`}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          items={[
            ...(menu.item.kind === 'drawing' ? [{ label: 'Version history', onSelect: () => setDialog({ kind: 'versions', item: menu.item, anchor: menu.anchor }) }] : []),
            { label: 'Delete', onSelect: () => setDialog({ kind: 'delete', item: menu.item, anchor: menu.anchor }) },
          ]}
        />
      ) : null}

      {sheetOpen && phone ? (
        <Dialog label="Files menu" variant="sheet" onClose={() => setSheetOpen(false)}>
          {nav}
          <div className="dialog-actions">
            <button type="button" className="btn btn-outline btn-touch" onClick={() => setSheetOpen(false)}><X aria-hidden="true" size={16} />Close</button>
          </div>
        </Dialog>
      ) : null}

      {dialog?.kind === 'pro' ? <ProDialog onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'support' ? <SupportFilesDialog onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'reference' ? <CommandReferenceDialog onClose={() => setDialog(null)} returnFocus={() => referenceLink.current} /> : null}
      {dialog?.kind === 'shortcuts' ? <ShortcutsDialog onClose={() => setDialog(null)} returnFocus={() => shortcutsLink.current} /> : null}
      {dialog?.kind === 'delete' ? (
        <DeleteDialog item={dialog.item} onClose={() => setDialog(null)} onDeleted={() => { setDialog(null); list.reload(); }} returnFocus={anchorFocus(dialog.anchor)} />
      ) : null}
      {dialog?.kind === 'versions' ? (
        <VersionHistoryDialog drawing={dialog.item} onClose={() => setDialog(null)} onRestored={list.reload} returnFocus={anchorFocus(dialog.anchor)} />
      ) : null}
    </div>
  );
}
