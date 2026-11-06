import { useState, type ReactNode, type RefObject } from "react";
import { plainLabel } from "../../shared/label.ts";
import { LIMITS, SYSTEM_KIND_IDS, SYSTEM_KINDS, ZONE_KIND_IDS, ZONE_KINDS, type Connector, type Shape, type SystemKind, type Zone, type ZoneKind } from "../../shared/model.ts";
import { announce } from "../announce.tsx";
import { EmptyPlan } from "../icons.tsx";
import { moveItems, resizeShape, resizeZone, updateConnector, updateShape, updateZone, type Edge, type LayerDirection } from "./edits.ts";
import { useStore, type PageStore } from "./store.ts";

export interface InspectorActions {
  align(edge: Edge): void;
  layer(direction: LayerDirection): void;
  group(): void;
  ungroup(): void;
  duplicate(): void;
  remove(): void;
  /** Label committed or discarded with Enter or Escape: focus returns to the item. */
  labelDone(id: string): void;
}

/** The item whose fields are shown: the focused selected item, else the first selected. */
function primaryItem(store: PageStore): Zone | Shape | Connector | null {
  const doc = store.display;
  const focused = (document.activeElement as HTMLElement | null)?.dataset?.item;
  const all = [...doc.zones, ...doc.shapes, ...doc.connectors];
  return all.find((i) => i.id === focused && store.selection.has(i.id)) ?? all.find((i) => store.selection.has(i.id)) ?? null;
}

function TextField({ label, value, readOnly, maxLength, onCommit, onDone, inputRef, multiline, error }: {
  label: string; value: string; readOnly: boolean; maxLength: number; onCommit(v: string): void;
  onDone?: () => void; inputRef?: RefObject<HTMLInputElement | null>; multiline?: boolean; error?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const id = `f-${label.replace(/\W+/g, "-").toLowerCase()}`;
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  const common = {
    id,
    value: draft ?? value,
    readOnly,
    maxLength,
    "aria-describedby": error ? `${id}-error` : undefined,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea {...common} rows={3} onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            setDraft(null);
          }
        }} />
      ) : (
        <input
          {...common}
          ref={inputRef}
          type="text"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
              onDone?.();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setDraft(null);
              onDone?.();
            }
          }}
        />
      )}
      {error && <p className="field-error" id={`${id}-error`}>{error}</p>}
    </div>
  );
}

function NumberField({ label, value, readOnly, onCommit }: { label: string; value: number; readOnly: boolean; onCommit(v: number): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const id = `f-${label.toLowerCase()}`;
  const commit = () => {
    if (draft !== null) {
      const n = Number(draft);
      if (draft.trim() !== "" && Number.isFinite(n) && Math.round(n) !== value) onCommit(Math.round(n));
    }
    setDraft(null);
  };
  return (
    <div className="field field-number">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        step={1}
        value={draft ?? String(value)}
        readOnly={readOnly}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.stopPropagation();
            setDraft(null);
          }
        }}
      />
    </div>
  );
}

