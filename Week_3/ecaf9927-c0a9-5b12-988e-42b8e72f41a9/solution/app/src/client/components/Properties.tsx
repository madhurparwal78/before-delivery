import { Fragment, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ConstraintKind, Entity, Part, Sketch, TreeRow } from '../../shared/api';
import { isDimension, refsFit } from '../../shared/constraint-rules';
import { FieldProblem, parseAngle, parseLength } from '../../shared/lengths';
import { editableLength, formatDensity, formatDimension, formatMass } from '../../shared/units';
import { entityById, suggestedLine } from '../lib/geometry';
import { useWorkbench, type Tool } from '../workbench';
import { Field } from './Field';
import { ExtrudeForm, Measurements, usePreview } from './Extrude';

const massCell = (grams: number | null): string => (grams === null ? '—' : formatMass(grams));

function QuantityInput({ row }: { row: TreeRow }) {
  const wb = useWorkbench();
  const [text, setText] = useState(String(row.quantity));
  useEffect(() => setText(String(row.quantity)), [row.quantity]);
  const commit = () => {
    const value = Number(text);
    if (Number.isInteger(value) && value >= 1 && value <= 999 && value !== row.quantity) void wb.setQuantity(row.instance_id, value);
    else setText(String(row.quantity));
  };
  return (
    <input
      type="number"
      className="num qty"
      min={1}
      max={999}
      aria-label={`Quantity of ${row.component.name}`}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
}

function TreeRows({ rows, depth }: { rows: TreeRow[]; depth: number }) {
  const wb = useWorkbench();
  const founder = wb.member?.role === 'founder';
  return (
    <>
      {rows.map((row) => {
        const open = wb.expanded.has(row.instance_id);
        const isAssembly = row.component.type === 'assembly';
        return (
          <Fragment key={row.instance_id}>
            <tr>
              <td className="item" style={{ paddingLeft: 4 + depth * 12 }}>
                <div className="item-line">
                  {isAssembly && (
                    <button
                      type="button"
                      className="icon-button small"
                      aria-label={`${open ? 'Collapse' : 'Expand'} ${row.component.name}`}
                      aria-expanded={open}
                      onClick={() => wb.toggleExpanded(row.instance_id)}
                    >
                      <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                        <path d={open ? 'M2 4l4 4 4-4' : 'M4 2l4 4-4 4'} fill="none" stroke="currentColor" strokeWidth="1.5" />
                      </svg>
                    </button>
                  )}
                  <span className="name">{row.component.name}</span>
                  {row.body_status === 'not_stored' && <span className="chip not-stored">Not stored</span>}
                </div>
              </td>
              <td className="num">
                {founder && depth === 0 ? (
                  <div className="qty-line">
                    <QuantityInput row={row} />
                    <button type="button" className="icon-button small remove" aria-label={`Remove ${row.component.name}`} onClick={() => void wb.removeInstance(row.instance_id)}>
                      <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                        <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  row.quantity
                )}
              </td>
              <td className="num">{massCell(row.unit_mass_g)}</td>
              <td className="num">{massCell(row.subtotal_mass_g)}</td>
              <td className="num">{row.pieces}</td>
            </tr>
            {isAssembly && open && row.children && <TreeRows rows={row.children} depth={depth + 1} />}
          </Fragment>
        );
      })}
    </>
  );
}

function AssemblyPanel() {
  const wb = useWorkbench();
  const data = wb.assembly;
  if (!data) return null;
  const { assembly, rows } = data;
  return (
    <>
      <h2 className="panel-title">{assembly.name}</h2>
      <div className="table-scroll">
        <table aria-label="Assembly tree" className="tree-table">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Qty</th>
              <th scope="col">Unit mass</th>
              <th scope="col">Subtotal</th>
              <th scope="col">Pieces</th>
            </tr>
          </thead>
          <tbody>
            <TreeRows rows={rows} depth={0} />
          </tbody>
        </table>
      </div>
      <section aria-label="Assembly totals" className="totals">
        <p>
          <span>Total mass</span> <span className="num">{formatMass(assembly.rollup.mass_g)}</span>
        </p>
        <p>
          <span>Pieces</span> <span className="num">{assembly.rollup.part_count}</span>
        </p>
        <p>
          <span>Lines</span> <span className="num">{assembly.rollup.line_count}</span>
        </p>
      </section>
      {wb.member?.role === 'founder' && (
        <button type="button" onClick={() => wb.setDialog('add')}>
          Add to assembly
        </button>
      )}
    </>
  );
}

function SaveStatus({ part }: { part: Part }) {
  const { saving } = useWorkbench();
  const text = saving[part.id] ? 'Saving…' : ({ stored: 'Stored', not_stored: 'Not stored', saving: 'Saving…', none: 'No body yet' } as const)[part.body.status];
  return (
    <div role="status" aria-label="Save status" className="save-status">
      {text}
    </div>
  );
}

/** The material choice keeps the member's pick on screen while the save is on its way. */
function MaterialSelect({ part }: { part: Part }) {
  const wb = useWorkbench();
  const [picked, setPicked] = useState(part.material.id);
  useEffect(() => setPicked(part.material.id), [part.material.id]);
  return (
    <div className="field">
      <label htmlFor="material">Material</label>
      <select
        id="material"
        value={picked}
        onChange={(event) => {
          setPicked(event.target.value);
          void wb.setMaterial(event.target.value);
        }}
      >
        {wb.materials.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} · {formatDensity(m.density_g_cm3)}
          </option>
        ))}
      </select>
    </div>
  );
}

