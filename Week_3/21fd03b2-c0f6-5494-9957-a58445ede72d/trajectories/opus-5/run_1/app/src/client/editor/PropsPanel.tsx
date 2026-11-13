import { useRef, useState } from 'react';
import { useRovingTabIndex } from '../components/roving.js';
import type { AssetRow } from '../../shared/api.js';
import { emptyCopy } from '../../shared/copy.js';
import { RIG_KINDS, RIG_LABELS } from '../../shared/scene.js';
import type { RigKind } from '../../shared/params.js';

const GLYPHS: Record<RigKind, string> = {
  ramp: '/|',
  pendulum: '-o',
  launcher: '^>',
  crate: '[#]',
};

export interface PropsPanelProps {
  models: readonly AssetRow[];
  canEdit: boolean;
  onAddRig: (kind: RigKind) => void;
  onAddModel: (asset: AssetRow) => void;
}

export function PropsPanel(props: PropsPanelProps): JSX.Element {
  const [tab, setTab] = useState<'Rigs' | 'Models'>('Rigs');
  const grid = useRef<HTMLDivElement | null>(null);
  useRovingTabIndex(grid, '.tile');

  const onGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'];
    if (!keys.includes(event.key)) return;
    const tiles = [...(grid.current?.querySelectorAll<HTMLElement>('.tile') ?? [])];
    const index = tiles.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    event.preventDefault();
    const step =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowDown' ? 2 : -2;
    tiles[Math.max(0, Math.min(tiles.length - 1, index + step))]?.focus();
  };

  return (
    <>
      <div role="tablist" aria-label="Prop types">
        {(['Rigs', 'Models'] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="tiles" ref={grid} onKeyDown={onGridKeyDown} style={{ marginTop: 8 }}>
        {tab === 'Rigs'
          ? RIG_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className="tile"
                aria-label={`Add ${kind}`}
                disabled={!props.canEdit}
                draggable
                onDragStart={(event) => event.dataTransfer.setData('text/plain', `rig:${kind}`)}
                onClick={() => props.onAddRig(kind)}
              >
                <span className="glyph" aria-hidden="true">
                  {GLYPHS[kind]}
                </span>
                <span className="label">{RIG_LABELS[kind]}</span>
              </button>
            ))
          : props.models.map((asset) => (
              <button
                key={asset.id}
                type="button"
                className="tile"
                aria-label={`Add ${asset.name}`}
                disabled={!props.canEdit}
                draggable
                onDragStart={(event) =>
                  event.dataTransfer.setData('text/plain', `model:${asset.id}`)
                }
                onClick={() => props.onAddModel(asset)}
              >
                <span className="glyph" aria-hidden="true">
                  {'<>'}
                </span>
                <span className="label">{asset.name}</span>
              </button>
            ))}
      </div>
      {tab === 'Models' && props.models.length === 0 ? (
        <p className="empty">{emptyCopy.models}</p>
      ) : null}
    </>
  );
}