function Select<T extends string>({ label, value, options, disabled, onChange }: { label: string; value: T; options: [T, string][]; disabled: boolean; onChange(v: T): void }) {
  const id = `f-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, name]) => <option key={v} value={v}>{name}</option>)}
      </select>
    </div>
  );
}

const Action = ({ children, onClick, disabled }: { children: ReactNode; onClick(): void; disabled: boolean }) => (
  <button type="button" className="btn btn-small" disabled={disabled} onClick={onClick}>{children}</button>
);

export function InspectorBody({ store, actions, labelRef }: { store: PageStore; actions: InspectorActions; labelRef: RefObject<HTMLInputElement | null> }) {
  useStore(store);
  const [zoneNameError, setZoneNameError] = useState<string | undefined>();
  const item = primaryItem(store);
  const doc = store.display;
  const ro = store.readOnly;
  if (!item) {
    return (
      <div className="inspector-empty">
        <EmptyPlan width={120} />
        <p>Select a zone, shape or connector to see its fields.</p>
      </div>
    );
  }
  const count = store.selection.size;
  const edit = store.edit.bind(store);
  const moveTo = (dx: number, dy: number) => {
    const next = moveItems(store.doc, new Set([item.id]), dx, dy);
    if (next === "overlap") announce("Zones can't overlap.");
    else edit(next);
  };
  const box = (
    <div className="field-grid">
      <NumberField label="X" value={item && "x" in item ? item.x : 0} readOnly={ro} onCommit={(v) => "x" in item && moveTo(v - item.x, 0)} />
      <NumberField label="Y" value={"y" in item ? item.y : 0} readOnly={ro} onCommit={(v) => "y" in item && moveTo(0, v - item.y)} />
      <NumberField label="Width" value={"width" in item ? item.width : 0} readOnly={ro} onCommit={(v) => {
        if ("z" in item) edit(resizeShape(store.doc, item.id, v, item.height));
        else if ("kind" in item && "width" in item) {
          const next = resizeZone(store.doc, item.id, v, item.height);
          if (next === "overlap") announce("Zones can't overlap.");
          else edit(next);
        }
      }} />
      <NumberField label="Height" value={"height" in item ? item.height : 0} readOnly={ro} onCommit={(v) => {
        if ("z" in item) edit(resizeShape(store.doc, item.id, item.width, v));
        else if ("kind" in item && "width" in item) {
          const next = resizeZone(store.doc, item.id, item.width, v);
          if (next === "overlap") announce("Zones can't overlap.");
          else edit(next);
        }
      }} />
    </div>
  );

  if ("points" in item) {
    const label = (id: string) => plainLabel(doc.shapes.find((s) => s.id === id)?.label ?? "");
    return (
      <div className="inspector-body">
        <p className="inspector-kind">Connector{count > 1 ? ` · ${count} items selected` : ""}</p>
        <TextField key={item.id} label="Label" value={item.label} readOnly={ro} maxLength={LIMITS.label} inputRef={labelRef} onCommit={(v) => edit(updateConnector(store.doc, item.id, v))} onDone={() => actions.labelDone(item.id)} />
        <div className="field"><label htmlFor="f-from">From</label><input id="f-from" type="text" readOnly value={label(item.from.shapeId)} /></div>
        <div className="field"><label htmlFor="f-to">To</label><input id="f-to" type="text" readOnly value={label(item.to.shapeId)} /></div>
      </div>
    );
  }

  if ("z" in item) {
    return (
      <div className="inspector-body">
        <p className="inspector-kind">{SYSTEM_KINDS[item.kind]}{count > 1 ? ` · ${count} items selected` : ""}</p>
        <TextField key={item.id} label="Label" value={item.label} readOnly={ro} maxLength={LIMITS.label} inputRef={labelRef} onCommit={(v) => edit(updateShape(store.doc, item.id, { label: v }))} onDone={() => actions.labelDone(item.id)} />
        <Select<SystemKind> label="Kind" value={item.kind} disabled={ro} options={SYSTEM_KIND_IDS.map((k) => [k, SYSTEM_KINDS[k]])} onChange={(kind) => edit(updateShape(store.doc, item.id, { kind }))} />
        {box}
        <div className="action-grid" role="group" aria-label="Arrange">
          <Action disabled={ro} onClick={() => actions.align("left")}>Align left</Action>
          <Action disabled={ro} onClick={() => actions.align("right")}>Align right</Action>
          <Action disabled={ro} onClick={() => actions.align("top")}>Align top</Action>
          <Action disabled={ro} onClick={() => actions.align("bottom")}>Align bottom</Action>
          <Action disabled={ro} onClick={() => actions.layer("forward")}>Bring forward</Action>
          <Action disabled={ro} onClick={() => actions.layer("backward")}>Send backward</Action>
          <Action disabled={ro} onClick={actions.group}>Group</Action>
          <Action disabled={ro} onClick={actions.ungroup}>Ungroup</Action>
          <Action disabled={ro} onClick={actions.duplicate}>Duplicate</Action>
          <Action disabled={ro} onClick={actions.remove}>Delete</Action>
        </div>
      </div>
    );
  }

  const derived = store.derived;
  const zd = derived.zones.find((z) => z.id === item.id);
  const shapeLabel = (id: string) => plainLabel(doc.shapes.find((s) => s.id === id)?.label ?? "");
  const flows = derived.crossings.filter((c) => c.zoneId === item.id).map((c) => {
    const conn = doc.connectors.find((k) => k.id === c.connectorId)!;
    return `${plainLabel(conn.label)}: ${shapeLabel(conn.from.shapeId)} to ${shapeLabel(conn.to.shapeId)}, ${c.direction === "in" ? "entering" : "leaving"}`;
  });
  return (
    <div className="inspector-body">
      <p className="inspector-kind">{ZONE_KINDS[item.kind].name} zone{count > 1 ? ` · ${count} items selected` : ""}</p>
      <TextField
        key={`${item.id}-name`}
        label="Zone name"
        value={item.name}
        readOnly={ro}
        maxLength={80}
        error={zoneNameError}
        onCommit={(v) => {
          const name = v.trim();
          // Zone names follow the plain-text rule: 1 to 80 characters, no control character.
          if (name === "" || /[\u0000-\u001f\u007f-\u009f]/.test(name)) {
            setZoneNameError("Enter a zone name of 1 to 80 characters.");
            return;
          }
          setZoneNameError(undefined);
          edit(updateZone(store.doc, item.id, { name }));
        }}
      />
      <Select<ZoneKind> label="Zone kind" value={item.kind} disabled={ro} options={ZONE_KIND_IDS.map((k) => [k, ZONE_KINDS[k].name])} onChange={(kind) => edit(updateZone(store.doc, item.id, { kind }))} />
      <TextField key={`${item.id}-note`} label="Note" value={item.note} readOnly={ro} maxLength={LIMITS.note} multiline onCommit={(v) => edit(updateZone(store.doc, item.id, { note: v }))} />
      {box}
      <h3 className="list-title" id={`sys-${item.id}`}>Systems <span className="mono">{zd?.systems ?? 0}</span></h3>
      <ul className="plain-list" aria-label={`Systems in ${item.name}`}>
        {(zd?.members ?? []).map((id) => <li key={id}>{shapeLabel(id)}</li>)}
      </ul>
      <h3 className="list-title">Crossing flows <span className="mono">{flows.length}</span></h3>
      <ul className="plain-list" aria-label={`Flows crossing ${item.name}`}>
        {flows.map((f, i) => <li key={i}>{f}</li>)}
      </ul>
    </div>
  );
}
