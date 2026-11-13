import { useState } from 'react';
import type { InputHTMLAttributes, KeyboardEvent } from 'react';
import '../../styles/drawing/controls.css';

interface CommitInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'onKeyDown'> {
  value: string;
  onCommit: (value: string) => void;
}

/** A text input that commits its draft on Enter or when it loses focus, and only when the draft differs. */
export function CommitInput({ value, onCommit, ...rest }: CommitInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  function commit(): void {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') commit();
  }
  return (
    <input
      className="field"
      type="text"
      autoComplete="off"
      {...rest}
      value={draft ?? value}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={commit}
    />
  );
}

/** A labelled `CommitInput` on its own line. */
export function CommitField({ label, value, placeholder, onCommit }: { label: string; value: string; placeholder?: string; onCommit: (value: string) => void }) {
  return (
    <div className="prop">
      <label className="label">{label}
        <CommitInput value={value} placeholder={placeholder} onCommit={onCommit} />
      </label>
    </div>
  );
}
