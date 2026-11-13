// Layers tab: Layer Properties Manager with the Layers grid. Rows are keyed by layer name and never remount on updates,
// so keyboard focus persists while live counts change.
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { COLOR_NAMES, LINETYPES, LINEWEIGHTS, type LayerView } from '../../../shared/types.ts';
import { ApiError } from '../../api.ts';
import { useEditor } from '../store.ts';
import { useFocusRequest } from './focusRequest.ts';
import { layerRefusal, type LayerOp } from './refusals.ts';
import '../../styles/panels.css';

const COLUMNS = ['Status', 'Name', 'On', 'Freeze', 'Lock', 'Color', 'Linetype', 'Lineweight', 'Objects'] as const;
type Column = (typeof COLUMNS)[number];
const NAME_COLUMN = COLUMNS.indexOf('Name');

type Kind = 'On' | 'Freeze' | 'Lock';
const TOGGLE_FIELD = { On: 'on', Freeze: 'frozen', Lock: 'locked' } as const;
type Look = 'Color' | 'Linetype' | 'Lineweight';
const LOOK_FIELD = { Color: 'color', Linetype: 'linetype', Lineweight: 'lineweight' } as const;
const LOOK_OPTIONS: Record<Look, readonly string[]> = { Color: COLOR_NAMES, Linetype: LINETYPES, Lineweight: LINEWEIGHTS };

/** What each toggle announces for its new value (brief: Announcements). */
const TOGGLE_WORDS: Record<Kind, [off: string, on: string]> = {
  On: ['turned off', 'turned on'],
  Freeze: ['thawed', 'frozen'],
  Lock: ['unlocked', 'locked'],
};

interface Overlay { value: boolean | string; settled: boolean }

const overlayKey = (layer: string, field: string): string => `${layer}\u0000${field}`;

/** The element a grid cell hands focus to: its control, or the cell itself. */
function targetOf(cell: HTMLElement): HTMLElement {
  return cell.querySelector<HTMLElement>('input,select') ?? cell;
}

