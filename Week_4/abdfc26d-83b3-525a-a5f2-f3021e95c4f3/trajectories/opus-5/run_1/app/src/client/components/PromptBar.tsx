import { useEffect, useRef, useState } from 'react';
import { promptPlaceholder, studioStatus } from '../../shared/copy.js';
import { useReducedMotion } from '../lib/hooks.js';
import { ErrorSummary } from './ErrorSummary.js';

const TYPE_MS = 1000 / 25;
const KEPT_PROMPT_KEY = 'phosphene-yard:kept-prompt';

export interface PromptBarProps {
  readonly pending: boolean;
  readonly fieldError: string | null;
  onSubmit(prompt: string): void;
}

/** The describe-a-piece prompt bar, with a placeholder that types itself out. */
export function PromptBar({ pending, fieldError, onSubmit }: PromptBarProps): JSX.Element {
  const reducedMotion = useReducedMotion();
  const [value, setValue] = useState(() => sessionStorage.getItem(KEPT_PROMPT_KEY) ?? '');
  const [typed, setTyped] = useState(() =>
    reducedMotion ? promptPlaceholder : '',
  );
  const [stopped, setStopped] = useState(reducedMotion);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // The placeholder stops for good the moment the field gets focus or text.
  useEffect(() => {
    if (stopped || reducedMotion) {
      setTyped(promptPlaceholder);
      return;
    }
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setTyped(promptPlaceholder.slice(0, index));
      if (index >= promptPlaceholder.length) window.clearInterval(timer);
    }, TYPE_MS);
    return () => window.clearInterval(timer);
  }, [stopped, reducedMotion]);

  useEffect(() => {
    if (value === '') {
      sessionStorage.removeItem(KEPT_PROMPT_KEY);
    } else {
      sessionStorage.setItem(KEPT_PROMPT_KEY, value);
    }
  }, [value]);

  const stopTypewriter = (): void => setStopped(true);

  const submit = (): void => {
    if (pending) return;
    onSubmit(value.trim());
  };

  return (
    <form
      className="prompt-bar"
      aria-label="Describe a piece"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {fieldError && (
        <ErrorSummary
          errors={{ 'describe-a-piece': fieldError }}
          labels={{ 'describe-a-piece': 'Describe a piece' }}
        />
      )}
      <div className="prompt-bar__field">
        <span className="prompt-bar__slash" aria-hidden="true">
          /
        </span>
        <textarea
          id="describe-a-piece"
          ref={inputRef}
          className="prompt-bar__input"
          aria-label="Describe a piece"
          placeholder={typed}
          rows={1}
          value={value}
          {...(fieldError ? { 'aria-invalid': true, 'aria-describedby': 'describe-a-piece-error' } : {})}
          onFocus={stopTypewriter}
          onChange={(event) => {
            stopTypewriter();
            setValue(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button type="submit" className="prompt-bar__submit" disabled={pending}>
          Describe
        </button>
      </div>
      {fieldError && (
        <p className="field-error" id="describe-a-piece-error">
          {fieldError}
        </p>
      )}
      <p className="prompt-bar__hint muted">
        {pending ? studioStatus.describePending : 'Enter to send. The assistant drafts a shader you can tune.'}
      </p>
    </form>
  );
}
