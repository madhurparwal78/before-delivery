import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { FaqContent, HospitalityContent, HotelContent, SessionContent } from '../shared/api.js';
import {
  CONTENT_SAVED,
  HANDS_ON_FIELD_ERROR,
  handsOnShareText,
} from '../shared/copy.js';
import {
  agendaMinutes,
  handsOnSharePercent,
  handsOnShareHolds,
} from '../shared/handsOnShare.js';
import { ApiFailure, api } from './api.js';
import { SeatsRegion, useInventory } from './DeskPage.js';
import { Field, LiveRegion } from './ui.js';

type Kind = 'sessions' | 'hospitality' | 'hotels' | 'faq';

const TABS: readonly { readonly kind: Kind; readonly label: string }[] = [
  { kind: 'sessions', label: 'Agenda' },
  { kind: 'hospitality', label: 'Evenings' },
  { kind: 'hotels', label: 'Hotels' },
  { kind: 'faq', label: 'FAQ' },
];

interface SessionForm {
  readonly id: string | null;
  readonly number: string;
  readonly day: string;
  readonly format: 'lecture' | 'hands-on';
  readonly minutes: string;
  readonly title: string;
  readonly outcomes: string;
}

const EMPTY_SESSION: SessionForm = {
  id: null,
  number: '',
  day: '1',
  format: 'lecture',
  minutes: '',
  title: '',
  outcomes: '',
};