export function LayersPanel() {
  const editor = useEditor();
  const layers = editor.drawing?.layers ?? [];
  const readOnly = !editor.canEditBase;
  const grid = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<{ layer: string; column: number } | null>(null);
  const [focusedLayer, setFocusedLayer] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Record<string, Overlay>>({});
  const wasEditing = useRef<string | null>(null);
  /** A cell to focus once the layer table has the row (after a rename the row is new). */
  const focusLater = useRef<{ layer: string; column: number } | null>(null);
  /** The layer names before New layer, so the one that appears can be told apart. */
  const beforeNew = useRef<Set<string> | null>(null);

  const cellAt = (layer: string, column: number): HTMLElement | null =>
    grid.current?.querySelector<HTMLElement>(`[data-layer="${CSS.escape(layer)}"][data-column="${column}"]`) ?? null;

  useFocusRequest('layers', () => {
    const stop = grid.current?.querySelector<HTMLElement>('[tabindex="0"]');
    (stop ?? grid.current)?.focus();
  });

  useEffect(() => {
    setOverlay((current) => {
      const kept = Object.entries(current).filter(([, entry]) => !entry.settled);
      return kept.length === Object.keys(current).length ? current : Object.fromEntries(kept);
    });
    setFocusedLayer((current) => (current && layers.some((layer) => layer.name === current) ? current : null));
    const later = focusLater.current;
    const laterCell = later ? cellAt(later.layer, later.column) : null;
    if (later && laterCell) {
      focusLater.current = null;
      setActive(later);
      targetOf(laterCell).focus();
    }
    const known = beforeNew.current;
    const added = known ? layers.find((layer) => !known.has(layer.name)) : undefined;
    if (known && added) {
      beforeNew.current = null;
      editor.announce(`Layer ${added.name} created.`);
      setActive({ layer: added.name, column: NAME_COLUMN });
      setEditing(added.name);
    }
    // The layer table is the trigger: it is replaced whenever the server's answer arrives.
  }, [editor.drawing?.layers]);

  // Leaving edit mode puts focus back on the Name cell the edit started from, unless the row is gone (renamed).
  useEffect(() => {
    const previous = wasEditing.current;
    wasEditing.current = editing;
    if (previous && editing === null) cellAt(previous, NAME_COLUMN)?.focus();
  }, [editing]);

  const stopFor = (layer: string, column: number): boolean => {
    const current = active && layers.some((item) => item.name === active.layer)
      ? active
      : { layer: layers[0]?.name ?? '', column: NAME_COLUMN };
    return current.layer === layer && current.column === column;
  };

  const shown = <T extends boolean | string>(layer: string, field: string, stored: T): T => {
    const entry = overlay[overlayKey(layer, field)];
    return entry ? (entry.value as T) : stored;
  };

  const run = async (op: LayerOp, args: Record<string, unknown>, name: string, say: (() => string) | null): Promise<boolean> => {
    setError(null);
    try {
      const result = await editor.runCommand('LAYER', { op, ...args });
      if (result && say) editor.announce(say());
      return result !== null;
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      setError(layerRefusal(failure, op, name));
      return false;
    }
  };

  const change = async (layer: string, field: string, value: boolean | string, say: () => string): Promise<void> => {
    const key = overlayKey(layer, field);
    setOverlay((current) => ({ ...current, [key]: { value, settled: false } }));
    const done = await run('set', { name: layer, [field]: value }, layer, say);
    setOverlay((current) => {
      if (!done) {
        const { [key]: _dropped, ...rest } = current;
        return rest;
      }
      return { ...current, [key]: { value, settled: true } };
    });
  };

  const rename = async (layer: string, text: string): Promise<void> => {
    const name = text.trim();
    if (name === layer) {
      setEditing(null);
      return;
    }
    focusLater.current = { layer: name, column: NAME_COLUMN };
    const done = await run('rename', { name: layer, new_name: name }, layer, () => `Layer ${layer} renamed to ${name}.`);
    if (done) setEditing(null);
    else focusLater.current = null;
  };

  const newLayer = (): void => {
    beforeNew.current = new Set(layers.map((layer) => layer.name));
    void run('new', {}, '', null).then((done) => {
      if (!done) beforeNew.current = null;
    });
  };

  const rowTarget = focusedLayer ?? layers.find((layer) => layer.current)?.name ?? null;

  const setCurrent = (): void => {
    if (rowTarget) void run('current', { name: rowTarget }, rowTarget, () => `Layer ${rowTarget} is now current.`);
  };

  const remove = (): void => {
    if (rowTarget) void run('delete', { name: rowTarget }, rowTarget, () => `Layer ${rowTarget} deleted.`);
  };

  const onFocus = (event: FocusEvent<HTMLDivElement>): void => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-column]');
    if (!cell?.dataset.layer) return;
    setActive({ layer: cell.dataset.layer, column: Number(cell.dataset.column) });
    setFocusedLayer(cell.dataset.layer);
  };

  const move = (layer: string, column: number, rowStep: number, columnStep: number): void => {
    const row = layers.findIndex((item) => item.name === layer);
    const nextRow = Math.min(Math.max(row + rowStep, 0), layers.length - 1);
    const nextColumn = Math.min(Math.max(column + columnStep, 0), COLUMNS.length - 1);
    const name = layers[nextRow]?.name;
    const cell = name === undefined ? null : cellAt(name, nextColumn);
    if (cell) targetOf(cell).focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    const cell = target.closest<HTMLElement>('[data-column]');
    if (!cell?.dataset.layer || (target instanceof HTMLInputElement && target.type === 'text')) return;
    const layer = cell.dataset.layer;
    const column = Number(cell.dataset.column);
    const steps: Record<string, [number, number]> = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
      Home: [0, -column], End: [0, COLUMNS.length - 1 - column],
    };
    const step = steps[event.key];
    if (step) {
      event.preventDefault();
      move(layer, column, step[0], step[1]);
    } else if (event.key === 'F2' && column === NAME_COLUMN && !readOnly) {
      event.preventDefault();
      setEditing(layer);
    } else if (event.key === 'Enter' && target instanceof HTMLSelectElement) {
      event.preventDefault();
      try {
        target.showPicker();
      } catch {
        // showPicker refuses outside a user gesture; the select simply stays focused.
      }
    }
  };

  return (
    <section className="panel panel-body" aria-label="Layer Properties Manager">
      <div className="panel-actions">
        <button type="button" className="btn btn-outline" onClick={newLayer} disabled={readOnly}>New layer</button>
        <button type="button" className="btn btn-outline" onClick={remove} disabled={readOnly || !rowTarget}>Delete layer</button>
        <button type="button" className="btn btn-outline" onClick={setCurrent} disabled={readOnly || !rowTarget}>Set current</button>
      </div>
      {error ? <p role="alert" className="panel-alert">{error}</p> : null}
      <div className="layer-scroll">
        <div ref={grid} role="grid" aria-label="Layers" className="layer-grid" onFocus={onFocus} onKeyDown={onKeyDown}>
          <div role="row" className="layer-row layer-head">
            {COLUMNS.map((column) => <div role="columnheader" key={column}>{column}</div>)}
          </div>
          {layers.map((layer) => (
            <LayerRow
              key={layer.name}
              layer={layer}
              readOnly={readOnly}
              editing={editing === layer.name}
              stopFor={stopFor}
              shown={shown}
              onToggle={(kind, value) => change(layer.name, TOGGLE_FIELD[kind], value, () => `Layer ${layer.name} ${TOGGLE_WORDS[kind][value ? 1 : 0]}.`)}
              onLook={(look, value) => change(layer.name, LOOK_FIELD[look], value, () => `Layer ${layer.name} ${LOOK_FIELD[look]} set to ${value}.`)}
              onEdit={() => setEditing(layer.name)}
              onRename={(text) => void rename(layer.name, text)}
              onCancel={() => {
                setEditing(null);
                setError(null);
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

interface RowProps {
  layer: LayerView;
  readOnly: boolean;
  editing: boolean;
  stopFor: (layer: string, column: number) => boolean;
  shown: <T extends boolean | string>(layer: string, field: string, stored: T) => T;
  onToggle: (kind: Kind, value: boolean) => void;
  onLook: (look: Look, value: string) => void;
  onEdit: () => void;
  onRename: (text: string) => void;
  onCancel: () => void;
}

function LayerRow({ layer, readOnly, editing, stopFor, shown, onToggle, onLook, onEdit, onRename, onCancel }: RowProps) {
  const cell = (column: Column) => ({
    role: 'gridcell' as const,
    'data-layer': layer.name,
    'data-column': COLUMNS.indexOf(column),
    'data-label': column,
  });
  const stored: Record<Kind, boolean> = { On: layer.on, Freeze: layer.frozen, Lock: layer.locked };
  const looks: Record<Look, string> = { Color: layer.color, Linetype: layer.linetype, Lineweight: layer.lineweight };

  return (
    <div role="row" className="layer-row" data-current={layer.current ? '' : undefined}>
      <div {...cell('Status')} tabIndex={stopFor(layer.name, 0) ? 0 : -1}>{layer.current ? 'Current' : ''}</div>
      <div {...cell('Name')} aria-label={layer.name} tabIndex={editing ? -1 : stopFor(layer.name, NAME_COLUMN) ? 0 : -1} onDoubleClick={readOnly ? undefined : onEdit}>
        {editing ? <NameEditor name={layer.name} onCommit={onRename} onCancel={onCancel} /> : layer.name}
      </div>
      {(['On', 'Freeze', 'Lock'] as const).map((kind) => (
        <div {...cell(kind)} key={kind}>
          <label className="layer-hit" data-label={kind}>
            <input
              type="checkbox" aria-label={`${kind} ${layer.name}`} disabled={readOnly}
              tabIndex={stopFor(layer.name, COLUMNS.indexOf(kind)) ? 0 : -1}
              checked={shown(layer.name, TOGGLE_FIELD[kind], stored[kind])}
              onChange={(event) => onToggle(kind, event.target.checked)}
            />
          </label>
        </div>
      ))}
      {(['Color', 'Linetype', 'Lineweight'] as const).map((look) => (
        <div {...cell(look)} key={look}>
          <select
            className="input" aria-label={`${look} ${layer.name}`} disabled={readOnly}
            tabIndex={stopFor(layer.name, COLUMNS.indexOf(look)) ? 0 : -1}
            value={shown(layer.name, LOOK_FIELD[look], looks[look])}
            onChange={(event) => onLook(look, event.target.value)}
          >
            {LOOK_OPTIONS[look].map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
      ))}
      <div {...cell('Objects')} tabIndex={stopFor(layer.name, COLUMNS.length - 1) ? 0 : -1}>{layer.objects}</div>
    </div>
  );
}

/** The Name cell in edit mode: the name is selected so typing replaces it; Enter commits, Escape cancels. */
function NameEditor({ name, onCommit, onCancel }: { name: string; onCommit: (text: string) => void; onCancel: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(name);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  return (
    <input
      ref={input} type="text" className="input layer-name-input" aria-label="Layer name" value={text} spellCheck={false}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onCommit(text);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    />
  );
}
