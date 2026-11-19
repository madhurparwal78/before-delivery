import { useEffect, useRef, useState } from 'react';
import type { Outcome } from '../lib/workspace.js';

interface CommitFieldProps {
  label: string;
  value: string;
  /** What to show instead of the typed text (a size being dragged). */
  shown?: string;
  /** Sends the typed text; a refusal marks the field invalid and the field goes back to the stored value. */
  onCommit: (text: string) => Promise<Outcome>;
}

/** A text field that applies its value on Enter or on leaving, when it differs from the stored one. */
export function CommitField({ label, value, shown, onCommit }: CommitFieldProps) {
  const [text, setText] = useState(value);
  const [problem, setProblem] = useState('');
  const sent = useRef<string | null>(null);
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => setText(value), [value]);

  const commit = async (): Promise<void> => {
    if (text.trim() === value || sent.current === text) return;
    sent.current = text;
    const outcome = await onCommit(text);
    sent.current = null;
    setProblem(outcome.ok ? '' : outcome.message);
    setText(latest.current);
  };

  return (
    <div className="commit-field">
      <input
        type="text"
        inputMode="text"
        className={problem ? 'invalid mono' : 'mono'}
        aria-label={label}
        aria-invalid={problem ? true : undefined}
        spellCheck={false}
        autoComplete="off"
        value={shown ?? text}
        onChange={(event) => {
          setText(event.target.value);
          setProblem('');
        }}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void commit();
        }}
      />
      {problem && <span className="field-error">{problem}</span>}
    </div>
  );
}
