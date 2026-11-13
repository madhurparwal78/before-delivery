import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileItem, MeResponse } from '../../shared/api';
import { copy } from '../../shared/copy';
import { itemCount } from '../../shared/format';
import { ApiFailure, errorCopy, openEventStream, request, uploadFile } from '../api';
import {
  Announcements,
  announce,
  AppLink,
  Dialog,
  EmptyState,
  isPhone,
  LoadingStrokes,
  navigate,
  useOutsideClose,
  useStorageOutage,
  useViewport,
  Wordmark,
} from '../shell';

type SortKey = 'type' | 'name' | 'modified' | 'size' | 'owner' | 'shared';

const COLUMNS: Array<{ key: SortKey; label: string; optional?: boolean }> = [
  { key: 'type', label: 'File Type', optional: true },
  { key: 'name', label: 'Name' },
  { key: 'modified', label: 'Date Modified' },
  { key: 'size', label: 'Size', optional: true },
  { key: 'owner', label: 'Owner', optional: true },
  { key: 'shared', label: 'Shared', optional: true },
];

const DEFAULT_DESCENDING: Record<SortKey, boolean> = {
  type: false,
  name: false,
  modified: true,
  size: false,
  owner: false,
  shared: false,
};

interface FolderPayload {
  folder: { id: string; name: string; parent_id: string | null };
  items: FileItem[];
}

