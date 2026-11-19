import { useState } from 'react';
import { LAYER_POPUP, useEscapeLayer } from '../layers.js';

export interface MentionState {
  owner: string | null;
  prefix: string;
  start: number;
  index: number;
}

const EMPTY: MentionState = { owner: null, prefix: '', start: 0, index: 0 };

export interface MentionApi {
  state: MentionState;
  matches: string[];
  /** Reads the caret's surroundings and opens, filters or closes the list. */
  sync: (owner: string, value: string, caret: number) => void;
  close: () => void;
  move: (delta: number) => void;
  choose: (
    value: string,
    handle?: string,
  ) => { value: string; caret: number } | null;
}

export function useMentions(handles: string[]): MentionApi {
  const [state, setState] = useState<MentionState>(EMPTY);

  const matches =
    state.owner === null
      ? []
      : handles.filter((handle) => handle.startsWith(state.prefix.toLowerCase()));

  return {
    state,
    matches,
    sync(owner, value, caret) {
      const before = value.slice(0, caret);
      const at = before.lastIndexOf('@');
      if (at < 0) {
        setState(EMPTY);
        return;
      }
      const preceding = at === 0 ? '' : before.charAt(at - 1);
      if (at !== 0 && !/\s/.test(preceding)) {
        setState(EMPTY);
        return;
      }
      const prefix = before.slice(at + 1);
      if (!/^[a-z0-9]*$/.test(prefix)) {
        setState(EMPTY);
        return;
      }
      const found = handles.filter((handle) => handle.startsWith(prefix.toLowerCase()));
      if (found.length === 0) {
        setState(EMPTY);
        return;
      }
      setState({ owner, prefix, start: at, index: 0 });
    },
    close() {
      setState(EMPTY);
    },
    move(delta) {
      setState((previous) => {
        const found = handles.filter((handle) => handle.startsWith(previous.prefix.toLowerCase()));
        if (found.length === 0) return previous;
        const next = (previous.index + delta + found.length) % found.length;
        return { ...previous, index: next };
      });
    },
    choose(value, handle) {
      if (state.owner === null) return null;
      const found = handles.filter((candidate) => candidate.startsWith(state.prefix.toLowerCase()));
      const chosen = handle ?? found[state.index];
      if (chosen === undefined) return null;
      const before = value.slice(0, state.start);
      const after = value.slice(state.start + 1 + state.prefix.length);
      const insertion = `@${chosen} `;
      setState(EMPTY);
      return { value: before + insertion + after, caret: before.length + insertion.length };
    },
  };
}

interface Props {
  api: MentionApi;
  onChoose: (handle: string) => void;
}

export function MentionList(props: Props): JSX.Element | null {
  const open = props.api.state.owner !== null && props.api.matches.length > 0;
  useEscapeLayer(open ? props.api.close : null, LAYER_POPUP);
  if (!open) return null;
  return (
    <ul className="mention-list" role="listbox" aria-label="Mention people">
      {props.api.matches.map((handle, index) => (
        <li
          key={handle}
          id={`mention-${handle}`}
          role="option"
          aria-selected={index === props.api.state.index}
          className={index === props.api.state.index ? 'mention-active' : undefined}
          onMouseDown={(event) => {
            event.preventDefault();
            props.onChoose(handle);
          }}
        >
          @{handle}
        </li>
      ))}
    </ul>
  );
}

export function mentionActiveDescendant(api: MentionApi): string | undefined {
  if (api.state.owner === null) return undefined;
  const handle = api.matches[api.state.index];
  return handle === undefined ? undefined : `mention-${handle}`;
}
