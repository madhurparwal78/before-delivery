import { useEffect, useMemo, useState } from 'react';
import { lengthIn } from '../../shared/units';
import { holderOf } from './locks';
import { drawPlacements } from './model';
import { commitRotation } from './placements';
import { editor, useEditor } from './state';

/** The selected placement: label, lengths in the current units, and an editable rotation. */
export default function Inspector() {
  const placements = useEditor((s) => s.placements);
  const queue = useEditor((s) => s.queue);
  const preview = useEditor((s) => s.preview);
  const selectedId = useEditor((s) => s.selectedId);
  const units = useEditor((s) => s.units);
  const prompt = useEditor((s) => s.lockedPrompt);
  const drawn = useMemo(() => drawPlacements(placements, queue, preview), [placements, queue, preview]);
  const p = drawn.find((x) => x.id === selectedId);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (p) setValue(String(p.rotationDeg));
  }, [p?.rotationDeg, p?.id, prompt]);

  if (!p) return null;
  const holder = holderOf('placement', p.id);
  const rows: [string, number][] = [['X', p.xMm], ['Y', p.yMm], ['Z', p.zMm], ['Width', p.widthMm], ['Depth', p.depthMm], ['Height', p.heightMm]];
  const commit = (): void => {
    const next = Number(value);
    if (value.trim() === '' || !Number.isFinite(next) || editor.get().dialogs.locked) return;
    commitRotation(p.id, next);
  };

  return (
    <aside className="inspector cluster column" role="region" aria-label="Inspector">
      <h2>{p.label}</h2>
      {holder && holder.userId !== editor.get().me?.id ? <p className="holder">Held by {holder.displayName}</p> : null}
      <dl>
        {rows.map(([name, mm]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd className="tabular">{lengthIn(mm, units)}</dd>
          </div>
        ))}
        <div>
          <dt>
            <label htmlFor="inspector-rotation">Rotation</label>
          </dt>
          <dd>
            <input
              id="inspector-rotation"
              type="number"
              inputMode="numeric"
              value={value}
              aria-label="Rotation"
              data-rotation=""
              onChange={(event) => setValue(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commit();
                }
              }}
            />
            <span aria-hidden="true">°</span>
          </dd>
        </div>
      </dl>
    </aside>
  );
}