function PartPanel({ part }: { part: Part }) {
  const wb = useWorkbench();
  const founder = wb.member?.role === 'founder';
  const view = wb.view;
  const feature = view?.kind === 'part' ? part.features.find((f) => f.id === view.extrudeId) : undefined;
  const preview = usePreview(part, wb.sketch, wb.member?.units ?? 'mm');

  useEffect(() => {
    if (feature) void wb.beginEdit(feature);
    else wb.closeExtrude();
  }, [feature?.id]);

  return (
    <>
      <h2 className="panel-title">{part.name}</h2>
      <SaveStatus part={part} />
      {founder ? (
        <MaterialSelect part={part} />
      ) : (
        <p className="material-line">
          <span className="muted">Material</span> {part.material.name} · <span className="num">{formatDensity(part.material.density_g_cm3)}</span>
        </p>
      )}
      {feature && wb.extrude && <ExtrudeForm part={part} feature={feature} />}
      <Measurements part={part} preview={preview} />
      <div className="button-row">
        <button type="button" onClick={() => void wb.savePart()}>
          Save part
        </button>
        {founder && (
          <button type="button" onClick={() => wb.setDialog('sketch')}>
            New sketch
          </button>
        )}
      </div>
    </>
  );
}

/* ---------------------------- sketch mode ---------------------------- */

const CONSTRAIN_BUTTONS: { label: string; kind: ConstraintKind | 'dimension' }[] = [
  { label: 'Coincident', kind: 'coincident' },
  { label: 'Horizontal', kind: 'horizontal' },
  { label: 'Vertical', kind: 'vertical' },
  { label: 'Parallel', kind: 'parallel' },
  { label: 'Perpendicular', kind: 'perpendicular' },
  { label: 'Equal', kind: 'equal' },
  { label: 'Fix', kind: 'fix' },
  { label: 'Dimension', kind: 'dimension' },
  { label: 'Horizontal distance', kind: 'horizontal_distance' },
  { label: 'Vertical distance', kind: 'vertical_distance' },
]

/** What a Dimension on the current selection means: one line or two points give a Distance, a circle a Diameter, an arc a Radius. */
function dimensionKind(sketch: Sketch, selection: readonly string[]): ConstraintKind | undefined {
  const [first] = selection;
  const entity = first ? entityById(sketch, first) : undefined;
  if (selection.length === 1 && entity?.type === 'line') return 'distance';
  if (selection.length === 1 && entity?.type === 'circle') return 'diameter';
  if (selection.length === 1 && entity?.type === 'arc') return 'radius';
  return selection.length === 2 && refsFit('distance', selection, sketch.entities) ? 'distance' : undefined;
}

/** Applies a constraint (or opens the dimension fields) for the current selection; the buttons and the shortcut keys share it. */
export function useConstrainSelection() {
  const wb = useWorkbench();
  const sketch = wb.sketch;
  const resolve = (kind: ConstraintKind | 'dimension'): ConstraintKind | undefined => {
    if (!sketch) return undefined;
    const resolved = kind === 'dimension' ? dimensionKind(sketch, wb.selection) : kind;
    return resolved && refsFit(resolved, wb.selection, sketch.entities) ? resolved : undefined;
  };
  const apply = async (kind: ConstraintKind | 'dimension') => {
    const resolved = resolve(kind);
    if (!resolved) return;
    if (isDimension(resolved)) {
      wb.openDimension(resolved, wb.selection);
      return;
    }
    await wb.constrain(resolved, wb.selection);
    wb.focusCanvas();
  };
  return { resolve, apply };
}

function ConstrainGroup() {
  const { resolve, apply } = useConstrainSelection();
  return (
    <div role="group" aria-label="Constrain selection" className="constrain">
      {CONSTRAIN_BUTTONS.map((b) => (
        <button key={b.label} type="button" disabled={!resolve(b.kind)} onClick={() => void apply(b.kind)}>
          {b.label}
        </button>
      ))}
    </div>
  );
}

