import { useRef } from "react";
import type { KeyboardEvent } from "react";

interface CodeEditorProps {
  label: string;
  value: string;
  readOnly?: boolean;
  errorLines?: ReadonlySet<number>;
  onChange: (value: string) => void;
  onSave: () => void;
}

export function CodeEditor({ label, value, readOnly = false, errorLines, onChange, onSave }: CodeEditorProps) {
  const gutter = useRef<HTMLDivElement>(null);
  const count = Math.max(1, value.split("\n").length);
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      onSave();
    }
  };
  return (
    <div className="code">
      <div className="gutter" ref={gutter} aria-hidden="true">
        {Array.from({ length: count }, (_value, index) => (
          <div key={index} className={errorLines?.has(index + 1) ? "gutter-line bad" : "gutter-line"}>
            {index + 1}
          </div>
        ))}
      </div>
      <textarea
        aria-label={label}
        className="code-text"
        value={value}
        readOnly={readOnly}
        spellCheck={false}
        wrap="off"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onScroll={(event) => {
          if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop;
        }}
      />
    </div>
  );
}
