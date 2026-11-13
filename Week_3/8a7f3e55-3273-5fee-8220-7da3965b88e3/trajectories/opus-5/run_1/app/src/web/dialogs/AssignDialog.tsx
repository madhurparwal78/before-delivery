import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Booking, InterpreterChoice } from '../../shared/api.js';
import {
  jsonRequest,
  noteActionFinished,
  sendAction,
  sendRefetch,
} from '../api.js';
import {
  errorCopy,
  NETWORK_FAILURE,
  noMatchLine,
  PENDING,
  seatFilledNotice,
  SUCCESS,
} from '../copy.js';
import { useLive } from '../live.js';
import { Dialog } from '../components/Dialog.js';
import { Field } from '../components/Field.js';

const SEARCH_DELAY_MS = 250;

export interface AssignDialogProps {
  booking: Booking;
  seat: number;
  onClose: () => void;
  onAssigned: (booking: Booking, holderName: string, seat: number) => void;
}

export function AssignDialog({
  booking,
  seat,
  onClose,
  onAssigned,
}: AssignDialogProps): ReactNode {
  const live = useLive();
  const [search, setSearch] = useState('');
  const [choices, setChoices] = useState<InterpreterChoice[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const latestSearch = useRef(0);
  const radios = useRef(new Map<string, HTMLInputElement>());
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const shownQuery = useRef('');

  const holdsOtherSeat = (id: string): boolean =>
    booking.seats.some((entry) => entry.seat !== seat && entry.holder !== null && 'id' in entry.holder && entry.holder.id === id);

  const loadChoices = async (text: string): Promise<void> => {
    const generation = latestSearch.current + 1;
    latestSearch.current = generation;
    const path = `/api/interpreters?booking_id=${encodeURIComponent(booking.id)}&q=${encodeURIComponent(text)}`;
    const outcome = await sendRefetch<{ interpreters: InterpreterChoice[] }>(path);
    if (generation !== latestSearch.current) return;
    shownQuery.current = text.trim();
    if (outcome.kind === 'error') {
      setQueryError(outcome.body.fields?.['q'] ?? null);
      setChoices([]);
      setChosen(null);
      return;
    }
    if (outcome.kind !== 'ok') return;
    setQueryError(null);
    const qualified = outcome.data.interpreters.filter((choice) => choice.qualified === true);
    setChoices(qualified);
    setChosen((current) =>
      current !== null && qualified.some((choice) => choice.id === current) ? current : null,
    );
  };

  const load = useRef(loadChoices);
  load.current = loadChoices;
  const opened = useRef(false);

  useEffect(() => {
    if (!opened.current) {
      opened.current = true;
      void load.current('');
      return;
    }
    const timer = window.setTimeout(() => void load.current(search), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  const seatHolder = booking.seats.find((entry) => entry.seat === seat)?.holder ?? null;
  useEffect(() => {
    if (seatHolder !== null) setNotice(seatFilledNotice(seat));
  }, [seatHolder, seat]);

  const firstEnabled = (): HTMLInputElement | null => {
    for (const choice of choices) {
      if (choice.busy === true) continue;
      if (holdsOtherSeat(choice.id)) continue;
      const node = radios.current.get(choice.id);
      if (node !== undefined) return node;
    }
    return null;
  };

  const assign = async (): Promise<void> => {
    if (chosen === null) return;
    const name = choices.find((choice) => choice.id === chosen)?.name ?? '';
    live.startAction();
    live.announceStatus(PENDING.assign);
    setPending(true);
    const outcome = await sendAction<Booking>(
      jsonRequest('POST', `/api/bookings/${booking.id}/assign`, {
        interpreter_id: chosen,
        seat,
      }),
    );
    noteActionFinished();
    setPending(false);

    if (outcome.kind === 'ok') {
      live.announceStatus(SUCCESS.assign(name, seat, outcome.data.ref));
      onAssigned(outcome.data, name, seat);
      return;
    }
    if (outcome.kind === 'network') {
      live.announceError(NETWORK_FAILURE);
      return;
    }
    if (outcome.kind !== 'error') return;
    live.announceError(
      errorCopy({
        action: 'assign',
        code: outcome.body.error,
        status: outcome.body.status,
        fields: outcome.body.fields,
      }),
    );
    if (outcome.body.error === 'schedule_conflict' || outcome.body.error === 'not_qualified') {
      await loadChoices(search);
      setChosen(null);
      window.setTimeout(() => firstEnabled()?.focus(), 0);
    }
  };

  const moveChoice = (direction: 1 | -1): void => {
    const enabled = choices.filter(
      (choice) => choice.busy !== true && !holdsOtherSeat(choice.id),
    );
    if (enabled.length === 0) return;
    const at = enabled.findIndex((choice) => choice.id === chosen);
    const next = enabled[(at + direction + enabled.length) % enabled.length];
    if (next === undefined) return;
    setChosen(next.id);
    radios.current.get(next.id)?.focus();
  };

  return (
    <Dialog
      title="Assign interpreter"
      onEscape={onClose}
      focusOnOpen={() => firstEnabled() ?? closeButton.current}
    >
      <p>{`Seat ${seat} on ${booking.ref}`}</p>
      <Field id="assign-search" label="Find interpreter" error={queryError ?? undefined}>
        <input
          id="assign-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Field>

      <span className="quote-status" role="status" aria-label="Assign status">
        {notice}
      </span>

      {queryError !== null ? null : choices.length === 0 ? (
        <p>{noMatchLine(shownQuery.current)}</p>
      ) : (
        <ul className="radio-list" role="list">
          {choices.map((choice) => {
            const busy = choice.busy === true;
            const sameBooking = holdsOtherSeat(choice.id);
            const disabled = busy || sameBooking;
            return (
              <li
                key={choice.id}
                className={disabled ? 'radio-row busy' : 'radio-row'}
              >
                <input
                  type="radio"
                  name="assign-choice"
                  value={choice.id}
                  aria-label={choice.name}
                  disabled={disabled}
                  checked={chosen === choice.id}
                  ref={(node) => {
                    if (node === null) radios.current.delete(choice.id);
                    else radios.current.set(choice.id, node);
                  }}
                  onChange={() => setChosen(choice.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                      event.preventDefault();
                      moveChoice(1);
                    }
                    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                      event.preventDefault();
                      moveChoice(-1);
                    }
                  }}
                />
                <span>
                  <span>{choice.name}</span>{' '}
                  <span className="mono">
                    {choice.credentials.map((credential) => credential.code).join(' · ')}
                  </span>
                  {disabled ? <span> Busy at this time</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="dialog-buttons">
        <button type="button" disabled={pending || chosen === null} onClick={() => void assign()}>
          {pending ? PENDING.assign : 'Assign'}
        </button>
        <button type="button" ref={closeButton} onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
