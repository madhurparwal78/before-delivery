import { useId, useState } from 'react';
import { Dialog } from './Dialog.js';

export interface PaletteCommand {
  label: string;
  run: () => void;
}

interface CommandPaletteProps {
  commands: PaletteCommand[];
  onClose: () => void;
}

/** The command palette: type to filter, arrows to move, Enter to run. */
export function CommandPalette({ commands, onClose }: CommandPaletteProps): JSX.Element {
  const base = useId();
  const [queryText, setQueryText] = useState('');
  const [active, setActive] = useState(0);
  const shown = commands.filter((command) =>
    command.label.toLowerCase().includes(queryText.trim().toLowerCase()),
  );
  const activeIndex = Math.min(active, Math.max(0, shown.length - 1));

  return (
    <Dialog name="Command palette" onClose={onClose}>
      <div className="palette">
        <label htmlFor={`${base}-search`}>Search commands</label>
        <input
          id={`${base}-search`}
          role="combobox"
          aria-expanded="true"
          aria-controls={`${base}-list`}
          aria-activedescendant={shown.length > 0 ? `${base}-option-${activeIndex}` : undefined}
          aria-autocomplete="list"
          type="text"
          value={queryText}
          onChange={(event) => {
            setQueryText(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((current) => (shown.length === 0 ? 0 : (current + 1) % shown.length));
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((current) => (shown.length === 0 ? 0 : (current - 1 + shown.length) % shown.length));
              return;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              const chosen = shown[activeIndex];
              onClose();
              chosen?.run();
            }
          }}
        />
        <ul className="palette-list" id={`${base}-list`} role="listbox" aria-label="Commands">
          {shown.map((command, index) => (
            <li
              key={command.label}
              id={`${base}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? 'palette-option active' : 'palette-option'}
              onMouseDown={(event) => {
                event.preventDefault();
                onClose();
                command.run();
              }}
            >
              {command.label}
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
