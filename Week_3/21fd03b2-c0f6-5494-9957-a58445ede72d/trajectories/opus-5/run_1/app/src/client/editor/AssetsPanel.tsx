import { useRef, useState } from 'react';
import type { AssetRow, CheckpointRow } from '../../shared/api.js';
import { emptyCopy, fieldCopy, noticeCopy, uploadStatusCopy } from '../../shared/copy.js';
import {
  MODEL_UNITS,
  assetFolder,
  checkUploadName,
  formatExtent,
  type ModelUnit,
} from '../../shared/uploads.js';
import { ApiFault, api } from '../api.js';
import { announce } from '../regions.js';

export interface AssetsPanelProps {
  projectId: string;
  sceneId: string;
  assets: readonly AssetRow[];
  checkpoints: readonly CheckpointRow[];
  canEdit: boolean;
  onAssetsChanged: () => void;
  onCheckpointSaved: () => void;
  onRestoreRequest: (checkpoint: CheckpointRow) => void;
}

export function AssetsPanel(props: AssetsPanelProps): JSX.Element {
  const [tab, setTab] = useState<'Files' | 'Checkpoints'>('Files');
  const [folder, setFolder] = useState<'Models' | 'Images'>('Models');
  const [filter, setFilter] = useState('');
  const [unit, setUnit] = useState<ModelUnit>('m');
  const [listView, setListView] = useState(false);
  const [thumbSize, setThumbSize] = useState(96);
  const [naming, setNaming] = useState(false);
  const [label, setLabel] = useState('');
  const [labelError, setLabelError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);

  const upload = async (files: FileList | null): Promise<void> => {
    if (!files) return;
    for (const file of [...files]) {
      const nameFailure = checkUploadName(file.name);
      if (nameFailure) {
        announce('upload', nameFailure.message);
        continue;
      }
      announce('upload', uploadStatusCopy.pending(file.name));
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const response = await fetch(
          `/api/projects/${props.projectId}/assets?name=${encodeURIComponent(file.name)}&unit=${unit}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/octet-stream' },
            body: bytes,
            credentials: 'same-origin',
          },
        );
        const payload = (await response.json()) as
          | { asset: AssetRow }
          | { error: { code: string; message: string; fields?: Record<string, string> } };
        if (!response.ok) {
          const error = (payload as { error: { code: string; message: string; fields?: Record<string, string> } })
            .error;
          if (error.code === 'storage_unavailable')
            announce('upload', uploadStatusCopy.storageOutage);
          else if (error.fields)
            announce('upload', Object.values(error.fields)[0] ?? error.message);
          else announce('upload', error.message);
          continue;
        }
        const asset = (payload as { asset: AssetRow }).asset;
        const placed = assetFolder(asset.kind);
        setFolder(placed);
        if (response.status === 200) announce('upload', uploadStatusCopy.replay(asset.name));
        else announce('upload', uploadStatusCopy.success(asset.name, placed));
        props.onAssetsChanged();
      } catch {
        announce('upload', uploadStatusCopy.storageOutage);
      }
    }
  };

  const saveCheckpoint = async (): Promise<void> => {
    setLabelError(null);
    announce('notices', noticeCopy.checkpointPending);
    try {
      const response = await api<{ checkpoint: CheckpointRow }>(
        `/api/scenes/${props.sceneId}/checkpoints`,
        { method: 'POST', body: { label } },
      );
      announce('notices', noticeCopy.checkpointSaved(response.checkpoint.label));
      setNaming(false);
      setLabel('');
      props.onCheckpointSaved();
    } catch (error) {
      if (error instanceof ApiFault) {
        if (error.code === 'storage_unavailable') announce('notices', error.message);
        setLabelError(error.fields.label ?? fieldCopy.name);
      }
    }
  };

  const contents = props.assets
    .filter((asset) => assetFolder(asset.kind) === folder)
    .filter((asset) => asset.name.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <>
      <div role="tablist" aria-label="Asset views">
        {(['Files', 'Checkpoints'] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>

      {tab === 'Files' ? (
        <>
          <div className="sub-toolbar" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="chip"
              disabled={!props.canEdit}
              onClick={() => picker.current?.click()}
            >
              Upload
            </button>
            <input
              ref={picker}
              type="file"
              multiple
              className="visually-hidden"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(event) => void upload(event.target.files)}
            />
            <select
              aria-label="Model units"
              value={unit}
              onChange={(event) => setUnit(event.target.value as ModelUnit)}
              style={{ width: 70 }}
            >
              {MODEL_UNITS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <input
              type="search"
              aria-label="Filter assets"
              placeholder="Filter assets"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              style={{ flex: 1, minWidth: 80 }}
            />
          </div>
          <div
            className="assets-body"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void upload(event.dataTransfer.files);
            }}
          >
            <ul className="folders" role="tree" aria-label="Folders">
              {(['Models', 'Images'] as const).map((name) => (
                <li
                  key={name}
                  role="treeitem"
                  aria-selected={folder === name}
                  tabIndex={0}
                  onClick={() => setFolder(name)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') setFolder(name);
                  }}
                >
                  {name}
                </li>
              ))}
            </ul>
            <ul
              className={listView ? 'contents rows' : 'contents'}
              aria-label="Folder contents"
              style={listView ? undefined : { gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))` }}
            >
              {contents.map((asset) => (
                <li
                  key={asset.id}
                  draggable={asset.extentMetres !== null}
                  onDragStart={(event) =>
                    event.dataTransfer.setData('text/plain', `model:${asset.id}`)
                  }
                >
                  <span>{asset.name}</span>
                  {asset.extentMetres !== null ? (
                    <span className="muted num"> {formatExtent(asset.extentMetres)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
          {contents.length === 0 ? <p className="empty">{emptyCopy.assetFolder}</p> : null}
          <div className="panel-footer">
            <span>Assets / {folder}</span>
            <input
              type="range"
              aria-label="Thumbnail size"
              min={64}
              max={160}
              value={thumbSize}
              onChange={(event) => setThumbSize(Number(event.target.value))}
              style={{ width: 90 }}
            />
            <button
              type="button"
              className="chip"
              aria-pressed={listView}
              onClick={() => setListView((value) => !value)}
            >
              List view
            </button>
          </div>
        </>
      ) : (
        <div style={{ marginTop: 8 }}>
          {props.canEdit ? (
            <div className="sub-toolbar">
              <button type="button" className="chip" onClick={() => setNaming((value) => !value)}>
                New checkpoint
              </button>
              {naming ? (
                <>
                  <input
                    type="text"
                    aria-label="Checkpoint name"
                    value={label}
                    aria-invalid={labelError ? true : undefined}
                    onChange={(event) => setLabel(event.target.value)}
                    style={{ flex: 1, minWidth: 100 }}
                  />
                  <button type="button" className="chip on" onClick={() => void saveCheckpoint()}>
                    Save checkpoint
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
          {labelError ? <span className="field-error">{labelError}</span> : null}
          {props.checkpoints.length === 0 ? (
            <p className="empty">{emptyCopy.checkpoints}</p>
          ) : (
            <ul className="list">
              {props.checkpoints.map((checkpoint) => (
                <li key={checkpoint.id}>
                  <span style={{ flex: 1 }}>{checkpoint.label}</span>
                  <span className="muted num">rev {checkpoint.revision}</span>
                  {props.canEdit ? (
                    <button
                      type="button"
                      className="chip"
                      aria-label={`Restore ${checkpoint.label}`}
                      onClick={() => props.onRestoreRequest(checkpoint)}
                    >
                      Restore
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
