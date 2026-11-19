import { useState } from 'react';
import { store } from '../store.js';
import { Dialog, Drawer, FieldError, KeyDot, ScrubField, useStoreState } from './common.js';
import { findLayer, readPath } from '../document.js';
import {
  BUS_KINDS,
  BUS_LABELS,
  isKeyableProperty,
  OUTPUT_BUSES,
  RANGES,
  snapToQuarterBeat,
  type OutputBus,
} from '../../shared/domain.js';
import type { AssetDoc, LayerDoc } from '../../shared/types.js';

interface RowProps {
  label: string;
  path: string;
  layer: LayerDoc;
  min: number;
  max: number;
}

function Field({ label, path, layer, min, max }: RowProps) {
  const state = useStoreState();
  const keyable = isKeyableProperty(path);
  const tick = snapToQuarterBeat(state.tick);
  const keyed = state.doc?.keys.some(
    (key) => key.layer_id === layer.id && key.property === path && key.tick === tick,
  );
  return (
    <div className="value-cell" data-keyable={keyable ? path : undefined}>
      <ScrubField
        label={label}
        value={readPath(layer, path)}
        min={min}
        max={max}
        onPreview={(next) => store.preview(layer.id, path, next)}
        onCommit={(next) => store.setLayerPath(layer.id, path, next)}
      />
      {keyable ? (
        <KeyDot
          label={label}
          pressed={keyed === true}
          onKey={() => store.keyProperty(layer.id, path, readPath(layer, path))}
        />
      ) : null}
      {state.errorPath === path ? <FieldError message={state.fieldErrors['value']} /> : null}
    </div>
  );
}

function ValueRow(props: RowProps) {
  return (
    <div className="form-row">
      <span className="label">{props.label}</span>
      <Field {...props} />
    </div>
  );
}

function VectorRow({ label, group, layer }: { label: string; group: 'position' | 'rotation' | 'scale'; layer: LayerDoc }) {
  const range = group === 'scale' ? RANGES.scale : group === 'rotation' ? RANGES.rotation : RANGES.position;
  const names = group === 'position' ? 'Position' : group === 'rotation' ? 'Rotation' : 'Scale';
  return (
    <div className="form-row">
      <span className="label">{label}</span>
      <div className="vector">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <Field
            key={axis}
            label={`${names} ${axis.toUpperCase()}`}
            path={`${group}.${axis}`}
            layer={layer}
            min={range.min}
            max={range.max}
          />
        ))}
      </div>
    </div>
  );
}

