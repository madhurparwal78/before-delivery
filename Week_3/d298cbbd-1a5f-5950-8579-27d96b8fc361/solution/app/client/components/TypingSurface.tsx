import type { JSX, RefObject } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import { BACKSPACE, CTRL_BACKSPACE, SPACE } from "../../shared/engine";

/** The key a keydown types, or null when it types nothing: only printed characters, Space and the two Backspaces are logged. */
function keyNameOf(event: KeyboardEvent): string | null {
  if (event.isComposing || event.key === "Unidentified" || event.keyCode === 229) return null;
  if (event.metaKey || (event.ctrlKey && !event.getModifierState("AltGraph") && event.key !== "Backspace")) return null;
  if (event.key === "Backspace") return event.ctrlKey || event.altKey ? CTRL_BACKSPACE : BACKSPACE;
  if (event.key === " ") return SPACE;
  return [...event.key].length === 1 ? event.key : null;
}

/** Characters and deletions an on-screen keyboard sends as input events instead of key events. */
function inputKeysOf(event: InputEvent): string[] {
  if (event.inputType === "deleteContentBackward") return [BACKSPACE];
  if (event.inputType === "deleteWordBackward") return [CTRL_BACKSPACE];
  if (event.inputType === "insertText" && event.data) return [...event.data].map((character) => (character === " " ? SPACE : character));
  return [];
}

interface Props {
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly onKey: (key: string) => void;
  readonly onFocus: () => void;
  readonly onBlur: () => void;
}

/** The visually hidden field that receives typing, from a keyboard or from a phone's on-screen keyboard. */
export function TypingSurface({ inputRef, onKey, onFocus, onBlur }: Props): JSX.Element {
  return (
    <input
      ref={inputRef}
      class="typing-input"
      type="text"
      aria-label="Typing input"
      autocomplete="off"
      autocapitalize="off"
      autocorrect="off"
      spellcheck={false}
      enterkeyhint="done"
      onKeyDown={(event) => {
        const key = keyNameOf(event);
        if (key === null) return;
        event.preventDefault();
        onKey(key);
      }}
      onBeforeInput={(event) => {
        const keys = inputKeysOf(event as InputEvent);
        if (keys.length === 0) return;
        event.preventDefault();
        for (const key of keys) onKey(key);
      }}
      onInput={(event) => {
        event.currentTarget.value = "";
      }}
      onFocus={onFocus}
      onBlur={onBlur}
    />
  );
}

/** Whether the Caps Lock warning is showing: the Caps Lock key toggles it, any other key reports the modifier state. */
export function useCapsLock(): boolean {
  const [on, setOn] = useState(false);
  useLayoutEffect(() => {
    let state = false;
    const listen = (event: KeyboardEvent): void => {
      state = event.key === "CapsLock" ? !state : event.getModifierState("CapsLock");
      setOn(state);
    };
    window.addEventListener("keydown", listen);
    return () => window.removeEventListener("keydown", listen);
  }, []);
  return on;
}
