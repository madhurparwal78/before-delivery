import { useState, type FormEvent } from 'react';
import { api, ApiFailure } from '../api';
import { useTitle } from '../router';
import type { PublicForm as Form } from '../settings';
import { Button, Problem } from '../ui';
import '../build/styles/site.css';

export function PublicForm({ form, slug, path }: { form: Form; slug: string; path: string }) {
  useTitle(form.name);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; field?: string } | null>(null);
  const [thanks, setThanks] = useState(false);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    setThanks(false);
    api.post(`/api/forms/${slug}/${path}`, values)
      .then(() => {
        setValues({});
        setThanks(true);
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiFailure)) throw error;
        setProblem({ message: error.message, field: error.field });
      })
      .finally(() => setBusy(false));
  };

  return (
    <section className="form-panel panel-dark on-dark">
      <h1>{form.name}</h1>
      <div className="auth-card">
        <form onSubmit={submit} noValidate>
          <Problem message={problem?.message ?? null} field={problem?.field} />
          {form.fields.map((field) => (
            <div key={field.name} className="field">
              <label htmlFor={`field-${field.name}`}>{field.label}</label>
              <input
                id={`field-${field.name}`}
                type={field.type === 'number' ? 'number' : 'text'}
                inputMode={field.type === 'number' ? 'decimal' : undefined}
                value={values[field.name] ?? ''}
                onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
              />
            </div>
          ))}
          <Button type="submit" busy={busy}>Submit</Button>
        </form>
        {thanks ? <p role="status" className="thanks">Thanks, your response was received.</p> : null}
      </div>
    </section>
  );
}
