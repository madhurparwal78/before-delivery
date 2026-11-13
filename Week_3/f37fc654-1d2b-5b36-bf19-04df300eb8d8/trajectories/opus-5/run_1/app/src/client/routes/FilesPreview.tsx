import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiFailure, api } from '../lib/api.js';
import { useAppEvent, useStageScene } from '../lib/app-context.js';
import { useReducedMotion } from '../lib/typing.js';
import { CueLine } from '../components/ui.js';
import type { CommissionShape, FileShape, RenderShape } from '../lib/shapes.js';
import * as copy from '../../shared/copy.js';
import { UPLOAD_KIND_LABELS, type UploadKind } from '../../shared/seed.js';

const UPLOAD_CONTROLS: { kind: UploadKind; label: string; accept: string }[] = [
  { kind: 'brief_pdf', label: 'Upload brief PDF', accept: '.pdf,application/pdf' },
  { kind: 'venue_photo', label: 'Upload venue photo', accept: 'image/png,image/jpeg' },
  { kind: 'installation_glb', label: 'Upload GLB model', accept: '.glb,model/gltf-binary' },
];

export function Files(): JSX.Element {
  const { commissionId = '' } = useParams();
  const reducedMotion = useReducedMotion();
  const [files, setFiles] = useState<FileShape[]>([]);
  const [status, setStatus] = useState('');
  const inputs = useRef(new Map<UploadKind, HTMLInputElement | null>());
  useStageScene({ scene: 'working' });

  const load = useCallback(() => {
    void api
      .get<{ files: FileShape[] }>(`/api/commissions/${commissionId}/files`)
      .then((result) => setFiles(result.files))
      .catch(() => undefined);
  }, [commissionId]);
  useEffect(load, [load]);

  const upload = async (kind: UploadKind, file: File): Promise<void> => {
    const shownName = file.name.split(/[/\\]/).pop() ?? file.name;
    setStatus(copy.uploadPending(shownName));
    const form = new FormData();
    form.append('kind', kind);
    form.append('file', file, file.name);
    try {
      const stored = await api.upload<FileShape>(
        `/api/commissions/${commissionId}/files`,
        form,
      );
      // A file reads as Stored only once the file store has confirmed it.
      setStatus(copy.uploadStored(stored.fileName, stored.sizeBytes, stored.sha256));
      load();
    } catch (error) {
      if (error instanceof ApiFailure) {
        setStatus(
          error.publicMessage ??
            Object.values(error.fieldErrors)[0] ??
            copy.OUTAGE_BANNERS.minio,
        );
      }
    }
  };

  return (
    <main className="column wide">
      <h1>Files</h1>
      <div className="inline">
        {UPLOAD_CONTROLS.map((control) => (
          <span key={control.kind}>
            <input
              type="file"
              accept={control.accept}
              className="visually-hidden"
              ref={(element) => inputs.current.set(control.kind, element)}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(control.kind, file);
                event.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => inputs.current.get(control.kind)?.click()}
            >
              {control.label}
            </button>
          </span>
        ))}
      </div>

      <div role="status" aria-label="Upload status" aria-live="polite" className="muted">
        {status}
      </div>

      {files.length === 0 ? (
        <CueLine text={copy.EMPTY_STATES.files} reducedMotion={reducedMotion} level={2} />
      ) : (
        <ul className="list" aria-label="Files">
          {files.map((file) => (
            <li className="row" key={file.id}>
              <div className="spread">
                <strong>{file.fileName}</strong>
                <span className="badge">Stored</span>
              </div>
              <p className="muted">
                {UPLOAD_KIND_LABELS[file.kind as UploadKind]} · {file.sizeBytes} bytes
              </p>
              <p className="muted numeral" style={{ wordBreak: 'break-all' }}>
                {file.sha256}
              </p>
            </li>
          ))}
        </ul>
      )}
      <Link to={`/c/${commissionId}/preview`}>Get a concept preview</Link>
    </main>
  );
}

