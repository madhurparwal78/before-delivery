// Properties tab: Object Properties for a selection, Model Properties (and the paper viewport scale) for none.
// Every value is formatted in the drawing's units; edits go through one PROPERTIES command per distinct change.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { COPY } from '../../../shared/copy.ts';
import { formatAngle, formatArea, formatLength, round6, unitsToMm } from '../../../shared/format.ts';
import { presentObject } from '../../../shared/geometry.ts';
import {
  COLOR_NAMES, LINETYPES, LINEWEIGHTS, STYLE_NAMES, VIEWPORT_SCALES,
  type ApiObject, type DrawingView, type ObjectCommon, type PlotStyle, type Point, type SupportFiles, type Units,
} from '../../../shared/types.ts';
import { GENERIC_ERROR } from '../../pages/errors.ts';
import { ApiError, get } from '../../api.ts';
import { parseNumber } from '../commandLine/parse.ts';
import { useEditor } from '../store.ts';
import { EmptyState } from './EmptyState.tsx';
import { firstFieldMessage } from './refusals.ts';
import { useChoice } from './useChoice.ts';
import '../../styles/panels.css';

const LINETYPE_SCALE_MIN = 0.01;
const LINETYPE_SCALE_MAX = 1000;
const VARIES = COPY.varies;

const TYPE_NAMES: Record<ApiObject['type'], string> = {
  line: 'Line', polyline: 'Polyline', circle: 'Circle', arc: 'Arc', spline: 'Spline', mtext: 'MText',
  dimension: 'Dimension', insert: 'Block reference', revcloud: 'Revision cloud',
};

const UNIT_NAMES: Record<Units, string> = { mm: 'Millimeters', m: 'Meters' };

type Reading = { set: Record<string, unknown> } | { error: string } | null;

interface Field {
  label: string;
  kind: 'select' | 'text' | 'multiline' | 'number';
  options?: (drawing: DrawingView) => readonly string[];
  /** The text the field shows for an object. */
  show: (object: ApiObject, units: Units) => string;
  /** What typing `text` into the field asks the server to set for this object. */
  read: (object: ApiObject, text: string, units: Units) => Reading;
}

type PointKey = 'start' | 'end' | 'center' | 'position';
type ScalarKey = 'radius' | 'scale' | 'rotation' | 'height' | 'width';

function pointOf(object: ApiObject, key: PointKey): Point | null {
  switch (key) {
    case 'start': return object.type === 'line' ? object.start : null;
    case 'end': return object.type === 'line' ? object.end : null;
    case 'center': return object.type === 'circle' || object.type === 'arc' ? object.center : null;
    case 'position': return object.type === 'insert' || object.type === 'mtext' ? object.position : null;
  }
}

function scalarOf(object: ApiObject, key: ScalarKey): number | null {
  switch (key) {
    case 'radius': return object.type === 'circle' || object.type === 'arc' ? object.radius : null;
    case 'scale': return object.type === 'insert' ? object.scale : null;
    case 'rotation': return object.type === 'insert' ? object.rotation : null;
    case 'height': case 'width': return object.type === 'mtext' ? object[key] : null;
  }
}

const number = (text: string): number | { error: string } => parseNumber(text.trim()) ?? { error: COPY.notANumber };

const coordinate = (label: string, key: PointKey, axis: 0 | 1): Field => ({
  label,
  kind: 'text',
  show: (object, units) => {
    const point = pointOf(object, key);
    return point ? formatLength(point[axis], units) : '';
  },
  read: (object, text, units) => {
    const value = number(text);
    const point = pointOf(object, key);
    if (typeof value !== 'number') return value;
    if (!point) return null;
    const mm = round6(unitsToMm(value, units));
    return { set: { [key]: axis === 0 ? [mm, point[1]] : [point[0], mm] } };
  },
});

const length = (label: string, key: ScalarKey): Field => ({
  label,
  kind: 'text',
  show: (object, units) => formatLength(scalarOf(object, key) ?? 0, units),
  read: (_object, text, units) => {
    const value = number(text);
    return typeof value === 'number' ? { set: { [key]: round6(unitsToMm(value, units)) } } : value;
  },
});

