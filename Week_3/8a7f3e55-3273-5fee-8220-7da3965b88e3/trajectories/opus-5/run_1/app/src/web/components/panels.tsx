import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AuditEntry, Booking, Material } from '../../shared/api.js';
import {
  downloadThroughLink,
  jsonRequest,
  noteActionFinished,
  sendAction,
} from '../api.js';
import { errorCopy, NETWORK_FAILURE, PENDING, STATUS_LABELS, SUCCESS } from '../copy.js';
import { agencyDateOf, agencyTimeOf, groupedCount, money } from '../format.js';
import { usePolledResource } from '../hooks.js';
import { useLive } from '../live.js';
import { Field } from './Field.js';

export function FactsList({ booking, showNotes }: { booking: Booking; showNotes: boolean }): ReactNode {
  return (
    <dl className="facts">
      <dt>Organisation</dt>
      <dd>{booking.org_name}</dd>
      <dt>Setting</dt>
      <dd>{booking.setting}</dd>
      <dt>Location</dt>
      <dd>{booking.location}</dd>
      <dt>On-site contact</dt>
      <dd>
        {booking.onsite_contact_name} · {booking.onsite_contact_phone}
      </dd>
      <dt>Deaf consumer</dt>
      <dd>{booking.consumer_name}</dd>
      <dt>Start to end</dt>
      <dd className="mono">
        {agencyDateOf(booking.start)} {agencyTimeOf(booking.start)}–{agencyTimeOf(booking.end)}
      </dd>
      <dt>Status</dt>
      <dd>{STATUS_LABELS[booking.status]}</dd>
      {showNotes && booking.requester_notes !== undefined ? (
        <>
          <dt>Notes for the agency</dt>
          <dd>{booking.requester_notes}</dd>
        </>
      ) : null}
    </dl>
  );
}

export function InterpretersPanel({ booking }: { booking: Booking }): ReactNode {
  const held = booking.seats.filter((seat) => seat.holder !== null);
  return (
    <section className="panel" aria-label="Interpreters">
      <h3 className="label">Interpreters</h3>
      {held.length === 0 ? (
        <p className="empty-row">No interpreter holds a seat yet.</p>
      ) : (
        held.map((seat) => {
          const holder = seat.holder;
          if (holder === null) return null;
          const codes = holder.credentials.map((credential) =>
            typeof credential === 'string' ? credential : credential.code,
          );
          return (
            <article className="interpreter-card" key={seat.seat} aria-label={holder.name}>
              <span className="initials" aria-hidden="true">
                {holder.initials}
              </span>
              <span>
                <span>{holder.name}</span>
                <br />
                <span className="mono">{codes.join(' · ')}</span>
              </span>
            </article>
          );
        })
      )}
    </section>
  );
}

