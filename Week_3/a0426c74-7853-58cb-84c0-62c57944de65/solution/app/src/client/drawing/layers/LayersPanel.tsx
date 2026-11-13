import { useState } from 'react';
import type { FormEvent } from 'react';
import { isXrefId } from '../../../shared/geometry/index.ts';
import { COLOURS, LINETYPES, LINEWEIGHTS } from '../../../shared/types.ts';
import type { Layer, Op } from '../../../shared/types.ts';
import { Button } from '../../ui/index.ts';
import { useDrawingSlice, useDrawingStore, useScene } from '../../store/index.ts';
import { Toggle } from '../controls/Toggle.tsx';
import { useFocusTarget } from '../focusTargets.tsx';
import '../../styles/drawing/layers.css';

type LayerChange = Extract<Op, { type: 'layer_set' }>['set'];

const NEW_LAYER = { colour: 'white', linetype: 'Continuous', lineweight: 0.25 } as const;

/** The option of `options` whose text is `value`; the select only offers those, so it is always found. */
function chosen<T extends string | number>(options: readonly T[], value: string): T | undefined {
  return options.find((option) => String(option) === value);
}

const TOGGLE_HEADS = ['On', 'Frozen', 'Locked'] as const;
const STYLE_HEADS = ['Colour', 'Linetype', 'Lineweight'] as const;

/** The header row of the grid: the columns of an editable row, or a single `State` column where every row is a sentence. */
function LayerHeader({ editable }: { editable: boolean }) {
  return (
    <div className="layer-row layer-row--head" role="row">
      <div role="columnheader">Layer</div>
      {editable ? (
        <>
          {TOGGLE_HEADS.map((head) => <div key={head} className="layer-row__flag" role="columnheader">{head}</div>)}
          <div className="layer-row__styles" role="presentation">
            {STYLE_HEADS.map((head) => <div key={head} role="columnheader">{head}</div>)}
          </div>
        </>
      ) : (
        <div className="layer-row__styles" role="columnheader">State</div>
      )}
    </div>
  );
}

function LayerRow({ layer, editable, onChange }: { layer: Layer; editable: boolean; onChange: (change: LayerChange) => void }) {
  return (
    <div className="layer-row" role="row">
      <div className="layer-row__name strong" role="gridcell">{layer.name}</div>
      {editable ? (
        <>
          <div role="gridcell"><Toggle pressed={layer.on} onClick={() => onChange({ on: !layer.on })}>On</Toggle></div>
          <div role="gridcell"><Toggle pressed={layer.frozen} onClick={() => onChange({ frozen: !layer.frozen })}>Frozen</Toggle></div>
          <div role="gridcell"><Toggle pressed={layer.locked} onClick={() => onChange({ locked: !layer.locked })}>Locked</Toggle></div>
          <div className="layer-row__styles" role="gridcell">
            <select className="field" aria-label="Colour" value={layer.colour} onChange={(event) => {
              const colour = chosen(COLOURS, event.target.value);
              if (colour) onChange({ colour });
            }}>
              {COLOURS.map((colour) => <option key={colour} value={colour}>{colour}</option>)}
            </select>
            <select className="field" aria-label="Linetype" value={layer.linetype} onChange={(event) => {
              const linetype = chosen(LINETYPES, event.target.value);
              if (linetype) onChange({ linetype });
            }}>
              {LINETYPES.map((linetype) => <option key={linetype} value={linetype}>{linetype}</option>)}
            </select>
            <select className="field" aria-label="Lineweight" value={String(layer.lineweight)} onChange={(event) => {
              const lineweight = chosen(LINEWEIGHTS, event.target.value);
              if (lineweight !== undefined) onChange({ lineweight });
            }}>
              {LINEWEIGHTS.map((weight) => <option key={weight} value={String(weight)}>{`${weight} mm`}</option>)}
            </select>
          </div>
        </>
      ) : (
        <div className="layer-row__styles muted" role="gridcell">
          {[layer.on ? 'on' : 'off', layer.frozen ? 'frozen' : null, layer.locked ? 'locked' : null, layer.colour, layer.linetype, `${layer.lineweight} mm`]
            .filter(Boolean).join(', ')}
        </div>
      )}
    </div>
  );
}

/** `grid "Layer list"` of the layers of the screen's scene: read-only for xref layers and for people who cannot edit. */
export function LayerList({ edit }: { edit: ((name: string, change: LayerChange) => void) | null }) {
  const scene = useScene();
  const focusRef = useFocusTarget('layer-list');
  return (
    <div className="layer-list" role="grid" aria-label="Layer list" tabIndex={-1} ref={focusRef}>
      <LayerHeader editable={edit !== null} />
      {scene.layers.map((layer) => (
        <LayerRow
          key={layer.name}
          layer={layer}
          editable={edit !== null && !isXrefId(layer.name)}
          onChange={(change) => edit?.(layer.name, change)}
        />
      ))}
    </div>
  );
}

function NameForm({ label, action, onSubmit }: { label: string; action: string; onSubmit: (name: string) => void }) {
  const [name, setName] = useState('');
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSubmit(name.trim());
    setName('');
  }
  return (
    <form className="field-row" onSubmit={submit}>
      <input className="field" type="text" aria-label={label} placeholder={label} autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} />
      <Button type="submit">{action}</Button>
    </form>
  );
}

/** `region "Layers"` of the live drawing: layer list, current layer, new layer, saved states. */
export function LayersPanel() {
  const store = useDrawingStore();
  const scene = useScene();
  const canEdit = useDrawingSlice((snapshot) => snapshot.canEdit);
  const currentLayer = useDrawingSlice((snapshot) => snapshot.currentLayer);
  const layerStates = useDrawingSlice((snapshot) => snapshot.state.layer_states);
  const modelLayers = scene.layers.filter((layer) => !isXrefId(layer.name));

  if (!canEdit) return <LayerList edit={null} />;
  return (
    <>
      <div className="field-row">
        <label className="label" htmlFor="current-layer">Current layer</label>
        <select id="current-layer" className="field" value={currentLayer} onChange={(event) => store.setCurrentLayer(event.target.value)}>
          {modelLayers.map((layer) => <option key={layer.name} value={layer.name}>{layer.name}</option>)}
        </select>
      </div>
      <LayerList edit={(name, set) => store.edit('LAYER', [{ type: 'layer_set', name, set }])} />
      <NameForm
        label="Layer name"
        action="New layer"
        onSubmit={(name) => store.edit('LAYER', [{ type: 'layer_add', name, ...NEW_LAYER }])}
      />
      <NameForm
        label="Layer state name"
        action="Save layer state"
        onSubmit={(name) => store.edit('LAYERSTATE', [{ type: 'layer_state_save', name }])}
      />
      <ul className="list" role="list" aria-label="Layer states">
        {Object.keys(layerStates).map((name) => (
          <li key={name} className="line">
            <span className="strong">{name}</span>
            <Button onClick={() => store.edit('LAYERSTATE', [{ type: 'layer_state_restore', name }])}>Restore</Button>
          </li>
        ))}
      </ul>
    </>
  );
}