const plain = (label: string, key: ScalarKey): Field => ({
  label,
  kind: 'text',
  show: (object) => String(round6(scalarOf(object, key) ?? 0)),
  read: (_object, text) => {
    const value = number(text);
    return typeof value === 'number' ? { set: { [key]: value } } : value;
  },
});

const textOf = (object: ApiObject, key: 'contents' | 'text_override'): string => {
  if (key === 'contents') return object.type === 'mtext' ? object.contents : '';
  return object.type === 'dimension' ? object.text_override ?? '' : '';
};

const words = (label: string, key: 'contents' | 'text_override', kind: 'text' | 'multiline'): Field => ({
  label,
  kind,
  show: (object) => textOf(object, key),
  read: (_object, text) => ({ set: { [key]: text } }),
});

type ChoiceKey = Exclude<keyof ObjectCommon, 'handle' | 'linetype_scale'>;

const choice = (label: string, key: ChoiceKey, options: (drawing: DrawingView) => readonly string[]): Field => ({
  label,
  kind: 'select',
  options,
  show: (object) => object[key],
  read: (_object, text) => ({ set: { [key]: text } }),
});

const fixedOptions = (...options: readonly string[]) => () => options;

const COMMON_FIELDS: Field[] = [
  choice('Layer', 'layer', (drawing) => drawing.layers.map((layer) => layer.name)),
  choice('Color', 'color', fixedOptions('ByLayer', ...COLOR_NAMES)),
  choice('Linetype', 'linetype', fixedOptions('ByLayer', ...LINETYPES)),
  {
    label: 'Linetype scale',
    kind: 'number',
    show: (object) => String(object.linetype_scale),
    read: (_object, text) => {
      const value = number(text);
      if (typeof value !== 'number') return value;
      if (value < LINETYPE_SCALE_MIN || value > LINETYPE_SCALE_MAX) return { error: COPY.linetypeScaleRange };
      return { set: { linetype_scale: value } };
    },
  },
  choice('Lineweight', 'lineweight', fixedOptions('ByLayer', ...LINEWEIGHTS)),
  choice('Dimension style', 'dimension_style', fixedOptions(...STYLE_NAMES)),
  choice('Text style', 'text_style', fixedOptions(...STYLE_NAMES)),
  choice('Multileader style', 'multileader_style', fixedOptions(...STYLE_NAMES)),
];

const TYPE_FIELDS: Record<ApiObject['type'], Field[]> = {
  line: [coordinate('Start X', 'start', 0), coordinate('Start Y', 'start', 1), coordinate('End X', 'end', 0), coordinate('End Y', 'end', 1)],
  polyline: [],
  circle: [coordinate('Center X', 'center', 0), coordinate('Center Y', 'center', 1), length('Radius', 'radius')],
  arc: [],
  spline: [],
  mtext: [words('Contents', 'contents', 'multiline'), length('Text height', 'height'), length('Width', 'width')],
  dimension: [words('Text override', 'text_override', 'text')],
  insert: [coordinate('Position X', 'position', 0), coordinate('Position Y', 'position', 1), plain('Scale', 'scale'), plain('Rotation', 'rotation')],
  revcloud: [],
};

/** Read-only values of an object, as label and text. */
function readouts(object: ApiObject, units: Units): [string, string][] {
  switch (object.type) {
    case 'line': return [['Length', formatLength(object.length, units)], ['Angle', formatAngle(object.angle)]];
    case 'polyline':
      return [
        ['Vertices', String(object.vertices.length)], ['Closed', object.closed ? 'Yes' : 'No'],
        ['Length', formatLength(object.length, units)], ['Area', object.area === null ? '—' : formatArea(object.area, units)],
      ];
    case 'circle':
      return [
        ['Diameter', formatLength(object.diameter, units)], ['Circumference', formatLength(object.circumference, units)],
        ['Area', formatArea(object.area, units)],
      ];
    case 'arc':
      return [
        ['Radius', formatLength(object.radius, units)], ['Start angle', formatAngle(object.start_angle)],
        ['End angle', formatAngle(object.end_angle)], ['Length', formatLength(object.length, units)],
      ];
    case 'insert': return [['Block name', object.block]];
    case 'dimension':
      return [['Measurement', object.kind === 'angular' ? formatAngle(object.measurement) : formatLength(object.measurement, units)]];
    case 'revcloud': return [['Arcs', String(object.arcs)]];
    case 'spline': case 'mtext': return [];
  }
}