function DimensionFields() {
  const wb = useWorkbench();
  const draft = wb.dimension;
  const value = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  useEffect(() => {
    value.current?.focus();
    value.current?.select();
  }, [draft?.kind, draft?.editing?.id]);
  if (!draft) return null;

  const submit = async () => {
    if (busy.current) return;
    busy.current = true;
    const outcome = draft.editing
      ? await wb.editConstraint(draft.editing, draft.value, draft.tolerance)
      : await wb.constrain(draft.kind, draft.refs, draft.value, draft.tolerance);
    busy.current = false;
    if (outcome.fields) {
      wb.updateDimension({ fieldErrors: outcome.fields });
      return;
    }
    wb.closeDimension();
    wb.focusCanvas();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      wb.closeDimension();
      wb.focusCanvas();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div className="dimension" onKeyDown={onKeyDown}>
      <Field
        label="Dimension value"
        inputRef={value}
        numeric
        autoComplete="off"
        value={draft.value}
        error={draft.fieldErrors['value']}
        onChange={(event) => wb.updateDimension({ value: event.target.value, fieldErrors: {} })}
      />
      <Field
        label="Tolerance"
        numeric
        autoComplete="off"
        placeholder="±0.05"
        value={draft.tolerance}
        error={draft.fieldErrors['tolerance']}
        onChange={(event) => wb.updateDimension({ tolerance: event.target.value, fieldErrors: {} })}
      />
      <button type="button" className="primary" onClick={() => void submit()}>
        Apply dimension
      </button>
    </div>
  );
}