function ProDialog(props: { email: string; onClose: () => void }): JSX.Element {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const send = async (): Promise<void> => {
    setPending(true);
    try {
      const result = await request<{ quote: { sent_to: string } }>('POST', '/api/quotes', {});
      const text = copy.pro.sent(result.quote.sent_to);
      setMessage(text);
      announce(text);
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        const text = errorCopy(failure, 'quote');
        setMessage(text);
        announce(text);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog title="Corbel Draft Pro" onClose={props.onClose}>
      <p>{copy.pro.dialogBody}</p>
      {message !== null ? <p role="alert">{message}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="btn" disabled={pending} onClick={() => void send()}>
          {pending ? copy.pro.pending : 'Email me a quote'}
        </button>
        <button type="button" className="btn btn-outline" onClick={props.onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

function SupportFilesDialog(props: { onClose: () => void }): JSX.Element {
  const [data, setData] = useState<Record<string, string[]> | null>(null);
  useEffect(() => {
    void request<Record<string, string[]>>('GET', '/api/support-files').then(setData);
  }, []);
  return (
    <Dialog title="Support files" onClose={props.onClose}>
      {data === null ? (
        <LoadingStrokes />
      ) : (
        <>
          {Object.entries(data).map(([group, values]) => (
            <section key={group}>
              <h3>{group.replace(/_/g, ' ')}</h3>
              <ul className="list-plain">
                {values.map((value) => (
                  <li key={value}>{value}</li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn btn-outline" onClick={props.onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

function VersionHistoryDialog(props: {
  drawing: FileItem;
  timeZone: string;
  onClose: () => void;
  onRestored: () => void;
}): JSX.Element {
  const [versions, setVersions] = useState<
    Array<{ number: number; created_at: string; actor: string; size_bytes: number }> | null
  >(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void request<{ versions: Array<{ number: number; created_at: string; actor: string; size_bytes: number }> }>(
      'GET',
      `/api/drawings/${props.drawing.id}/file-versions`,
    ).then((result) => setVersions(result.versions));
  }, [props.drawing.id]);

  useEffect(load, [load]);

  const restore = async (number: number): Promise<void> => {
    setBusy(true);
    try {
      const drawing = await request<{ version: number }>('GET', `/api/drawings/${props.drawing.id}`);
      const result = await request<{ file_version: number }>(
        'POST',
        `/api/drawings/${props.drawing.id}/file-versions/${number}/restore`,
        { base_version: drawing.version },
      );
      const text = copy.files.restored(number, result.file_version);
      announce(text);
      load();
      props.onRestored();
    } catch (failure) {
      if (failure instanceof ApiFailure) announce(errorCopy(failure, 'upload'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={`Version history — ${props.drawing.name}`} onClose={props.onClose}>
      {versions === null ? <LoadingStrokes /> : null}
      {versions !== null && versions.length === 0 ? <p>{copy.files.versionsEmpty}</p> : null}
      {versions !== null && versions.length > 0 ? (
        <ul className="list-plain" aria-label="Versions">
          {versions.map((version) => (
            <li key={version.number}>
              <span>
                {copy.files.versionItem(
                  version.number,
                  new Date(version.created_at),
                  props.timeZone,
                  version.actor,
                  version.size_bytes,
                )}
              </span>
              <button
                type="button"
                className="btn btn-outline btn-small"
                disabled={busy}
                onClick={() => void restore(version.number)}
              >
                {`Restore version ${version.number}`}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-outline" onClick={props.onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

function RowMenu(props: {
  item: FileItem;
  onClose: () => void;
  onDelete: () => void;
  onHistory: () => void;
}): JSX.Element {
  const ref = useOutsideClose(props.onClose);
  return (
    <div className="menu" role="menu" ref={ref} aria-label={`Actions for ${props.item.name}`}>
      {props.item.kind === 'drawing' ? (
        <button type="button" role="menuitem" onClick={props.onHistory}>
          Version history
        </button>
      ) : null}
      <button type="button" role="menuitem" onClick={props.onDelete}>
        Delete
      </button>
    </div>
  );
}

export function DashboardPage(props: { me: MeResponse; view: string | null; folder: string | null }): JSX.Element {
  const [me, setMe] = useState<MeResponse>(props.me);
  const viewport = useViewport();
  const phone = isPhone(viewport.width);
  const storageDown = useStorageOutage();
  const folderId = props.folder ?? 'root';
  const [sort, setSort] = useState<SortKey>('modified');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [listView, setListView] = useState<'List' | 'Grid'>('List');
  const [payload, setPayload] = useState<FolderPayload | null>(null);
  const [recent, setRecent] = useState<FileItem[] | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [folderPending, setFolderPending] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<FileItem | null>(null);
  const [history, setHistory] = useState<FileItem | null>(null);
  const [showPro, setShowPro] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  const [showFilesMenu, setShowFilesMenu] = useState(false);
  const [uploads, setUploads] = useState<Array<{ name: string; state: string }>>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (props.view === 'recent') {
      void request<{ items: FileItem[] }>('GET', '/api/recent').then((result) => setRecent(result.items));
      return;
    }
    setRecent(null);
  }, [props.view, nonce]);

  useEffect(() => {
    if (props.view === 'recent') return;
    const target = props.view === 'samples' ? 'samples' : folderId;
    const params = new URLSearchParams({ sort, order });
    if (debounced.trim() !== '') params.set('q', debounced.trim());
    void request<FolderPayload>('GET', `/api/folders/${target}?${params.toString()}`)
      .then(setPayload)
      .catch(() => setPayload(null));
  }, [folderId, sort, order, debounced, nonce, props.view]);

  useEffect(() => {
    return openEventStream('/api/events', {
      files: () => reload(),
      recent: () => reload(),
      trial: () => {
        void request<MeResponse>('GET', '/api/me').then(setMe);
        reload();
      },
    });
  }, [reload]);

  const items = props.view === 'recent' ? (recent ?? []) : (payload?.items ?? []);

  const headerSort = (key: SortKey): void => {
    if (sort === key) setOrder(order === 'asc' ? 'desc' : 'asc');
    else {
      setSort(key);
      setOrder(DEFAULT_DESCENDING[key] ? 'desc' : 'asc');
    }
  };

  const createFolder = async (name: string): Promise<void> => {
    setFolderPending(true);
    setFolderError(null);
    try {
      await request('POST', '/api/folders', { parent_id: folderId, name });
      setNewFolder(null);
      reload();
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        setFolderError(failure.field('name') ?? errorCopy(failure));
      }
    } finally {
      setFolderPending(false);
    }
  };

  const doDelete = async (item: FileItem): Promise<void> => {
    try {
      if (item.kind === 'folder') await request('DELETE', `/api/folders/${item.id}`);
      else await request('DELETE', `/api/drawings/${item.id}`);
      announce(copy.files.deleted(item.name));
      setDeleting(null);
      reload();
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        const text =
          failure.code === 'folder_not_empty' ? copy.files.folderNotEmpty(item.name) : errorCopy(failure);
        announce(text);
        setDeleting(null);
      }
    }
  };

  const doUpload = async (file: File): Promise<void> => {
    setUploads((current) => [...current, { name: file.name, state: copy.files.uploadPending(file.name) }]);
    try {
      const result = await uploadFile<{
        drawing: { name: string };
        file_version: number;
        imported: number;
        skipped: number;
      }>(`/api/folders/${folderId}/uploads`, file);
      setUploads((current) =>
        current.map((entry) =>
          entry.name === file.name ? { ...entry, state: copy.files.uploadStored } : entry,
        ),
      );
      if (result.file_version > 1) {
        announce(copy.files.sameNameUpload(result.drawing.name, result.file_version));
      } else {
        announce(copy.files.importSummary(result.imported, result.skipped));
      }
      reload();
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        const text =
          failure.code === 'file_too_large'
            ? copy.files.tooLarge(file.name, Number(failure.extra.limit_bytes ?? 0))
            : failure.field('file') ?? errorCopy(failure, 'upload');
        setUploads((current) => current.map((entry) => (entry.name === file.name ? { ...entry, state: text } : entry)));
        announce(text);
      }
    }
  };

  const title = props.view === 'recent' ? 'Recent' : props.view === 'samples' ? 'Sample Files' : (payload?.folder.name ?? 'My Drawings');

  const filesNav = (
    <nav aria-label="Files" className="sidebar-nav">
      <button
        type="button"
        className="btn btn-quiet"
        onClick={() => {
          void request<{ drawing: { id: string } }>('POST', '/api/drawings', { folder_id: folderId }).then(
            (result) => navigate(`/d/${result.drawing.id}`),
          );
        }}
      >
        New Drawing
      </button>
      <button type="button" className="btn btn-quiet" onClick={() => fileInput.current?.click()}>
        Upload...
      </button>
      <button
        type="button"
        className="btn btn-quiet"
        onClick={() => {
          setNewFolder('New folder');
          setFolderError(null);
        }}
      >
        New Folder
      </button>
      <AppLink to="/drawings?view=recent">Recent</AppLink>
      <AppLink to="/drawings?view=samples">Sample Files</AppLink>
      <AppLink to="/drawings">My Drawings</AppLink>
    </nav>
  );

  return (
    <div className="app-shell">
      <Announcements />
      <header className="app-header">
        <AppLink to="/drawings" aria-label="Corbel Works">
          <Wordmark compact />
        </AppLink>
        <span className="spacer" />
        <span className="chip" role="status" aria-label="Trial">
          {copy.trial.status(me.trial.days_left, me.trial.ended)}
        </span>
        <button type="button" className="btn btn-small" onClick={() => setShowPro(true)}>
          Get Pro for $12/month
        </button>
        <span>{me.user.name}</span>
        <button
          type="button"
          className="btn btn-outline btn-small"
          onClick={() => {
            void request('POST', '/api/auth/signout', {}).then(() => navigate('/signin'));
          }}
        >
          Sign out
        </button>
      </header>

      {me.trial.ended ? <div className="banner">{copy.trial.endedBanner}</div> : null}
      {storageDown ? (
        <div className="banner" role="status" aria-label="Service status">
          {copy.outage.minio}
        </div>
      ) : null}

      <div className="dashboard-body">
        {phone ? null : <div className="panel dashboard-sidebar">{filesNav}</div>}

        <div>
          <h1>{title}</h1>
          <div className="toolbar">
            {phone ? (
              <button type="button" className="btn btn-quiet" onClick={() => setShowFilesMenu(true)}>
                Files menu
              </button>
            ) : null}
            <button type="button" className="btn btn-quiet" onClick={reload}>
              Refresh
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setShowSupport(true)}>
              Manage Support Files
            </button>
            <input
              type="search"
              aria-label="Search this folder"
              placeholder="Search this folder"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div role="radiogroup" aria-label="View" style={{ display: 'flex', gap: '0.3rem' }}>
              {(['List', 'Grid'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={listView === mode}
                  className="btn btn-quiet btn-small"
                  tabIndex={listView === mode ? 0 : -1}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                      event.preventDefault();
                      setListView('Grid');
                    }
                    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                      event.preventDefault();
                      setListView('List');
                    }
                  }}
                  onClick={() => setListView(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
            <span className="chip" role="status" aria-label="Files status">
              {itemCount(items.length)}
            </span>
          </div>

          <input
            ref={fileInput}
            type="file"
            accept=".dxf"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) void doUpload(file);
              event.target.value = '';
            }}
          />

          {uploads.length > 0 ? (
            <ul className="list-plain" aria-label="Uploads">
              {uploads.map((entry) => (
                <li key={entry.name}>{entry.state}</li>
              ))}
            </ul>
          ) : null}

          {listView === 'List' ? (
            <table className="files-table" aria-label="Files">
              <thead>
                <tr>
                  {COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      className={column.optional === true ? 'optional-column' : undefined}
                      aria-sort={sort === column.key ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
                    >
                      <button type="button" onClick={() => headerSort(column.key)}>
                        {column.label}
                      </button>
                    </th>
                  ))}
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {newFolder !== null ? (
                  <tr>
                    <td className="optional-column">Folder</td>
                    <td>
                      <input
                        aria-label="Folder name"
                        autoFocus
                        disabled={folderPending}
                        defaultValue={newFolder}
                        onFocus={(event) => event.target.select()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void createFolder(event.currentTarget.value);
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            setNewFolder(null);
                          }
                        }}
                        onBlur={(event) => {
                          if (folderPending) return;
                          void createFolder(event.target.value);
                        }}
                      />
                      {folderError !== null ? (
                        <div className="field-error" role="alert">
                          {folderError}
                        </div>
                      ) : null}
                    </td>
                    <td colSpan={5} />
                  </tr>
                ) : null}
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="optional-column">{item.kind === 'folder' ? 'Folder' : 'DXF Drawing'}</td>
                    <td>
                      <AppLink
                        to={item.kind === 'folder' ? `/drawings?folder=${item.id}` : `/d/${item.id}`}
                      >
                        {item.name}
                      </AppLink>
                    </td>
                    <td>{item.modified_label}</td>
                    <td className="optional-column">{item.size_label}</td>
                    <td className="optional-column">{item.owner}</td>
                    <td className="optional-column">{item.shared}</td>
                    <td style={{ position: 'relative' }}>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn btn-quiet btn-small"
                          aria-label={`More actions for ${item.name}`}
                          onClick={() => setOpenMenu(openMenu === item.id ? null : item.id)}
                        >
                          ⋯
                        </button>
                        {openMenu === item.id ? (
                          <RowMenu
                            item={item}
                            onClose={() => setOpenMenu(null)}
                            onDelete={() => {
                              setOpenMenu(null);
                              setDeleting(item);
                            }}
                            onHistory={() => {
                              setOpenMenu(null);
                              setHistory(item);
                            }}
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <ul className="cards" aria-label="Files">
              {items.map((item) => (
                <li className="card" key={item.id}>
                  <AppLink to={item.kind === 'folder' ? `/drawings?folder=${item.id}` : `/d/${item.id}`}>
                    {item.name}
                  </AppLink>
                  <span>{item.modified_label}</span>
                  <span>{item.size_label}</span>
                  <button
                    type="button"
                    className="btn btn-quiet btn-small"
                    aria-label={`More actions for ${item.name}`}
                    onClick={() => setDeleting(item)}
                  >
                    ⋯
                  </button>
                </li>
              ))}
            </ul>
          )}

          {items.length === 0 && newFolder === null ? (
            <EmptyState
              line={debounced.trim() === '' ? copy.files.emptyFolder : copy.files.noSearchMatch(debounced.trim())}
            />
          ) : null}
        </div>

        <aside className="panel dashboard-welcome" aria-label="Welcome">
          <h2>{`Welcome back, ${me.user.name.split(' ')[0] ?? me.user.name}`}</h2>
          <div className="sidebar-nav">
            <AppLink to="/drawings?view=samples">Command reference</AppLink>
            <AppLink to="/drawings?view=samples">Keyboard shortcuts</AppLink>
            <AppLink to="/drawings?view=samples">Sample files</AppLink>
          </div>
        </aside>
      </div>

      {showPro ? <ProDialog email={me.user.email} onClose={() => setShowPro(false)} /> : null}
      {showSupport ? <SupportFilesDialog onClose={() => setShowSupport(false)} /> : null}
      {history !== null ? (
        <VersionHistoryDialog
          drawing={history}
          timeZone={me.user.time_zone}
          onClose={() => setHistory(null)}
          onRestored={reload}
        />
      ) : null}
      {deleting !== null ? (
        <Dialog title={`Delete ${deleting.name}?`} role="alertdialog" onClose={() => setDeleting(null)}>
          <p>{copy.files.deleteDialogBody}</p>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => void doDelete(deleting)}>
              Delete
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setDeleting(null)}>
              Cancel
            </button>
          </div>
        </Dialog>
      ) : null}
      {showFilesMenu ? (
        <Dialog title="Files menu" sheet onClose={() => setShowFilesMenu(false)}>
          {filesNav}
          <div className="dialog-actions">
            <button type="button" className="btn btn-outline" onClick={() => setShowFilesMenu(false)}>
              Close
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
