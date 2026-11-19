import { useState } from 'react';
import type { PieceInput } from '../../shared/protocol.js';
import { writeView } from '../lib/viewState.js';
import { useStore } from '../store.js';
import { useRouteChoice } from './RouteChoice.js';
import {
  BuildGlyph,
  HeadingNeedle,
  OperateGlyph,
  PlayGlyph,
  ReturnGlyph,
  TileGlyph,
} from './Art.js';

const TILES: { name: string; piece: PieceInput }[] = [
  { name: 'Straight 12 in', piece: { kind: 'straight', length_mm: 305 } },
  { name: 'Straight 6 in', piece: { kind: 'straight', length_mm: 152 } },
  {
    name: 'Curve left',
    piece: { kind: 'curve', radius_mm: 1067, angle_deg: 15, hand: 'left' },
  },
  {
    name: 'Curve right',
    piece: { kind: 'curve', radius_mm: 1067, angle_deg: 15, hand: 'right' },
  },
  {
    name: 'Turnout left',
    piece: { kind: 'turnout', frog_number: 6, hand: 'left', length_mm: 305 },
  },
  {
    name: 'Turnout right',
    piece: { kind: 'turnout', frog_number: 6, hand: 'right', length_mm: 305 },
  },
  { name: 'Rise', piece: { kind: 'straight', length_mm: 1219, rise_mm: 19 } },
  { name: 'Fall', piece: { kind: 'straight', length_mm: 1219, rise_mm: -19 } },
];

export function TileRail(): JSX.Element {
  const { actions, lastTile } = useStore();
  return (
    <div role="toolbar" aria-label="Track pieces" data-testid="tile-rail" className="tile-rail">
      {TILES.map((tile) => (
        <button
          key={tile.name}
          className="tile"
          aria-label={tile.name}
          onClick={() => void actions.appendPiece(tile.name, tile.piece)}
        >
          <TileGlyph name={tile.name} />
          <span className="tile-name">{tile.name}</span>
          <span className={lastTile === tile.name ? 'tile-ring filled' : 'tile-ring'} />
        </button>
      ))}
      <button
        className="tile"
        aria-label="Undo last piece"
        onClick={() => void actions.undoLastPiece()}
      >
        <TileGlyph name="Undo last piece" />
        <span className="tile-name">Undo last piece</span>
        <span className="tile-ring" />
      </button>
    </div>
  );
}

function AddModuleDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { actions } = useStore();
  const [name, setName] = useState('');
  const [endplate, setEndplate] = useState('single');
  return (
    <div className="modal-centre" onKeyDown={(event) => event.key === 'Escape' && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Add module"
        className="modal-card"
        onSubmit={(event) => {
          event.preventDefault();
          void actions
            .addModule(name, endplate === 'double' ? 'double' : 'single')
            .then(onClose);
        }}
      >
        <h2>Add module</h2>
        <label className="field">
          <span>Module name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field">
          <span>Endplate</span>
          <select value={endplate} onChange={(event) => setEndplate(event.target.value)}>
            <option value="single">Single</option>
            <option value="double">Double</option>
          </select>
        </label>
        <button className="lipped" type="submit">
          Create module
        </button>
        <button className="mini" type="button" onClick={onClose}>
          Close
        </button>
      </form>
    </div>
  );
}

function SaveVersionDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { actions } = useStore();
  const [label, setLabel] = useState('');
  return (
    <div className="modal-centre" onKeyDown={(event) => event.key === 'Escape' && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Save version"
        className="modal-card"
        onSubmit={(event) => {
          event.preventDefault();
          void actions.saveVersion(label).then(onClose);
        }}
      >
        <h2>Save version</h2>
        <label className="field">
          <span>Version label</span>
          <input value={label} onChange={(event) => setLabel(event.target.value)} />
        </label>
        <button className="lipped" type="submit">
          Save
        </button>
        <button className="mini" type="button" onClick={onClose}>
          Close
        </button>
      </form>
    </div>
  );
}

export function BuildActions(): JSX.Element {
  const { actions, view, layout } = useStore();
  const [addModule, setAddModule] = useState(false);
  const [saveVersion, setSaveVersion] = useState(false);
  const selectable = Boolean(view.piece ?? view.end);
  return (
    <div className="build-actions">
      <button className="lipped" onClick={() => setAddModule(true)}>
        Add module
      </button>
      <button
        className="lipped quiet"
        data-testid="trash-module"
        disabled={!selectable || !layout}
        onClick={() => void actions.trashModule()}
      >
        Trash module
      </button>
      <button className="lipped quiet" onClick={() => void actions.checkLayout()}>
        Check layout
      </button>
      <button className="lipped quiet" onClick={() => setSaveVersion(true)}>
        Save version
      </button>
      {addModule ? <AddModuleDialog onClose={() => setAddModule(false)} /> : null}
      {saveVersion ? <SaveVersionDialog onClose={() => setSaveVersion(false)} /> : null}
    </div>
  );
}

export function BottomEdge({
  onOpenSchematic,
}: {
  onOpenSchematic: () => void;
}): JSX.Element {
  const { view, session, actions } = useStore();
  const choice = useRouteChoice();
  const operate = view.mode === 'operate';
  const selectedTrain = session?.trains.find((train) => train.id === view.train) ?? null;

  return (
    <div className="bottom-edge">
      <div className="bottom-centre">
        {operate ? null : <BuildActions />}
        {operate ? null : <TileRail />}
      </div>

      <div className="bottom-left">
        {operate ? (
          <>
            <button
              className="round-action"
              aria-label="Highball"
              data-testid="highball"
              disabled={!selectedTrain}
              onClick={() => {
                const destination = choice.destination || view.block;
                if (!selectedTrain || !destination) return;
                void actions.highball(
                  selectedTrain.id,
                  destination,
                  choice.via || null,
                  choice.timeLimitMinutes * 60,
                );
              }}
            >
              <PlayGlyph />
            </button>
            <button
              className="round-action"
              aria-label="Recall"
              data-testid="recall"
              disabled={!selectedTrain}
              onClick={() => selectedTrain && void actions.recall(selectedTrain.id)}
            >
              <ReturnGlyph />
            </button>
          </>
        ) : null}
        <button
          className="heading-dial"
          aria-label="Rotate heading"
          data-testid="heading-dial"
          onClick={() => writeView({ heading: (view.heading + 45) % 360 })}
        >
          <HeadingNeedle heading={view.heading} />
        </button>
        {operate ? (
          <button className="mini phone-only" onClick={onOpenSchematic}>
            Schematic
          </button>
        ) : null}
      </div>

      <button
        role="switch"
        aria-label="Operate mode"
        aria-checked={operate}
        data-testid="mode-switch"
        className="mode-switch"
        onClick={() => {
          if (!operate && !session) {
            writeView({ sheet: 'sessions' });
            void actions.refreshSheet('sessions');
            return;
          }
          writeView({ mode: operate ? 'build' : 'operate' });
        }}
      >
        <BuildGlyph className={operate ? 'glyph-idle' : 'glyph-active'} />
        <span className="mode-track">
          <span className="mode-knob" />
        </span>
        <OperateGlyph className={operate ? 'glyph-active' : 'glyph-idle'} />
      </button>
    </div>
  );
}