function ConstraintList({ sketch }: { sketch: Sketch }) {
  const wb = useWorkbench();
  const unit = wb.member?.units ?? 'mm';
  const precision = wb.member?.precision ?? 2;
  return (
    <section className="constraints">
      <h3 className="section-title">Constraints</h3>
      <ul aria-label="Constraints">
        {sketch.constraints.map((c) => (
          <li key={c.id}>
            <span className="label">{c.label}</span>{' '}
            {c.value_mm !== undefined && <span className="num value">{formatDimension(c.value_mm, c.tolerance, unit, precision)}</span>}{' '}
            {c.redundant && <span className="badge">redundant</span>}
            <span className="row-actions">
              {c.value_mm !== undefined && (
                <button type="button" className="icon-button small" aria-label={`Edit ${c.label}`} onClick={() => wb.openDimension(c.kind, c.refs, c)}>
                  <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
                    <path d="M2 10l1-3 5-5 2 2-5 5z" fill="none" stroke="currentColor" strokeWidth="1.2" />
                  </svg>
                </button>
              )}
              <button type="button" className="icon-button small" aria-label={`Delete ${c.label}`} onClick={() => void wb.deleteConstraint(c)}>
                <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const TOOL_FIELDS: Record<Exclude<Tool, 'select'>, { title: string; place: string; fields: string[] }> = {
  line: { title: 'Line', place: 'Place line', fields: ['Start X', 'Start Y', 'End X', 'End Y'] },
  circle: { title: 'Circle', place: 'Place circle', fields: ['Centre X', 'Centre Y', 'Diameter'] },
  arc: { title: 'Arc', place: 'Place arc', fields: ['Centre X', 'Centre Y', 'Radius', 'Start angle', 'End angle'] },
  point: { title: 'Point', place: 'Place point', fields: ['X', 'Y'] },
};

/** Suggested values for a tool's fields, in the member's display unit. */
function suggestions(tool: Exclude<Tool, 'select'>, sketch: Sketch, unit: 'mm' | 'in'): string[] {
  const text = (mm: number) => editableLength(mm, unit);
  const { start, end } = suggestedLine(sketch);
  switch (tool) {
    case 'line':
      return [text(start.x), text(start.y), text(end.x), text(end.y)];
    case 'circle':
      return [text(start.x + 5), text(start.y), text(10)];
    case 'arc':
      return [text(start.x), text(start.y), text(10), '0', '90'];
    case 'point':
      return [text(start.x), text(start.y)];
  }
}

function ToolForm({ tool, sketch }: { tool: Exclude<Tool, 'select'>; sketch: Sketch }) {
  const wb = useWorkbench();
  const unit = wb.member?.units ?? 'mm';
  const definition = TOOL_FIELDS[tool];
  const [values, setValues] = useState<string[]>(() => suggestions(tool, sketch, unit));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const first = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  useEffect(() => {
    setValues(suggestions(tool, sketch, unit));
    setErrors({});
    first.current?.focus();
    first.current?.select();
  }, [tool]);

  const entityFrom = (): { entity: unknown; errors: Record<string, string> } => {
    const at = (name: string) => values[definition.fields.indexOf(name)] ?? '';
    const problems: Record<string, string> = {};
    const length = (name: string) => {
      try {
        return parseLength(at(name), unit);
      } catch (error) {
        if (error instanceof FieldProblem) problems[name] = error.message;
        return 1;
      }
    };
    const angle = (name: string) => {
      try {
        return parseAngle(at(name));
      } catch (error) {
        if (error instanceof FieldProblem) problems[name] = error.message;
        return 0;
      }
    };
    switch (tool) {
      case 'line':
        return {
          entity: { type: 'line', start: { x: at('Start X'), y: at('Start Y') }, end: { x: at('End X'), y: at('End Y') } },
          errors: problems,
        };
      case 'circle':
        return { entity: { type: 'circle', center: { x: at('Centre X'), y: at('Centre Y') }, radius: length('Diameter') / 2 }, errors: problems };
      case 'arc':
        return {
          entity: { type: 'arc', center: { x: at('Centre X'), y: at('Centre Y') }, radius: length('Radius'), start_angle_deg: angle('Start angle'), end_angle_deg: angle('End angle') },
          errors: problems,
        };
      case 'point':
        return { entity: { type: 'point', x: at('X'), y: at('Y') }, errors: problems };
    }
  };

  const placeIt = async () => {
    if (busy.current) return;
    const built = entityFrom();
    if (Object.keys(built.errors).length > 0) {
      setErrors(built.errors);
      return;
    }
    busy.current = true;
    const outcome = await wb.placeEntity(built.entity);
    busy.current = false;
    if (outcome.fields) {
      const mapped: Record<string, string> = {};
      const lookup: Record<string, string> = {
        'entity.start.x': 'Start X', 'entity.start.y': 'Start Y', 'entity.end.x': 'End X', 'entity.end.y': 'End Y',
        'entity.center.x': 'Centre X', 'entity.center.y': 'Centre Y', 'entity.radius': tool === 'circle' ? 'Diameter' : 'Radius',
        'entity.start_angle_deg': 'Start angle', 'entity.end_angle_deg': 'End angle', 'entity.x': 'X', 'entity.y': 'Y',
      };
      for (const [key, message] of Object.entries(outcome.fields)) mapped[lookup[key] ?? definition.fields[0] ?? ''] = message;
      setErrors(mapped);
      return;
    }
    if (outcome.ok) {
      wb.setTool('select');
      wb.focusCanvas();
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      wb.setTool('select');
      wb.focusCanvas();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void placeIt();
    }
  };

  return (
    <div role="group" aria-label={definition.title} className="tool-form" onKeyDown={onKeyDown}>
      {definition.fields.map((name, i) => (
        <Field
          key={name}
          label={name}
          inputRef={i === 0 ? first : undefined}
          numeric
          autoComplete="off"
          value={values[i] ?? ''}
          error={errors[name]}
          onChange={(event) => setValues((current) => current.map((v, k) => (k === i ? event.target.value : v)))}
        />
      ))}
      <button type="button" className="primary" onClick={() => void placeIt()}>
        {definition.place}
      </button>
    </div>
  );
}

function SketchPanel({ sketch, part }: { sketch: Sketch; part: Part }) {
  const wb = useWorkbench();
  const preview = usePreview(part, sketch, wb.member?.units ?? 'mm');
  return (
    <>
      <h2 className="panel-title">
        {sketch.name} <span className="muted small">on {part.name}</span>
      </h2>
      <SaveStatus part={part} />
      {wb.extrude && !wb.extrude.featureId ? (
        <>
          <ExtrudeForm part={part} />
          <Measurements part={part} preview={preview} />
        </>
      ) : (
        wb.tool !== 'select' && <ToolForm tool={wb.tool} sketch={sketch} />
      )}
      <ConstrainGroup />
      <DimensionFields />
      <ConstraintList sketch={sketch} />
      <div className="sticky-actions">
        <div className="button-row">
          <button type="button" disabled={!sketch.entities.some((e: Entity) => wb.selection.includes(e.id))} onClick={() => void wb.deleteSelection()}>
            Delete selection
          </button>
          <button type="button" onClick={() => void wb.closeSketch()}>
            Close sketch
          </button>
        </div>
      </div>
    </>
  );
}

export function PropertiesContent() {
  const wb = useWorkbench();
  const { view, part, sketch } = wb;
  if (view?.kind === 'assembly') return <AssemblyPanel />;
  if (view?.kind === 'part' && part) return <PartPanel key={part.id} part={part} />;
  if (view?.kind === 'sketch' && part && sketch) return <SketchPanel sketch={sketch} part={part} />;
  return null;
}
