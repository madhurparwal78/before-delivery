// The command line: the last lines of log "Command history" above the prompt and textbox "Command".
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { awaitsText, promptOf } from '../commandLine/machine.ts';
import { useEditorState, useEditorStore } from '../store.ts';

export function CommandLine() {
  const store = useEditorStore();
  const { history, machine } = useEditorState();
  const [value, setValue] = useState('');
  const log = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = log.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [history]);

  const submit = (): void => {
    store.session.submit(value);
    setValue('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    } else if (event.key === ' ' && !awaitsText(machine)) {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setValue('');
      store.session.escape();
    }
  };

  return (
    <div className="command-line">
      <div ref={log} role="log" aria-label="Command history" className="command-history">
        {history.map((line) => <div key={line.id}>{line.text}</div>)}
      </div>
      <div className="command-row">
        <span role="status" aria-label="Command prompt" className="command-prompt">{promptOf(machine)}</span>
        <input
          ref={(element) => { store.commandInput = element; }}
          type="text"
          aria-label="Command"
          placeholder="Type a command"
          className="input command-input"
          value={value}
          autoFocus
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  );
}
