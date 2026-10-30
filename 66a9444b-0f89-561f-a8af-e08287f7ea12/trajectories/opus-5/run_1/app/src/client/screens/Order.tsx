import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog.js';
import { ApiError, request } from '../lib/api.js';
import { formatDeadline, formatEuros } from '../lib/festival.js';
import { useRoute, useUser } from '../lib/store.js';
import type { Line, Order } from '../lib/types.js';
import type { JSX } from 'react';

const REFRESH_MS = 10_000;

function orderStatusCopy(order: Order): string {
  if (order.status === 'proof_pending') {
    return 'Reduced rate awaiting proof — payment authorised, not taken.';
  }
  if (order.refunds.some((refund) => refund.status === 'pending')) {
    return "Refund pending — we'll complete it as soon as our payment service is back.";
  }
  if (order.rate === 'reduced' && order.lines.every((line) => line.state === 'expired')) {
    return 'Proof deadline passed — your payment authorisation was released.';
  }
  if (order.rate === 'reduced' && order.lines.every((line) => line.state === 'voided')) {
    return 'Reduced rate not approved — your payment authorisation was released.';
  }
  return order.confirmation_mail === 'sent'
    ? 'Confirmation email: sent'
    : "Confirmation email: pending — we'll send it as soon as our mail service is back.";
}

