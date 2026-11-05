import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { BenchesResponse, MeResponse, Reservation } from '../shared/api.js';
import { formatDollars } from '../shared/money.js';
import {
  BILLING_OFFLINE,
  DOCUMENT_STORAGE_OFFLINE,
  REFUNDS_CLOSED,
  UPLOAD_STORAGE_OFFLINE,
  UPLOAD_TOO_LARGE,
  UPLOAD_WRONG_TYPE,
  accountUpdates,
  benchUpdates,
  offerRegion,
} from '../shared/copy.js';
import { ApiFailure, api, idempotencyKey, statusOf } from './api.js';
import { useLab } from './store.js';
import { Dialog, Field, LiveRegion } from './ui.js';

function stateLabel(seat: Reservation, venueDate: string): string {
  if (seat.state === 'deposit_paid' && seat.balance_cents > 0 && venueDate > '2027-03-19') {
    return 'Balance overdue';
  }
  const labels: Record<Reservation['state'], string> = {
    held: 'Held',
    deposit_paid: 'Deposit paid',
    paid_in_full: 'Paid in full',
    checked_in_day1: 'Checked in, day 1',
    checked_in_day2: 'Checked in, day 2',
    certificate_issued: 'Certificate issued',
    released: 'Released',
    cancelled: 'Cancelled',
    refunded: 'Refunded',
  };
  return labels[seat.state];
}

function uploadMessage(error: unknown): string {
  if (!(error instanceof ApiFailure)) return 'Something went wrong.';
  if (error.code === 'unsupported_file_type') return UPLOAD_WRONG_TYPE;
  if (error.code === 'file_too_large' || error.code === 'payload_too_large') return UPLOAD_TOO_LARGE;
  if (error.code === 'storage_unavailable') return UPLOAD_STORAGE_OFFLINE;
  return error.body.message;
}

async function openDocument(path: string, announce: (text: string) => void): Promise<void> {
  try {
    const result = await api<{ url: string }>(path);
    window.open(result.url, '_blank', 'noopener');
  } catch (error) {
    announce(
      error instanceof ApiFailure && error.code === 'storage_unavailable'
        ? DOCUMENT_STORAGE_OFFLINE
        : 'That document is not available.',
    );
  }
}

type DialogKind =
  | { readonly kind: 'upgrade'; readonly seat: Reservation }
  | { readonly kind: 'assign'; readonly seat: Reservation }
  | { readonly kind: 'licence'; readonly seat: Reservation }
  | { readonly kind: 'passport'; readonly seat: Reservation };

