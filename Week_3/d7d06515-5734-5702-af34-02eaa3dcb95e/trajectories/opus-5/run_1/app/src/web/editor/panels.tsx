import { useEffect, useRef, useState } from 'react';
import type {
  ActivityEntry,
  Drawing,
  DrawingObject,
  IssueRow,
  LayerRow,
  TraceSummary,
} from '../../shared/api';
import {
  COLOR_NAMES,
  LINETYPE_NAMES,
  LINEWEIGHT_NAMES,
  OBJECT_COLORS,
  OBJECT_LINETYPES,
  OBJECT_LINEWEIGHTS,
  PLOT_STYLES,
  STYLE_NAMES,
} from '../../shared/api';
import { copy } from '../../shared/copy';
import { formatAngle, formatArea, formatLength, type Units } from '../../shared/format';

export type PanelTab = 'Properties' | 'Layers' | 'Blocks' | 'Xrefs' | 'Traces' | 'Activity' | 'Issues';

export const PANEL_TABS: Array<{ id: PanelTab; label: string }> = [
  { id: 'Properties', label: 'Prop.' },
  { id: 'Layers', label: 'Layers' },
  { id: 'Blocks', label: 'Blocks' },
  { id: 'Xrefs', label: 'Xrefs' },
  { id: 'Traces', label: 'Traces' },
  { id: 'Activity', label: 'Activity' },
  { id: 'Issues', label: 'Issues' },
];

const TYPE_LABELS: Record<DrawingObject['type'], string> = {
  line: 'Line',
  polyline: 'Polyline',
  circle: 'Circle',
  arc: 'Arc',
  spline: 'Spline',
  mtext: 'MText',
  dimension: 'Dimension',
  insert: 'Block reference',
  revcloud: 'Revision cloud',
};

export interface PropertyChange {
  handles: string[];
  set: Record<string, unknown>;
}

function ReadOnly(props: { label: string; value: string }): JSX.Element {
  return (
    <>
      <span>{props.label}</span>
      <span className="prop-readonly">{props.value}</span>
    </>
  );
}

function EditableText(props: {
  label: string;
  value: string;
  disabled: boolean;
  onCommit: (value: string) => void;
  error?: string;
}): JSX.Element {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  return (
    <>
      <label htmlFor={`prop-${props.label}`}>{props.label}</label>
      <span>
        <input
          id={`prop-${props.label}`}
          aria-label={props.label}
          value={draft}
          disabled={props.disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              props.onCommit(draft);
            }
          }}
          onBlur={() => {
            if (draft !== props.value) props.onCommit(draft);
          }}
        />
        {props.error !== undefined ? (
          <span className="field-error" role="alert">
            {props.error}
          </span>
        ) : null}
      </span>
    </>
  );
}

