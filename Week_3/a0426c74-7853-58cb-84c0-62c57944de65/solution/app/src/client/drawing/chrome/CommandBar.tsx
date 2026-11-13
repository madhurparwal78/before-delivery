import { useState } from 'react';
import type { KeyboardEvent, Ref } from 'react';
import { Button } from '../../ui/index.ts';
import { AID_LABEL, useSceneSlice, useSceneStore } from '../../store/index.ts';
import type { DraftingAid } from '../../store/index.ts';
import '../../styles/drawing/command.css';

const AIDS: readonly DraftingAid[] = ['snap', 'ortho', 'grid', 'polar'];

/** What the keys of `textbox "Command"` do: the live drawing runs commands, a read-only version refuses them. */
export interface CommandHandlers {
  /** Enter with the typed text; the box is cleared after */
  enter: (text: string) => void;
  /** Space: true when it acted as Enter (the box is cleared), false where Space is a character */
  space: (text: string) => boolean;
  escape: () => void;
  /** `U` in an empty box at the Ready prompt: true when it acted */
  undoAtReady: () => boolean;
}

/** `textbox "Command"` with `status "Command prompt"` beside it (sage while a command runs) and `group "Drafting aids"` at the right end. */
export function CommandBar({ inputRef, handlers, running = false }: { inputRef: Ref<HTMLInputElement>; handlers: CommandHandlers; running?: boolean }) {
  const store = useSceneStore();
  const [text, setText] = useState('');
  const prompt = useSceneSlice((snapshot) => snapshot.prompt);
  const aids = useSceneSlice((snapshot) => snapshot.aids);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      handlers.enter(text);
      setText('');
    } else if (event.key === ' ') {
      if (handlers.space(text)) {
        event.preventDefault();
        setText('');
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      handlers.escape();
      setText('');
    } else if ((event.key === 'u' || event.key === 'U') && text === '' && !event.ctrlKey && !event.metaKey && !event.altKey && handlers.undoAtReady()) {
      event.preventDefault();
    }
  }

  return (
    <div className="command-bar">
      <input
        ref={inputRef}
        className="field command-input"
        type="text"
        aria-label="Command"
        placeholder="Command"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="command-prompt" role="status" aria-label="Command prompt" data-active-tool={running ? '' : undefined}>{prompt}</div>
      <div className="command-aids" role="group" aria-label="Drafting aids">
        {AIDS.map((aid) => (
          <Button key={aid} aria-pressed={aids[aid]} onClick={() => store.toggleAid(aid)}>{AID_LABEL[aid]}</Button>
        ))}
      </div>
    </div>
  );
}
