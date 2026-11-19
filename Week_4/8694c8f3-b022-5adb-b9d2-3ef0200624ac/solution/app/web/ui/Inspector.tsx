import { ChevronDown, ChevronRight, FolderOpen, Image, Lock, Unlock, X } from "lucide-react";
import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { snapTick } from "../../shared/beat.ts";
import { BUS_LABELS, KEYABLE_PROPERTIES, KINDS_WITH_BUSES, KINDS_WITH_MATERIAL } from "../../shared/layers.ts";
import type { LayerDoc, OutputBus } from "../../shared/types.ts";
import { OUTPUT_BUSES } from "../../shared/types.ts";
import type { EditorStore } from "../store/editor.ts";
import { Modal } from "./Modal.tsx";
import { ScrubField } from "./ScrubField.tsx";

function toHex(tint: [number, number, number]): string {
  return `#${tint.map((part) => Math.round(part * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function contrastOn(tint: [number, number, number]): string {
  return tint[0] * 0.299 + tint[1] * 0.587 + tint[2] * 0.114 > 0.55 ? "#000000" : "#ffffff";
}

function KeyDot({ store, layer, path, label }: { store: EditorStore; layer: LayerDoc; path: string; label: string }) {
  const tick = snapTick(store.transport.tick());
  const key = store.doc.keys.find((candidate) => candidate.layer_id === layer.id && candidate.property === path && candidate.tick === tick);
  const toggle = (): void => {
    if (key) store.commit({ type: "key.remove", target: layer.id, payload: { property: path, tick } });
    else store.commit({ type: "key.set", target: layer.id, payload: { property: path, tick, value: store.valueOf(layer.id, path) ?? 0 } });
  };
  return (
    <button type="button" className="keydot" aria-label={`Keyframe ${label}`} aria-pressed={Boolean(key)} disabled={!store.canEdit} onClick={toggle} />
  );
}

function ValueField({ store, layer, path, label, min, max, decimals }: { store: EditorStore; layer: LayerDoc; path: string; label: string; min?: number; max?: number; decimals?: number }) {
  const spec = KEYABLE_PROPERTIES[path];
  const value = store.valueOf(layer.id, path) ?? 0;
  return (
    <div className="value-cell" data-keyrow={path}>
      <KeyDot store={store} layer={layer} path={path} label={label} />
      <ScrubField
        label={label}
        value={value}
        min={min ?? spec?.min ?? 0}
        max={max ?? spec?.max ?? 1}
        decimals={decimals}
        disabled={!store.canEdit}
        error={store.fieldErrors.get(`${layer.id}:value`)}
        onPreview={(next) => store.preview(layer.id, path, next)}
        onCommit={(next) => store.setLayerValue(layer.id, path, next)}
        onScrubStart={() => store.beginScrub(layer.id, path)}
        onScrubEnd={() => store.endScrub()}
      />
    </div>
  );
}

function Row({ label, children, keyed = false }: { label: string; children: ReactNode; keyed?: boolean }) {
  return (
    <div className="row" data-keyed={keyed ? "true" : undefined}>
      <span className="row-label">{label}</span>
      <div className="row-value">{children}</div>
    </div>
  );
}

function Drawer({ name, open, onToggle, children }: { name: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="drawer" data-open={open ? "true" : "false"}>
      <h3 className="drawer-head">
        <button type="button" aria-expanded={open} onClick={onToggle}>
          {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
          <span>{name}</span>
        </button>
      </h3>
      <div className="drawer-body" aria-hidden={!open}>
        <div className="drawer-inner">{children}</div>
      </div>
    </section>
  );
}

function VectorRow({ store, layer, group, title }: { store: EditorStore; layer: LayerDoc; group: "position" | "rotation" | "scale"; title: string }) {
  return (
    <Row label={title} keyed>
      <div className="triple">
        {(["x", "y", "z"] as const).map((axis) => (
          <ValueField key={axis} store={store} layer={layer} path={`${group}.${axis}`} label={`${title} ${axis.toUpperCase()}`} decimals={2} />
        ))}
      </div>
    </Row>
  );
}

function TextureSlot({ store, layer, slot }: { store: EditorStore; layer: LayerDoc; slot: "albedo" | "emissive" }) {
  const [choosing, setChoosing] = useState(false);
  const caption = slot === "albedo" ? "Albedo" : "Emissive";
  const id = slot === "albedo" ? layer.material?.albedo_texture_id : layer.material?.emissive_texture_id;
  const bound = store.assets.find((asset) => asset.id === id);
  const path = slot === "albedo" ? "material.albedo_texture_id" : "material.emissive_texture_id";
  return (
    <Row label={caption}>
      <div role="group" aria-label={`${caption} texture`} className="slot">
        <Image size={12} aria-hidden="true" className="slot-icon" />
        <span className={bound ? "slot-name" : "slot-name empty"}>{bound ? bound.name : "Texture"}</span>
        <button type="button" className="mini" aria-label={`Browse texture for ${caption}`} disabled={!store.canEdit} onClick={() => setChoosing(true)}>
          <FolderOpen size={12} aria-hidden="true" />
        </button>
        <button type="button" className="mini" aria-label={`Clear ${caption}`} disabled={!store.canEdit || !id} onClick={() => store.setLayerValue(layer.id, path, null)}>
          <X size={12} aria-hidden="true" />
        </button>
      </div>
      {choosing ? <TexturePicker store={store} current={id ?? null} onClose={() => setChoosing(false)} onUse={(assetId) => store.setLayerValue(layer.id, path, assetId)} /> : null}
    </Row>
  );
}

function TexturePicker({ store, current, onClose, onUse }: { store: EditorStore; current: string | null; onClose: () => void; onUse: (assetId: string) => void }) {
  const textures = store.assets.filter((asset) => asset.kind === "texture" && asset.status === "ready");
  const [picked, setPicked] = useState<string | null>(current);
  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const at = textures.findIndex((asset) => asset.id === picked);
    const next = event.key === "ArrowDown" ? textures[at + 1] : event.key === "ArrowUp" ? textures[Math.max(0, at - 1)] : undefined;
    if (next) {
      event.preventDefault();
      setPicked(next.id);
    }
  };
  return (
    <Modal title="Choose texture" onClose={onClose}>
      {(titleId) => (
        <>
          <h2 id={titleId} className="modal-title small">Choose texture</h2>
          {textures.length === 0 ? <p className="muted">No ready textures yet</p> : null}
          <div role="listbox" aria-label="Textures" className="choices" onKeyDown={onKey}>
            {textures.map((asset) => (
              <div
                key={asset.id}
                role="option"
                aria-selected={asset.id === picked}
                tabIndex={asset.id === picked || (picked === null && asset === textures[0]) ? 0 : -1}
                className="choice"
                onClick={() => setPicked(asset.id)}
              >
                {asset.name}
              </div>
            ))}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button
              type="button"
              className="btn"
              disabled={picked === null}
              onClick={() => {
                if (picked) onUse(picked);
                onClose();
              }}
            >
              Use texture
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function TintRow({ store, layer }: { store: EditorStore; layer: LayerDoc }) {
  const [open, setOpen] = useState(false);
  const tint = layer.material?.tint ?? [1, 1, 1];
  return (
    <Row label="Tint">
      <div className="swatch-wrap">
        <button type="button" className="swatch" aria-label="Tint" style={{ background: toHex(tint) }} disabled={!store.canEdit} onClick={() => setOpen(true)} />
        <span className="swatch-hex" style={{ color: contrastOn(tint) }}>{toHex(tint)}</span>
      </div>
      {open ? (
        <Modal title="Tint" onClose={() => setOpen(false)}>
          {(titleId) => (
            <>
              <h2 id={titleId} className="modal-title small">Tint</h2>
              {(["Red", "Green", "Blue"] as const).map((channel, index) => (
                <div className="row" key={channel}>
                  <span className="row-label">{channel}</span>
                  <div className="row-value">
                    <ScrubField
                      label={channel}
                      value={tint[index] ?? 1}
                      min={0}
                      max={1}
                      onPreview={() => undefined}
                      onCommit={(next) => {
                        const parts: [number, number, number] = [...tint];
                        parts[index] = next;
                        store.setLayerValue(layer.id, "material.tint", parts);
                      }}
                    />
                  </div>
                </div>
              ))}
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setOpen(false)}>Done</button>
              </div>
            </>
          )}
        </Modal>
      ) : null}
    </Row>
  );
}

function BusRow({ store, layer }: { store: EditorStore; layer: LayerDoc }) {
  const [open, setOpen] = useState(false);
  const toggle = (bus: OutputBus): void => {
    const next = layer.output_buses.includes(bus) ? layer.output_buses.filter((candidate) => candidate !== bus) : [...layer.output_buses, bus];
    if (next.length > 0) store.setLayerValue(layer.id, "output_buses", next);
  };
  return (
    <Row label="Buses">
      <div className="pick-field">
        <span className="pick-text">{OUTPUT_BUSES.filter((bus) => layer.output_buses.includes(bus)).map((bus) => BUS_LABELS[bus]).join(", ")}</span>
        <button type="button" className="mini" aria-label="Choose output buses" disabled={!store.canEdit} onClick={() => setOpen(true)}>…</button>
      </div>
      {open ? (
        <Modal title="Output buses" onClose={() => setOpen(false)}>
          {(titleId) => (
            <>
              <h2 id={titleId} className="modal-title small">Output buses</h2>
              {OUTPUT_BUSES.map((bus) => (
                <label key={bus} className="check">
                  <input type="checkbox" checked={layer.output_buses.includes(bus)} onChange={() => toggle(bus)} />
                  <span>{BUS_LABELS[bus]}</span>
                </label>
              ))}
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setOpen(false)}>Done</button>
              </div>
            </>
          )}
        </Modal>
      ) : null}
    </Row>
  );
}

export function Inspector({ store }: { store: EditorStore }) {
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const layer = store.selected;
  if (!layer) {
    return (
      <section aria-label="Inspector" role="region" className="inspector empty">
        <p className="muted">Select a layer to edit it.</p>
      </section>
    );
  }
  const drawer = (name: string, body: ReactNode): ReactNode => (
    <Drawer name={name} open={!closed.has(name)} onToggle={() => setClosed((previous) => {
      const next = new Set(previous);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    })}>
      {body}
    </Drawer>
  );
  const mine = store.heldByMe(layer.id);
  const onRowKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key.toLowerCase() !== "k" || (event.target as HTMLElement).tagName === "INPUT") return;
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-keyrow]");
    if (!row) return;
    event.preventDefault();
    row.querySelector<HTMLButtonElement>(".keydot")?.click();
  };
  const near = layer.props["near"] ?? 0.1;
  const far = layer.props["far"] ?? 200;
  return (
    <section aria-label="Inspector" role="region" className="inspector" onKeyDown={onRowKey}>
      <header className="inspector-head">
        <h2>{layer.name}</h2>
        {store.mode === "live" && store.canEdit ? (
          <button type="button" className="btn pt" onClick={() => void (mine ? store.releaseLock(layer.id) : store.takeLock(layer.id))}>
            {mine ? <Unlock size={12} aria-hidden="true" /> : <Lock size={12} aria-hidden="true" />}
            {mine ? "Release lock" : "Take lock"}
          </button>
        ) : null}
      </header>
      <div className="inspector-scroll">
        {drawer("Transform", (
          <>
            <VectorRow store={store} layer={layer} group="position" title="Position" />
            <VectorRow store={store} layer={layer} group="rotation" title="Rotation" />
            <VectorRow store={store} layer={layer} group="scale" title="Scale" />
          </>
        ))}
        {layer.kind === "camera" ? drawer("Camera", (
          <>
            <Row label="View" keyed><ValueField store={store} layer={layer} path="props.fov" label="Field of view" /></Row>
            <Row label="Range" keyed>
              <div className="pair">
                <ValueField store={store} layer={layer} path="props.near" label="Near plane" max={Math.min(10, far - 0.01)} />
                <ValueField store={store} layer={layer} path="props.far" label="Far plane" min={near + 0.01} />
              </div>
            </Row>
          </>
        )) : null}
        {KINDS_WITH_MATERIAL.includes(layer.kind) ? drawer("Material", (
          <>
            <TintRow store={store} layer={layer} />
            <Row label="Tint alpha" keyed><ValueField store={store} layer={layer} path="material.tint_alpha" label="Tint alpha" /></Row>
            <TextureSlot store={store} layer={layer} slot="albedo" />
            <TextureSlot store={store} layer={layer} slot="emissive" />
          </>
        )) : null}
        {layer.kind === "tube" ? drawer("Shape", (
          <>
            <Row label="Twist" keyed><ValueField store={store} layer={layer} path="props.twist" label="Twist" /></Row>
            <Row label="Radius" keyed><ValueField store={store} layer={layer} path="props.radius" label="Radius" /></Row>
          </>
        )) : null}
        {layer.kind === "model" ? drawer("Model", (
          <Row label="Asset">
            <select
              className="select"
              aria-label="Model asset"
              value={layer.model_asset_id ?? ""}
              disabled={!store.canEdit}
              onChange={(event) => store.setLayerValue(layer.id, "model_asset_id", event.target.value === "" ? null : event.target.value)}
            >
              <option value="">None</option>
              {store.assets.filter((asset) => asset.kind === "model" && asset.status === "ready").map((asset) => (
                <option key={asset.id} value={asset.id}>{asset.name}</option>
              ))}
            </select>
          </Row>
        )) : null}
        {layer.kind === "light" ? drawer("Light", (
          <Row label="Intensity" keyed><ValueField store={store} layer={layer} path="props.intensity" label="Intensity" /></Row>
        )) : null}
        {KINDS_WITH_BUSES.includes(layer.kind) ? drawer("Outputs", <BusRow store={store} layer={layer} />) : null}
      </div>
    </section>
  );
}
