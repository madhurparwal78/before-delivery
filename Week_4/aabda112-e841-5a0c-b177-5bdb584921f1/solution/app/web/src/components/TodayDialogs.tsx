import { useState } from 'react';
import { APPOINTMENT_REASONS, APPOINTMENT_STATUS_LABEL, can, type AppointmentReason } from '../../../shared/domain';
import { ApiError, mutate, post } from '../lib/api';
import { announce } from '../lib/announce';
import { useMe } from '../lib/env';
import { hm, instantDay } from '../lib/format';
import { Link } from '../lib/router';
import type { Appointment, ClientEntry, Room } from '../lib/types';
import { Modal } from './Modal';
import { describedBy, ErrorSummary, Field, Pill, type SummaryItem } from './ui';

export interface BookRequest {
  room: Room;
  start: string;
  vetId: string;
}

interface BookProps {
  request: BookRequest;
  vets: { id: string; name: string }[];
  clients: ClientEntry[];
  returnFocus: () => HTMLElement | null;
  onClose: () => void;
  onBooked: (appointment: Appointment) => void;
}

/** `Book appointment`: checked in the browser for Client and Patient first, then sent; a rejection shows in the same summary. */
export function BookDialog({ request, vets, clients, returnFocus, onClose, onBooked }: BookProps) {
  const [clientId, setClientId] = useState('');
  const [patientId, setPatientId] = useState('');
  const [vetId, setVetId] = useState(request.vetId);
  const [reason, setReason] = useState<AppointmentReason>('Consult');
  const [items, setItems] = useState<SummaryItem[]>([]);
  const [token, setToken] = useState(0);
  const [busy, setBusy] = useState(false);
  const patients = clients.find((c) => c.id === clientId)?.patients ?? [];
  const messageFor = (field: string) => items.find((i) => i.field === field)?.message;
  const fieldId = (field: string) => `book-${field}`;

  const submit = async () => {
    if (busy) return;
    const missing: SummaryItem[] = [];
    if (!clientId) missing.push({ field: 'client', message: 'Client is required.' });
    if (!patientId) missing.push({ field: 'patient', message: 'Patient is required.' });
    if (missing.length > 0) {
      setItems(missing);
      setToken((t) => t + 1);
      return;
    }
    setBusy(true);
    try {
      await mutate(
        () => post<Appointment>('/api/appointments', { patientId, vetId, roomId: request.room.id, start: request.start, reason }),
        (made) => {
          announce(`Booked ${made.patientName} with ${made.vetName} at ${hm(made.start)}.`);
          onBooked(made);
        },
      );
    } catch (error) {
      const field = error instanceof ApiError && error.field ? { vetId: 'vet', patientId: 'patient', reason: 'reason' }[error.field] : undefined;
      setItems([{ field, message: error instanceof ApiError ? error.message : 'Something went wrong. Try again.' }]);
      setToken((t) => t + 1);
      setBusy(false);
    }
  };

  return (
    <Modal label="Book appointment" onClose={onClose} returnFocus={returnFocus}>
      <h2 className="modal-title">Book appointment</h2>
      <p className="muted">
        {request.room.name}, {hm(request.start)}, {instantDay(request.start)}
      </p>
      <ErrorSummary items={items} token={token} fieldId={fieldId} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        noValidate
      >
        <Field id={fieldId('client')} label="Client" error={messageFor('client')}>
          <select
            id={fieldId('client')}
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setPatientId('');
            }}
            {...describedBy(fieldId('client'), messageFor('client'))}
          >
            <option value="">Choose a client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id={fieldId('patient')} label="Patient" error={messageFor('patient')}>
          <select id={fieldId('patient')} value={patientId} onChange={(e) => setPatientId(e.target.value)} {...describedBy(fieldId('patient'), messageFor('patient'))}>
            <option value="">Choose a patient</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id={fieldId('vet')} label="Vet" error={messageFor('vet')}>
          <select id={fieldId('vet')} value={vetId} onChange={(e) => setVetId(e.target.value)}>
            {vets.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id={fieldId('reason')} label="Reason">
          <select id={fieldId('reason')} value={reason} onChange={(e) => setReason(e.target.value as AppointmentReason)}>
            {APPOINTMENT_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <div className="modal-actions">
          <Pill busy={busy} onClick={() => void submit()}>
            Book
          </Pill>
          <Pill variant="outline" className="on-light" onClick={onClose}>
            Cancel
          </Pill>
        </div>
      </form>
    </Modal>
  );
}

