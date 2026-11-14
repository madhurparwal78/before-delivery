import type { RefObject } from 'preact';
import { useRef } from 'preact/hooks';

export interface CommandLineProps {
  inputRef: RefObject<HTMLInputElement>;
  text: string;
  setText(text: string): void;
  error: string;
  invalid: boolean;
  readback: string;
  callsigns: string[];
  history: string[];
  previewRoute: string[];
  previewConflicts: Set<string>;
  prefilled: boolean;
  onSend(text: string): void;
  onEscapePrefill(): void;
}

interface Cycle {
  matches: string[];
  index: number;
  value: string;
}

export function CommandLine(props: CommandLineProps) {
  const cycle = useRef<Cycle | null>(null);
  const browse = useRef<{ index: number; draft: string } | null>(null);

  const setValue = (value: string) => {
    props.setText(value);
  };

  return (
    <div class="command-line">
      <form
        aria-label="Command line"
        class="command-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!props.text.trim()) return;
          browse.current = null;
          cycle.current = null;
          props.onSend(props.text);
        }}
      >
        <label for="command-input" class="command-label">
          Command
        </label>
        <input
          id="command-input"
          ref={props.inputRef}
          class="mono command-input"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck={false}
          aria-invalid={props.invalid ? 'true' : undefined}
          aria-describedby="command-error"
          value={props.text}
          onInput={(event) => {
            cycle.current = null;
            browse.current = null;
            setValue(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            const value = event.currentTarget.value;
            if (event.key === 'Tab' && !event.shiftKey) {
              const running = cycle.current;
              if (running && running.value === value) {
                running.index = (running.index + 1) % running.matches.length;
                running.value = `${running.matches[running.index]} `;
                event.preventDefault();
                setValue(running.value);
                return;
              }
              cycle.current = null;
              if (!value || /\s/.test(value)) return;
              const typed = value.toUpperCase();
              const matches = props.callsigns.filter((callsign) => callsign.startsWith(typed)).sort();
              if (matches.length === 0) return;
              event.preventDefault();
              const completed = `${matches[0]} `;
              cycle.current = matches.length > 1 ? { matches, index: 0, value: completed } : null;
              setValue(completed);
              return;
            }
            if (event.key === 'ArrowUp') {
              if (props.history.length === 0) return;
              event.preventDefault();
              const state = browse.current ?? { index: props.history.length, draft: value };
              state.index = Math.max(0, state.index - 1);
              browse.current = state;
              setValue(props.history[state.index]!);
              return;
            }
            if (event.key === 'ArrowDown') {
              const state = browse.current;
              if (!state) return;
              event.preventDefault();
              state.index += 1;
              if (state.index >= props.history.length) {
                browse.current = null;
                setValue(state.draft);
              } else {
                setValue(props.history[state.index]!);
              }
              return;
            }
            if (event.key === 'Escape' && props.prefilled) {
              event.preventDefault();
              props.onEscapePrefill();
            }
          }}
        />
        <button type="submit" class="primary send-button">
          Send
        </button>
      </form>
      <div id="command-error" role="alert" aria-label="Command error" class={props.error ? 'hatched-cell' : 'live-empty'}>
        {props.error}
      </div>
      <p role="status" aria-label="Readback" class="readback mono">
        {props.readback}
      </p>
      <div class="route-preview">
        <span class="label">Route</span>
        <ol aria-label="Route preview" class="route-list">
          {props.previewRoute.map((segment) => (
            <li key={segment} class={props.previewConflicts.has(segment) ? 'conflict' : ''}>
              {props.previewConflicts.has(segment) ? `${segment} R4` : segment}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
