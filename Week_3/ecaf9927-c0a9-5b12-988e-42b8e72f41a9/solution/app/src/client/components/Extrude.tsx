import { useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { DIRECTIONS, OPERATIONS, type Direction, type Feature, type Operation, type Part, type Sketch } from '../../shared/api';
import { FieldProblem, parseLength } from '../../shared/lengths';
import { closedLoops, profileArea } from '../../shared/profile';
import { formatArea, formatCentroid, formatLengthPlain, formatMass, formatVolume, roundHalfAwayFromZero, unitScale } from '../../shared/units';
import { newKey } from '../api';
import { sketchBounds, toScreen, type View } from '../lib/geometry';
import { prefersReducedMotion } from '../lib/overlay';
import { previewFigures, type Preview } from '../lib/preview';
import { useWorkbench } from '../workbench';
import { Field, Segmented } from './Field';

const OPERATION_LABELS: Record<Operation, string> = { new: 'New body', join: 'Join', cut: 'Cut', intersect: 'Intersect' };
const DIRECTION_LABELS: Record<Direction, string> = { normal: 'Normal', reverse: 'Reverse', symmetric: 'Symmetric' };
const operationOptions = OPERATIONS.map((value) => ({ value, label: OPERATION_LABELS[value] }));
const directionOptions = DIRECTIONS.map((value) => ({ value, label: DIRECTION_LABELS[value] }));

const SETTLE_MS = 380;
const OVERSHOOT_PX = 5;

/** The depth typed so far in millimetres, or undefined while it is not a valid length. */
function typedDepth(text: string, unit: 'mm' | 'in'): number | undefined {
  try {
    return parseLength(text, unit);
  } catch (error) {
    if (error instanceof FieldProblem) return undefined;
    throw error;
  }
}

/** The preview while an extrude form is open, or null. */
export function usePreview(part: Part, sketch: Sketch | null, unit: 'mm' | 'in'): Preview | null {
  const { extrude } = useWorkbench();
  return useMemo(() => {
    if (!extrude || !sketch) return null;
    const depthMm = typedDepth(extrude.depth, unit);
    const loops = closedLoops(sketch.entities, sketch.constraints);
    if (depthMm === undefined || !loops) return null;
    const committed = part.features.find((f) => f.id === extrude.featureId)?.depth_mm ?? 0;
    if (extrude.featureId && depthMm === committed) return null;
    return previewFigures({
      confirmed: part.confirmed,
      densityGPerCm3: part.material.density_g_cm3,
      profileAreaMm2: profileArea(loops),
      depthMm,
      committedDepthMm: committed,
      operation: extrude.operation,
    });
  }, [extrude, sketch, part, unit]);
}

const dash = '—';

export function Measurements({ part, preview }: { part: Part; preview: Preview | null }) {
  const { member } = useWorkbench();
  const unit = member?.units ?? 'mm';
  const precision = member?.precision ?? 2;
  const confirmed = part.confirmed;
  if (!preview && !confirmed) {
    return (
      <div role="status" aria-label="Measurements" className="measurements">
        <p className="muted">No stored body yet</p>
      </div>
    );
  }
  const figures = preview
    ? {
        volume: preview.volume === undefined ? dash : formatVolume(preview.volume, unit, precision),
        area: dash,
        centroid: dash,
        mass: preview.mass === undefined ? dash : formatMass(preview.mass),
      }
    : {
        volume: formatVolume((confirmed as NonNullable<typeof confirmed>).volume_mm3, unit, precision),
        area: formatArea((confirmed as NonNullable<typeof confirmed>).area_mm2, unit, precision),
        centroid: formatCentroid((confirmed as NonNullable<typeof confirmed>).centroid_mm, unit, precision),
        mass: formatMass((confirmed as NonNullable<typeof confirmed>).mass_g),
      };
  return (
    <div role="status" aria-label="Measurements" className="measurements">
      <h3 className="section-title">{preview ? 'Preview' : 'Confirmed'}</h3>
      <dl>
        <dt>Volume</dt>
        <dd className="num">{figures.volume}</dd>
        <dt>Surface area</dt>
        <dd className="num">{figures.area}</dd>
        <dt>Centroid</dt>
        <dd className="num">{figures.centroid}</dd>
        <dt>Mass</dt>
        <dd className="num">{figures.mass}</dd>
      </dl>
    </div>
  );
}

/** The form for a new extrude (sketch mode) or an existing one (opened from the feature tree). */
export function ExtrudeForm({ part, feature }: { part: Part; feature?: Feature }) {
  const wb = useWorkbench();
  const { extrude, saving } = wb;
  const key = useRef<string | null>(null);
  const depthField = useRef<HTMLInputElement>(null);
  const busy = saving[part.id] === true;
  const editing = feature !== undefined;

  useEffect(() => {
    depthField.current?.focus();
    depthField.current?.select();
  }, []);

  if (!extrude) return null;
  const errors = extrude.fieldErrors;

  const commit = async () => {
    if (busy) return;
    if (editing) {
      const outcome = await wb.applyDepth(feature, extrude.depth, extrude.direction);
      wb.updateExtrude({ fieldErrors: outcome.fields ?? {} });
      return;
    }
    key.current ??= newKey();
    const outcome = await wb.confirmExtrude(key.current);
    if (outcome.ok || outcome.failure) key.current = null;
    if (outcome.fields) wb.updateExtrude({ fieldErrors: outcome.fields });
    if (outcome.ok) wb.focusCanvas();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      wb.closeExtrude();
      if (!editing) wb.focusCanvas();
    }
  };

  return (
    <form
      aria-label={editing ? `Edit ${feature.name}` : 'Extrude'}
      className="extrude-form"
      onKeyDown={onKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        void commit();
      }}
    >
      <Field
        inputRef={depthField}
        label="Depth"
        type="text"
        numeric
        inputMode="decimal"
        autoComplete="off"
        value={extrude.depth}
        error={errors['depth']}
        onChange={(event) => wb.updateExtrude({ depth: event.target.value, fieldErrors: {} })}
      />
      {!editing && (
        <Segmented label="Operation" name="operation" value={extrude.operation} options={operationOptions} onChange={(operation) => wb.updateExtrude({ operation })} />
      )}
      {errors['operation'] && <p className="field-error">{errors['operation']}</p>}
      <Segmented label="Direction" name="direction" value={extrude.direction} options={directionOptions} onChange={(direction) => wb.updateExtrude({ direction })} />
      {errors['direction'] && <p className="field-error">{errors['direction']}</p>}
      <div className="button-row">
        <button type="submit" className="primary" disabled={busy}>
          {editing ? 'Apply depth' : busy ? 'Extruding…' : 'Confirm extrude'}
        </button>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              wb.closeExtrude();
              wb.focusCanvas();
            }}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

