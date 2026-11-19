import type { JSX } from 'preact';
import { Icon } from '../icons';
import { TOOLS, MIRRORS } from '../../shared/rules';
import { chooseTool, copySelection, pasteWithoutSelection, redo, runSelectionOp, TOOL_LABEL, undo } from './draw';
import type { Model } from './model';
import { useModel } from './use-model';

export function Toolbar({ m, part }: { m: Model; part: 'tools' | 'options' }): JSX.Element {
  useModel(m);
  const number = (value: string, min: number, max: number, fallback: number): number => {
    const parsed = Math.round(Number(value));
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
  };
  return (
    <div class={part === 'tools' ? 'tools' : 'options-group'}>
      {part === 'tools' && m.canEdit && (
        <>
          <div role="toolbar" aria-label="Tools" class="toolbar">
            {TOOLS.map((tool) => (
              <button key={tool} type="button" class="pill icon-only" aria-label={TOOL_LABEL[tool]} title={TOOL_LABEL[tool]} aria-pressed={m.tool === tool} onClick={() => chooseTool(m, tool)}>
                <Icon name={tool} />
              </button>
            ))}
            <button type="button" class="pill icon-only" aria-label="Undo" title="Undo" onClick={() => void undo(m)}>
              <Icon name="undo" />
            </button>
            <button type="button" class="pill icon-only" aria-label="Redo" title="Redo" onClick={() => void redo(m)}>
              <Icon name="redo" />
            </button>
          </div>
        </>
      )}
      {part === 'options' && m.canEdit && (
        <>
          <div class="options">
            <label class="check">
              <input type="checkbox" checked={m.pixelPerfect} onChange={(event) => { m.pixelPerfect = (event.currentTarget as HTMLInputElement).checked; m.announce(`Pixel perfect ${m.pixelPerfect ? 'on' : 'off'}`); }} />
              Pixel perfect
            </label>
            <label class="check">
              <input type="checkbox" checked={m.filled} onChange={(event) => { m.filled = (event.currentTarget as HTMLInputElement).checked; m.changed(); }} />
              Filled
            </label>
            <label class="check">
              <input type="checkbox" checked={m.contiguous} onChange={(event) => { m.contiguous = (event.currentTarget as HTMLInputElement).checked; m.changed(); }} />
              Contiguous
            </label>
            <label class="field-label compact">
              Dither level
              <input class="input" type="number" min={1} max={16} value={m.ditherLevel} onInput={(event) => { m.ditherLevel = number((event.currentTarget as HTMLInputElement).value, 1, 16, 8); m.changed(); }} />
            </label>
            <label class="field-label compact">
              Brush size
              <input class="input" type="number" min={1} max={8} value={m.size} onInput={(event) => { m.size = number((event.currentTarget as HTMLInputElement).value, 1, 8, 1); m.changed(); }} />
            </label>
            <label class="field-label compact">
              Mirror
              <select class="input" value={m.mirror} onChange={(event) => { m.mirror = (event.currentTarget as HTMLSelectElement).value as Model['mirror']; m.changed(); }}>
                {MIRRORS.map((mirror) => (
                  <option key={mirror} value={mirror}>
                    {mirror === 'none' ? 'None' : mirror.toUpperCase().slice(0, 1) + mirror.slice(1)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div class="row selection-actions">
            <button type="button" class="pill small" disabled={!m.selection} onClick={() => runSelectionOp(m, 'move')}>
              Move selection
            </button>
            <button type="button" class="pill small" disabled={!m.selection} onClick={() => copySelection(m)}>
              Copy selection
            </button>
            <button type="button" class="pill small" disabled={!m.clipboard} onClick={() => (m.selection ? runSelectionOp(m, 'paste') : pasteWithoutSelection(m))}>
              Paste selection
            </button>
            <button type="button" class="pill small" disabled={!m.selection} onClick={() => runSelectionOp(m, 'flip_h')}>
              Flip horizontal
            </button>
            <button type="button" class="pill small" disabled={!m.selection} onClick={() => runSelectionOp(m, 'flip_v')}>
              Flip vertical
            </button>
            <button type="button" class="pill small" disabled={!m.selection} onClick={() => runSelectionOp(m, 'rotate')}>
              Rotate 90
            </button>
          </div>
        </>
      )}
      {part === 'options' && (
      <div class="options">
        <label class="check">
          <input type="checkbox" checked={m.onion.on} onChange={(event) => { m.onion = { ...m.onion, on: (event.currentTarget as HTMLInputElement).checked }; m.changed(); }} />
          Onion skin
        </label>
        <label class="field-label compact">
          Onion frames
          <input class="input" type="number" min={1} max={4} value={m.onion.frames} onInput={(event) => { m.onion = { ...m.onion, frames: number((event.currentTarget as HTMLInputElement).value, 1, 4, 1) }; m.changed(); }} />
        </label>
      </div>
      )}
    </div>
  );
}
