import { useId, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import { onRefusal } from '../api.ts';
import { Button, Dialog, Notice } from '../ui/index.ts';

interface NameDialogProps {
  /** the dialog's name and its submit button's label */
  title: string;
  fieldLabel: string;
  submitLabel: string;
  opener: RefObject<HTMLElement | null>;
  /** creates the thing; a refusal comes back as ApiFailure and is shown under the field */
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}

/** A dialog with one name field and the server's refusal sentences under it. */
export function NameDialog({ title, fieldLabel, submitLabel, opener, onSubmit, onClose }: NameDialogProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [sentences, setSentences] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    await onRefusal(() => onSubmit(name), (failure) => {
      setSentences(failure.sentences);
      setBusy(false);
      input.current?.focus();
    });
  }

  return (
    <Dialog name={title} onClose={onClose} opener={opener}>
      <form className="name-form" onSubmit={submit} noValidate>
        <label className="field-label" htmlFor={`${id}-name`}>{fieldLabel}</label>
        <input
          ref={input}
          id={`${id}-name`}
          className="field"
          type="text"
          autoComplete="off"
          data-autofocus
          aria-describedby={`${id}-status`}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div id={`${id}-status`} role="status">
          {sentences.length > 0 ? (
            <Notice tone="error">{sentences.map((sentence) => <p key={sentence}>{sentence}</p>)}</Notice>
          ) : null}
        </div>
        <div className="name-actions">
          <Button primary type="submit" disabled={busy}>{submitLabel}</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
