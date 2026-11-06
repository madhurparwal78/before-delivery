// Contact: a single-column form with an error summary and a polite result line.
import { useState } from 'preact/hooks';
import { pick, TOPICS } from '../../shared/catalog.js';
import { api } from '../api';
import { useCopy } from '../state';
import { ErrorSummary, Field, type FieldError, Live, orderedErrors } from '../ui';

const ORDER: [string, string][] = [
  ['name', 'f-name'],
  ['email', 'f-email'],
  ['topic', 'f-topic'],
  ['message', 'f-message'],
];

const EMPTY = { name: '', email: '', topic: '', message: '' };

export function ContactPage() {
  const { m, l } = useCopy();
  const [form, setForm] = useState(EMPTY);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);
  const set = (key: keyof typeof EMPTY) => (e: Event) => setForm({ ...form, [key]: (e.target as HTMLInputElement).value });

  const submit = async (e: Event) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setStatus(m.sending);
    const r = await api<{ reference: string }>('POST', '/api/contact', form);
    setPending(false);
    if (r.ok) {
      setFields({});
      setErrors([]);
      setForm(EMPTY);
      setStatus(m.contactThanks(r.data.reference));
    } else if (r.error.fields) {
      setStatus('');
      setFields(r.error.fields);
      setErrors(orderedErrors(r.error.fields, ORDER));
      setAttempt((a) => a + 1);
    } else setStatus(r.status === 0 ? m.network : r.error.message);
  };

  return (
    <div class="page narrow">
      <h1 tabIndex={-1}>{m.contactHeading}</h1>
      <p class="lede">{m.contactIntro}</p>
      <ErrorSummary errors={errors} attempt={attempt} />
      <form class="stack" onSubmit={submit} noValidate>
        <Field id="f-name" label={m.name} autocomplete="name" value={form.name} onInput={set('name')} error={fields.name} />
        <Field id="f-email" label={m.email} type="email" autocomplete="email" value={form.email} onInput={set('email')} error={fields.email} />
        <div class="field">
          <label for="f-topic">{m.topic}</label>
          <select id="f-topic" value={form.topic} onChange={set('topic')} aria-invalid={fields.topic ? 'true' : undefined} aria-describedby={fields.topic ? 'f-topic-error' : undefined}>
            <option value="">{m.chooseTopic}</option>
            {TOPICS.map((t) => (
              <option key={t.value} value={t.value}>
                {pick(t.label, l)}
              </option>
            ))}
          </select>
          {fields.topic && (
            <p id="f-topic-error" class="field-error">
              {fields.topic}
            </p>
          )}
        </div>
        <div class="field">
          <label for="f-message">{m.message}</label>
          <textarea
            id="f-message"
            rows={6}
            value={form.message}
            onInput={set('message')}
            aria-invalid={fields.message ? 'true' : undefined}
            aria-describedby={fields.message ? 'f-message-error' : undefined}
          />
          {fields.message && (
            <p id="f-message-error" class="field-error">
              {fields.message}
            </p>
          )}
        </div>
        <div class="actions">
          <button type="submit" class="button primary" aria-disabled={pending ? 'true' : undefined} aria-busy={pending ? 'true' : undefined}>
            {pending ? m.sending : m.sendMessage}
          </button>
        </div>
        <Live name={m.contactStatus} text={status} class="result-line" />
      </form>
    </div>
  );
}