export function AccountPage(): ReactNode {
  const lab = useLab();
  const [message, setMessage] = useState('');
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [benches, setBenches] = useState<BenchesResponse | null>(null);
  const announce = useCallback((text: string) => setMessage(text), []);
  const me = lab.me;

  useEffect(() => {
    void api<BenchesResponse>('/api/benches').then(setBenches).catch(() => undefined);
  }, [dialog, message]);

  const reload = useCallback(async () => {
    await lab.refresh();
  }, [lab]);

  if (me === null) {
    return (
      <main className="staff">
        <h1>My seats</h1>
        <p>Sign in on the programme page to see your seats.</p>
        <p>
          <a href="/">Back to the programme</a>
        </p>
      </main>
    );
  }

  const liveOffer = me.offers.find((offer) => offer.state === 'offered' && offer.seconds_remaining > 0);

  return (
    <main className="staff account">
      <h1>My seats</h1>
      <p className="account-who">
        {me.account.name} · {me.account.email} ·{' '}
        <a href="/">Back to the programme</a>
      </p>

      {liveOffer === undefined ? null : (
        <section aria-label="Waitlist offer" className="offer">
          <h2>{offerRegion.heading(liveOffer.bench)}</h2>
          <p className="num">{offerRegion.left(liveOffer.seconds_remaining)}</p>
          <button
            type="button"
            onClick={() => {
              void lab.acceptOffer(liveOffer.id).then(() => {
                announce(benchUpdates.holdPlaced(liveOffer.bench, lab.benches?.seats_remaining ?? 0));
              });
            }}
          >
            Accept bench
          </button>
          <button
            type="button"
            onClick={() => {
              void lab.declineOffer(liveOffer.id).then(() => announce(accountUpdates.offerLapsed));
            }}
          >
            Decline
          </button>
        </section>
      )}

      {me.waitlist === null ? null : (
        <p className="waitlist-note">
          You are number <span className="num">{me.waitlist.position}</span> on the{' '}
          {me.waitlist.tier === 'atelier' ? 'Atelier' : 'Bench'} waitlist.
        </p>
      )}

      {me.reservations.length === 0 ? <p>You have no seats yet.</p> : null}

      {me.reservations.map((seat) => {
        const amAttendee = seat.attendee?.email.toLowerCase() === me.account.email.toLowerCase();
        const accepted = seat.attendee?.accepted === true;
        return (
          <section className="seat" aria-label={`Bench ${seat.bench}`} key={seat.id}>
            <h2 className="num">Bench {seat.bench}</h2>
            <p className="seat-state">{stateLabel(seat, me.venue_date)}</p>
            <p className="seat-money num">
              Paid ${formatDollars(seat.paid_cents)} · Balance ${formatDollars(seat.balance_cents)}
            </p>
            <p className="seat-attendee">
              {seat.attendee === null
                ? 'No attendee yet'
                : `${seat.attendee.name} · ${seat.attendee.accepted ? 'accepted' : 'invited'}`}
            </p>
            <p className="seat-licence">Licence: {seat.licence_status}</p>

            {amAttendee && !accepted ? (
              <button
                type="button"
                onClick={() => {
                  void api(`/api/reservations/${seat.id}/accept`, { method: 'POST' }).then(async () => {
                    await reload();
                    announce(accountUpdates.seatAccepted(seat.bench));
                  });
                }}
              >
                Accept seat
              </button>
            ) : null}

            {seat.state === 'deposit_paid' ? (
              <button
                type="button"
                onClick={() => {
                  void api<{ reservation: Reservation }>(`/api/reservations/${seat.id}/balance`, {
                    body: { billing_name: me.account.name },
                    idempotencyKey: idempotencyKey('balance'),
                  })
                    .then(async (result) => {
                      await reload();
                      announce(
                        statusOf(result) === 202
                          ? benchUpdates.paymentPending(seat.bench)
                          : accountUpdates.balancePaid(seat.bench),
                      );
                    })
                    .catch((error: unknown) => {
                      announce(
                        error instanceof ApiFailure && error.code === 'billing_unavailable'
                          ? BILLING_OFFLINE
                          : error instanceof ApiFailure
                            ? error.body.message
                            : 'Something went wrong.',
                      );
                    });
                }}
              >
                Pay balance ${formatDollars(seat.balance_cents)}
              </button>
            ) : null}

            {seat.tier === 'bench' &&
            (seat.state === 'deposit_paid' || seat.state === 'paid_in_full') ? (
              <button type="button" onClick={() => setDialog({ kind: 'upgrade', seat })}>
                Upgrade to Atelier
              </button>
            ) : null}

            {seat.state === 'deposit_paid' || seat.state === 'paid_in_full' ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    void api<{ reservation: Reservation }>(`/api/reservations/${seat.id}/cancel`, {
                      method: 'POST',
                    })
                      .then(async (result) => {
                        await reload();
                        announce(
                          accountUpdates.cancelled(
                            seat.bench,
                            result.reservation.refund_due_cents ?? 0,
                          ),
                        );
                      })
                      .catch((error: unknown) => {
                        announce(
                          error instanceof ApiFailure && error.code === 'no_refund_window'
                            ? REFUNDS_CLOSED
                            : error instanceof ApiFailure
                              ? error.body.message
                              : 'Something went wrong.',
                        );
                      });
                  }}
                >
                  Cancel seat
                </button>
                <button type="button" onClick={() => setDialog({ kind: 'assign', seat })}>
                  Assign to a colleague
                </button>
              </>
            ) : null}

            {amAttendee && accepted ? (
              <>
                <button type="button" onClick={() => setDialog({ kind: 'licence', seat })}>
                  Upload licence
                </button>
                <button type="button" onClick={() => setDialog({ kind: 'passport', seat })}>
                  Upload passport scan
                </button>
              </>
            ) : null}

            {seat.documents.some((kind) => kind.endsWith('receipt')) ? (
              <button
                type="button"
                onClick={() => {
                  const kind =
                    seat.documents.find((candidate) => candidate.endsWith('receipt')) ?? '';
                  void openDocument(`/api/reservations/${seat.id}/documents/${kind}`, announce);
                }}
              >
                Download receipt
              </button>
            ) : null}

            {seat.documents.includes('visa-letter') && amAttendee ? (
              <button
                type="button"
                onClick={() =>
                  void openDocument(`/api/reservations/${seat.id}/documents/visa-letter`, announce)
                }
              >
                Download visa letter
              </button>
            ) : null}

            {seat.documents.includes('certificate') && amAttendee ? (
              <button
                type="button"
                onClick={() =>
                  void openDocument(`/api/reservations/${seat.id}/documents/certificate`, announce)
                }
              >
                Download certificate
              </button>
            ) : null}
          </section>
        );
      })}

      {me.groups.map((group) => (
        <section className="group" aria-label={`Group ${group.id}`} key={group.id}>
          <h2>Group invoice</h2>
          <p className="num">
            {group.invoice === null
              ? 'Not yet invoiced'
              : `Total $${formatDollars(group.invoice.total_cents)}`}
          </p>
          {group.invoice === null ? null : (
            <button
              type="button"
              onClick={() => void openDocument(`/api/groups/${group.id}/documents/invoice`, announce)}
            >
              Download group invoice
            </button>
          )}
        </section>
      ))}

      <LiveRegion name="Account updates" message={message} />

      {dialog === null ? null : (
        <AccountDialog
          dialog={dialog}
          benches={benches}
          me={me}
          onClose={() => setDialog(null)}
          onDone={async (text) => {
            setDialog(null);
            await reload();
            announce(text);
          }}
        />
      )}
    </main>
  );
}

