import { useLayoutEffect, useState } from 'preact/hooks';
import { api, failureText, fieldErrorsOf } from '../api.js';
import { useApp } from '../app-context.js';
import { ErrorCell, Field, FormErrors, FormStatus } from '../components/forms.js';

function NameForm(props: {
  label: string;
  fieldId: string;
  fieldLabel: string;
  button: string;
  submit(name: string): Promise<void>;
}) {
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState('');
  return (
    <form
      aria-label={props.label}
      class="stack cell"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        setStatus('Saving...');
        setErrors({});
        setFailure('');
        try {
          await props.submit(name);
          setStatus('');
        } catch (error) {
          setStatus('');
          const fields = fieldErrorsOf(error);
          if (fields) setErrors(fields);
          else setFailure(failureText(error));
        }
      }}
    >
      <h2>{props.label}</h2>
      <FormErrors errors={errors} fields={{ name: { id: props.fieldId, label: props.fieldLabel } }} />
      <Field id={props.fieldId} label={props.fieldLabel} error={errors.name} value={name} onInput={(e) => setName(e.currentTarget.value)} />
      <button type="submit" class="primary">
        {props.button}
      </button>
      <FormStatus text={status} />
      <ErrorCell label={`${props.label} error`} text={failure} />
    </form>
  );
}

export function HomePage() {
  const { me, reloadMe, navigate } = useApp();
  const instructor = Boolean(me?.school);
  const [scenarios, setScenarios] = useState<{ id: string; name: string }[]>([]);
  useLayoutEffect(() => {
    if (instructor) void api<{ id: string; name: string }[]>('GET', '/api/scenarios').then(setScenarios);
  }, [instructor]);
  if (!me) return null;
  const canFoundSchool = !instructor && me.classes.length === 0;
  return (
    <div class="grid-page">
      <section class="cell">
        <h1>Your classes</h1>
        {me.school ? <p class="muted">{me.school.name}</p> : null}
        <ul aria-label="Classes" class="link-list">
          {me.classes.map((cls) => (
            <li key={cls.id}>
              <a href={`/classes/${cls.id}`}>{cls.name}</a>
            </li>
          ))}
        </ul>
        {me.classes.length === 0 ? <p class="empty">No classes yet.</p> : null}
        {instructor ? (
          <p class="row-links">
            <a href="/aerodromes">Aerodromes</a>
            <a href="/scenarios/new">New scenario</a>
          </p>
        ) : null}
      </section>
      {instructor ? (
        <section class="cell" aria-labelledby="scenarios-heading">
          <h2 id="scenarios-heading">Scenarios</h2>
          <ul aria-label="Scenarios" class="link-list">
            {scenarios.map((scenario) => (
              <li key={scenario.id}>
                <a href={`/scenarios/${scenario.id}`}>{scenario.name}</a>
              </li>
            ))}
          </ul>
          {scenarios.length === 0 ? <p class="empty">No scenarios yet.</p> : null}
        </section>
      ) : null}
      {canFoundSchool ? (
        <NameForm
          label="Create school"
          fieldId="school-name"
          fieldLabel="School name"
          button="Create school"
          submit={async (name) => {
            await api('POST', '/api/schools', { name });
            await reloadMe();
          }}
        />
      ) : null}
      {instructor ? (
        <NameForm
          label="Create class"
          fieldId="class-name"
          fieldLabel="Class name"
          button="Create class"
          submit={async (name) => {
            const created = await api<{ id: string }>('POST', '/api/classes', { name });
            await reloadMe();
            navigate(`/classes/${created.id}`);
          }}
        />
      ) : null}
    </div>
  );
}
