import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ApiError, api } from './api.js';
import { announce } from './announce.js';
import { useSession } from './session.js';
import { Button, Field, Modal, RadioGroup, useFocusFirstInvalid } from './ui.js';
import './pages/pages.css';

const CATEGORIES = [
  { value: 'hate', label: 'Hate speech or incitement' },
  { value: 'terrorism', label: 'Terrorist content' },
  { value: 'csam', label: 'Child sexual abuse material' },
  { value: 'ip', label: 'Intellectual property infringement' },
  { value: 'privacy', label: 'Privacy violation' },
  { value: 'other', label: 'Other illegal content' },
];

const COPY = {
  category: 'Choose a type',
  explanation: 'Explain why this is illegal',
  reporterEmail: 'Enter a valid email address',
  goodFaith: 'Confirm the statement to send',
} as const;

export function ReportDialog({ targetType, targetId, onClose }: { targetType: 'post' | 'comment'; targetId: string; onClose: () => void }): React.JSX.Element {
  const { user } = useSession();
  const [category, setCategory] = useState<string | null>(null);
  const [explanation, setExplanation] = useState('');
  const [email, setEmail] = useState('');
  const [goodFaith, setGoodFaith] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tries, setTries] = useState(0);
  const [busy, setBusy] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const faithError = useId();
  useFocusFirstInvalid(form, tries);
  useEffect(() => { if (reference !== null) close.current?.focus(); }, [reference]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      const filed = await api<{ reference: string }>('POST', '/api/reports', {
        targetType, targetId, category: category ?? undefined, explanation, goodFaith,
        ...(user ? {} : { reporterEmail: email }),
      });
      setReference(filed.reference);
      announce(`Report sent. Reference ${filed.reference}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        const next: Record<string, string> = {};
        for (const key of Object.keys(error.fields) as Array<keyof typeof COPY>) if (key in COPY) next[key] = COPY[key];
        setErrors(next);
        setTries((n) => n + 1);
      } else {
        announce("The report didn't send", true);
      }
    } finally {
      setBusy(false);
    }
  };

  if (reference !== null) {
    return (
      <Modal title="Report received" onClose={onClose}>
        <p>Your reference is {reference}</p>
        <p className="muted">We sent a confirmation to your email address.</p>
        <div className="form-actions"><button ref={close} type="button" className="btn btn-primary" onClick={onClose}>Close</button></div>
      </Modal>
    );
  }
  return (
    <Modal title="Report illegal content" onClose={onClose}>
      <form ref={form} className="report-dialog" onSubmit={(e) => void submit(e)} noValidate>
        <RadioGroup label="Type of illegal content" name="category" options={CATEGORIES} value={category} onChange={setCategory} error={errors.category} />
        <Field label="Explain why this is illegal" error={errors.explanation}>
          {(p) => <textarea {...p} rows={4} value={explanation} onChange={(e) => setExplanation(e.target.value)} />}
        </Field>
        {!user && (
          <Field label="Your email" error={errors.reporterEmail} hint="Used only to send you the confirmation.">
            {(p) => <input {...p} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
        )}
        <div className="field">
          <label className="check">
            <input
              type="checkbox" checked={goodFaith} onChange={(e) => setGoodFaith(e.target.checked)}
              aria-invalid={errors.goodFaith ? true : undefined} aria-describedby={errors.goodFaith ? faithError : undefined}
            />
            <span>I believe this report is accurate and complete</span>
          </label>
          {errors.goodFaith && <p id={faithError} className="field-error">{errors.goodFaith}</p>}
        </div>
        <div className="form-actions">
          <Button type="submit" variant="primary" busy={busy}>{busy ? 'Sending...' : 'Send report'}</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
