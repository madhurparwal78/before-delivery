import { useRef, useState, type ReactNode } from 'react';
import type { Booking } from '../../shared/api.js';
import { jsonRequest, newIdempotencyKey, noteActionFinished, sendAction } from '../api.js';
import { errorCopy, NETWORK_FAILURE, notesHint, PENDING, SUCCESS, titleHint } from '../copy.js';
import { countCodePoints } from '../format.js';
import { useLive } from '../live.js';
import { Dialog } from '../components/Dialog.js';
import { Field } from '../components/Field.js';

interface Draft {
  org_id: string;
  setting: string;
  title: string;
  location: string;
  onsite_contact_name: string;
  onsite_contact_phone: string;
  consumer_name: string;
  start_date: string;
  start_time: string;
  duration_minutes: string;
  requester_notes: string;
}

const FIELD_ORDER = [
  'org_id',
  'setting',
  'title',
  'location',
  'onsite_contact_name',
  'onsite_contact_phone',
  'consumer_name',
  'start',
  'duration_minutes',
  'requester_notes',
] as const;

export interface NewRequestDialogProps {
  organisations: { id: string; name: string }[] | null;
  agencyToday: string;
  timeZone: string;
  onClose: () => void;
  onCreated: (booking: Booking) => void;
}

export function NewRequestDialog({
  organisations,
  agencyToday,
  timeZone,
  onClose,
  onCreated,
}: NewRequestDialogProps): ReactNode {
  const live = useLive();
  const [draft, setDraft] = useState<Draft>({
    org_id: organisations?.[0]?.id ?? '',
    setting: 'medical',
    title: '',
    location: '',
    onsite_contact_name: '',
    onsite_contact_phone: '',
    consumer_name: '',
    start_date: agencyToday,
    start_time: '09:00',
    duration_minutes: '60',
    requester_notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const idempotencyKey = useRef(newIdempotencyKey());
  const lastAttempt = useRef<string | null>(null);
  const submitButton = useRef<HTMLButtonElement | null>(null);
  const firstField = useRef<HTMLElement | null>(null);
  const fieldNodes = useRef(new Map<string, HTMLElement>());

  const set = <K extends keyof Draft>(name: K, value: Draft[K]): void => {
    setDraft((current) => ({ ...current, [name]: value }));
  };

  const register =
    (name: string, first = false) =>
    (node: HTMLElement | null): void => {
      if (node === null) {
        fieldNodes.current.delete(name);
        return;
      }
      fieldNodes.current.set(name, node);
      if (first) firstField.current = node;
    };

  const submit = async (): Promise<void> => {
    const body: Record<string, unknown> = {
      ...(organisations === null ? {} : { org_id: draft.org_id }),
      setting: draft.setting,
      title: draft.title,
      location: draft.location,
      onsite_contact_name: draft.onsite_contact_name,
      onsite_contact_phone: draft.onsite_contact_phone,
      consumer_name: draft.consumer_name,
      start: `${draft.start_date}T${draft.start_time}`,
      duration_minutes: Number(draft.duration_minutes),
      requester_notes: draft.requester_notes,
    };
    const serialized = JSON.stringify(body);
    if (lastAttempt.current !== null && lastAttempt.current !== serialized) {
      idempotencyKey.current = newIdempotencyKey();
    }
    lastAttempt.current = serialized;

    live.startAction();
    live.announceStatus(PENDING.submitRequest);
    setPending(true);
    const outcome = await sendAction<Booking>(
      jsonRequest('POST', '/api/bookings', body, idempotencyKey.current),
    );
    noteActionFinished();
    setPending(false);

    if (outcome.kind === 'ok') {
      setErrors({});
      live.announceStatus(SUCCESS.submitRequest(outcome.data.ref));
      onCreated(outcome.data);
      return;
    }
    if (outcome.kind === 'network') {
      live.announceError(NETWORK_FAILURE);
      submitButton.current?.focus();
      return;
    }
    if (outcome.kind !== 'error') return;
    const fields = outcome.body.fields ?? {};
    setErrors(fields);
    live.announceError(
      errorCopy({
        action: 'submitRequest',
        code: outcome.body.error,
        status: outcome.body.status,
        fields,
      }),
    );
    const firstBroken = FIELD_ORDER.find((name) => fields[name] !== undefined);
    if (firstBroken === undefined) submitButton.current?.focus();
    else fieldNodes.current.get(firstBroken)?.focus();
  };

  return (
    <Dialog title="New request" onEscape={onClose} focusOnOpen={() => firstField.current}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {organisations === null ? null : (
          <Field id="nr-org" label="Organisation" error={errors['org_id']}>
            <select
              id="nr-org"
              value={draft.org_id}
              ref={register('org_id', true)}
              onChange={(event) => set('org_id', event.target.value)}
            >
              {organisations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field id="nr-setting" label="Setting" error={errors['setting']}>
          <select
            id="nr-setting"
            value={draft.setting}
            ref={register('setting', organisations === null)}
            onChange={(event) => set('setting', event.target.value)}
          >
            <option value="medical">medical</option>
            <option value="educational">educational</option>
            <option value="legal">legal</option>
            <option value="workplace">workplace</option>
          </select>
        </Field>

        <Field
          id="nr-title"
          label="Title"
          hint={titleHint(countCodePoints(draft.title))}
          hintId="nr-title-hint"
          error={errors['title']}
        >
          <input
            id="nr-title"
            type="text"
            value={draft.title}
            aria-describedby="nr-title-hint"
            ref={register('title')}
            onChange={(event) => set('title', event.target.value)}
          />
        </Field>

        <Field id="nr-location" label="Location" error={errors['location']}>
          <input
            id="nr-location"
            type="text"
            value={draft.location}
            ref={register('location')}
            onChange={(event) => set('location', event.target.value)}
          />
        </Field>

        <Field
          id="nr-contact-name"
          label="On-site contact name"
          error={errors['onsite_contact_name']}
        >
          <input
            id="nr-contact-name"
            type="text"
            value={draft.onsite_contact_name}
            ref={register('onsite_contact_name')}
            onChange={(event) => set('onsite_contact_name', event.target.value)}
          />
        </Field>

        <Field
          id="nr-contact-phone"
          label="On-site contact phone"
          error={errors['onsite_contact_phone']}
        >
          <input
            id="nr-contact-phone"
            type="text"
            value={draft.onsite_contact_phone}
            ref={register('onsite_contact_phone')}
            onChange={(event) => set('onsite_contact_phone', event.target.value)}
          />
        </Field>

        <Field id="nr-consumer" label="Deaf consumer name" error={errors['consumer_name']}>
          <input
            id="nr-consumer"
            type="text"
            value={draft.consumer_name}
            ref={register('consumer_name')}
            onChange={(event) => set('consumer_name', event.target.value)}
          />
        </Field>

        <Field id="nr-start-date" label="Start date" error={errors['start']}>
          <input
            id="nr-start-date"
            type="date"
            value={draft.start_date}
            aria-describedby="nr-zone-hint"
            ref={register('start')}
            onChange={(event) => set('start_date', event.target.value)}
          />
        </Field>

        <Field
          id="nr-start-time"
          label="Start time"
          hint={`Times in ${timeZone}`}
          hintId="nr-zone-hint"
        >
          <input
            id="nr-start-time"
            type="time"
            value={draft.start_time}
            aria-describedby="nr-zone-hint"
            onChange={(event) => set('start_time', event.target.value)}
          />
        </Field>

        <Field
          id="nr-duration"
          label="Length (minutes)"
          error={errors['duration_minutes']}
        >
          <input
            id="nr-duration"
            type="number"
            value={draft.duration_minutes}
            ref={register('duration_minutes')}
            onChange={(event) => set('duration_minutes', event.target.value)}
          />
        </Field>

        <Field
          id="nr-notes"
          label="Notes for the agency"
          hint={notesHint(countCodePoints(draft.requester_notes))}
          hintId="nr-notes-hint"
          error={errors['requester_notes']}
        >
          <input
            id="nr-notes"
            type="text"
            value={draft.requester_notes}
            aria-describedby="nr-notes-hint"
            ref={register('requester_notes')}
            onChange={(event) => set('requester_notes', event.target.value)}
          />
        </Field>

        <div className="dialog-buttons">
          <button type="submit" ref={submitButton} disabled={pending}>
            {pending ? PENDING.submitRequest : 'Submit request'}
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </form>
    </Dialog>
  );
}