function AccountDialog({
  dialog,
  benches,
  me,
  onClose,
  onDone,
}: {
  readonly dialog: DialogKind;
  readonly benches: BenchesResponse | null;
  readonly me: MeResponse;
  readonly onClose: () => void;
  readonly onDone: (text: string) => Promise<void>;
}): ReactNode {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [licenceNumber, setLicenceNumber] = useState('');
  const [licenceState, setLicenceState] = useState('');
  const [fullName, setFullName] = useState('');
  const [nationality, setNationality] = useState('');
  const [passportNumber, setPassportNumber] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [bench, setBench] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const seat = dialog.seat;

  const openAtelier = (benches?.benches ?? []).filter(
    (candidate) => candidate.tier === 'atelier' && candidate.state === 'open',
  );

  if (dialog.kind === 'upgrade') {
    return (
      <Dialog name="Upgrade to Atelier" onClose={onClose}>
        <h2>Upgrade to Atelier</h2>
        {failure === null ? null : <p className="form-error">{failure}</p>}
        <div role="radiogroup" aria-label="Atelier bench">
          {openAtelier.map((candidate) => (
            <button
              key={candidate.label}
              type="button"
              role="radio"
              aria-checked={bench === candidate.label}
              aria-label={`Bench ${candidate.label}`}
              className={`num${bench === candidate.label ? ' tier-on' : ''}`}
              onClick={() => setBench(candidate.label)}
            >
              {candidate.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            setFailure(null);
            void api(`/api/reservations/${seat.id}/upgrade`, {
              body: { bench, billing_name: me.account.name },
              idempotencyKey: idempotencyKey('upgrade'),
            })
              .then(() => onDone(accountUpdates.upgraded(bench)))
              .catch((error: unknown) => {
                setFailure(
                  error instanceof ApiFailure && error.code === 'billing_unavailable'
                    ? BILLING_OFFLINE
                    : error instanceof ApiFailure
                      ? error.body.message
                      : 'Something went wrong.',
                );
              });
          }}
        >
          Pay the difference
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </Dialog>
    );
  }

  if (dialog.kind === 'assign') {
    return (
      <Dialog name="Assign to a colleague" onClose={onClose}>
        <h2>Assign to a colleague</h2>
        {failure === null ? null : <p className="form-error">{failure}</p>}
        <Field label="Colleague name" value={name} onChange={setName} />
        <Field label="Colleague email" value={email} onChange={setEmail} />
        <button
          type="button"
          onClick={() => {
            setFailure(null);
            void api(`/api/reservations/${seat.id}/assignee`, {
              method: 'PUT',
              body: { name, email },
            })
              .then(() => onDone(accountUpdates.assigned(seat.bench, name)))
              .catch((error: unknown) => {
                setFailure(error instanceof ApiFailure ? error.body.message : 'Something went wrong.');
              });
          }}
        >
          Assign seat
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </Dialog>
    );
  }

  if (dialog.kind === 'licence') {
    return (
      <Dialog name="Upload licence" onClose={onClose}>
        <h2>Upload licence</h2>
        {failure === null ? null : <p className="form-error">{failure}</p>}
        <Field label="Licence number" value={licenceNumber} onChange={setLicenceNumber} />
        <Field label="Issuing state" value={licenceState} onChange={setLicenceState} />
        <p className="field">
          <label htmlFor="licence-file">Licence file</label>
          <input
            id="licence-file"
            type="file"
            aria-label="Licence file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </p>
        <button
          type="button"
          onClick={() => {
            setFailure(null);
            const form = new FormData();
            form.set('licence_number', licenceNumber);
            form.set('licence_state', licenceState);
            if (file !== null) form.set('file', file);
            void api(`/api/reservations/${seat.id}/licence`, { form })
              .then(() => onDone(accountUpdates.licenceUploaded))
              .catch((error: unknown) => setFailure(uploadMessage(error)));
          }}
        >
          Send licence
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </Dialog>
    );
  }

  return (
    <Dialog name="Upload passport scan" onClose={onClose}>
      <h2>Upload passport scan</h2>
      {failure === null ? null : <p className="form-error">{failure}</p>}
      <Field label="Full name as in passport" value={fullName} onChange={setFullName} />
      <Field label="Nationality" value={nationality} onChange={setNationality} />
      <Field label="Passport number" value={passportNumber} onChange={setPassportNumber} />
      <p className="field">
        <label htmlFor="passport-file">Passport file</label>
        <input
          id="passport-file"
          type="file"
          aria-label="Passport file"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </p>
      <button
        type="button"
        onClick={() => {
          setFailure(null);
          const form = new FormData();
          form.set('full_name', fullName);
          form.set('nationality', nationality);
          form.set('passport_number', passportNumber);
          if (file !== null) form.set('file', file);
          void api(`/api/reservations/${seat.id}/passport`, { form })
            .then(() => onDone(accountUpdates.passportUploaded))
            .catch((error: unknown) => setFailure(uploadMessage(error)));
        }}
      >
        Send passport scan
      </button>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </Dialog>
  );
}