function TextureSlot({
  layer,
  slot,
  assets,
}: {
  layer: LayerDoc;
  slot: 'Albedo' | 'Emissive';
  assets: AssetDoc[];
}) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const path = slot === 'Albedo' ? 'material.albedo_texture_id' : 'material.emissive_texture_id';
  const bound = slot === 'Albedo' ? layer.material?.albedo_texture_id : layer.material?.emissive_texture_id;
  const boundAsset = assets.find((asset) => asset.id === bound);
  const textures = assets.filter((asset) => asset.kind === 'texture' && asset.status === 'ready');
  return (
    <div className="form-row" role="group" aria-label={`${slot} texture`}>
      <span className="label">{slot} texture</span>
      <div className="value-cell">
        <span className="grow">{boundAsset?.name ?? 'Texture'}</span>
        <button
          type="button"
          className="row-button"
          aria-label={`Browse texture for ${slot}`}
          onClick={() => setOpen(true)}
        >
          Browse
        </button>
        <button
          type="button"
          className="row-button"
          aria-label={`Clear ${slot}`}
          onClick={() => store.setLayerPath(layer.id, path, null)}
        >
          Clear
        </button>
      </div>
      {open ? (
        <Dialog title="Choose texture" onClose={() => setOpen(false)}>
          <ul className="listbox" role="listbox" aria-label="Textures" tabIndex={0}>
            {textures.map((asset) => (
              <li
                key={asset.id}
                role="option"
                aria-selected={chosen === asset.id}
                onClick={() => setChosen(asset.id)}
              >
                {asset.name}
              </li>
            ))}
          </ul>
          <div className="dialog-actions">
            <button
              type="button"
              className="row-button"
              onClick={() => {
                if (chosen !== null) store.setLayerPath(layer.id, path, chosen);
                setOpen(false);
              }}
            >
              Use texture
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

function TintRow({ layer }: { layer: LayerDoc }) {
  const [open, setOpen] = useState(false);
  const tint = layer.material?.tint ?? [1, 1, 1];
  const channels: ['Red', 'Green', 'Blue'] = ['Red', 'Green', 'Blue'];
  return (
    <div className="form-row">
      <span className="label">Tint</span>
      <div className="value-cell">
        <button type="button" className="row-button" onClick={() => setOpen(true)}>
          Tint
        </button>
        {open ? (
          <Dialog title="Tint" onClose={() => setOpen(false)}>
            {channels.map((channel, index) => (
              <div className="form-row" key={channel}>
                <span className="label">{channel}</span>
                <ScrubField
                  label={channel}
                  value={tint[index] ?? 0}
                  min={0}
                  max={1}
                  onPreview={(next) => {
                    const updated = [...tint];
                    updated[index] = next;
                    store.preview(layer.id, 'material.tint', updated);
                  }}
                  onCommit={(next) => {
                    const updated = [...tint];
                    updated[index] = next;
                    store.setLayerPath(layer.id, 'material.tint', updated);
                  }}
                />
              </div>
            ))}
            <div className="dialog-actions">
              <button type="button" className="row-button" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </Dialog>
        ) : null}
      </div>
    </div>
  );
}

function OutputsDrawer({ layer }: { layer: LayerDoc }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<OutputBus[]>(layer.output_buses);
  return (
    <Drawer name="Outputs">
      <div className="form-row">
        <span className="label">Output buses</span>
        <div className="value-cell">
          <span className="grow">{layer.output_buses.map((bus) => BUS_LABELS[bus]).join(', ')}</span>
          <button
            type="button"
            className="row-button"
            onClick={() => {
              setDraft(layer.output_buses);
              setOpen(true);
            }}
          >
            Choose output buses
          </button>
        </div>
      </div>
      {open ? (
        <Dialog title="Output buses" onClose={() => setOpen(false)}>
          {OUTPUT_BUSES.map((bus) => (
            <label className="checkrow" key={bus}>
              <input
                type="checkbox"
                checked={draft.includes(bus)}
                onChange={(event) =>
                  setDraft(
                    event.target.checked ? [...draft, bus] : draft.filter((entry) => entry !== bus),
                  )
                }
              />
              {BUS_LABELS[bus]}
            </label>
          ))}
          <div className="dialog-actions">
            <button
              type="button"
              className="row-button"
              onClick={() => {
                if (draft.length > 0) store.setLayerPath(layer.id, 'output_buses', draft);
                setOpen(false);
              }}
            >
              Done
            </button>
          </div>
        </Dialog>
      ) : null}
    </Drawer>
  );
}

export function Inspector() {
  const state = useStoreState();
  const layer = findLayer(state.doc, state.selection);
  if (layer === null) {
    return (
      <section className="inspector" aria-label="Inspector">
        <p className="status-line">Select a layer to edit it</p>
      </section>
    );
  }
  const heldByMe = store.heldByMe(layer.id);
  const models = state.assets.filter((asset) => asset.kind === 'model' && asset.status === 'ready');

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'k' && event.key !== 'K') return;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && active.getAttribute('role') !== 'spinbutton') return;
    const cell = active?.closest('[data-keyable]');
    const path = cell?.getAttribute('data-keyable');
    if (path === null || path === undefined) return;
    event.preventDefault();
    store.keyProperty(layer.id, path, readPath(layer, path));
  };

  return (
    <section className="inspector" aria-label="Inspector" onKeyDown={onKeyDown}>
      <div className="inspector-head">
        <h2>{layer.name}</h2>
        {state.demo ? null : (
          <button
            type="button"
            className="row-button"
            onClick={() => (heldByMe ? void store.releaseLock(layer.id) : void store.takeLock(layer.id))}
          >
            {heldByMe ? 'Release lock' : 'Take lock'}
          </button>
        )}
      </div>

      <Drawer name="Transform">
        <VectorRow label="Position" group="position" layer={layer} />
        <VectorRow label="Rotation" group="rotation" layer={layer} />
        <VectorRow label="Scale" group="scale" layer={layer} />
      </Drawer>

      {layer.kind === 'camera' ? (
        <Drawer name="Camera">
          <ValueRow
            label="Field of view"
            path="props.fov"
            layer={layer}
            min={RANGES.fov.min}
            max={RANGES.fov.max}
          />
          <div className="form-row">
            <span className="label">Planes</span>
            <div className="pair">
              <Field
                label="Near plane"
                path="props.near"
                layer={layer}
                min={RANGES.near.min}
                max={RANGES.near.max}
              />
              <Field
                label="Far plane"
                path="props.far"
                layer={layer}
                min={RANGES.far.min}
                max={RANGES.far.max}
              />
            </div>
          </div>
        </Drawer>
      ) : null}

      {layer.kind === 'light' ? (
        <Drawer name="Light">
          <ValueRow
            label="Intensity"
            path="props.intensity"
            layer={layer}
            min={RANGES.intensity.min}
            max={RANGES.intensity.max}
          />
        </Drawer>
      ) : null}

      {layer.kind === 'tube' ? (
        <Drawer name="Shape">
          <ValueRow label="Twist" path="props.twist" layer={layer} min={RANGES.twist.min} max={RANGES.twist.max} />
          <ValueRow
            label="Radius"
            path="props.radius"
            layer={layer}
            min={RANGES.radius.min}
            max={RANGES.radius.max}
          />
        </Drawer>
      ) : null}

      {layer.material === null ? null : (
        <Drawer name="Material">
          <TintRow layer={layer} />
          <ValueRow
            label="Tint alpha"
            path="material.tint_alpha"
            layer={layer}
            min={RANGES.tint_alpha.min}
            max={RANGES.tint_alpha.max}
          />
          <TextureSlot layer={layer} slot="Albedo" assets={state.assets} />
          <TextureSlot layer={layer} slot="Emissive" assets={state.assets} />
        </Drawer>
      )}

      {layer.kind === 'model' ? (
        <Drawer name="Model">
          <div className="form-row">
            <label htmlFor="model-asset">Model asset</label>
            <select
              id="model-asset"
              aria-label="Model asset"
              value={layer.model_asset_id ?? ''}
              onChange={(event) =>
                store.setLayerPath(
                  layer.id,
                  'model_asset_id',
                  event.target.value === '' ? null : event.target.value,
                )
              }
            >
              <option value="">No model</option>
              {models.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </select>
          </div>
        </Drawer>
      ) : null}

      {BUS_KINDS.includes(layer.kind) ? <OutputsDrawer layer={layer} /> : null}
    </section>
  );
}
