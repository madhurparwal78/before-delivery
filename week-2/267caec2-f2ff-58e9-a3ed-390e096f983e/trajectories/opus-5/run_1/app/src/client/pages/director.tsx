import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { api, DeskError } from '../api';
import type { PageProps } from '../main';
import { useShell } from '../shell';
import type { CategorySummary, Program, Studio } from '../types';
import { Field, GridLines, useFeedback, usePending } from '../ui';

const ZONES = [
  'Asia/Kolkata',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
  'UTC',
];

export function DirectorHome({ navigate }: PageProps): JSX.Element {
  useShell('Director', null);
  const feedback = useFeedback();
  const [pending, run] = usePending();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    name: '',
    year: String(new Date().getFullYear()),
    timeZone: 'Asia/Kolkata',
    earlyBirdDate: '',
    deadlineDate: '',
    earlyBirdFee: '45.00',
    standardFee: '70.00',
  });

  const load = async (): Promise<void> => {
    const body = await api<{ programs: Program[] }>('GET', '/api/programs');
    setPrograms(body.programs);
  };

  useEffect(() => {
    void load();
  }, []);

  const change = (field: string) => (event: Event) =>
    setForm({ ...form, [field]: (event.target as HTMLInputElement).value });

  const create = async (event: Event): Promise<void> => {
    event.preventDefault();
    setErrors({});
    feedback.say('Creating program…');
    const result = await run(async () => {
      try {
        return await api<{ program: Program }>('POST', '/api/programs', {
          name: form.name,
          year: Number(form.year),
          timeZone: form.timeZone,
          earlyBirdDate: form.earlyBirdDate,
          deadlineDate: form.deadlineDate,
          earlyBirdFeeCents: Math.round(Number(form.earlyBirdFee) * 100),
          standardFeeCents: Math.round(Number(form.standardFee) * 100),
        });
      } catch (error) {
        if (error instanceof DeskError && Object.keys(error.fields).length > 0) {
          setErrors(error.fields);
          document.getElementById(`program-${Object.keys(error.fields)[0]}`)?.focus();
        }
        throw error;
      }
    });
    if (result === undefined) return;
    feedback.say('Program created.');
    await load();
  };

  return (
    <div class="grid">
      <GridLines />
      <div class="span-12">
        <h1>Director</h1>
        <p>
          <a
            href="/director/audit"
            onClick={(event) => {
              event.preventDefault();
              navigate('/director/audit');
            }}
          >
            Director actions
          </a>
        </p>
      </div>
      <div class="span-6 stack">
        <h2>Programs</h2>
        {programs.map((program) => (
          <div key={program.id} class="region">
            <h3>
              <a
                href={`/director/programs/${program.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(`/director/programs/${program.id}`);
                }}
              >
                {program.name}
              </a>
            </h3>
            <p class="hint">
              {program.year} · {program.timeZone} · entries close {program.deadlineLabel}
            </p>
          </div>
        ))}
      </div>
      <form class="span-6 stack" onSubmit={(event) => void create(event)}>
        <h2>New program</h2>
        <Field label="Program name" id="program-name" error={errors.name}>
          <input id="program-name" type="text" value={form.name} onInput={change('name')} />
        </Field>
        <Field label="Year" id="program-year" error={errors.year}>
          <input id="program-year" type="number" aria-label="Year" value={form.year} onInput={change('year')} />
        </Field>
        <Field label="Time zone" id="program-timeZone" error={errors.timeZone}>
          <select id="program-timeZone" aria-label="Time zone" value={form.timeZone} onChange={change('timeZone')}>
            {ZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Early-bird ends" id="program-earlyBirdDate" error={errors.earlyBirdDate}>
          <input
            id="program-earlyBirdDate"
            type="date"
            value={form.earlyBirdDate}
            onInput={change('earlyBirdDate')}
          />
        </Field>
        <Field label="Entries close" id="program-deadlineDate" error={errors.deadlineDate}>
          <input
            id="program-deadlineDate"
            type="date"
            value={form.deadlineDate}
            onInput={change('deadlineDate')}
          />
        </Field>
        <Field label="Early-bird fee" id="program-earlyBirdFeeCents" error={errors.earlyBirdFeeCents}>
          <input
            id="program-earlyBirdFeeCents"
            type="text"
            aria-label="Early-bird fee"
            value={form.earlyBirdFee}
            onInput={change('earlyBirdFee')}
          />
        </Field>
        <Field label="Standard fee" id="program-standardFeeCents" error={errors.standardFeeCents}>
          <input
            id="program-standardFeeCents"
            type="text"
            aria-label="Standard fee"
            value={form.standardFee}
            onInput={change('standardFee')}
          />
        </Field>
        <div>
          <button class="btn" type="submit" disabled={pending}>
            {pending ? 'Creating program…' : 'Create program'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function DirectorProgram({ params, navigate }: PageProps): JSX.Element {
  const feedback = useFeedback();
  const [pending, run] = usePending();
  const [program, setProgram] = useState<Program | null>(null);
  const [summary, setSummary] = useState<CategorySummary[]>([]);
  const [studios, setStudios] = useState<Studio[]>([]);
  const [dates, setDates] = useState({ earlyBirdDate: '', deadlineDate: '' });
  const [category, setCategory] = useState({ name: '', shortlistSize: '5', finalistCount: '3' });
  const [juror, setJuror] = useState({ name: '', email: '', password: '', studioId: '' });

  const load = async (): Promise<void> => {
    const body = await api<{ programs: Program[] }>('GET', '/api/programs');
    const found = body.programs.find((item) => item.id === params.id) ?? null;
    setProgram(found);
    if (found !== null) setDates({ earlyBirdDate: found.earlyBirdDate, deadlineDate: found.deadlineDate });
    const counts = await api<{ categories: CategorySummary[] }>('GET', `/api/programs/${params.id}/summary`);
    setSummary(counts.categories);
  };

  useEffect(() => {
    void load();
    void api<{ studios: Studio[] }>('GET', '/api/studios').then((body) => setStudios(body.studios));
  }, [params.id]);

  useShell(program?.name ?? 'Director', program?.entriesOpen === true ? program.deadlineAt : null);

  const updateDates = async (event: Event): Promise<void> => {
    event.preventDefault();
    feedback.say('Updating dates…');
    const result = await run(() => api('PATCH', `/api/programs/${params.id}`, dates));
    if (result === undefined) return;
    feedback.say('Dates updated.');
    await load();
  };

  const addCategory = async (event: Event): Promise<void> => {
    event.preventDefault();
    feedback.say('Adding category…');
    const result = await run(() =>
      api('POST', `/api/programs/${params.id}/categories`, {
        name: category.name,
        shortlistSize: Number(category.shortlistSize),
        finalistCount: Number(category.finalistCount),
      }),
    );
    if (result === undefined) return;
    feedback.say('Category added.');
    setCategory({ ...category, name: '' });
    await load();
  };

  const createJuror = async (event: Event): Promise<void> => {
    event.preventDefault();
    feedback.say('Creating juror…');
    const result = await run(() =>
      api('POST', '/api/jurors', {
        name: juror.name,
        email: juror.email,
        password: juror.password,
        studioId: juror.studioId === '' ? null : juror.studioId,
      }),
    );
    if (result === undefined) return;
    feedback.say('Juror account created.');
    setJuror({ name: '', email: '', password: '', studioId: '' });
  };

  const states = [...new Set(summary.flatMap((item) => Object.keys(item.counts)))];

  return (
    <div class="grid">
      <GridLines />
      <div class="span-12">
        <h1>{program?.name ?? 'Program'}</h1>
      </div>

      <form class="span-6 stack" onSubmit={(event) => void updateDates(event)}>
        <h2>Dates</h2>
        <Field label="Early-bird ends" id="dates-early">
          <input
            id="dates-early"
            type="date"
            aria-label="Early-bird ends"
            value={dates.earlyBirdDate}
            onInput={(event) =>
              setDates({ ...dates, earlyBirdDate: (event.target as HTMLInputElement).value })
            }
          />
        </Field>
        <Field label="Entries close" id="dates-close">
          <input
            id="dates-close"
            type="date"
            aria-label="Entries close"
            value={dates.deadlineDate}
            onInput={(event) =>
              setDates({ ...dates, deadlineDate: (event.target as HTMLInputElement).value })
            }
          />
        </Field>
        <div>
          <button class="btn" type="submit" disabled={pending}>
            {pending ? 'Updating dates…' : 'Update dates'}
          </button>
        </div>
      </form>

      <form class="span-6 stack" onSubmit={(event) => void addCategory(event)}>
        <h2>Add category</h2>
        <Field label="Category name" id="category-name">
          <input
            id="category-name"
            type="text"
            value={category.name}
            onInput={(event) => setCategory({ ...category, name: (event.target as HTMLInputElement).value })}
          />
        </Field>
        <Field label="Shortlist size" id="category-shortlist">
          <input
            id="category-shortlist"
            type="number"
            aria-label="Shortlist size"
            value={category.shortlistSize}
            onInput={(event) =>
              setCategory({ ...category, shortlistSize: (event.target as HTMLInputElement).value })
            }
          />
        </Field>
        <Field label="Finalists" id="category-finalists">
          <input
            id="category-finalists"
            type="number"
            aria-label="Finalists"
            value={category.finalistCount}
            onInput={(event) =>
              setCategory({ ...category, finalistCount: (event.target as HTMLInputElement).value })
            }
          />
        </Field>
        <div>
          <button class="btn" type="submit" disabled={pending}>
            {pending ? 'Adding category…' : 'Add category'}
          </button>
        </div>
      </form>

      <div class="span-12">
        <h2>Entries by state</h2>
        <div class="ranked">
          <table aria-label="Entries by state">
            <thead>
              <tr>
                <th scope="col">Category</th>
                {states.map((state) => (
                  <th key={state} scope="col">
                    {state}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.map((item) => (
                <tr key={item.id}>
                  <td>
                    <a
                      href={`/director/categories/${item.id}`}
                      onClick={(event) => {
                        event.preventDefault();
                        navigate(`/director/categories/${item.id}`);
                      }}
                    >
                      {item.name}
                    </a>
                  </td>
                  {states.map((state) => (
                    <td key={state} class="rank-cell">
                      {item.counts[state] ?? 0}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div class="span-12 stack">
        <h2>Rounds</h2>
        {summary.map((item) =>
          item.rounds.map((round) => (
            <p key={round.id}>
              <a
                href={`/director/rounds/${round.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(`/director/rounds/${round.id}`);
                }}
              >
                {item.name} — {round.name}
              </a>{' '}
              <span class="hint">{round.state}</span>
            </p>
          )),
        )}
      </div>

      <form class="span-6 stack" onSubmit={(event) => void createJuror(event)}>
        <h2>New juror</h2>
        <Field label="Juror name" id="juror-name">
          <input
            id="juror-name"
            type="text"
            value={juror.name}
            onInput={(event) => setJuror({ ...juror, name: (event.target as HTMLInputElement).value })}
          />
        </Field>
        <Field label="Juror email" id="juror-email">
          <input
            id="juror-email"
            type="email"
            value={juror.email}
            onInput={(event) => setJuror({ ...juror, email: (event.target as HTMLInputElement).value })}
          />
        </Field>
        <Field label="Juror password" id="juror-password">
          <input
            id="juror-password"
            type="password"
            value={juror.password}
            onInput={(event) => setJuror({ ...juror, password: (event.target as HTMLInputElement).value })}
          />
        </Field>
        <Field label="Home studio" id="juror-studio">
          <select
            id="juror-studio"
            aria-label="Home studio"
            value={juror.studioId}
            onChange={(event) => setJuror({ ...juror, studioId: (event.target as HTMLSelectElement).value })}
          >
            <option value="">None</option>
            {studios.map((studio) => (
              <option key={studio.id} value={studio.id}>
                {studio.name}
              </option>
            ))}
          </select>
        </Field>
        <div>
          <button class="btn" type="submit" disabled={pending}>
            {pending ? 'Creating juror…' : 'Create juror'}
          </button>
        </div>
      </form>
    </div>
  );
}
