import { useMemo, useRef, useState } from 'react';
import { NO_DRAWINGS_YET, VERSION_STATE_LABEL } from '../../shared/copy.ts';
import type { DrawingListing, FolderSummary, VersionDocument } from '../../shared/types.ts';
import { sendJson } from '../api.ts';
import { navigate } from '../history.ts';
import { Link } from '../router.tsx';
import { Button, EmptyFrame, Frame, Notice } from '../ui/index.ts';
import { NameDialog } from './NameDialog.tsx';
import { SheetThumbnail } from './SheetThumbnail.tsx';
import { useJson } from './useJson.ts';

interface FolderNode { folder: FolderSummary; depth: number }

/** Folders in reading order: each folder followed by its subfolders. A folder whose parent the caller cannot see is a top folder. */
function folderOutline(folders: readonly FolderSummary[]): FolderNode[] {
  const known = new Set(folders.map((folder) => folder.id));
  const outline: FolderNode[] = [];
  const visit = (parentId: string | null, depth: number): void => {
    const children = folders.filter((folder) => (parentId === null ? folder.parent_id === null || !known.has(folder.parent_id) : folder.parent_id === parentId));
    for (const folder of children) {
      outline.push({ folder, depth });
      visit(folder.id, depth + 1);
    }
  };
  visit(null, 0);
  return outline;
}

/** The static skeleton of a folder's drawing rows while they load: one dimmed frame where the contact-sheet run will be. */
function RowsSkeleton() {
  return (
    <div className="drawing-row" aria-hidden="true">
      <span className="drawing-name" />
      <div className="run"><div className="run-item"><EmptyFrame dimmed /></div></div>
    </div>
  );
}

function VersionFrame({ id, sheetName, number, state }: { id: string; sheetName: string; number: number; state: keyof typeof VERSION_STATE_LABEL }) {
  const version = useJson<VersionDocument>(`/api/versions/${id}`);
  return (
    <li className="run-item">
      <Link to={`/versions/${id}`} className="version-link">
        <Frame
          caption={
            <>
              <span className="version-label">{`${sheetName} v${number}`}</span>
              <span className="version-state">{VERSION_STATE_LABEL[state]}</span>
            </>
          }
        >
          {version.status === 'ready' ? <SheetThumbnail version={version.data} /> : <div className="thumb thumb--pending" />}
        </Frame>
      </Link>
    </li>
  );
}

function DrawingRow({ drawing }: { drawing: DrawingListing }) {
  const versions = drawing.sheets.flatMap((sheet) => sheet.versions.map((version) => ({ ...version, sheetName: sheet.name })));
  return (
    <li className="drawing-row">
      <Link to={`/drawings/${drawing.id}`} className="drawing-name">{drawing.name}</Link>
      <ul className="run">
        {versions.length === 0 ? <li className="run-item"><EmptyFrame /></li> : null}
        {versions.map((version) => (
          <VersionFrame key={version.id} id={version.id} sheetName={version.sheetName} number={version.number} state={version.state} />
        ))}
      </ul>
    </li>
  );
}

function FolderSection({ node }: { node: FolderNode }) {
  const { folder, depth } = node;
  const listing = useJson<{ drawings: DrawingListing[] }>(`/api/folders/${folder.id}/drawings`);
  const [creating, setCreating] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);

  async function createDrawing(name: string): Promise<void> {
    const created = await sendJson<{ id: string }>('POST', `/api/folders/${folder.id}/drawings`, { name });
    navigate(`/drawings/${created.id}`);
  }

  return (
    <section className="folder" style={{ marginLeft: depth * 16 }} aria-labelledby={`folder-${folder.id}`}>
      <h2 id={`folder-${folder.id}`} className="folder-name">{folder.name}</h2>
      {listing.status === 'loading' ? <RowsSkeleton /> : null}
      {listing.status === 'failed' ? <Notice tone="error">{listing.failure.message}</Notice> : null}
      {listing.status === 'ready' && listing.data.drawings.length === 0 ? (
        <div className="folder-empty">
          <EmptyFrame />
          <p>{NO_DRAWINGS_YET}</p>
        </div>
      ) : null}
      {listing.status === 'ready' && listing.data.drawings.length > 0 ? (
        <ul className="drawing-rows">
          {listing.data.drawings.map((drawing) => <DrawingRow key={drawing.id} drawing={drawing} />)}
        </ul>
      ) : null}
      <Button ref={opener} onClick={() => setCreating(true)}>New drawing</Button>
      {creating ? (
        <NameDialog
          title="New drawing"
          fieldLabel="Drawing name"
          submitLabel="Create drawing"
          opener={opener}
          onSubmit={createDrawing}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </section>
  );
}

export function FoldersPage() {
  const [foldersCreated, setFoldersCreated] = useState(0);
  const loaded = useJson<{ folders: FolderSummary[] }>('/api/folders', foldersCreated);
  const [creating, setCreating] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);

  const outline = useMemo(
    () => (loaded.status === 'ready' ? folderOutline(loaded.data.folders) : []),
    [loaded],
  );

  async function createFolder(name: string): Promise<void> {
    await sendJson('POST', '/api/folders', { name, parent_id: null });
    setFoldersCreated((count) => count + 1);
    setCreating(false);
  }

  return (
    <main className="folders">
      <h1 className="folders-name">Folders</h1>
      <div className="folders-actions">
        <Button ref={opener} onClick={() => setCreating(true)}>New folder</Button>
      </div>
      {loaded.status === 'loading' ? <section className="folder"><RowsSkeleton /></section> : null}
      {loaded.status === 'failed' ? <Notice tone="error">{loaded.failure.message}</Notice> : null}
      {outline.map((node) => <FolderSection key={node.folder.id} node={node} />)}
      {creating ? (
        <NameDialog
          title="New folder"
          fieldLabel="Folder name"
          submitLabel="Create folder"
          opener={opener}
          onSubmit={createFolder}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </main>
  );
}