function minutesValue(raw: string): number {
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function AgendaTab({ announce }: { readonly announce: (text: string) => void }): ReactNode {
  const [sessions, setSessions] = useState<SessionContent[]>([]);
  const [form, setForm] = useState<SessionForm>(EMPTY_SESSION);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await api<{ items: SessionContent[] }>('/api/desk/content/sessions');
    setSessions(result.items);
  }, []);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  /** The share the agenda would have if the form were saved now. */
  const projected = useMemo(() => {
    const others = sessions.filter((session) => session.id !== form.id);
    const counted = confirmingDelete
      ? others
      : [...others, { format: form.format, minutes: minutesValue(form.minutes) }];
    return agendaMinutes(counted);
  }, [confirmingDelete, form.format, form.id, form.minutes, sessions]);

  const breaksRule = !handsOnShareHolds(projected);
  const minutesError = breaksRule ? HANDS_ON_FIELD_ERROR : serverError;

  const save = useCallback(async () => {
    setServerError(null);
    const body = {
      number: minutesValue(form.number),
      day: minutesValue(form.day),
      format: form.format,
      minutes: minutesValue(form.minutes),
      title: form.title,
      outcomes: form.outcomes,
    };
    try {
      if (form.id === null) {
        await api('/api/desk/content/sessions', { body });
      } else {
        await api(`/api/desk/content/sessions/${form.id}`, { method: 'PATCH', body });
      }
      await load();
      announce(CONTENT_SAVED);
    } catch (error) {
      if (error instanceof ApiFailure) {
        const fieldMessage = error.body.errors?.['minutes'] ?? null;
        if (fieldMessage !== null) setServerError(fieldMessage);
        announce(error.body.message);
        return;
      }
      throw error;
    }
  }, [announce, form, load]);

  return (
    <div className="content-pane">
      <div className="content-list">
        <ul aria-label="Sessions" className="session-admin-list">
          {sessions.map((session) => (
            <li key={session.id}>
              <button
                type="button"
                aria-label={`Session ${session.number}: ${session.title}`}
                onClick={() => {
                  setConfirmingDelete(false);
                  setServerError(null);
                  setForm({
                    id: session.id,
                    number: String(session.number),
                    day: String(session.day),
                    format: session.format,
                    minutes: String(session.minutes),
                    title: session.title,
                    outcomes: session.outcomes,
                  });
                }}
              >
                <span className="num">Session {session.number}</span>: {session.title}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => {
            setConfirmingDelete(false);
            setServerError(null);
            setForm(EMPTY_SESSION);
          }}
        >
          New session
        </button>
      </div>

      <div className="content-form">
        <p role="status" aria-live="polite" aria-label="Hands-on share" className="share-status">
          {handsOnShareText(
            projected.handsOnMinutes,
            projected.totalMinutes,
            handsOnSharePercent(projected),
          )}
        </p>
        <Field
          label="Number"
          value={form.number}
          onChange={(value) => setForm((current) => ({ ...current, number: value }))}
        />
        <Field
          label="Day"
          value={form.day}
          onChange={(value) => setForm((current) => ({ ...current, day: value }))}
        />
        <div role="radiogroup" aria-label="Format" className="format-switch">
          {(['lecture', 'hands-on'] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="radio"
              aria-checked={form.format === candidate}
              aria-label={candidate === 'lecture' ? 'Lecture' : 'Hands-on'}
              className={form.format === candidate ? 'tier-on' : ''}
              onClick={() => setForm((current) => ({ ...current, format: candidate }))}
            >
              {candidate === 'lecture' ? 'Lecture' : 'Hands-on'}
            </button>
          ))}
        </div>
        <Field
          label="Minutes"
          value={form.minutes}
          onChange={(value) => setForm((current) => ({ ...current, minutes: value }))}
          error={minutesError ?? undefined}
        />
        <Field
          label="Title"
          value={form.title}
          onChange={(value) => setForm((current) => ({ ...current, title: value }))}
        />
        <Field
          label="Outcomes"
          value={form.outcomes}
          onChange={(value) => setForm((current) => ({ ...current, outcomes: value }))}
        />
        <button type="button" onClick={() => void save()}>
          Save
        </button>
        {form.id === null ? null : confirmingDelete ? (
          <>
            <button
              type="button"
              onClick={() => {
                void api(`/api/desk/content/sessions/${form.id}`, { method: 'DELETE' })
                  .then(async () => {
                    setConfirmingDelete(false);
                    setForm(EMPTY_SESSION);
                    await load();
                    announce(CONTENT_SAVED);
                  })
                  .catch((error: unknown) => {
                    if (error instanceof ApiFailure) {
                      setServerError(error.body.errors?.['minutes'] ?? null);
                      announce(error.body.message);
                    }
                  });
              }}
            >
              Confirm delete
            </button>
            <button type="button" onClick={() => setConfirmingDelete(false)}>
              Keep session
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirmingDelete(true)}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

interface SimpleField {
  readonly name: string;
  readonly label: string;
  readonly fallback?: string;
}

const FIELDS: Record<Exclude<Kind, 'sessions'>, readonly SimpleField[]> = {
  hospitality: [
    { name: 'title', label: 'Title' },
    { name: 'day', label: 'Day', fallback: '1' },
    { name: 'starts_at', label: 'Starts at' },
    { name: 'venue', label: 'Venue' },
    { name: 'tier', label: 'Tier', fallback: 'all' },
    { name: 'description', label: 'Description' },
  ],
  hotels: [
    { name: 'name', label: 'Name' },
    { name: 'distance', label: 'Distance' },
    { name: 'rate', label: 'Rate' },
    { name: 'map_url', label: 'Map link' },
  ],
  faq: [
    { name: 'question', label: 'Question' },
    { name: 'answer', label: 'Answer' },
    { name: 'sort', label: 'Sort', fallback: '1' },
  ],
};

const NUMERIC = new Set(['day', 'sort']);

function titleOf(kind: Exclude<Kind, 'sessions'>, item: Record<string, unknown>): string {
  if (kind === 'hotels') return String(item['name'] ?? '');
  if (kind === 'faq') return String(item['question'] ?? '');
  return String(item['title'] ?? '');
}

function SimpleTab({
  kind,
  announce,
}: {
  readonly kind: Exclude<Kind, 'sessions'>;
  readonly announce: (text: string) => void;
}): ReactNode {
  type Item = (HospitalityContent | HotelContent | FaqContent) & Record<string, unknown>;
  const [items, setItems] = useState<Item[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [id, setId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const result = await api<{ items: Item[] }>(`/api/desk/content/${kind}`);
    setItems(result.items);
  }, [kind]);

  useEffect(() => {
    setId(null);
    setValues({});
    setErrors({});
    void load().catch(() => undefined);
  }, [load]);

  const fields = FIELDS[kind];

  return (
    <div className="content-pane">
      <div className="content-list">
        <ul aria-label={kind} className="session-admin-list">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => {
                  setId(item.id);
                  setErrors({});
                  const next: Record<string, string> = {};
                  for (const field of fields) next[field.name] = String(item[field.name] ?? '');
                  setValues(next);
                }}
              >
                {titleOf(kind, item)}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => {
            setId(null);
            setErrors({});
            const next: Record<string, string> = {};
            for (const field of fields) next[field.name] = field.fallback ?? '';
            setValues(next);
          }}
        >
          New entry
        </button>
      </div>
      <div className="content-form">
        {fields.map((field) => (
          <Field
            key={field.name}
            label={field.label}
            value={values[field.name] ?? ''}
            error={errors[field.name]}
            onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))}
          />
        ))}
        <button
          type="button"
          onClick={() => {
            setErrors({});
            const body: Record<string, unknown> = {};
            for (const field of fields) {
              const raw = values[field.name] ?? '';
              body[field.name] = NUMERIC.has(field.name) ? Number.parseInt(raw, 10) || 0 : raw;
            }
            const request =
              id === null
                ? api(`/api/desk/content/${kind}`, { body })
                : api(`/api/desk/content/${kind}/${id}`, { method: 'PATCH', body });
            void request
              .then(async () => {
                await load();
                announce(CONTENT_SAVED);
              })
              .catch((error: unknown) => {
                if (error instanceof ApiFailure) {
                  setErrors(error.body.errors ?? {});
                  announce(error.body.message);
                }
              });
          }}
        >
          Save
        </button>
        {id === null ? null : (
          <button
            type="button"
            onClick={() => {
              void api(`/api/desk/content/${kind}/${id}`, { method: 'DELETE' })
                .then(async () => {
                  setId(null);
                  setValues({});
                  await load();
                  announce(CONTENT_SAVED);
                })
                .catch(() => undefined);
            }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

export function ContentDeskPage(): ReactNode {
  const [kind, setKind] = useState<Kind>('sessions');
  const [message, setMessage] = useState('');
  const inventory = useInventory();

  return (
    <main className="staff content-desk">
      <h1>Content desk</h1>
      <p>
        <a href="/">Back to the programme</a>
      </p>
      <SeatsRegion inventory={inventory} />
      <div role="tablist" aria-label="Content" className="content-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.kind}
            type="button"
            role="tab"
            aria-selected={kind === tab.kind}
            tabIndex={kind === tab.kind ? 0 : -1}
            className={kind === tab.kind ? 'tier-on' : ''}
            onClick={() => setKind(tab.kind)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              const index = TABS.findIndex((candidate) => candidate.kind === kind);
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % TABS.length
                  : (index - 1 + TABS.length) % TABS.length;
              setKind(TABS[next]?.kind ?? 'sessions');
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {kind === 'sessions' ? (
        <AgendaTab announce={setMessage} />
      ) : (
        <SimpleTab kind={kind} announce={setMessage} />
      )}
      <LiveRegion name="Desk updates" message={message} />
    </main>
  );
}
