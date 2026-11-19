import { useRef } from "react";
import { Button } from "../../lib/ui.js";

/** A button that opens the file chooser of a hidden file input and hands the chosen file over. */
export function FilePicker({ label, accept, busy, onFile }: { label: string; accept?: string; busy?: boolean; onFile: (file: File) => void }): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) onFile(file);
        }}
      />
      <Button busy={busy} onClick={() => input.current?.click()}>
        {label}
      </Button>
    </>
  );
}
