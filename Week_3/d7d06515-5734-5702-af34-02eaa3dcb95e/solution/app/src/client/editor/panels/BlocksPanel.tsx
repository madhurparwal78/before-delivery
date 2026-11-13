// Blocks tab: the block library. Insert starts the INSERT command with the item's Scale and Rotation.
import { useRef, useState } from 'react';
import { COPY } from '../../../shared/copy.ts';
import { arcSweep, polar, primitivesOf } from '../../../shared/geometry.ts';
import { BLOCK_NAMES, type BlockName, type Point, type Primitive, type StoredObject } from '../../../shared/types.ts';
import { parseNumber } from '../commandLine/parse.ts';
import { useEditor } from '../store.ts';
import { useFocusRequest } from './focusRequest.ts';
import '../../styles/panels.css';

const ARC_STEP_DEGREES = 10;
const THUMB_PADDING = 0.08;

/** A block at its base point, unscaled and unrotated: what the thumbnail draws. */
function sampleInsert(block: BlockName): StoredObject {
  return {
    handle: '', layer: '0', color: 'ByLayer', linetype: 'ByLayer', linetype_scale: 1, lineweight: 'ByLayer',
    dimension_style: 'Standard', text_style: 'Standard', multileader_style: 'Standard',
    type: 'insert', block, position: [0, 0], scale: 1, rotation: 0,
  };
}

function strokePoints(primitive: Primitive): Point[] | null {
  switch (primitive.kind) {
    case 'line': return [primitive.a, primitive.b];
    case 'polyline': return primitive.closed ? [...primitive.points, ...primitive.points.slice(0, 1)] : primitive.points;
    case 'arc': {
      const sweep = arcSweep(primitive.start_angle, primitive.end_angle);
      const steps = Math.max(2, Math.ceil(sweep / ARC_STEP_DEGREES));
      return Array.from({ length: steps + 1 }, (_, i) => polar(primitive.center, primitive.radius, primitive.start_angle + (sweep * i) / steps));
    }
    case 'circle': {
      const steps = 360 / ARC_STEP_DEGREES;
      return Array.from({ length: steps + 1 }, (_, i) => polar(primitive.center, primitive.radius, i * ARC_STEP_DEGREES));
    }
    case 'text': return null;
  }
}

function BlockThumbnail({ block }: { block: BlockName }) {
  const strokes = primitivesOf(sampleInsert(block), 'mm').map(strokePoints).filter((points): points is Point[] => points !== null);
  const xs = strokes.flat().map((point) => point[0]);
  const ys = strokes.flat().map((point) => point[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(...xs) - minX || 1;
  const height = Math.max(...ys) - minY || 1;
  const pad = Math.max(width, height) * THUMB_PADDING;
  return (
    <svg className="block-thumb" viewBox={`${minX - pad} ${-(minY + height + pad)} ${width + 2 * pad} ${height + 2 * pad}`} aria-hidden="true" focusable="false">
      <g transform="scale(1 -1)" fill="none" stroke="var(--ink)" strokeWidth="1.5" vectorEffect="non-scaling-stroke">
        {strokes.map((points, index) => (
          <polyline key={index} points={points.map(([x, y]) => `${x},${y}`).join(' ')} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
    </svg>
  );
}

function BlockItem({ block, onInsert }: { block: BlockName; onInsert: (block: BlockName, scale: number, rotation: number) => void }) {
  const [scale, setScale] = useState('1');
  const [rotation, setRotation] = useState('0');
  const [error, setError] = useState<string | null>(null);

  const insert = (): void => {
    const factor = parseNumber(scale.trim());
    const angle = parseNumber(rotation.trim());
    if (factor === null || factor <= 0) setError(COPY.positiveNumber);
    else if (angle === null) setError(COPY.notANumber);
    else {
      setError(null);
      onInsert(block, factor, angle);
    }
  };

  return (
    <li className="block-item">
      <BlockThumbnail block={block} />
      <span className="block-name">{block}</span>
      <div className="block-inputs">
        <label className="block-input">
          <span>Scale</span>
          <input type="number" step="any" className="input" value={scale} onChange={(event) => setScale(event.target.value)} />
        </label>
        <label className="block-input">
          <span>Rotation</span>
          <input type="number" step="any" className="input" value={rotation} onChange={(event) => setRotation(event.target.value)} />
        </label>
      </div>
      <button type="button" className="btn btn-outline block-insert" aria-label={`Insert ${block}`} onClick={insert}>Insert</button>
      {error ? <p role="alert" className="field-error">{error}</p> : null}
    </li>
  );
}

export function BlocksPanel() {
  const editor = useEditor();
  const list = useRef<HTMLUListElement>(null);

  useFocusRequest('blocks', () => list.current?.querySelector<HTMLElement>('button')?.focus());

  const insert = (block: BlockName, scale: number, rotation: number): void => {
    editor.startCommand('INSERT', { block, scale, rotation });
    editor.focusCommandLine();
  };

  return (
    <div className="panel">
      <h3 className="panel-heading">Blocks</h3>
      <ul ref={list} className="block-library" aria-label="Block library">
        {BLOCK_NAMES.map((block) => <BlockItem key={block} block={block} onInsert={insert} />)}
      </ul>
    </div>
  );
}
