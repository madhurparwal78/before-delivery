import { useRef, type KeyboardEvent, type Ref } from "react";
import { tabEdit } from "./code-keys.js";

const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta"]);

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  ref?: Ref<HTMLTextAreaElement>;
}

export function CodePane({ label, value, onChange, ref }: Props): React.JSX.Element {
  const leaving = useRef(false);

  const press = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Escape") {
      leaving.current = true;
      return;
    }
    if (event.key !== "Tab") {
      if (!MODIFIERS.has(event.key)) leaving.current = false;
      return;
    }
    if (leaving.current) {
      leaving.current = false;
      return;
    }
    event.preventDefault();
    const field = event.currentTarget;
    const edit = tabEdit(field.value, field.selectionStart, field.selectionEnd, event.shiftKey);
    field.setSelectionRange(edit.from, edit.to);
    document.execCommand("insertText", false, edit.text);
    field.setSelectionRange(edit.selection[0], edit.selection[1]);
  };

  return (
    <textarea
      ref={ref}
      className="code"
      aria-label={`${label} code`}
      value={value}
      spellCheck={false}
      autoCapitalize="off"
      autoComplete="off"
      wrap="off"
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={press}
      onBlur={() => {
        leaving.current = false;
      }}
    />
  );
}
