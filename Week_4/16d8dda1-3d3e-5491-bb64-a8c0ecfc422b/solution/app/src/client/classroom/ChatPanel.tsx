import { useEffect, useId, useRef, type FormEvent, type KeyboardEvent, type MutableRefObject, type RefObject } from 'react';
import { Icon } from '../ui/icons';
import { ActionButton, useClassroom } from './context';

interface ChatPanelProps {
  /** The page reads this to focus the field when C is pressed. */
  inputRef: RefObject<HTMLInputElement | null>;
  /** What had focus before C, restored by Escape. */
  returnFocus: MutableRefObject<HTMLElement | null>;
}

export function ChatPanel({ inputRef, returnFocus }: ChatPanelProps) {
  const { store, state, snapshot, isOwner, canRun } = useClassroom();
  const titleId = useId();
  const log = useRef<HTMLDivElement>(null);
  const breakout = snapshot.breakout;
  const table = state.chatTable;
  const mayPost = breakout !== null && table !== null && (!canRun || isOwner);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [state.chatMessages.length]);

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const field = inputRef.current;
    if (!field || !mayPost) return;
    if (await store.sendChat(field.value)) {
      field.value = '';
    }
  };

  const leave = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') return;
    const previous = returnFocus.current;
    if (previous?.isConnected) previous.focus();
    else event.currentTarget.blur();
    returnFocus.current = null;
  };

  return (
    <section className="panel-block" aria-labelledby={titleId}>
      <h2 id={titleId} className="panel-title">
        Table chat
      </h2>
      {canRun && (
        <div className="field">
          <label htmlFor="chat-table">Table</label>
          <select id="chat-table" value={table ?? ''} disabled={!breakout} onChange={(event) => store.chooseChatTable(event.target.value)}>
            {breakout?.tables.map((entry) => (
              <option key={entry.tableId} value={entry.tableId}>
                {entry.tableId}
              </option>
            ))}
          </select>
        </div>
      )}
      {!breakout && <p className="hint">Chat opens when breakouts start.</p>}
      {breakout && !canRun && table === null && <p className="hint">You are not at a table.</p>}
      <div className="chat-log" role="log" aria-label="Table messages" ref={log} tabIndex={0}>
        {state.chatMessages.map((message) => (
          <p key={message.messageId}>
            <strong>{message.author}</strong> {message.text}
          </p>
        ))}
      </div>
      <form className="chat-form" onSubmit={(event) => void send(event)}>
        <input ref={inputRef} type="text" aria-label="Message your table" disabled={!mayPost} autoComplete="off" onKeyDown={leave} />
        <ActionButton actionKey="chat" type="submit" className="primary" disabled={!mayPost} data-native-enter="">
          <Icon name="chat" size={18} />
          Send
        </ActionButton>
      </form>
    </section>
  );
}