export function PrepPanel({
  booking,
  canUpload,
  canDownload,
  onChanged,
}: {
  booking: Booking;
  canUpload: boolean;
  canDownload: boolean;
  onChanged: () => void;
}): ReactNode {
  const live = useLive();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (): Promise<void> => {
    const file = fileInput.current?.files?.[0] ?? null;
    const shown = file?.name ?? 'file';
    live.startAction();
    live.announceStatus(PENDING.upload(shown));
    setFieldError(null);
    setUploading(true);
    const form = new FormData();
    if (file !== null) form.append('file', file);
    const outcome = await sendAction<Material>({
      method: 'POST',
      path: `/api/bookings/${booking.id}/materials`,
      form,
    });
    noteActionFinished();
    setUploading(false);
    if (outcome.kind === 'ok') {
      live.announceStatus(SUCCESS.upload(outcome.data.name));
      if (fileInput.current !== null) fileInput.current.value = '';
      onChanged();
      return;
    }
    if (outcome.kind === 'network') {
      live.announceError(NETWORK_FAILURE);
      return;
    }
    if (outcome.kind !== 'error') return;
    const message = errorCopy({
      action: 'upload',
      code: outcome.body.error,
      status: outcome.body.status,
      fields: outcome.body.fields,
    });
    if (outcome.body.fields?.['file'] !== undefined) {
      setFieldError(outcome.body.fields['file']);
    }
    live.announceError(message);
    onChanged();
  };

  const download = async (material: Material): Promise<void> => {
    live.startAction();
    live.announceStatus(PENDING.download);
    const linked = await sendAction<{ url: string }>(
      jsonRequest('POST', `/api/bookings/${booking.id}/materials/${material.id}/link`),
    );
    noteActionFinished();
    if (linked.kind === 'error') {
      live.announceError(
        errorCopy({ action: 'download', code: linked.body.error, status: linked.body.status }),
      );
      return;
    }
    if (linked.kind !== 'ok') return;
    const fetched = await downloadThroughLink(linked.data.url, material.name);
    if (fetched.kind === 'error') {
      live.announceError(
        errorCopy({ action: 'download', code: fetched.body.error, status: fetched.body.status }),
      );
    }
  };

  return (
    <section className="panel" aria-label="Prep materials">
      <h3 className="label">Prep materials</h3>
      <ul className="plain-list" role="list">
        {booking.materials.length === 0 ? (
          <li className="empty-row">No prep materials yet.</li>
        ) : (
          booking.materials.map((material) => (
            <li key={material.id}>
              <span>{material.name}</span>{' '}
              <span className="mono">{groupedCount(material.size_bytes)} bytes</span>{' '}
              <span className="mono">
                {agencyDateOf(material.uploaded_at)} {agencyTimeOf(material.uploaded_at)}
              </span>{' '}
              {canDownload ? (
                <button type="button" className="plain" onClick={() => void download(material)}>
                  {`Download ${material.name}`}
                </button>
              ) : null}
            </li>
          ))
        )}
      </ul>
      {canUpload ? (
        <div className="panel-actions">
          <Field id="prep-file" label="Attach prep material" error={fieldError ?? undefined}>
            <input id="prep-file" type="file" ref={fileInput} />
          </Field>
          <button type="button" disabled={uploading} onClick={() => void upload()}>
            Upload
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function BillingPanel({ booking }: { booking: Booking }): ReactNode {
  const charge = booking.charge ?? null;
  return (
    <section className="panel" aria-label="Billing">
      <h3 className="label">Billing</h3>
      {charge === null ? (
        <p className="empty-row">No invoice line yet.</p>
      ) : (
        <p>
          <span className="mono">{charge.line_ref}</span>{' '}
          <span className="mono">{money(charge.amount_cents)}</span>{' '}
          <span>{charge.sync_status === 'synced' ? 'Synced' : 'Pending sync'}</span>
        </p>
      )}
    </section>
  );
}

/** Changes whenever a state-changing action has altered the booking. */
export function auditToken(booking: Booking): string {
  return [
    booking.status,
    booking.seat_count,
    booking.open_call_status,
    booking.charge?.line_ref ?? '',
    ...booking.seats.map((seat) => seat.holder?.name ?? ''),
  ].join('|');
}

export function AuditPanel({
  bookingId,
  afterAction,
}: {
  bookingId: string;
  afterAction: string;
}): ReactNode {
  const audit = usePolledResource<{ entries: AuditEntry[] }>(`/api/bookings/${bookingId}/audit`);
  const reload = useRef(audit.reload);
  reload.current = audit.reload;
  useEffect(() => {
    void reload.current();
  }, [afterAction]);
  const entries = audit.data?.entries ?? [];
  return (
    <section className="panel" aria-label="Audit trail">
      <h3 className="label">Audit trail</h3>
      <ul className="plain-list" role="list">
        {entries.length === 0 ? (
          <li className="empty-row">Nothing recorded yet.</li>
        ) : (
          entries.map((entry, index) => (
            <li key={`${entry.at}-${index}`}>
              <span className="mono">
                {agencyDateOf(entry.at)} {agencyTimeOf(entry.at)}
              </span>
              {` · ${entry.actor_name} · ${entry.action}`}
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