export function Preview(): JSX.Element {
  const { commissionId = '' } = useParams();
  const [commission, setCommission] = useState<CommissionShape | null>(null);
  const [photos, setPhotos] = useState<FileShape[]>([]);
  const [chosen, setChosen] = useState('');
  const [reference, setReference] = useState('');
  const [render, setRender] = useState<RenderShape | null>(null);
  const [status, setStatus] = useState('');
  const [requesting, setRequesting] = useState(false);

  useStageScene({
    scene: 'working',
    silhouette: commission?.installationType ?? 'none',
    roomWidthM: commission?.room.widthM ?? null,
    roomDepthM: commission?.room.depthM ?? null,
  });

  useEffect(() => {
    void api
      .get<CommissionShape>(`/api/commissions/${commissionId}`)
      .then(setCommission)
      .catch(() => undefined);
    void api
      .get<{ files: FileShape[] }>(`/api/commissions/${commissionId}/files`)
      .then((result) => {
        const venuePhotos = result.files.filter((file) => file.kind === 'venue_photo');
        setPhotos(venuePhotos);
        setChosen((current) => current || (venuePhotos[0]?.id ?? ''));
      })
      .catch(() => undefined);
  }, [commissionId]);

  // Progress and completion are announced as the render moves on.
  useAppEvent('render.updated', (data) => {
    if (data['renderId'] !== render?.id) return;
    const state = String(data['state']);
    const progress = Number(data['progress'] ?? 0);
    setRender((current) =>
      current ? { ...current, state: state as RenderShape['state'], progress } : current,
    );
    if (state === 'ready') setStatus(copy.PREVIEW_READY);
    else if (state === 'failed') setStatus(copy.PREVIEW_FAILED);
    else if (progress > 0) setStatus(copy.previewProgress(progress));
  });

  const requestPreview = async (): Promise<void> => {
    setRequesting(true);
    setStatus(copy.PREVIEW_QUEUED);
    try {
      const created = await api.post<RenderShape>(
        `/api/commissions/${commissionId}/renders`,
        {
          venuePhotoFileId: chosen,
          ...(reference.trim() === '' ? {} : { referenceImageUrl: reference.trim() }),
        },
      );
      setRender(created);
    } catch (error) {
      if (error instanceof ApiFailure) {
        setStatus(
          Object.values(error.fieldErrors)[0] ??
            error.publicMessage ??
            copy.PREVIEW_FAILED,
        );
      }
    } finally {
      setRequesting(false);
    }
  };

  const progress = render?.progress ?? 0;

  return (
    <main className="column">
      <h1>Concept preview</h1>

      <div role="radiogroup" aria-label="Venue photo" className="list">
        {photos.map((photo) => (
          <button
            key={photo.id}
            type="button"
            role="radio"
            aria-checked={chosen === photo.id}
            className="chip"
            onClick={() => setChosen(photo.id)}
          >
            <span className="box" aria-hidden="true">
              {chosen === photo.id ? '✓' : ''}
            </span>
            <span className="label">{photo.fileName}</span>
          </button>
        ))}
        {photos.length === 0 ? (
          <p className="muted">
            <Link to={`/c/${commissionId}/files`}>Add a venue photo first.</Link>
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="field-referenceImageUrl">Reference image address (optional)</label>
        <input
          id="field-referenceImageUrl"
          className="answer-field"
          aria-label="Reference image address (optional)"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
        />
      </div>

      <button
        type="button"
        className="primary"
        disabled={chosen === '' || requesting}
        onClick={() => void requestPreview()}
      >
        Request preview
      </button>

      <div
        role="progressbar"
        aria-label="Preview progress"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        className="progress-track"
      >
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div role="status" aria-label="Preview status" aria-live="polite" className="muted">
        {status}
      </div>

      {render?.state === 'ready' ? (
        <>
          <img
            className="preview-image"
            src={`/api/renders/${render.id}/preview`}
            alt="Concept preview"
          />
          <Link to={`/c/${commissionId}/configure`}>Configure the room</Link>
        </>
      ) : null}
    </main>
  );
}