/** The one value all texts agree on, or the varies marker. */
const agreed = (texts: string[]): string => (texts.every((text) => text === texts[0]) ? texts[0] ?? '' : VARIES);

/** The object as it would read with every pending edit applied, derived values recomputed. */
function withDrafts(object: ApiObject, fields: Field[], drafts: Record<string, string>, units: Units): ApiObject {
  let result = object;
  for (const field of fields) {
    const draft = drafts[field.label];
    if (draft === undefined) continue;
    const reading = field.read(result, draft, units);
    if (reading && 'set' in reading) result = presentObject(Object.assign({}, result, reading.set), units);
  }
  return result;
}

function ObjectProperties({ objects }: { objects: ApiObject[] }) {
  const editor = useEditor();
  const { drawing, units, preview } = editor;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const saving = useRef(new Set<string>());
  const ids = useId();

  if (!drawing) return null;
  const shown = objects.map((object) => preview?.[object.handle] ?? object);
  const first = shown[0];
  if (!first) return null;
  const sameType = shown.every((object) => object.type === first.type);
  const fields = sameType ? [...TYPE_FIELDS[first.type], ...COMMON_FIELDS] : COMMON_FIELDS;
  const typeFields = sameType ? TYPE_FIELDS[first.type] : [];
  const view = shown.map((object) => withDrafts(object, fields, drafts, units));

  const lockedLayers = new Set(drawing.layers.filter((layer) => layer.locked).map((layer) => layer.name));
  const lockedNames = [...new Set(shown.filter((object) => lockedLayers.has(object.layer)).map((object) => object.layer))];
  const inTrace = shown.some((object) => editor.activeTrace?.objects.some((traced) => traced.handle === object.handle));
  const disabled = !editor.canEditBase || inTrace || shown.every((object) => lockedLayers.has(object.layer));

  const heading = shown.length === 1 ? TYPE_NAMES[first.type] : `${shown.length} objects selected`;
  const handles = shown.map((object) => object.handle);

  const dropDraft = (label: string): void => {
    setDrafts((current) => {
      const { [label]: _dropped, ...rest } = current;
      return rest;
    });
  };

  const setDraft = (label: string, text: string): void => {
    setDrafts((current) => ({ ...current, [label]: text }));
    setErrors((current) => {
      const { [label]: _dropped, ...rest } = current;
      return rest;
    });
  };

  const commit = async (field: Field, text: string): Promise<void> => {
    if (saving.current.has(field.label)) return;
    const readings = shown.map((object) => ({ object, reading: field.read(object, text, units) }));
    const refused = readings.find((entry) => entry.reading && 'error' in entry.reading)?.reading;
    if (refused && 'error' in refused) {
      setErrors((current) => ({ ...current, [field.label]: refused.error }));
      return;
    }
    const groups = new Map<string, { set: Record<string, unknown>; handles: string[] }>();
    for (const { object, reading } of readings) {
      if (!reading || !('set' in reading)) continue;
      const key = JSON.stringify(reading.set);
      const group = groups.get(key) ?? { set: reading.set, handles: [] };
      group.handles.push(object.handle);
      groups.set(key, group);
    }
    saving.current.add(field.label);
    setGeneral(null);
    try {
      for (const group of groups.values()) await editor.runCommand('PROPERTIES', { handles: group.handles, set: group.set });
      dropDraft(field.label);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      const message = firstFieldMessage(error);
      if (field.kind === 'select') dropDraft(field.label);
      if (message) setErrors((current) => ({ ...current, [field.label]: message }));
      else setGeneral(GENERIC_ERROR);
    } finally {
      saving.current.delete(field.label);
    }
  };

  const onKey = (field: Field) => (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    const draft = drafts[field.label];
    if (event.key === 'Enter' && !(field.kind === 'multiline' && event.shiftKey)) {
      event.preventDefault();
      if (draft !== undefined) void commit(field, draft);
    } else if (event.key === 'Escape' && draft !== undefined) {
      event.stopPropagation();
      dropDraft(field.label);
    }
  };

  const control = (field: Field, index: number) => {
    const id = `${ids}-${index}`;
    const errorId = `${id}-error`;
    const error = errors[field.label];
    const draft = drafts[field.label];
    const text = draft ?? agreed(shown.map((object) => field.show(object, units)));
    const common = { id, disabled, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? errorId : undefined } as const;
    let input;
    if (field.kind === 'select') {
      const options = field.options?.(drawing) ?? [];
      input = (
        <select {...common} className="input" value={text === VARIES ? '' : text} onChange={(event) => { setDraft(field.label, event.target.value); void commit(field, event.target.value); }}>
          {text === VARIES ? <option value="" disabled>{VARIES}</option> : null}
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    } else if (field.kind === 'multiline') {
      input = (
        <textarea
          {...common} className="input" rows={3} value={text} spellCheck={false}
          onChange={(event) => setDraft(field.label, event.target.value)}
          onKeyDown={onKey(field)}
          onBlur={() => { if (draft !== undefined) void commit(field, draft); }}
        />
      );
    } else {
      input = (
        <input
          {...common} className="input" type={field.kind === 'number' ? 'number' : 'text'} step={field.kind === 'number' ? 'any' : undefined}
          value={text === VARIES && field.kind === 'number' ? '' : text} placeholder={text === VARIES ? VARIES : undefined}
          spellCheck={false} autoComplete="off"
          onChange={(event) => setDraft(field.label, event.target.value)}
          onFocus={(event) => { if (text === VARIES) event.currentTarget.select(); }}
          onKeyDown={onKey(field)}
          onBlur={() => { if (draft !== undefined) void commit(field, draft); }}
        />
      );
    }
    return (
      <div className="prop-field" key={field.label}>
        <label htmlFor={id}>{field.label}</label>
        {input}
        {error ? <p id={errorId} role="alert" className="field-error">{error}</p> : null}
      </div>
    );
  };

  const readoutRows = sameType
    ? (readouts(first, units).map(([label], row) => [label, agreed(view.map((object) => readouts(object, units)[row]?.[1] ?? ''))] as const))
    : [];

  return (
    <section className="panel-body" aria-label="Object Properties">
      <h3 className="panel-heading">{heading}</h3>
      {lockedNames.length > 0 ? <p className="panel-note">{`On locked layer ${lockedNames.join(', ')}`}</p> : null}
      {general ? <p role="alert" className="field-error">{general}</p> : null}
      <div className="prop-group">
        <p className="prop-readout">
          <span className="prop-label">Handle</span> <span className="prop-value">{agreed(handles)}</span>
        </p>
        {readoutRows.map(([label, value]) => (
          <p className="prop-readout" key={label}>
            <span className="prop-label">{label}</span> <span className="prop-value">{value}</span>
          </p>
        ))}
      </div>
      <div className="prop-group">
        {typeFields.map((field, index) => control(field, index))}
        {COMMON_FIELDS.map((field, index) => control(field, typeFields.length + index))}
      </div>
    </section>
  );
}

let plotStyles: Promise<PlotStyle[]> | null = null;

/** The plot styles the server offers, fetched once. */
function usePlotStyles(fallback: PlotStyle): PlotStyle[] {
  const [styles, setStyles] = useState<PlotStyle[]>([fallback]);
  useEffect(() => {
    let live = true;
    plotStyles ??= get<SupportFiles>('/api/support-files').then((files) => files.plot_styles);
    void plotStyles.then((loaded) => { if (live) setStyles(loaded); }).catch(() => { plotStyles = null; });
    return () => { live = false; };
  }, []);
  return styles;
}

function ModelProperties({ drawing }: { drawing: DrawingView }) {
  const editor = useEditor();
  const styles = usePlotStyles(drawing.plot_style);
  const [units, chooseUnits] = useChoice(drawing.units);
  const [plotStyle, choosePlotStyle] = useChoice(drawing.plot_style);
  const [error, setError] = useState<string | null>(null);
  const ids = useId();

  const release = (): void => {
    chooseUnits(null);
    choosePlotStyle(null);
  };

  const change = async (model: { units: Units } | { plot_style: PlotStyle }): Promise<void> => {
    setError(null);
    try {
      const result = await editor.runCommand('PROPERTIES', { model });
      if (result && 'units' in model) editor.announce(`Units set to ${UNIT_NAMES[model.units]}.`);
      if (!result) release();
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      release();
      setError(firstFieldMessage(failure) ?? GENERIC_ERROR);
    }
  };

  return (
    <section className="panel-body" aria-label="Model Properties">
      <EmptyState heading>No selection</EmptyState>
      <div className="prop-group">
        <div className="prop-field">
          <label htmlFor={`${ids}-units`}>Units</label>
          <select
            id={`${ids}-units`} className="input" value={units} disabled={!editor.canEditBase}
            onChange={(event) => {
              const next = event.target.value === 'm' ? 'm' : 'mm';
              chooseUnits(next);
              void change({ units: next });
            }}
          >
            {(Object.keys(UNIT_NAMES) as Units[]).map((value) => <option key={value} value={value}>{UNIT_NAMES[value]}</option>)}
          </select>
        </div>
        <div className="prop-field">
          <label htmlFor={`${ids}-plot`}>Plot style</label>
          <select
            id={`${ids}-plot`} className="input" value={plotStyle} disabled={!editor.canEditBase}
            onChange={(event) => {
              const style = styles.find((value) => value === event.target.value);
              if (!style) return;
              choosePlotStyle(style);
              void change({ plot_style: style });
            }}
          >
            {styles.map((style) => <option key={style} value={style}>{style}</option>)}
          </select>
        </div>
        {error ? <p role="alert" className="field-error">{error}</p> : null}
      </div>
    </section>
  );
}

/** Paper layouts only: the one viewport's scale. */
function ViewportScale({ drawing }: { drawing: DrawingView }) {
  const editor = useEditor();
  const id = useId();
  const layout = drawing.layouts.find((item) => item.name === editor.layout);
  const [scale, chooseScale] = useChoice(layout?.viewport_scale ?? VIEWPORT_SCALES[1]);
  if (!layout?.viewport_scale) return null;
  return (
    <div className="prop-group">
      <div className="prop-field">
        <label htmlFor={id}>Viewport scale</label>
        <select
          id={id} className="input" value={scale} disabled={!editor.canEditBase}
          onChange={(event) => {
            const next = VIEWPORT_SCALES.find((value) => value === event.target.value);
            if (!next) return;
            chooseScale(next);
            void editor.runCommand('LAYOUT', { op: 'scale', name: layout.name, viewport_scale: next }).then((result) => {
              if (!result) chooseScale(null);
            });
          }}
        >
          {VIEWPORT_SCALES.map((scale) => <option key={scale} value={scale} label={scale} />)}
        </select>
      </div>
    </div>
  );
}

export function PropertiesPanel() {
  const editor = useEditor();
  const { drawing, selected } = editor;
  if (!drawing) return null;
  return (
    <div className="panel">
      {selected.length === 0
        ? <ModelProperties drawing={drawing} />
        : <ObjectProperties key={selected.map((object) => object.handle).join(',')} objects={selected} />}
      <ViewportScale drawing={drawing} />
    </div>
  );
}
