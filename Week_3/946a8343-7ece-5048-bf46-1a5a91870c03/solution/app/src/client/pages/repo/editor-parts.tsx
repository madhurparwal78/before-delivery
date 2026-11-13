// Pieces of the web editor: the tab strip and its dialogs.
import { useRef, useState } from "preact/hooks";
import { Dialog } from "../../a11y/dialog.tsx";
import { Button } from "../../ui/button.tsx";
import { TextField } from "../../ui/fields.tsx";
import type { OpenFile } from "./editor-model.ts";

export function tabName(file: OpenFile, showConflict: boolean): string {
  return `${file.path}${file.deleted ? " (deleted)" : ""}${showConflict ? " (conflict)" : ""}`;
}

export function FileTabs({
  files,
  active,
  conflicting,
  onSelect,
}: {
  files: readonly OpenFile[];
  active: number | null;
  conflicting: (file: OpenFile) => boolean;
  onSelect(key: number): void;
}) {
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const move = (event: KeyboardEvent, index: number): void => {
    const last = files.length - 1;
    const to =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : -1;
    const target = files[to];
    if (!target) return;
    event.preventDefault();
    onSelect(target.key);
    buttons.current.get(target.key)?.focus();
  };
  return (
    <div role="tablist" aria-label="Open files" class="sp-editor__tabs">
      {files.map((file, index) => {
        const conflict = conflicting(file);
        return (
          <button
            key={file.key}
            ref={(element) => {
              if (element) buttons.current.set(file.key, element);
              else buttons.current.delete(file.key);
            }}
            type="button"
            role="tab"
            id={`editor-tab-${file.key}`}
            aria-selected={file.key === active ? "true" : "false"}
            aria-controls={`editor-panel-${file.key}`}
            tabIndex={file.key === active ? 0 : -1}
            data-conflict={conflict ? "true" : undefined}
            class="sp-editor__tab"
            onClick={() => onSelect(file.key)}
            onKeyDown={(event) => move(event, index)}
          >
            {tabName(file, conflict)}
          </button>
        );
      })}
    </div>
  );
}

interface PathDialogProps {
  name: string;
  field: string;
  submit: string;
  initial: string;
  /** Returns the problem to show, or null when the path was taken. */
  onSubmit(path: string): string | null;
  onClose(): void;
}

/** `dialog "New file"` and the rename dialog: one `textbox "File path"`. */
export function PathDialog({ name, field, submit, initial, onSubmit, onClose }: PathDialogProps) {
  const [value, setValue] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  return (
    <Dialog name={name} open onClose={onClose} initialFocus={input}>
      <div class="sp-dialog__bar">
        <h2 class="sp-dialog__title">{name}</h2>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setProblem(onSubmit(value));
        }}
      >
        <TextField
          label={field}
          name="editor-path"
          value={value}
          innerRef={input}
          error={problem}
          autoComplete="off"
          spellcheck={false}
          onInput={(event) => setValue(event.currentTarget.value)}
        />
        <div class="sp-editor__dialog-actions">
          <Button type="submit">{submit}</Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function UnsavedDialog({ onKeep, onDiscard }: { onKeep(): void; onDiscard(): void }) {
  return (
    <Dialog name="Unsaved changes" open onClose={onKeep}>
      <div class="sp-dialog__bar">
        <h2 class="sp-dialog__title">Unsaved changes</h2>
      </div>
      <p>Leaving this page drops the edits you have not committed.</p>
      <div class="sp-editor__dialog-actions">
        <Button onClick={onKeep}>Keep editing</Button>
        <Button variant="secondary" onClick={onDiscard}>
          Discard
        </Button>
      </div>
    </Dialog>
  );
}
