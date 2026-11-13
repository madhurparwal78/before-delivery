import { useEffect, useRef, useState } from 'react';
import type { BodyMesh, Part } from '../../shared/api';
import { get } from '../api';
import { fastenerMesh, drawSolids, type Placed, type Region } from '../lib/solid';
import { useViewportSize } from '../lib/useMedia';
import { useWorkbench } from '../workbench';

const NO_BODY_COPY = 'No stored body yet';
const BODY_UNAVAILABLE_COPY = 'Body view unavailable while storage is unreachable.';

type Loaded = { state: 'ready'; mesh: BodyMesh } | { state: 'unavailable' };

const cache = new Map<string, BodyMesh>();

/** Reads a part's confirmed body through the server; remembered by build so a redraw only happens when the body changes. */
async function loadBody(part: Pick<Part, 'id' | 'confirmed'>): Promise<Loaded> {
  const build = part.confirmed?.build ?? 0;
  const key = `${part.id}@${build}`;
  const known = cache.get(key);
  if (known) return { state: 'ready', mesh: known };
  const result = await get<BodyMesh>(`/api/parts/${part.id}/body`).catch(() => undefined);
  if (!result?.ok) return { state: 'unavailable' };
  cache.set(key, result.data);
  return { state: 'ready', mesh: result.data };
}

/** The part of the viewport the floating panels leave free. */
export function freeRegion(width: number, height: number): Region {
  if (width < 768) return { x: 12, y: 96, width: width - 24, height: height - 180 };
  const left = width >= 1100 ? 300 : 252;
  const right = width >= 1100 ? 372 : 312;
  return { x: left, y: 72, width: width - left - right, height: height - 72 - 96 };
}

const palette = () => {
  const style = getComputedStyle(document.documentElement);
  return { light: style.getPropertyValue('--body-light').trim(), dark: style.getPropertyValue('--body-dark').trim(), ink: style.getPropertyValue('--ink').trim() };
};

function paint(canvas: HTMLCanvasElement, width: number, height: number, bodies: Placed[], labels: string[]): void {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx || bodies.length === 0) return;
  // On standard-density screens the bodies are drawn at twice the size and scaled down, which smooths their edges.
  const supersample = ratio >= 2 ? 1 : 2;
  const scratch = document.createElement('canvas');
  scratch.width = canvas.width * supersample;
  scratch.height = canvas.height * supersample;
  const scratchContext = scratch.getContext('2d', { willReadFrequently: true });
  if (!scratchContext) return;
  const { slots } = drawSolids(scratchContext, bodies, freeRegion(width, height), palette(), ratio * supersample);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(scratch, 0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(ratio, ratio);
  ctx.font = '500 13px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = palette().ink;
  labels.forEach((label, i) => {
    const slot = slots[i];
    if (slot && label) ctx.fillText(label, slot.x + slot.width / 2, slot.baseline + 22);
  });
  ctx.restore();
}

/** The Part view: a still, fixed three-quarter view of the open part's stored body. */
export function PartView({ part }: { part: Part }) {
  const wb = useWorkbench();
  const { width, height } = useViewportSize();
  const ref = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState<Loaded | 'none'>(part.confirmed ? { state: 'unavailable' } : 'none');
  const build = part.confirmed?.build ?? 0;

  useEffect(() => {
    let current = true;
    if (!part.confirmed) {
      setLoaded('none');
      return;
    }
    void loadBody(part).then((result) => current && setLoaded(result));
    return () => {
      current = false;
    };
  }, [part.id, build, wb.storage]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    paint(canvas, width, height, loaded !== 'none' && loaded.state === 'ready' ? [{ mesh: loaded.mesh, shiftX: 0 }] : [], []);
  }, [loaded, width, height]);

  const message = loaded === 'none' ? NO_BODY_COPY : loaded.state === 'unavailable' ? BODY_UNAVAILABLE_COPY : null;
  return (
    <>
      <canvas ref={ref} role="img" aria-label={`Part view: ${part.name}`} className="body-canvas" style={{ width, height }} />
      {message && <p className="canvas-note">{message}</p>}
    </>
  );
}

/** Bodies run left to right in tree order, wrapping to further rows when the free canvas is narrow. */
function layoutRows(found: { mesh: BodyMesh; label: string }[], width: number, height: number): { bodies: Placed[]; labels: string[] } {
  const free = freeRegion(width, height).width;
  const rowCount = Math.min(found.length, free < 460 ? 3 : free < 900 ? 2 : 1);
  const perRow = Math.ceil(found.length / Math.max(1, rowCount));
  const depth = Math.max(0, ...found.flatMap((f) => f.mesh.vertices.map((v) => v[1]))) + 40;
  const bodies: Placed[] = [];
  let cursor = 0;
  found.forEach(({ mesh }, i) => {
    if (i % perRow === 0) cursor = 0;
    const xs = mesh.vertices.map((v) => v[0]);
    const low = Math.min(...xs);
    bodies.push({ mesh, shiftX: cursor - low, shiftY: -Math.floor(i / perRow) * depth });
    cursor += Math.max(...xs) - low + 30;
  });
  return { bodies, labels: found.map((f) => f.label) };
}

/** The Assembly view: every instance's stored body drawn once, left to right in tree order, each labelled with its quantity. */
export function AssemblyView() {
  const wb = useWorkbench();
  const { assembly, parts } = wb;
  const { width, height } = useViewportSize();
  const ref = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState<{ bodies: Placed[]; labels: string[] } | 'unavailable' | null>(null);
  const rows = assembly?.rows;
  const signature = JSON.stringify([rows?.map((r) => [r.component.id, r.quantity]), parts.map((p) => `${p.id}@${p.confirmed?.build ?? 0}`)]);

  useEffect(() => {
    let current = true;
    if (!rows) return;
    void (async () => {
      const found: { mesh: BodyMesh; label: string }[] = [];
      const place = (mesh: BodyMesh, label: string) => found.push({ mesh, label });
      const walk = async (list: typeof rows, parentQuantity: number): Promise<boolean> => {
        for (const row of list) {
          if (row.component.type === 'part') {
            const part = parts.find((p) => p.id === row.component.id);
            if (!part?.confirmed) continue;
            const loadedBody = await loadBody(part);
            if (loadedBody.state === 'unavailable') return false;
            place(loadedBody.mesh, `×${row.quantity * parentQuantity}`);
          } else if (row.component.type === 'purchased') {
            place(fastenerMesh(row.component.id), `×${row.quantity * parentQuantity}`);
          } else if (row.children && !(await walk(row.children, row.quantity * parentQuantity))) {
            return false;
          }
        }
        return true;
      };
      const ok = await walk(rows, 1);
      if (current) setDrawn(ok ? { ...layoutRows(found, window.innerWidth, window.innerHeight) } : 'unavailable');
    })();
    return () => {
      current = false;
    };
  }, [signature, wb.storage]);

  useEffect(() => {
    const canvas = ref.current;
    if (canvas && drawn && drawn !== 'unavailable') paint(canvas, width, height, drawn.bodies, drawn.labels);
  }, [drawn, width, height]);

  const name = assembly?.assembly.name ?? '';
  return (
    <>
      <canvas ref={ref} role="img" aria-label={`Assembly view: ${name}`} className="body-canvas" style={{ width, height }} />
      {drawn === 'unavailable' && <p className="canvas-note">{BODY_UNAVAILABLE_COPY}</p>}
    </>
  );
}
