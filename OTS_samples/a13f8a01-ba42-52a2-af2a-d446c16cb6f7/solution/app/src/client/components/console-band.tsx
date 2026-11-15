import type { PreviewMessage } from "../../shared/types.js";
import { DISPLAY_ENTRY_LIMIT } from "../../shared/types.js";

export interface ConsoleEntry {
  id: number;
  text: string;
}

export interface ConsoleState {
  entries: ConsoleEntry[];
  count: number;
}

export const EMPTY_CONSOLE: ConsoleState = { entries: [], count: 0 };

export function pushEntry(state: ConsoleState, message: PreviewMessage): ConsoleState {
  const entry = { id: state.count, text: `${message.kind} ${message.text}` };
  return { entries: [...state.entries, entry].slice(-DISPLAY_ENTRY_LIMIT), count: state.count + 1 };
}

interface Props {
  state: ConsoleState;
  open: boolean;
  onToggle: () => void;
  onClear: () => void;
  showToggle: boolean;
}

export function ConsoleBand({ state, open, onToggle, onClear, showToggle }: Props): React.JSX.Element {
  return (
    <div className="console" data-open={open}>
      <div className="console-bar">
        {showToggle && (
          <button type="button" className="console-toggle" aria-expanded={open} aria-controls="console-log" onClick={onToggle}>
            Console <span className="badge tabular" aria-hidden="true">{state.count}</span>
          </button>
        )}
        <button type="button" className="console-clear" onClick={onClear} hidden={!open}>
          Clear console
        </button>
      </div>
      <div id="console-log" role="log" aria-label="Console" data-count={state.count} className="console-log" hidden={!open}>
        <ul>
          {state.entries.map((entry) => (
            <li key={entry.id}>{entry.text}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
