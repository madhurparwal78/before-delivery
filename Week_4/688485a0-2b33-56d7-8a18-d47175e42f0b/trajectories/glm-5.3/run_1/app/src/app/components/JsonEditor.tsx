import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { EditorView } from "@codemirror/view";
import { ReactNode, useRef } from "react";

/**
 * The JSON editor (an open-source code-editor component). Tab inserts two
 * spaces, Escape then Tab moves focus out, and Ctrl/Cmd+S saves. The display
 * rule never applies inside it.
 */

interface JsonEditorProps {
  value: string;
  onChange: ((value: string) => void) | undefined;
  readOnly?: boolean;
  ariaLabel: string;
  onSave?: (() => void) | undefined;
}

export function JsonEditor(props: JsonEditorProps): ReactNode {
  const { value, onChange, readOnly, ariaLabel, onSave } = props;
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const escapeArmedRef = useRef(false);
  return (
    <div
      className="json-editor-host"
      onKeyDown={e => {
        const key = e.key;
        if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === "s") {
          e.preventDefault();
          saveRef.current?.();
          return;
        }
        if (key === "Escape") {
          escapeArmedRef.current = true;
          return;
        }
        if (key === "Tab" && escapeArmedRef.current) {
          e.preventDefault();
          escapeArmedRef.current = false;
          // move focus to the next control after the editor host
          const focusables = Array.from(
            (e.currentTarget.closest("[data-editor-scope]")?.querySelectorAll(
              "button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
            ) ?? []) as HTMLElement[],
          );
          const after = focusables.find(f => f.compareDocumentPosition(e.currentTarget) & Node.DOCUMENT_POSITION_FOLLOWING);
          after?.focus();
        }
      }}
    >
      <CodeMirror
        value={value}
        aria-label={ariaLabel}
        theme="none"
        extensions={[json(), ...(readOnly === true ? [EditorView.editable.of(false)] : [])]}
        readOnly={readOnly === true}
        basicSetup={{
          foldGutter: false,
          autocompletion: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          lineNumbers: false,
          searchKeymap: false,
        }}
        onChange={(v: string) => onChange?.(v)}
        indentWithTab={false}
      />
    </div>
  );
}
