import { useRef, useState } from 'preact/hooks';
import { ApiError, get, post } from '../lib/api.js';
import { usePolling } from '../lib/polling.js';
import { go } from '../lib/router.js';
import { useOverlay } from '../lib/overlay.js';
import { announce } from '../lib/announce.js';
import { dropDialog, holdDialog } from '../lib/resume.js';
import type { Appointment, SlotWeek } from '../lib/types.js';
import { copy, fieldCopy } from '../../shared/copy.js';
import { formatDateOnly, formatDateTime } from '../../shared/brussels.js';
import { isValidEmailish, isValidNameish } from '../lib/validate.js';
import { Overlay } from '../components/Overlay.js';
import { ActionButton, DialogActions, Field } from '../components/form.js';
import { ProblemsSummary, noProblems, problemsOf, type Problems } from '../components/Problems.js';
import { Icon } from '../components/Icon.js';
import { PublicTopBar } from '../components/chrome.js';
import { BottomBar } from '../components/layout.js';

const DIALOG = 'book-slot';

export function AppointmentsScreen({ search }: { search: string }) {
  const week = new URLSearchParams(search).get('week');
  const weeks = usePolling(
    () => get<SlotWeek>(`/api/appointment-slots${week === null ? '' : `?week=${week}`}`),
    week ?? 'first',
  );
  const dialog = useOverlay();
  const heading = useRef<HTMLHeadingElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [problems, setProblems] = useState<Problems>(noProblems);
  const [pending, setPending] = useState(false);

  const data = weeks.data;
  const days = new Map<string, SlotWeek['slots']>();
  for (const slot of data?.slots ?? []) {
    const day = slot.startsAt.slice(0, 10);
    days.set(day, [...(days.get(day) ?? []), slot]);
  }

  const book = async (): Promise<void> => {
    const fields: Record<string, string> = {};
    if (!isValidNameish(name)) fields['name'] = fieldCopy.name;
    if (!isValidEmailish(email)) fields['email'] = fieldCopy.email;
    if (Object.keys(fields).length > 0) {
      setProblems(problemsOf(fields));
      return;
    }
    setPending(true);
    try {
      const result = await post<{ appointment: Appointment }>('/api/appointments', {
        startsAt: selected,
        name: name.trim(),
        email: email.trim(),
      });
      announce(copy.bookingConfirmed(formatDateTime(Date.parse(result.appointment.startsAt))));
      setProblems(noProblems);
      setSelected(null);
      setName('');
      setEmail('');
      dropDialog(DIALOG);
      dialog.close();
      await weeks.reload();
      heading.current?.focus();
    } catch (error) {
      if (error instanceof ApiError) {
        const { failure } = error;
        setProblems(
          Object.keys(failure.fields).length > 0
            ? problemsOf(failure.fields)
            : problemsOf({}, failure.message),
        );
        announce(failure.message);
        await weeks.reload();
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div class="screen">
      <PublicTopBar />
      <main class="screen__main appointments">
        <h1 ref={heading} class="heading heading--1" tabIndex={-1}>
          {data === null || data === undefined
            ? 'Book an intake slot'
            : `Week of ${formatDateOnly(data.weekStart)}`}
        </h1>

        <div class="appointments__weeks">
          <button
            type="button"
            class="button button--quiet"
            disabled={data?.previousWeek === null || data === null || data === undefined}
            onClick={() => go(`/appointments?week=${data?.previousWeek ?? ''}`)}
          >
            <Icon name="previous" />
            Previous week
          </button>
          <button
            type="button"
            class="button button--quiet"
            disabled={data?.nextWeek === null || data === null || data === undefined}
            onClick={() => go(`/appointments?week=${data?.nextWeek ?? ''}`)}
          >
            Next week
            <Icon name="next" />
          </button>
        </div>

        <div class="appointments__days">
          {[...days.entries()].map(([day, slots]) => (
            <div key={day} class="appointments__day" role="group" aria-label={formatDateOnly(day)}>
              <h2 class="appointments__day-heading">{formatDateOnly(day)}</h2>
              <ul class="appointments__slots" role="list">
                {slots.map((slot) => (
                  <li key={slot.startsAt}>
                    <button
                      type="button"
                      class="slot tabular"
                      aria-pressed={selected === slot.startsAt}
                      disabled={!slot.free}
                      onClick={() => setSelected(slot.startsAt)}
                    >
                      {formatDateTime(Date.parse(slot.startsAt))}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <BottomBar>
          <button
            type="button"
            class="button button--primary"
            ref={dialog.openerRef}
            disabled={selected === null}
            onClick={() => {
              holdDialog(DIALOG, { name, email, slot: selected ?? '' });
              dialog.open();
            }}
          >
            Book slot
          </button>
        </BottomBar>

        {dialog.mounted ? (
          <Overlay state={dialog} name="Book slot">
            <h2 class="dialog__heading">Book slot</h2>
            <p class="dialog__note tabular">
              {selected === null ? '' : formatDateTime(Date.parse(selected))}
            </p>
            <ProblemsSummary
              problems={problems}
              controlIds={{ name: 'book-name', email: 'book-email', startsAt: 'book-name' }}
              labels={{}}
            />
            <Field
              id="book-name"
              label="Your name"
              value={name}
              onInput={(value) => {
                setName(value);
                holdDialog(DIALOG, { name: value, email, slot: selected ?? '' });
              }}
              problem={problems.fields['name']}
            />
            <Field
              id="book-email"
              label="Email"
              type="email"
              value={email}
              onInput={(value) => {
                setEmail(value);
                holdDialog(DIALOG, { name, email: value, slot: selected ?? '' });
              }}
              problem={problems.fields['email']}
            />
            <DialogActions>
              <ActionButton label="Confirm booking" pending={pending} onPress={() => void book()} />
              <button
                type="button"
                class="button button--quiet"
                onClick={() => {
                  dropDialog(DIALOG);
                  dialog.close();
                }}
              >
                Cancel
              </button>
            </DialogActions>
          </Overlay>
        ) : null}
      </main>
    </div>
  );
}
