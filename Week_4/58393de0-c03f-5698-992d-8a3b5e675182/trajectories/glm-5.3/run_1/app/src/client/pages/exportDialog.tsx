import type { VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { exportFileName } from '../../shared/exportName.js';
import { say } from '../status.js';
import { M } from '../copy.js';
import type { ProjectKind } from '../../shared/types.js';

export interface ExportDialogProps {
  projectName: string;
  kind: ProjectKind;
  snapshot: unknown;
  projectId: string | null;
  readOnly: boolean;
  opener: HTMLElement | null;
  onClose: () => void;
  onExported: () => void;
  hiddenStateRef: { current: { format: string; unit: string } };
}

export function ExportDialog(props: ExportDialogProps): VNode {
  const isCircuit = props.kind === 'circuit';
  const [format, setFormat] = useState<'stl' | 'obj' | 'svg'>(isCircuit ? 'svg' : 'stl');
  const [unit, setUnit] = useState<'mm' | 'in'>(isCircuit ? 'mm' : 'mm');
  const [bbox, setBbox] = useState<{ x: number; y: number; z: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Compute the design's bbox for the size line: derive from the snapshot
  // objects when available (3D and Block Lab), otherwise the circuit line.
  useEffect(() => {
    const snap = props.snapshot as { objects?: Array<{ x: number; y: number; z: number; w: number; d: number; h: number }> } | null;
    if (isCircuit || !snap?.objects || snap.objects.length === 0) { setBbox(null); return; }
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const o of snap.objects) {
      minX = Math.min(minX, o.x - o.w / 2); maxX = Math.max(maxX, o.x + o.w / 2);
      minY = Math.min(minY, o.y - o.d / 2); maxY = Math.max(maxY, o.y + o.d / 2);
      minZ = Math.min(minZ, o.z - o.h / 2); maxZ = Math.max(maxZ, o.z + o.h / 2);
    }
    const scale = 1;
    setBbox({ x: (maxX - minX) * scale, y: (maxY - minY) * scale, z: (maxZ - minZ) * scale });
  }, [props.snapshot, format, unit]);

  const hasSolids = (() => {
    const snap = props.snapshot as { objects?: Array<{ mode?: string }> } | null;
    if (isCircuit) {
      const c = props.snapshot as { components?: unknown[] } | null;
      return (c?.components?.length ?? 0) > 0;
    }
    return (snap?.objects ?? []).some((o) => o.mode !== 'hole');
  })();

  const toInches = (mm: number) => mm / 25.4;
  const sizeLine = isCircuit
    ? M.exportCircuitSize
    : bbox
      ? M.exportSize(
          unit === 'mm' ? round1(bbox.x) : round2(toInches(bbox.x)),
          unit === 'mm' ? round1(bbox.y) : round2(toInches(bbox.y)),
          unit === 'mm' ? round1(bbox.z) : round2(toInches(bbox.z)),
          unit,
        )
      : 'Size: —';

  useEffect(() => {
    // Focus trap
    const node = ref.current;
    if (!node) return;
    const focusables = () => Array.from(node.querySelectorAll<HTMLElement>('button:not([disabled]), input, [tabindex]:not([tabindex="-1"])'));
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'Tab') {
        const list = focusables();
        if (list.length === 0) return;
        const first = list[0]!, last = list[list.length - 1]!;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    node.addEventListener('keydown', onKey);
    return () => {
      node.removeEventListener('keydown', onKey);
      props.opener?.focus();
    };
  }, []);

  const close = () => props.onClose();

  const download = async () => {
    if (!hasSolids) { setError(isCircuit ? M.nothingToExportCircuit : M.nothingToExport3d); return; }
    setBusy(true);
    setError(null);
    const fileName = exportFileName(props.projectName, format);
    try {
      let bytes: ArrayBuffer;
      let triangleCount: number;
      if (isCircuit) {
        const svg = buildCircuitSvg(props.snapshot as { components: Array<{ label?: string; type?: string }> });
        bytes = new TextEncoder().encode(svg).buffer;
        triangleCount = 0;
      } else {
        const result = await runExportWorker(format, unit, props.snapshot);
        if (!result) { setError(M.meshNotClosed); setBusy(false); return; }
        bytes = result.bytes;
        triangleCount = result.triangleCount;
      }

      // Store, then download.
      const query = new URLSearchParams({ format, unit, name: fileName });
      if (props.projectId) query.set('projectId', props.projectId);
      const upload = await fetch(`/api/exports?${query.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(bytes),
      });
      if (!upload.ok) {
        const err = await upload.json().catch(() => ({ error: 'unknown', message: 'Not found.' }));
        if (err.error === 'storage_unavailable') { setError(M.exportStorageFailed); say(M.exportStorageFailed); }
        else if (err.error === 'email_unverified') { setError(M.unverifiedExport); say(M.unverifiedExport); }
        else if (err.error === 'mesh_not_closed') { setError(M.meshNotClosed); say(M.meshNotClosed); }
        else { setError(err.message || M.notFound); say(err.message || M.notFound); }
        setBusy(false);
        return;
      }
      const exportRow = await upload.json() as { id: string; downloadUrl: string };
      // Download the stored copy.
      const res = await fetch(exportRow.downloadUrl);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
      }
      say(M.exported(fileName, unit === 'mm' ? 'millimetres' : 'inches'));
      say(M.exportStored);
      // Keep #qy-export state for the editor page.
      props.hiddenStateRef.current = { format, unit };
      setHiddenState(props.hiddenStateRef, format, unit, triangleCount, bytes.byteLength);
      setBusy(false);
      props.onExported();
      close();
    } catch {
      setError(M.meshNotClosed);
      setBusy(false);
    }
  };

  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-label="Export" ref={ref}>
      <div class="dialog">
        <h2>Export</h2>
        <fieldset class="field" style="border:none;padding:0">
          <legend style="font-weight:600;margin-bottom:8px">Format</legend>
          <div class="radio-row" role="radiogroup" aria-label="Format">
            {(['stl', 'obj', 'svg'] as const).map((f) => (
              <label key={f} style={{ opacity: isCircuit && f !== 'svg' ? 0.5 : 1 }}>
                <input
                  type="radio"
                  name="exp-format"
                  value={f}
                  checked={format === f}
                  disabled={isCircuit && f !== 'svg'}
                  onChange={() => setFormat(f)}
                />
                {f.toUpperCase()}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset class="field" style="border:none;padding:0">
          <legend style="font-weight:600;margin-bottom:8px">Unit</legend>
          <div class="radio-row" role="radiogroup" aria-label="Unit">
            <label style={{ opacity: isCircuit ? 0.5 : 1 }}>
              <input type="radio" name="exp-unit" value="mm" checked={unit === 'mm'} disabled={isCircuit} onChange={() => setUnit('mm')} />
              Millimetres
            </label>
            <label style={{ opacity: isCircuit ? 0.5 : 1 }}>
              <input type="radio" name="exp-unit" value="in" checked={unit === 'in'} disabled={isCircuit} onChange={() => setUnit('in')} />
              Inches
            </label>
          </div>
        </fieldset>
        <p style="font-weight:600" aria-live="polite">{sizeLine}</p>
        {error && <p class="err" role="alert">{error}</p>}
        <div class="row">
          <button class="pill ghost" onClick={close}>Cancel</button>
          <button class="pill" onClick={() => void download()} disabled={busy || !hasSolids}>Download</button>
        </div>
      </div>
    </div>
  );
}

function round1(n: number): number { return Math.round(n * 10) / 10; }
function round2(n: number): number { return Math.round(n * 100) / 100; }

function setHiddenState(ref: { current: { format: string; unit: string } }, format: string, unit: string, triangleCount: number, bytes: number): void {
  const el = document.getElementById('qy-export');
  if (!el) return;
  el.dataset.state = 'done';
  el.dataset.format = format;
  el.dataset.unit = unit;
  el.dataset.triangleCount = format === 'svg' ? '' : String(triangleCount);
  el.dataset.bytes = String(bytes);
  void ref;
}

function runExportWorker(format: 'stl' | 'obj' | 'svg', unit: 'mm' | 'in', snapshot: unknown): Promise<{ bytes: ArrayBuffer; triangleCount: number; bbox: { x: number; y: number; z: number } } | null> {
  return new Promise((resolve) => {
    const worker = new Worker('/assets/exportWorker.js');
    const snap = snapshot as { objects?: unknown[] };
    worker.onmessage = (ev: MessageEvent) => {
      const data = ev.data as { type: 'done'; bytes: ArrayBuffer; triangleCount: number; bbox: { x: number; y: number; z: number } } | { type: 'error'; message: string };
      worker.terminate();
      if (data.type === 'done') resolve({ bytes: data.bytes, triangleCount: data.triangleCount, bbox: data.bbox });
      else resolve(null);
    };
    worker.onerror = () => { worker.terminate(); resolve(null); };
    worker.postMessage({ type: 'export', format, unit, objects: snap?.objects ?? [], projectName: '' });
  });
}

function buildCircuitSvg(snapshot: { components?: Array<{ label?: string; type?: string }> }): string {
  const comps = snapshot.components ?? [];
  const boxes = comps.map((c, i) => {
    const x = 40 + (i % 3) * 90;
    const y = 60 + Math.floor(i / 3) * 70;
    const fill = c.type === 'battery' ? '#ffecb3' : c.type === 'led' ? '#c8f7c5' : c.type === 'switch' ? '#cfe4ff' : '#f3e5f5';
    return `<rect x="${x}" y="${y}" width="70" height="40" rx="8" fill="${fill}" stroke="#333"/><text x="${x + 35}" y="${y + 25}" text-anchor="middle" font-family="sans-serif" font-size="12">${c.label ?? ''}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210">${boxes}</svg>`;
}
