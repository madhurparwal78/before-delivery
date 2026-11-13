import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Placement, Room } from '../shared/types.js';
import { hasWebGL } from './stage-math.js';
import { COPY } from '../shared/copy.js';

/** Dialog with focus trap, wrap-around Tab and Escape close (all dialogs). */
export function Dialog(props: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  variant?: 'center' | 'side' | 'small';
  scrimCenter?: boolean;
  firstFocusRef?: React.RefObject<HTMLElement>;
  ariaClass?: string;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const { onClose, label, children, variant = 'center' } = props;

  useEffect(() => {
    opener.current = document.activeElement;
    const node = ref.current;
    if (!node) return;
    const focusables = () => Array.from(
      node.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
    // Opening moves focus to the first control (the picker passes a specific one).
    const initial = props.firstFocusRef?.current;
    (initial ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.key === 'Tab') {
        const items = focusables();
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || !node.contains(document.activeElement))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !node.contains(document.activeElement))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    const close = (): void => {
      const el = opener.current as HTMLElement | null;
      onClose();
      requestAnimationFrame(() => el?.focus?.());
    };
    node.addEventListener('keydown', onKey);
    return () => {
      node.removeEventListener('keydown', onKey);
    };
  }, [onClose, label]);

  return (
    <div className={`scrim${props.scrimCenter === false ? '' : ' center'}`} data-nocenter={undefined}>
      <div
        ref={ref}
        role="dialog"
        aria-label={label}
        className={`sheet dialog-open ${variant === 'side' ? 'side' : ''} ${variant === 'small' ? 'small' : ''}`}
      >
        {children}
      </div>
    </div>
  );
}

/** The stage: WebGL canvas or the flat floor plan (DP-11). */
export function StageRegion(props: {
  room: Room;
  placements: Placement[];
  selectedId: string | null;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  onPointerDown: (e: React.PointerEvent) => void;
  hiddenIds?: Set<string>;
  markers?: Array<{ label: string; x: number; z: number }>;
  camAttrs?: Record<string, string>;
}): JSX.Element {
  const webgl = hasWebGL();
  const planRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (webgl) return;
    const c = planRef.current;
    if (!c) return;
    drawFloorPlan(c, props.room, props.placements);
  }, [webgl, props.room, props.placements]);

  return (
    <div className="stage-region" role="region" aria-label="Room stage" tabIndex={0} {...(props.camAttrs ?? {})}
      onPointerDown={props.onPointerDown}>
      {webgl ? (
        <canvas ref={props.canvasRef} style={{ width: '100%', height: '100%', touchAction: 'none' }} />
      ) : (
        <>
          <div className="floorplan-notice">{COPY.noWebGL}</div>
          <canvas ref={planRef} style={{ width: '100%', height: '100%' }} />
        </>
      )}
    </div>
  );
}

export function drawFloorPlan(canvas: HTMLCanvasElement, room: Room, placements: Placement[]): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0b0e14';
  ctx.fillRect(0, 0, w, h);
  const pad = 60;
  const s = Math.min((w - pad * 2) / room.widthMm, (h - pad * 2) / room.depthMm);
  const ox = (w - room.widthMm * s) / 2;
  const oy = (h - room.depthMm * s) / 2;
  ctx.strokeStyle = '#3a4560';
  ctx.lineWidth = 2;
  ctx.strokeRect(ox, oy, room.widthMm * s, room.depthMm * s);
  ctx.font = '11px Inter, sans-serif';
  for (const p of placements) {
    const x = ox + p.xMm * s;
    const z = oy + p.zMm * s;
    ctx.strokeStyle = p.kind === 'cylinder' ? '#7db4f0' : '#8b95a8';
    if (p.kind === 'cylinder') {
      ctx.beginPath();
      ctx.ellipse(x + (p.widthMm * s) / 2, z + (p.depthMm * s) / 2, (p.widthMm * s) / 2, (p.depthMm * s) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.strokeRect(x, z, p.widthMm * s, p.depthMm * s);
    }
    ctx.fillStyle = '#8b95a8';
    ctx.fillText(p.label, x + 2, z - 4);
    if (p.kind === 'door' && p.entry) {
      ctx.fillStyle = '#ff6b45';
      ctx.fillText('entry', x + 2, z + 12);
    }
  }
}

/** Lucide icon inline. */
export function Icon(props: { name: string; size?: number }): JSX.Element {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/icons/${props.name}.svg`).then((r) => (r.ok ? r.text() : null)).then((t) => {
      if (live) setSrc(t);
    });
    return () => { live = false; };
  }, [props.name]);
  const size = props.size ?? 16;
  if (!src) return <span style={{ display: 'inline-block', width: size, height: size }} aria-hidden="true" />;
  const scaled = src.replace('<svg ', `<svg width="${size}" height="${size}" `);
  return <span style={{ display: 'inline-flex', width: size, height: size }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: scaled }} />;
}