interface SliderProps {
  feature?: Feature;
  camera?: View;
  sketch: Sketch | null;
}

/** The depth handle beside the profile: drag it or step it with the arrow keys; it settles with a short spring. */
export function DepthSlider({ feature, camera, sketch }: SliderProps) {
  const wb = useWorkbench();
  const { extrude } = wb;
  const unit = wb.member?.units ?? 'mm';
  const precision = wb.member?.precision ?? 2;
  const handle = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ max: number } | null>(null);
  const depthMm = extrude ? (typedDepth(extrude.depth, unit) ?? 0) : 0;
  const stepMm = unit === 'in' ? unitScale('in', 1) * 0.05 : 1;
  const max = drag.current?.max ?? Math.max(100, Math.ceil((depthMm * 1.5) / 50) * 50);
  const fraction = Math.min(1, depthMm / max);
  if (!extrude) return null;

  const write = (mm: number) => {
    const clamped = Math.min(10000, Math.max(stepMm / 10, mm));
    wb.updateExtrude({ depth: String(Number(roundHalfAwayFromZero(clamped / unitScale(unit, 1), Math.max(precision, 3)))), fieldErrors: {} });
  };

  const settle = (from: number, to: number) => {
    if (prefersReducedMotion() || !handle.current) return;
    const delta = from - to;
    const overshoot = -Math.sign(delta || 1) * OVERSHOOT_PX;
    handle.current.animate(
      [{ transform: `translateY(${delta}px)` }, { transform: `translateY(${overshoot}px)`, offset: 0.55 }, { transform: 'translateY(0)' }],
      { duration: SETTLE_MS, easing: 'cubic-bezier(.2,.9,.2,1)' },
    );
  };

  const commitIfEditing = () => {
    if (feature) void wb.applyDepth(feature, (wb.extrude as NonNullable<typeof wb.extrude>).depth, (wb.extrude as NonNullable<typeof wb.extrude>).direction);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const amount = stepMm * (event.shiftKey ? 10 : 1);
    const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowDown' || event.key === 'ArrowLeft' ? -1 : 0;
    if (direction !== 0) {
      event.preventDefault();
      const height = track.current?.getBoundingClientRect().height ?? 160;
      write(depthMm + direction * amount);
      settle(-direction * (amount / max) * height, 0);
    } else if (event.key === 'Enter' && feature) {
      event.preventDefault();
      commitIfEditing();
    }
  };

  const depthFromPointer = (event: ReactPointerEvent<HTMLDivElement>, limit: number) => {
    const box = track.current?.getBoundingClientRect();
    if (!box) return depthMm;
    return Math.max(0, Math.min(1, (box.bottom - event.clientY) / box.height)) * limit;
  };

  const place = (() => {
    if (camera && sketch) {
      const { max: top } = sketchBounds(sketch);
      const edge = toScreen(camera, { x: top.x, y: top.y });
      return { left: Math.min(window.innerWidth - 400, edge.x + 56), top: Math.max(90, Math.min(window.innerHeight - 300, edge.y - 60)) };
    }
    return { left: Math.max(24, window.innerWidth >= 1100 ? 330 : 270), top: Math.max(120, window.innerHeight / 2 - 100) };
  })();

  return (
    <div className="depth-slider" style={place}>
      <div ref={track} className="depth-track" aria-hidden="true">
        <div className="depth-fill" style={{ height: `${fraction * 100}%` }} />
      </div>
      <div
        ref={handle}
        role="slider"
        tabIndex={0}
        aria-label="Extrude depth"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={depthMm}
        aria-valuetext={formatLengthPlain(depthMm, unit, precision) + ' ' + unit}
        className="depth-handle"
        style={{ bottom: `calc(${fraction * 100}% - 11px)` }}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { max };
        }}
        onPointerMove={(event) => {
          if (drag.current) write(depthFromPointer(event, drag.current.max));
        }}
        onPointerUp={(event) => {
          if (!drag.current) return;
          const limit = drag.current.max;
          const target = depthFromPointer(event, limit);
          drag.current = null;
          write(target);
          settle(-OVERSHOOT_PX * 2, 0);
          commitIfEditing();
        }}
      />
      <span className="depth-label num">{formatLengthPlain(depthMm, unit, precision)} {unit}</span>
    </div>
  );
}
