import type { Ref } from "preact";
import { useState } from "preact/hooks";
import { waitTime } from "../../shared/copy";

export function Reader({ fieldRef, status, remaining, onRead }: { fieldRef: Ref<HTMLInputElement>; status: string; remaining: number; onRead: (code: string) => void }) {
  const [code, setCode] = useState("");
  const waiting = remaining > 0;
  return (
    <form
      class="reader"
      onSubmit={(e) => {
        e.preventDefault();
        if (waiting) return;
        const value = code.trim().toUpperCase();
        if (value) onRead(value);
      }}
    >
      <label for="batch-code">Batch code</label>
      <div class="reader-row">
        <input id="batch-code" ref={fieldRef} type="text" autocomplete="off" autocapitalize="characters" spellcheck={false} value={code} onInput={(e) => setCode((e.currentTarget as HTMLInputElement).value)} />
        <button type="submit" class="rect-button" aria-disabled={waiting ? "true" : undefined} onClick={(e) => waiting && e.preventDefault()}>
          Read pack
        </button>
      </div>
      <div role="status" aria-label="Pack reader status" class="status">
        {status}
      </div>
      {waiting && (
        <div role="timer" aria-label="Wait time" class="timer">
          {waitTime(remaining)}
        </div>
      )}
    </form>
  );
}
