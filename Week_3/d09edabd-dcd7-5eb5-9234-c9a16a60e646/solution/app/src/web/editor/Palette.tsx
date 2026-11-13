import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Version } from '../../shared/types';
import { Dialog } from '../ui/Dialog';
import { pressPlay } from './play';
import { closeDialog, openDialog, useEditor, type DialogName } from './state';
import { loadVersions, restoreVersion } from './versions';

interface Command {
  name: string;
  needsLive?: boolean;
  keepOpen?: boolean;
  run: () => void;
}

/** The Command palette: filter as you type, Enter runs the active option, "Restore version..." lists the room's versions. */
export default function Palette() {
  const open = useEditor((s) => s.dialogs.palette === true);
  const live = useEditor((s) => s.live);
  const versions = useEditor((s) => s.versions);
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(false);
  const [active, setActive] = useState(0);
  const opener = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery('');
    setPicking(false);
    setActive(0);
  }, [open]);

  /** Closes the palette with focus back where it was, then opens or runs what was chosen. */
  const leave = (then: () => void): void => {
    opener.current?.focus({ preventScroll: true });
    closeDialog('palette');
    then();
  };
  const sheet = (name: DialogName) => () => leave(() => openDialog(name));

  /** The field empties once the room's versions are in, so every key typed after it finds the list. */
  const pickVersion = async (): Promise<void> => {
    await loadVersions().catch(() => undefined);
    setPicking(true);
    setQuery('');
    setActive(0);
  };

  const commands: Command[] = [
    { name: 'Start playtest', needsLive: true, run: () => leave(pressPlay) },
    { name: 'Freeze version...', run: sheet('versions') },
    { name: 'Restore version...', run: () => void pickVersion() },
    { name: 'Open Versions', run: sheet('versions') },
    { name: 'Open Prop library', run: sheet('props') },
    { name: 'Open Trigger graph', run: sheet('graph') },
    { name: 'Keyboard shortcuts', run: sheet('shortcuts') },
  ];

  const options = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (picking) {
      return versions.map((v) => ({ key: v.id, name: `Version ${v.number} — ${v.label}`, version: v })).filter((o) => o.name.toLowerCase().includes(needle));
    }
    return commands.filter((c) => c.name.toLowerCase().includes(needle)).map((c) => ({ key: c.name, name: c.name, command: c }));
  }, [query, picking, versions, live]);

  const run = (index: number): void => {
    const option = options[index];
    if (!option) return;
    if ('version' in option && option.version) {
      const version: Version = option.version;
      leave(() => void restoreVersion(version));
      return;
    }
    const command = (option as { command: Command }).command;
    if (command.needsLive && !live) return;
    command.run();
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (options.length) setActive((a) => (a + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(active);
    }
  };

  const current = Math.min(active, Math.max(0, options.length - 1));
  return (
    <Dialog name="Command palette" open={open} onClose={() => closeDialog('palette')} className="palette" initialFocus={(root) => root.querySelector<HTMLElement>('input')}>
      <input
        type="text"
        role="combobox"
        aria-label="Command"
        aria-expanded="true"
        aria-controls="palette-options"
        aria-activedescendant={options[current] ? `palette-${current}` : undefined}
        autoComplete="off"
        placeholder={picking ? 'Pick a version to restore' : 'Type a command'}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      <span id="palette-live-note" className="visually-hidden">
        Needs the live service.
      </span>
      <ul id="palette-options" role="listbox" aria-label="Commands" className="palette-list">
        {options.map((option, index) => {
          const unavailable = 'command' in option && option.command.needsLive === true && !live;
          return (
            <li
              key={option.key}
              id={`palette-${index}`}
              role="option"
              aria-selected={index === current}
              aria-disabled={unavailable || undefined}
              aria-describedby={unavailable ? 'palette-live-note' : undefined}
              onMouseMove={() => setActive(index)}
              onClick={() => run(index)}
            >
              {option.name}
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
