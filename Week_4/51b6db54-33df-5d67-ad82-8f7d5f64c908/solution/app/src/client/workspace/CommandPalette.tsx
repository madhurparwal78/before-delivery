import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Dialog } from '../ui';
import { rankCommands } from '../../shared/commands';
import { TOOLS } from '../../shared/rules';
import { chooseTool, showFrame, TOOL_LABEL } from './draw';
import type { Model } from './model';
import { useModel } from './use-model';

export function CommandPalette({ m }: { m: Model }): JSX.Element | null {
  useModel(m);
  return m.commandPaletteOpen ? <CommandDialog m={m} /> : null;
}

function CommandDialog({ m }: { m: Model }): JSX.Element {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const close = (): void => {
    m.commandPaletteOpen = false;
    m.changed();
  };
  const names = [
    ...TOOLS.map((tool) => `Tool: ${TOOL_LABEL[tool]}`),
    ...m.layers.map((layer) => `Layer: ${layer.name}`),
    ...m.frames.map((_, i) => `Frame ${i + 1}`),
    ...m.swatches.map((swatch) => `Swatch ${swatch.index}`),
  ];
  const results = rankCommands(names, query);

  const run = (name: string): void => {
    close();
    if (name.startsWith('Tool: ')) {
      const tool = TOOLS.find((t) => `Tool: ${TOOL_LABEL[t]}` === name);
      if (tool) chooseTool(m, tool);
    } else if (name.startsWith('Layer: ')) {
      const layer = m.layers.find((l) => `Layer: ${l.name}` === name);
      if (layer) {
        m.layerId = layer.id;
        m.changed();
      }
    } else if (name.startsWith('Frame ')) {
      const frame = m.frames[Number(name.slice(6)) - 1];
      if (frame) showFrame(m, frame.id);
    } else {
      m.primary = Number(name.slice(7));
      m.changed();
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (results.length === 0 ? 0 : (current + step + results.length) % results.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = results[active];
      if (chosen) run(chosen.name);
    }
  };

  return (
    <Dialog label="Command palette" onClose={close} class="palette">
      <div class="stack">
        <input
          class="input"
          type="text"
          role="combobox"
          aria-label="Command"
          aria-expanded="true"
          aria-controls="commands"
          aria-autocomplete="list"
          aria-activedescendant={results[active] ? `command-${active}` : undefined}
          value={query}
          data-autofocus
          autocomplete="off"
          onInput={(event) => {
            setQuery((event.currentTarget as HTMLInputElement).value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        {results.length === 0 ? (
          <p class="muted">No matching commands</p>
        ) : (
          <div role="listbox" id="commands" aria-label="Commands" class="command-list">
            {results.map((result, i) => (
              <div key={result.name} id={`command-${i}`} role="option" aria-selected={i === active} class="command" onClick={() => run(result.name)}>
                {result.name}
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