export function OrderScreen(props: { orderId: string }): JSX.Element {
  const route = useRoute();
  const { user, loading } = useUser();
  const [order, setOrder] = useState<Order | null>(null);
  const [missing, setMissing] = useState(false);
  const [status, setStatus] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [transferLine, setTransferLine] = useState<Line | null>(null);
  const [proofKind, setProofKind] = useState<'student' | 'jobseeker'>('student');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const transferOpener = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    try {
      const body = await request<Order>(`/api/orders/${props.orderId}`);
      setOrder(body);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.failure.status === 404) setMissing(true);
    }
  }, [props.orderId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  if (loading) return <section className="narrow ground-paper">Loading…</section>;
  if (user === null) {
    return (
      <section className="narrow ground-paper">
        <h1 className="display">Order</h1>
        <p>
          <a
            href={`/signin?next=${encodeURIComponent(`/orders/${props.orderId}`)}`}
            onClick={(event) => {
              event.preventDefault();
              route.navigate(`/signin?next=${encodeURIComponent(`/orders/${props.orderId}`)}`);
            }}
          >
            Sign in
          </a>{' '}
          to see this order.
        </p>
      </section>
    );
  }
  if (missing) {
    return (
      <section className="narrow ground-paper">
        <h1 className="display">Not found</h1>
        <p>That order isn&rsquo;t yours to see.</p>
      </section>
    );
  }
  if (order === null) return <section className="narrow ground-paper">Loading…</section>;

  const download = async (line: Line, event: React.MouseEvent): Promise<void> => {
    event.preventDefault();
    if (line.pass === null) return;
    try {
      const response = await fetch(`/api/orders/${order.id}/passes/${line.pass.code}`, {
        credentials: 'same-origin',
      });
      if (!response.ok) {
        setStatus("Your pass is safe but can't be downloaded right now. Try again in a moment.");
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${line.pass.code}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setStatus("Your pass is safe but can't be downloaded right now. Try again in a moment.");
    }
  };

  const uploadProof = async (): Promise<void> => {
    if (proofFile === null) {
      setUploadStatus('Choose a proof document first.');
      return;
    }
    setUploadStatus('Uploading…');
    const form = new FormData();
    form.set('kind', proofKind);
    form.set('file', proofFile);
    try {
      const proof = await request<{ deadline: string }>(`/api/orders/${order.id}/proof`, {
        method: 'POST',
        body: form,
      });
      setUploadStatus(`Proof received. We'll decide by ${formatDeadline(proof.deadline)}.`);
      await load();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      setUploadStatus(uploadMessage(error));
    }
  };

  const submitTransfer = async (
    line: Line,
    recipientName: string,
    recipientEmail: string,
  ): Promise<void> => {
    setStatus('Transferring…');
    try {
      await request(`/api/orders/${order.id}/lines/${line.id}/transfer`, {
        method: 'POST',
        body: { recipient_name: recipientName, recipient_email: recipientEmail },
      });
      setStatus(
        `Transferred to ${recipientName}. Their new pass is on its way and your old pass no longer scans.`,
      );
      setTransferLine(null);
      await load();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      setStatus(
        error.failure.code === 'storage_unavailable'
          ? "We couldn't issue the new pass right now. Nothing changed — try again in a moment."
          : 'That ticket can no longer be transferred.',
      );
    }
  };

  const proofPending = order.status === 'proof_pending';

  return (
    <section className="wide ground-paper">
      <h1 className="display">{`Order ${order.ref}`}</h1>
      <p className="status" role="status" aria-label="Order status">
        {status === '' ? orderStatusCopy(order) : status}
      </p>

      <table className="ruled" aria-label="Order lines">
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Holder</th>
            <th scope="col">State</th>
            <th scope="col">Price</th>
            <th scope="col">Voucher</th>
            <th scope="col">Paid</th>
            <th scope="col">Pass</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line) => (
            <tr key={line.id}>
              <td>{line.title}</td>
              <td>{line.holder_name}</td>
              <td>{line.state.replace(/_/g, ' ')}</td>
              <td className="figures">{formatEuros(line.list_cents)}</td>
              <td className="figures">{formatEuros(line.voucher_cents)}</td>
              <td className="figures">{formatEuros(line.charged_cents)}</td>
              <td>
                {line.pass === null ? (
                  <span className="muted">—</span>
                ) : (
                  <a
                    href={`/api/orders/${order.id}/passes/${line.pass.code}`}
                    download
                    onClick={(event) => void download(line, event)}
                  >
                    {`Download pass ${line.pass.code}`}
                  </a>
                )}
                {line.state === 'captured' ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      transferOpener.current = event.currentTarget;
                      setTransferLine(line);
                    }}
                  >
                    {`Transfer ${line.title}`}
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={5}>
              Total
            </th>
            <td className="figures">{formatEuros(order.total_cents)}</td>
            <td />
          </tr>
        </tfoot>
      </table>

      {order.refunds.length > 0 ? (
        <table className="ruled" aria-label="Refunds">
          <thead>
            <tr>
              <th scope="col">Reason</th>
              <th scope="col">Card</th>
              <th scope="col">Voucher</th>
              <th scope="col">State</th>
            </tr>
          </thead>
          <tbody>
            {order.refunds.map((refund) => (
              <tr key={refund.id}>
                <td>{refund.reason}</td>
                <td className="figures">{formatEuros(refund.card_cents)}</td>
                <td className="figures">{formatEuros(refund.voucher_cents)}</td>
                <td>{refund.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {proofPending ? (
        <fieldset className="proof" aria-label="Proof of reduced rate">
          <legend>Proof of reduced rate</legend>
          <label>
            <input
              type="radio"
              name="proof-kind"
              checked={proofKind === 'student'}
              onChange={() => setProofKind('student')}
            />
            Student
          </label>
          <label>
            <input
              type="radio"
              name="proof-kind"
              checked={proofKind === 'jobseeker'}
              onChange={() => setProofKind('jobseeker')}
            />
            Jobseeker
          </label>
          <div className="field">
            <label htmlFor="proof-file">Proof document</label>
            <input
              id="proof-file"
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(event) => setProofFile(event.target.files?.[0] ?? null)}
            />
          </div>
          <button type="button" className="primary" onClick={() => void uploadProof()}>
            Upload proof
          </button>
          <p className="status" role="status" aria-label="Upload status">
            {uploadStatus}
          </p>
          {order.proof_deadline !== null ? (
            <p className="muted figures">{`Upload by ${formatDeadline(order.proof_deadline)}`}</p>
          ) : null}
        </fieldset>
      ) : null}

      {transferLine !== null ? (
        <TransferDialog
          line={transferLine}
          openerRef={transferOpener}
          onClose={() => setTransferLine(null)}
          onSubmit={submitTransfer}
        />
      ) : null}
    </section>
  );
}

function uploadMessage(error: ApiError): string {
  const code = error.failure.fields['file'] ?? error.failure.code;
  if (error.failure.status === 413) return 'This file is larger than 5,000,000 bytes.';
  if (code === 'unsupported_type') return 'Upload a PDF, JPEG or PNG file.';
  if (code === 'invalid_name') return "This file name isn't allowed. Rename the file and try again.";
  if (code === 'storage_unavailable') return "We couldn't store your file right now. Try again in a moment.";
  if (code === 'empty') return 'That file is empty.';
  return 'We could not accept that file.';
}

interface TransferDialogProps {
  line: Line;
  openerRef: React.MutableRefObject<HTMLElement | null>;
  onClose: () => void;
  onSubmit: (line: Line, name: string, email: string) => Promise<void>;
}

function TransferDialog(props: TransferDialogProps): JSX.Element {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  return (
    <Dialog
      label="Transfer ticket"
      closeLabel="Cancel"
      openerRef={props.openerRef}
      onClose={props.onClose}
    >
      <div className="field">
        <label htmlFor="recipient-name">Recipient name</label>
        <input
          id="recipient-name"
          type="text"
          ref={nameRef}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="recipient-email">Recipient email</label>
        <input
          id="recipient-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="dialog-actions">
        <button type="button" onClick={props.onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => void props.onSubmit(props.line, name, email)}
        >
          Transfer ticket
        </button>
      </div>
    </Dialog>
  );
}