function Combo(props: {
  label: string;
  value: string;
  options: readonly string[];
  disabled: boolean;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <>
      <label htmlFor={`prop-${props.label}`}>{props.label}</label>
      <select
        id={`prop-${props.label}`}
        aria-label={props.label}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {props.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        {props.options.includes(props.value) ? null : <option value={props.value}>{props.value}</option>}
      </select>
    </>
  );
}

export function PropertiesPanel(props: {
  drawing: Drawing;
  selection: DrawingObject[];
  units: Units;
  dragPreview: DrawingObject | null;
  onChange: (change: PropertyChange) => void;
  onModelChange: (model: { units?: Units; plot_style?: string }) => void;
  readOnly: boolean;
}): JSX.Element {
  const [error, setError] = useState<{ field: string; message: string } | null>(null);
  const selection = props.selection;

  if (selection.length === 0) {
    return (
      <section aria-label="Model Properties">
        <h3>Model Properties</h3>
        <p>{copy.properties.noSelection}</p>
        <div className="prop-grid">
          <Combo
            label="Units"
            value={props.units === 'm' ? 'Meters' : 'Millimeters'}
            options={['Millimeters', 'Meters']}
            disabled={props.readOnly}
            onChange={(value) => props.onModelChange({ units: value === 'Meters' ? 'm' : 'mm' })}
          />
          <Combo
            label="Plot style"
            value={props.drawing.plot_style}
            options={PLOT_STYLES}
            disabled={props.readOnly}
            onChange={(value) => props.onModelChange({ plot_style: value })}
          />
        </div>
      </section>
    );
  }

  const handles = selection.map((object) => object.handle);
  const single = selection.length === 1 ? (props.dragPreview ?? selection[0]!) : null;
  const lockedLayer = props.drawing.layers.find(
    (layer) => layer.locked && selection.some((object) => object.layer === layer.name),
  );
  const disabled = props.readOnly || lockedLayer !== undefined;

  const shared = <T,>(read: (object: DrawingObject) => T): T | null => {
    const first = read(selection[0]!);
    return selection.every((object) => JSON.stringify(read(object)) === JSON.stringify(first)) ? first : null;
  };

  const sharedText = (read: (object: DrawingObject) => string): string => {
    const value = shared(read);
    return value === null ? copy.properties.varies : value;
  };

  const commit = (field: string, value: unknown): void => {
    setError(null);
    props.onChange({ handles, set: { [field]: value } });
  };

  const number = (field: string, text: string): number | null => {
    const parsed = Number.parseFloat(text);
    if (!Number.isFinite(parsed) || !/^-?\d+(\.\d+)?$/.test(text.trim())) {
      setError({ field, message: copy.properties.notANumber });
      return null;
    }
    return parsed;
  };

  const toMillimetres = (value: number): number => (props.units === 'm' ? value * 1000 : value);

  return (
    <section aria-label="Object Properties">
      <h3>
        {selection.length === 1
          ? TYPE_LABELS[selection[0]!.type]
          : copy.properties.multiHeading(selection.length)}
      </h3>
      {lockedLayer !== undefined ? <p role="alert">{copy.properties.lockedLayer(lockedLayer.name)}</p> : null}
      <div className="prop-grid">
        <Combo
          label="Layer"
          value={sharedText((object) => object.layer)}
          options={props.drawing.layers.map((layer) => layer.name)}
          disabled={disabled}
          onChange={(value) => commit('layer', value)}
        />
        <Combo
          label="Color"
          value={sharedText((object) => object.color)}
          options={OBJECT_COLORS}
          disabled={disabled}
          onChange={(value) => commit('color', value)}
        />
        <Combo
          label="Linetype"
          value={sharedText((object) => object.linetype)}
          options={OBJECT_LINETYPES}
          disabled={disabled}
          onChange={(value) => commit('linetype', value)}
        />
        <EditableText
          label="Linetype scale"
          value={shared((object) => object.linetype_scale) === null ? copy.properties.varies : String(selection[0]!.linetype_scale.toFixed(2))}
          disabled={disabled}
          error={error?.field === 'linetype_scale' ? error.message : undefined}
          onCommit={(text) => {
            const value = number('linetype_scale', text);
            if (value === null) return;
            if (value < 0.01 || value > 1000) {
              setError({ field: 'linetype_scale', message: copy.properties.linetypeScaleRange });
              return;
            }
            commit('linetype_scale', value);
          }}
        />
        <Combo
          label="Lineweight"
          value={sharedText((object) => object.lineweight)}
          options={OBJECT_LINEWEIGHTS}
          disabled={disabled}
          onChange={(value) => commit('lineweight', value)}
        />
        <Combo
          label="Dimension style"
          value={sharedText((object) => object.dimension_style)}
          options={STYLE_NAMES}
          disabled={disabled}
          onChange={(value) => commit('dimension_style', value)}
        />
        <Combo
          label="Text style"
          value={sharedText((object) => object.text_style)}
          options={STYLE_NAMES}
          disabled={disabled}
          onChange={(value) => commit('text_style', value)}
        />
        <Combo
          label="Multileader style"
          value={sharedText((object) => object.multileader_style)}
          options={STYLE_NAMES}
          disabled={disabled}
          onChange={(value) => commit('multileader_style', value)}
        />
        <ReadOnly label="Handle" value={sharedText((object) => object.handle)} />

        {single !== null && single.type === 'line' ? (
          <>
            <EditableText
              label="Start X"
              value={formatLength(single.start[0], props.units)}
              disabled={disabled}
              onCommit={(text) => {
                const value = number('Start X', text);
                if (value !== null) commit('start', [toMillimetres(value), single.start[1]]);
              }}
            />
            <EditableText
              label="Start Y"
              value={formatLength(single.start[1], props.units)}
              disabled={disabled}
              onCommit={(text) => {
                const value = number('Start Y', text);
                if (value !== null) commit('start', [single.start[0], toMillimetres(value)]);
              }}
            />
            <EditableText
              label="End X"
              value={formatLength(single.end[0], props.units)}
              disabled={disabled}
              onCommit={(text) => {
                const value = number('End X', text);
                if (value !== null) commit('end', [toMillimetres(value), single.end[1]]);
              }}
            />
            <EditableText
              label="End Y"
              value={formatLength(single.end[1], props.units)}
              disabled={disabled}
              onCommit={(text) => {
                const value = number('End Y', text);
                if (value !== null) commit('end', [single.end[0], toMillimetres(value)]);
              }}
            />
            <ReadOnly label="Length" value={formatLength(single.length, props.units)} />
            <ReadOnly label="Angle" value={formatAngle(single.angle)} />
          </>
        ) : null}

        {single !== null && single.type === 'polyline' ? (
          <>
            <ReadOnly label="Vertices" value={String(single.vertices.length)} />
            <ReadOnly label="Closed" value={single.closed ? 'Yes' : 'No'} />
            <ReadOnly label="Length" value={formatLength(single.length, props.units)} />
            <ReadOnly
              label="Area"
              value={single.area === null ? copy.files.dash : formatArea(single.area, props.units)}
            />
          </>
        ) : null}

        {single !== null && single.type === 'circle' ? (
          <>
            <EditableText
              label="Center X"
              value={formatLength(single.center[0], props.units)}
              disabled={disabled}
              onCommit={(text) => {
                const value = number('Center X', text);
                if (value !== null) commit('center', [toMillimetres(value), single.center[1]]);
              }}
            />
            <EditableText
              label="Center Y"
              value={formatLength(single.center[1], props.units)}
              disabled={disabled}
              onCommit={(text) => {
                const value = number('Center Y', text);
                if (value !== null) commit('center', [single.center[0], toMillimetres(value)]);
              }}
            />
            <EditableText
              label="Radius"
              value={formatLength(single.radius, props.units)}
              disabled={disabled}
              onCommit={(text) => {
                const value = number('Radius', text);
                if (value !== null) commit('radius', toMillimetres(value));
              }}
            />
            <ReadOnly label="Diameter" value={formatLength(single.diameter, props.units)} />
            <ReadOnly label="Circumference" value={formatLength(single.circumference, props.units)} />
            <ReadOnly label="Area" value={formatArea(single.area, props.units)} />
          </>
        ) : null}

        {single !== null && single.type === 'arc' ? (
          <>
            <ReadOnly label="Radius" value={formatLength(single.radius, props.units)} />
            <ReadOnly label="Start angle" value={formatAngle(single.start_angle)} />
            <ReadOnly label="End angle" value={formatAngle(single.end_angle)} />
            <ReadOnly label="Length" value={formatLength(single.length, props.units)} />
          </>
        ) : null}

        {single !== null && single.type === 'insert' ? (
          <>
            <ReadOnly label="Block name" value={single.block} />
            <EditableText
              label="Position X"
              value={formatLength(single.position[0], props.units)}
              disabled={disabled}
              onCommit={(text) => {
                const value = number('Position X', text);
                if (value !== null) commit('position', [toMillimetres(value), single.position[1]]);
              }}
            />
            <EditableText
              label="Position Y"
              value={formatLength(single.position[1], props.units)}
              disabled={disabled}
              onCommit={(text) => {
                const value = number('Position Y', text);
                if (value !== null) commit('position', [single.position[0], toMillimetres(value)]);
              }}
            />
            <EditableText
              label="Scale"
              value={single.scale.toFixed(2)}
              disabled={disabled}
              onCommit={(text) => {
                const value = number('Scale', text);
                if (value !== null) commit('scale', value);
              }}
            />
            <EditableText
              label="Rotation"
              value={single.rotation.toFixed(2)}
              disabled={disabled}
              onCommit={(text) => {
                const value = number('Rotation', text);
                if (value !== null) commit('rotation', value);
              }}
            />
          </>
        ) : null}

        {single !== null && single.type === 'dimension' ? (
          <>
            <ReadOnly
              label="Measurement"
              value={
                single.kind === 'angular'
                  ? formatAngle(single.measurement)
                  : formatLength(single.measurement, props.units)
              }
            />
            <EditableText
              label="Text override"
              value={single.text_override ?? ''}
              disabled={disabled}
              onCommit={(text) => commit('text_override', text === '' ? null : text)}
            />
          </>
        ) : null}

        {single !== null && single.type === 'mtext' ? (
          <>
            <EditableText
              label="Contents"
              value={single.contents}
              disabled={disabled}
              onCommit={(text) => commit('contents', text)}
            />
            <EditableText
              label="Text height"
              value={formatLength(single.height, props.units)}
              disabled={disabled}
              onCommit={(text) => {
                const value = number('Text height', text);
                if (value !== null) commit('height', toMillimetres(value));
              }}
            />
            <EditableText
              label="Width"
              value={formatLength(single.width, props.units)}
              disabled={disabled}
              onCommit={(text) => {
                const value = number('Width', text);
                if (value !== null) commit('width', toMillimetres(value));
              }}
            />
          </>
        ) : null}

        {single !== null && single.type === 'revcloud' ? (
          <ReadOnly label="Arcs" value={String(single.arcs)} />
        ) : null}
      </div>
    </section>
  );
}

type LayerColumn = 'status' | 'name' | 'on' | 'freeze' | 'lock' | 'color' | 'linetype' | 'lineweight' | 'objects';

const LAYER_COLUMNS: Array<{ id: LayerColumn; label: string }> = [
  { id: 'status', label: 'Status' },
  { id: 'name', label: 'Name' },
  { id: 'on', label: 'On' },
  { id: 'freeze', label: 'Freeze' },
  { id: 'lock', label: 'Lock' },
  { id: 'color', label: 'Color' },
  { id: 'linetype', label: 'Linetype' },
  { id: 'lineweight', label: 'Lineweight' },
  { id: 'objects', label: 'Objects' },
];

export interface LayerOperation {
  op: 'new' | 'rename' | 'set' | 'current' | 'delete';
  name?: string;
  new_name?: string;
  on?: boolean;
  frozen?: boolean;
  locked?: boolean;
  color?: string;
  linetype?: string;
  lineweight?: string;
}

export function LayersPanel(props: {
  layers: LayerRow[];
  error: string | null;
  readOnly: boolean;
  onOperation: (operation: LayerOperation) => void;
  gridRef: React.RefObject<HTMLTableElement>;
}): JSX.Element {
  const [focused, setFocused] = useState<{ row: number; column: number }>({ row: 0, column: 1 });
  const [renaming, setRenaming] = useState<string | null>(null);
  const cellRefs = useRef(new Map<string, HTMLTableCellElement>());

  const focusCell = (row: number, column: number): void => {
    const key = `${row}:${column}`;
    setFocused({ row, column });
    window.setTimeout(() => cellRefs.current.get(key)?.focus(), 0);
  };

  const onKeyDown = (event: React.KeyboardEvent, row: number, column: number, layer: LayerRow): void => {
    const columnId = LAYER_COLUMNS[column]!.id;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusCell(row, Math.min(LAYER_COLUMNS.length - 1, column + 1));
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusCell(row, Math.max(0, column - 1));
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusCell(Math.min(props.layers.length - 1, row + 1), column);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusCell(Math.max(0, row - 1), column);
      return;
    }
    if (event.key === ' ' && (columnId === 'on' || columnId === 'freeze' || columnId === 'lock')) {
      event.preventDefault();
      if (props.readOnly && columnId !== 'lock') return;
      if (columnId === 'on') props.onOperation({ op: 'set', name: layer.name, on: !layer.on });
      if (columnId === 'freeze') props.onOperation({ op: 'set', name: layer.name, frozen: !layer.frozen });
      if (columnId === 'lock') props.onOperation({ op: 'set', name: layer.name, locked: !layer.locked });
      return;
    }
    if (event.key === 'F2' && columnId === 'name') {
      event.preventDefault();
      setRenaming(layer.name);
      return;
    }
    if (event.key === 'Enter' && (columnId === 'color' || columnId === 'linetype' || columnId === 'lineweight')) {
      event.preventDefault();
      const select = cellRefs.current.get(`${row}:${column}`)?.querySelector('select');
      select?.focus();
      select?.click();
    }
  };

  const cellProps = (row: number, column: number, layer: LayerRow): React.TdHTMLAttributes<HTMLTableCellElement> => ({
    role: 'gridcell',
    tabIndex: focused.row === row && focused.column === column ? 0 : -1,
    ref: (node: HTMLTableCellElement | null) => {
      if (node !== null) cellRefs.current.set(`${row}:${column}`, node);
    },
    onFocus: () => setFocused({ row, column }),
    onKeyDown: (event) => onKeyDown(event, row, column, layer),
  }) as React.TdHTMLAttributes<HTMLTableCellElement>;

  return (
    <section aria-label="Layer Properties Manager">
      <h3>Layer Properties Manager</h3>
      {props.error !== null ? (
        <div className="alert" role="alert">
          {props.error}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-quiet btn-small"
          disabled={props.readOnly}
          onClick={() => props.onOperation({ op: 'new' })}
        >
          New layer
        </button>
        <button
          type="button"
          className="btn btn-quiet btn-small"
          disabled={props.readOnly}
          onClick={() => {
            const layer = props.layers[focused.row];
            if (layer !== undefined) props.onOperation({ op: 'delete', name: layer.name });
          }}
        >
          Delete layer
        </button>
        <button
          type="button"
          className="btn btn-quiet btn-small"
          disabled={props.readOnly}
          onClick={() => {
            const layer = props.layers[focused.row];
            if (layer !== undefined) props.onOperation({ op: 'current', name: layer.name });
          }}
        >
          Set current
        </button>
      </div>
      <table className="layers-grid" role="grid" aria-label="Layers" ref={props.gridRef}>
        <thead>
          <tr role="row">
            {LAYER_COLUMNS.map((column) => (
              <th key={column.id} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.layers.map((layer, row) => (
            <tr role="row" key={layer.name}>
              <td {...cellProps(row, 0, layer)}>{layer.current ? 'Current' : ''}</td>
              <td {...cellProps(row, 1, layer)}>
                {renaming === layer.name ? (
                  <input
                    aria-label={`Rename ${layer.name}`}
                    autoFocus
                    defaultValue={layer.name}
                    onFocus={(event) => event.target.select()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        const value = event.currentTarget.value;
                        setRenaming(null);
                        props.onOperation({ op: 'rename', name: layer.name, new_name: value });
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        setRenaming(null);
                      }
                    }}
                    onBlur={() => setRenaming(null)}
                  />
                ) : (
                  layer.name
                )}
              </td>
              <td {...cellProps(row, 2, layer)}>
                <input
                  type="checkbox"
                  aria-label={`On ${layer.name}`}
                  checked={layer.on}
                  disabled={props.readOnly}
                  tabIndex={-1}
                  onChange={() => props.onOperation({ op: 'set', name: layer.name, on: !layer.on })}
                />
              </td>
              <td {...cellProps(row, 3, layer)}>
                <input
                  type="checkbox"
                  aria-label={`Freeze ${layer.name}`}
                  checked={layer.frozen}
                  disabled={props.readOnly}
                  tabIndex={-1}
                  onChange={() => props.onOperation({ op: 'set', name: layer.name, frozen: !layer.frozen })}
                />
              </td>
              <td {...cellProps(row, 4, layer)}>
                <input
                  type="checkbox"
                  aria-label={`Lock ${layer.name}`}
                  checked={layer.locked}
                  tabIndex={-1}
                  onChange={() => props.onOperation({ op: 'set', name: layer.name, locked: !layer.locked })}
                />
              </td>
              <td {...cellProps(row, 5, layer)}>
                <select
                  aria-label={`Color ${layer.name}`}
                  value={layer.color}
                  disabled={props.readOnly}
                  tabIndex={-1}
                  onChange={(event) =>
                    props.onOperation({ op: 'set', name: layer.name, color: event.target.value })
                  }
                >
                  {COLOR_NAMES.map((color) => (
                    <option key={color} value={color}>
                      {color}
                    </option>
                  ))}
                </select>
              </td>
              <td {...cellProps(row, 6, layer)}>
                <select
                  aria-label={`Linetype ${layer.name}`}
                  value={layer.linetype}
                  disabled={props.readOnly}
                  tabIndex={-1}
                  onChange={(event) =>
                    props.onOperation({ op: 'set', name: layer.name, linetype: event.target.value })
                  }
                >
                  {LINETYPE_NAMES.map((linetype) => (
                    <option key={linetype} value={linetype}>
                      {linetype}
                    </option>
                  ))}
                </select>
              </td>
              <td {...cellProps(row, 7, layer)}>
                <select
                  aria-label={`Lineweight ${layer.name}`}
                  value={layer.lineweight}
                  disabled={props.readOnly}
                  tabIndex={-1}
                  onChange={(event) =>
                    props.onOperation({ op: 'set', name: layer.name, lineweight: event.target.value })
                  }
                >
                  {LINEWEIGHT_NAMES.map((lineweight) => (
                    <option key={lineweight} value={lineweight}>
                      {lineweight}
                    </option>
                  ))}
                </select>
              </td>
              <td {...cellProps(row, 8, layer)}>{layer.objects}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function BlocksPanel(props: {
  blocks: readonly string[];
  readOnly: boolean;
  onInsert: (name: string, scale: number, rotation: number) => void;
  firstButtonRef: React.RefObject<HTMLButtonElement>;
}): JSX.Element {
  const [settings, setSettings] = useState<Record<string, { scale: number; rotation: number }>>({});
  return (
    <section aria-label="Blocks">
      <h3>Blocks</h3>
      <ul className="list-plain" aria-label="Block library">
        {props.blocks.map((name, index) => {
          const entry = settings[name] ?? { scale: 1, rotation: 0 };
          return (
            <li key={name}>
              <strong>{name}</strong>
              <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <label>
                  <span className="sr-only">Scale</span>
                  <input
                    type="number"
                    aria-label="Scale"
                    step="0.1"
                    value={entry.scale}
                    style={{ width: '4.5rem' }}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        [name]: { ...entry, scale: Number.parseFloat(event.target.value) || 0 },
                      }))
                    }
                  />
                </label>
                <label>
                  <span className="sr-only">Rotation</span>
                  <input
                    type="number"
                    aria-label="Rotation"
                    step="1"
                    value={entry.rotation}
                    style={{ width: '4.5rem' }}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        [name]: { ...entry, rotation: Number.parseFloat(event.target.value) || 0 },
                      }))
                    }
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-quiet btn-small"
                  ref={index === 0 ? props.firstButtonRef : undefined}
                  disabled={props.readOnly}
                  onClick={() => props.onInsert(name, entry.scale, entry.rotation)}
                >
                  {`Insert ${name}`}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function XrefsPanel(props: {
  drawing: Drawing;
  candidates: Array<{ id: string; name: string }>;
  readOnly: boolean;
  onAttach: (drawingId: string) => void;
  onOperation: (op: 'unload' | 'reload' | 'detach', xrefId: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const statusLabel = { loaded: 'Loaded', unloaded: 'Unloaded', not_found: 'Not found' } as const;

  return (
    <section aria-label="Xrefs">
      <h3>External references</h3>
      <ul className="list-plain" aria-label="External references">
        <li>
          <button
            type="button"
            className="btn btn-quiet btn-small"
            disabled={props.readOnly}
            onClick={() => setOpen(true)}
          >
            Attach drawing
          </button>
        </li>
        {props.drawing.xrefs.map((xref) => (
          <li key={xref.id}>
            <span>
              {xref.name} · {statusLabel[xref.status]}
            </span>
            <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-quiet btn-small"
                onClick={() => props.onOperation('unload', xref.id)}
              >
                {`Unload ${xref.name}`}
              </button>
              <button
                type="button"
                className="btn btn-quiet btn-small"
                onClick={() => props.onOperation('reload', xref.id)}
              >
                {`Reload ${xref.name}`}
              </button>
              <button
                type="button"
                className="btn btn-quiet btn-small"
                onClick={() => props.onOperation('detach', xref.id)}
              >
                {`Detach ${xref.name}`}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {open ? (
        <div className="scrim">
          <div className="dialog" role="dialog" aria-modal="true" aria-label="Attach drawing">
            <h2>Attach drawing</h2>
            <div role="radiogroup" aria-label="Drawing">
              {props.candidates.map((candidate) => (
                <label key={candidate.id} style={{ display: 'block' }}>
                  <input
                    type="radio"
                    name="xref-drawing"
                    value={candidate.id}
                    checked={choice === candidate.id}
                    onChange={() => setChoice(candidate.id)}
                  />{' '}
                  {candidate.name}
                </label>
              ))}
            </div>
            <div className="dialog-actions">
              <button
                type="button"
                className="btn"
                disabled={choice === null}
                onClick={() => {
                  if (choice !== null) props.onAttach(choice);
                  setOpen(false);
                }}
              >
                Attach
              </button>
              <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function TracesPanel(props: {
  traces: TraceSummary[];
  activeTraceId: string | null;
  canCreate: boolean;
  isOwner: boolean;
  actorName: string;
  authoredTraces: string[];
  submitPending: boolean;
  onCreate: (name: string) => void;
  onOpen: (id: string) => void;
  onSubmit: (id: string) => void;
  onClose: (id: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const stateLabel = { open: 'Open', submitted: 'Submitted', closed: 'Closed' } as const;

  return (
    <section aria-label="Traces">
      <h3>Traces</h3>
      <button
        type="button"
        className="btn btn-quiet btn-small"
        disabled={!props.canCreate}
        onClick={() => setOpen(true)}
      >
        New trace
      </button>
      {props.traces.length === 0 ? <p>{copy.traces.empty}</p> : null}
      <ul className="list-plain" aria-label="Traces">
        {props.traces.map((trace) => (
          <li key={trace.id}>
            <span>
              {copy.traces.item(
                trace.name,
                stateLabel[trace.state],
                trace.state === 'open'
                  ? null
                  : trace.notice === 'sent'
                    ? copy.traces.noticeSent
                    : copy.traces.noticeNotSent,
              )}
            </span>
            <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-quiet btn-small" onClick={() => props.onOpen(trace.id)}>
                {`Open trace ${trace.name}`}
              </button>
              {trace.state === 'open' &&
              (trace.author === props.actorName || props.authoredTraces.includes(trace.id)) ? (
                <button
                  type="button"
                  className="btn btn-quiet btn-small"
                  disabled={props.submitPending}
                  onClick={() => props.onSubmit(trace.id)}
                >
                  {props.submitPending ? copy.traces.submitPending : 'Submit trace'}
                </button>
              ) : null}
              {trace.state === 'submitted' && props.isOwner ? (
                <button
                  type="button"
                  className="btn btn-quiet btn-small"
                  onClick={() => props.onClose(trace.id)}
                >
                  {`Close trace ${trace.name}`}
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {open ? (
        <div className="scrim">
          <div className="dialog" role="dialog" aria-modal="true" aria-label="New trace">
            <h2>New trace</h2>
            {error !== null ? (
              <div className="alert" role="alert">
                {error}
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="trace-name">Trace name</label>
              <input id="trace-name" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="dialog-actions">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (name.trim() === '' || name.trim().length > 80) {
                    setError(copy.traces.nameError);
                    return;
                  }
                  props.onCreate(name.trim());
                  setOpen(false);
                  setName('');
                }}
              >
                Create trace
              </button>
              <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function ActivityPanel(props: { entries: ActivityEntry[] }): JSX.Element {
  return (
    <section aria-label="Activity">
      <h3>Activity</h3>
      <div className="log-lines" role="log" aria-label="Activity">
        {props.entries.map((entry, index) => (
          <div key={`${entry.at}-${index}`}>{entry.text}</div>
        ))}
      </div>
    </section>
  );
}

export function IssuesPanel(props: {
  issues: IssueRow[];
  isOwner: boolean;
  onResolve: (number: number) => void;
}): JSX.Element {
  return (
    <section aria-label="Issues">
      <h3>Issues</h3>
      {props.issues.length === 0 ? <p>{copy.traces.issuesEmpty}</p> : null}
      <ul className="list-plain" aria-label="Issues">
        {props.issues.map((issue) => (
          <li key={issue.number}>
            <span>
              {copy.traces.issueItem(issue.number, issue.text, issue.status === 'open' ? 'Open' : 'Resolved')}
            </span>
            {props.isOwner && issue.status === 'open' ? (
              <button
                type="button"
                className="btn btn-quiet btn-small"
                onClick={() => props.onResolve(issue.number)}
              >
                {`Resolve issue ${issue.number}`}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
