import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ASSIGNMENT_STATUS_LABELS,
  LANGUAGE_NAMES,
  SETTING_LABELS,
  type AssignmentView,
  type SessionUser,
} from '../../shared/contract.js';
import { formatAgencyRange } from '../../shared/zone.js';
import { ApiFailure, NetworkFailure, api } from '../api.js';
import { AssignmentDrawer } from '../components/AssignmentDrawer.js';
import { usePoll } from '../hooks.js';
import { useHatchSeam, type SeamSnapshot } from '../seam.js';
import {
  Field,
  SeatLane,
  StatusRegion,
  coveredCountOf,
  coveredCountText,
  seatLabelOf,
} from '../ui.js';

const LANGUAGE_ORDER = ['asl', 'es', 'vi', 'so', 'ar'];
const SETTINGS = ['hospital', 'clinic', 'school'] as const;

interface FormState {
  language: string;
  setting: string;
  date: string;
  time: string;
  duration: string;
  street: string;
  city: string;
  initials: string;
  notes: string;
}

const BLANK: FormState = {
  language: 'asl',
  setting: 'hospital',
  date: '',
  time: '',
  duration: '90',
  street: '',
  city: '',
  initials: '',
  notes: '',
};

export function Requests({ user }: { user: SessionUser }): ReactNode {
  const [search, setSearch] = useState('');
  const requests = usePoll(() => api.assignments(search), search);
  const [openNumber, setOpenNumber] = useState<string | null>(null);

  const assignments = requests.data?.assignments ?? [];
  const snapshot = useMemo<SeamSnapshot | null>(
    () =>
      requests.data === null
        ? null
        : {
            seats: assignments.flatMap((assignment) =>
              assignment.seats.map((seat) => ({
                key: `${assignment.number}:${seat.seat}`,
                held: seat.status !== 'open',
                label: seatLabelOf(seat),
                groupKey: null,
                capsuleKey: assignment.number,
                announceSubject: `${assignment.number}: seat ${seat.seat}`,
              })),
            ),
            groups: [],
            capsules: assignments.map((assignment) => ({
              key: assignment.number,
              covered: coveredCountOf(assignment.seats),
              seats: assignment.seats.length,
            })),
          },
    [requests.data],
  );
  const { display } = useHatchSeam(snapshot);

  const opened = assignments.find((assignment) => assignment.number === openNumber) ?? null;

  return (
    <main className="sheet">
      {user.role === 'scheduler' ? (
        <section className="panel span-4">
          <h2 className="panel__title">Request an interpreter</h2>
          <RequestForm onCreated={() => void requests.refresh()} />
        </section>
      ) : null}

      <section className={user.role === 'scheduler' ? 'panel span-8' : 'panel span-12'}>
        <h2 className="panel__title">Requests</h2>
        <Field label="Search requests">
          {({ id }) => (
            <input
              id={id}
              type="search"
              value={search}
              placeholder="Assignment number or city"
              onChange={(event) => setSearch(event.target.value)}
            />
          )}
        </Field>
        <div className="table-wrap">
  <table className="stacked" aria-label="Requests">
            <thead>
              <tr>
                <th scope="col">Number</th>
                <th scope="col">Language</th>
                <th scope="col">Setting</th>
                <th scope="col">When (Central)</th>
                <th scope="col">Seats</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="visually-hidden">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((assignment) => (
                <tr key={assignment.number}>
                  <td data-label="Number">
                    <span className="num">{assignment.number}</span>
                  </td>
                  <td data-label="Language">{LANGUAGE_NAMES[assignment.language] ?? assignment.language}</td>
                  <td data-label="Setting">{SETTING_LABELS[assignment.setting]}</td>
                  <td data-label="When">
                    {formatAgencyRange(new Date(assignment.start_at), new Date(assignment.end_at))}
                  </td>
                  <td data-label="Seats">
                    {assignment.seats.map((seat) => (
                      <SeatLane
                        key={seat.seat}
                        seat={seat.seat}
                        variant="bar"
                        fill={display.fill[`${assignment.number}:${seat.seat}`] ?? 0}
                        label={display.label[`${assignment.number}:${seat.seat}`] ?? 'open'}
                        animating={display.animating[`${assignment.number}:${seat.seat}`] ?? false}
                      />
                    ))}
                    <span>
                      {coveredCountText(
                        display.covered[assignment.number] ?? coveredCountOf(assignment.seats),
                        assignment.seats.length,
                      )}
                    </span>
                  </td>
                  <td data-label="Status" className="statuscell">
                    {ASSIGNMENT_STATUS_LABELS[assignment.status]}
                  </td>
                  <td data-label="">
                    <button
                      type="button"
                      className="btn btn--quiet"
                      onClick={() => setOpenNumber(assignment.number)}
                    >
                      Open {assignment.number}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
</div>
        {assignments.length === 0 ? <p>No requests yet.</p> : null}
      </section>

      {opened === null ? null : (
        <AssignmentDrawer
          assignment={opened}
          role={user.role}
          onClose={() => setOpenNumber(null)}
          onChanged={() => void requests.refresh()}
        />
      )}
    </main>
  );
}

function RequestForm({ onCreated }: { onCreated: () => void }): ReactNode {
  const [form, setForm] = useState<FormState>(BLANK);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());

  const set = (key: keyof FormState) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (): Promise<void> => {
    setPending(true);
    setFields({});
    setStatus('Submitting…');
    try {
      const created: AssignmentView = await api.createAssignment(
        {
          language: form.language,
          setting: form.setting,
          start_at: `${form.date}T${form.time}:00`,
          duration_minutes: Number(form.duration),
          street_address: form.street,
          city: form.city,
          patient_initials: form.initials,
          medical_notes: form.notes,
        },
        idempotencyKey.current,
      );
      setStatus(`Request ${created.number} submitted. Awaiting release by dispatch.`);
      setForm(BLANK);
      idempotencyKey.current = crypto.randomUUID();
      onCreated();
    } catch (error) {
      if (error instanceof NetworkFailure) {
        setStatus("Couldn't reach Teamseat. Your request is safe to submit again.");
      } else if (error instanceof ApiFailure && error.code === 'idempotency_conflict') {
        setStatus('This request was already submitted with different details. Reload to see it.');
      } else if (error instanceof ApiFailure && error.status === 422) {
        setFields(error.fields);
        setStatus('Check the highlighted fields.');
      } else {
        setStatus("Couldn't reach Teamseat. Your request is safe to submit again.");
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      aria-label="Request an interpreter"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Field label="Language" error={fields['language']}>
        {({ id, describedBy }) => (
          <select
            id={id}
            aria-describedby={describedBy}
            value={form.language}
            onChange={(event) => set('language')(event.target.value)}
          >
            {LANGUAGE_ORDER.map((code) => (
              <option key={code} value={code}>
                {LANGUAGE_NAMES[code]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Setting" error={fields['setting']}>
        {({ id, describedBy }) => (
          <select
            id={id}
            aria-describedby={describedBy}
            value={form.setting}
            onChange={(event) => set('setting')(event.target.value)}
          >
            {SETTINGS.map((setting) => (
              <option key={setting} value={setting}>
                {SETTING_LABELS[setting]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Date" hint="YYYY-MM-DD, Central time" error={fields['start_at']}>
        {({ id, describedBy }) => (
          <input
            id={id}
            type="text"
            inputMode="numeric"
            placeholder="2026-11-12"
            aria-describedby={describedBy}
            value={form.date}
            onChange={(event) => set('date')(event.target.value)}
          />
        )}
      </Field>
      <Field label="Start time" hint="HH:MM, Central time">
        {({ id, describedBy }) => (
          <input
            id={id}
            type="text"
            inputMode="numeric"
            placeholder="09:00"
            aria-describedby={describedBy}
            value={form.time}
            onChange={(event) => set('time')(event.target.value)}
          />
        )}
      </Field>
      <Field label="Duration (minutes)" error={fields['duration_minutes']}>
        {({ id, describedBy }) => (
          <input
            id={id}
            type="number"
            min={30}
            max={480}
            step={15}
            aria-describedby={describedBy}
            value={form.duration}
            onChange={(event) => set('duration')(event.target.value)}
          />
        )}
      </Field>
      <Field label="Street address" error={fields['street_address']}>
        {({ id, describedBy }) => (
          <input
            id={id}
            type="text"
            aria-describedby={describedBy}
            value={form.street}
            onChange={(event) => set('street')(event.target.value)}
          />
        )}
      </Field>
      <Field label="City" error={fields['city']}>
        {({ id, describedBy }) => (
          <input
            id={id}
            type="text"
            aria-describedby={describedBy}
            value={form.city}
            onChange={(event) => set('city')(event.target.value)}
          />
        )}
      </Field>
      <Field label="Patient initials" hint="Two or three capital letters" error={fields['patient_initials']}>
        {({ id, describedBy }) => (
          <input
            id={id}
            type="text"
            maxLength={3}
            aria-describedby={describedBy}
            value={form.initials}
            onChange={(event) => set('initials')(event.target.value.toUpperCase())}
          />
        )}
      </Field>
      <Field label="Medical notes" error={fields['medical_notes']}>
        {({ id, describedBy }) => (
          <textarea
            id={id}
            aria-describedby={describedBy}
            value={form.notes}
            onChange={(event) => set('notes')(event.target.value)}
          />
        )}
      </Field>
      <button type="submit" className="btn btn--primary" disabled={pending}>
        Submit request
      </button>
      <StatusRegion name="Request status" text={status} />
    </form>
  );
}
