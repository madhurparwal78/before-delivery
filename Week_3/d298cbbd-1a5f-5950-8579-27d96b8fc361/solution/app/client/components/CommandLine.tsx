import type { JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { matchingCommands } from "../commands";
import type { Command } from "../commands";
import { Dialog } from "./Dialog";

interface Props {
  readonly onChoose: (command: Command) => void;
  readonly onCancel: () => void;
}

export function CommandLine({ onChoose, onCancel }: Props): JSX.Element {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const matches = matchingCommands(query);
  const current = Math.min(active, Math.max(0, matches.length - 1));

  useLayoutEffect(() => inputRef.current?.focus(), []);
  useLayoutEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [current, query]);

  function move(step: number): void {
    if (matches.length > 0) setActive((current + step + matches.length) % matches.length);
  }

  return (
    <Dialog label="Command line" onCancel={onCancel} class="dialog command-line">
      <h2 class="dialog-title">Command line</h2>
      <input
        ref={inputRef}
        class="command-input"
        role="combobox"
        aria-label="Command"
        aria-expanded="true"
        aria-controls="command-options"
        aria-autocomplete="list"
        aria-activedescendant={matches[current] ? `command-${current}` : undefined}
        autocomplete="off"
        spellcheck={false}
        value={query}
        onInput={(event) => {
          setQuery(event.currentTarget.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            move(event.key === "ArrowDown" ? 1 : -1);
          } else if (event.key === "Enter") {
            event.preventDefault();
            const chosen = matches[current];
            if (chosen) onChoose(chosen);
          }
        }}
      />
      <ul id="command-options" class="command-options" role="listbox" aria-label="Commands" ref={listRef}>
        {matches.map((command, index) => (
          <li
            key={command.label}
            id={`command-${index}`}
            role="option"
            aria-selected={index === current ? "true" : "false"}
            class="command-option"
            onClick={() => onChoose(command)}
          >
            {command.label}
          </li>
        ))}
      </ul>
      <button type="button" class="button ghost" onClick={onCancel}>Close</button>
    </Dialog>
  );
}