interface DetailsProps {
  appointment: Appointment;
  returnFocus: () => HTMLElement | null;
  onClose: () => void;
  onCancelled: (appointment: Appointment) => Promise<void>;
  onChanged: () => void;
}

const ACTIONS = [
  { label: 'Check in', path: 'check-in', from: 'booked', permission: 'appointments.write', done: (a: Appointment) => `${a.patientName} checked in.` },
  { label: 'Start consult', path: 'start', from: 'checked-in', permission: 'consult.run', done: (a: Appointment) => `${a.patientName} is now in consult.` },
  { label: 'Complete consult', path: 'complete', from: 'in-consult', permission: 'consult.run', done: (a: Appointment) => `Consult completed for ${a.patientName}.` },
  { label: 'Mark no-show', path: 'no-show', from: 'booked', permission: 'appointments.write', done: (a: Appointment) => `${a.patientName} marked no-show.` },
] as const;

/** `Appointment details`: only the edges legal from the current status and allowed for the role. */
export function DetailsDialog({ appointment: a, returnFocus, onClose, onCancelled, onChanged }: DetailsProps) {
  const me = useMe();
  const [items, setItems] = useState<SummaryItem[]>([]);
  const [token, setToken] = useState(0);
  const [busy, setBusy] = useState<string>();

  const fail = (error: unknown) => {
    setItems([{ message: error instanceof ApiError ? error.message : 'Something went wrong. Try again.' }]);
    setToken((t) => t + 1);
    setBusy(undefined);
  };

  const act = async (action: (typeof ACTIONS)[number]) => {
    if (busy) return;
    setBusy(action.label);
    try {
      await mutate(
        () => post<Appointment>(`/api/appointments/${a.id}/${action.path}`),
        (updated) => {
          announce(action.done(updated));
          onChanged();
          onClose();
        },
      );
    } catch (error) {
      fail(error);
    }
  };

  const cancel = async () => {
    if (busy) return;
    setBusy('Cancel appointment');
    try {
      await onCancelled(a);
      onClose();
    } catch (error) {
      fail(error);
    }
  };

  const canCancel = can(me.role, 'appointments.write') && (a.status === 'booked' || a.status === 'checked-in');
  return (
    <Modal label="Appointment details" onClose={onClose} returnFocus={returnFocus}>
      <h2 className="modal-title">Appointment details</h2>
      <dl className="details">
        <dt>Patient</dt>
        <dd>{a.patientName}</dd>
        <dt>Vet</dt>
        <dd>{a.vetName}</dd>
        <dt>Room</dt>
        <dd>{a.roomName}</dd>
        <dt>Time</dt>
        <dd>
          {instantDay(a.start)}, {hm(a.start)} to {hm(a.end)}
        </dd>
        <dt>Reason</dt>
        <dd>{a.reason}</dd>
        <dt>Status</dt>
        <dd>{APPOINTMENT_STATUS_LABEL[a.status]}</dd>
      </dl>
      <ErrorSummary items={items} token={token} fieldId={(f) => f} />
      <div className="modal-links">
        <Link to={`/consult/${a.id}`} onClick={onClose}>
          Open consult
        </Link>
        <Link to={`/patients/${a.patientId}`} onClick={onClose}>
          Open patient
        </Link>
      </div>
      <div className="modal-actions">
        {ACTIONS.filter((x) => x.from === a.status && can(me.role, x.permission)).map((x) => (
          <Pill key={x.label} busy={busy === x.label} onClick={() => void act(x)}>
            {x.label}
          </Pill>
        ))}
        {canCancel && (
          <Pill variant="blue" busy={busy === 'Cancel appointment'} onClick={() => void cancel()}>
            Cancel appointment
          </Pill>
        )}
        <Pill variant="outline" className="on-light" onClick={onClose}>
          Close
        </Pill>
      </div>
    </Modal>
  );
}
