// The inline New Folder field: `New folder` selected; Enter or leaving commits, Escape removes the row (brief: Interactions > Dashboard).
import { useEffect, useId, useRef, useState } from 'react';
import { fieldMessages, GENERIC_ERROR } from '../errors.ts';

interface NewFolderFieldProps {
  /** Creates the folder; rejects with the API error so a 422 shows under the field and the row stays. */
  create: (name: string) => Promise<void>;
  onClose: () => void;
}

export function NewFolderField({ create, onClose }: NewFolderFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const busy = useRef(false);
  const [value, setValue] = useState('New folder');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const errorId = useId();

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const commit = async (): Promise<void> => {
    if (finished.current || busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      await create(value);
      finished.current = true;
      onClose();
    } catch (failure) {
      setError(fieldMessages(failure).name ?? GENERIC_ERROR);
      busy.current = false;
      setPending(false);
    }
  };

  return (
    <div className="new-folder" aria-busy={pending || undefined}>
      <input
        ref={input}
        className="input"
        aria-label="Folder name"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void commit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            finished.current = true;
            onClose();
          }
        }}
        spellCheck={false}
      />
      {error ? <p id={errorId} className="field-error">{error}</p> : null}
    </div>
  );
}
