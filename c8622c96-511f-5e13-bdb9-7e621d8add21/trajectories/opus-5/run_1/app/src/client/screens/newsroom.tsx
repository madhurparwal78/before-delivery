import { useCallback, useEffect, useRef, useState } from 'react';
import {
  NoAnswer,
  RequestFailed,
  request,
  type FollowItem,
  type LicenceView,
  type Session,
  type ShortlistItem,
  type UsageTotals,
} from '../api.js';
import { Dialog } from '../components/Dialog.js';
import { displayMoney, invoiceLabel, licenceStateLabel, receiptLabel } from '../format.js';
import { usePolling } from '../hooks.js';

const NETWORK_FAILURE = 'Couldn’t reach Saltprint Desk. Nothing was changed; try again.';

export function Shortlist({ session }: { session: Session }): React.ReactElement {
  const [items, setItems] = useState<ShortlistItem[]>([]);
  const [status, setStatus] = useState('');

  const load = useCallback(() => {
    void request<{ items: ShortlistItem[] }>('/api/shortlist')
      .then((result) => setItems(result.data.items))
      .catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  const remove = async (item: ShortlistItem): Promise<void> => {
    try {
      await request(`/api/shortlist/${item.id}`, { method: 'DELETE' });
      setStatus('Removed from shortlist.');
    } catch {
      setStatus(NETWORK_FAILURE);
    } finally {
      load();
    }
  };

  return (
    <main>
      <h1>Shortlist · {items.length} frames</h1>
      <span className="status" role="status" aria-label="Shortlist status">
        {status}
      </span>
      <ul className="plain" aria-label="Shortlist">
        {items.map((item) => (
          <li key={item.id}>
            <img src={`/media/frames/${item.frame_id}/grid`} alt="" />
            <span>
              <strong>{item.essay_title}</strong>
              <br />
              <span className="mono">Frame {item.position}</span>
              <br />
              <span className="mono">
                {item.added_by} · {item.added_display}
              </span>
            </span>
            {session.role === 'picture_editor' ? (
              <button type="button" onClick={() => void remove(item)}>
                {`Remove frame ${item.position} of ${item.essay_title} from shortlist`}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </main>
  );
}

export function Following(): React.ReactElement {
  const [follows, setFollows] = useState<FollowItem[]>([]);
  const [status, setStatus] = useState('');

  const load = useCallback(() => {
    void request<{ follows: FollowItem[] }>('/api/follows')
      .then((result) => setFollows(result.data.follows))
      .catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  const unfollow = async (follow: FollowItem, label: string): Promise<void> => {
    try {
      await request(`/api/follows/${follow.id}`, { method: 'DELETE' });
      setStatus(`Unfollowed ${label}.`);
    } catch {
      setStatus(NETWORK_FAILURE);
    } finally {
      load();
    }
  };

  return (
    <main>
      <h1>Following</h1>
      <span className="status" role="status" aria-label="Follow status">
        {status}
      </span>
      <ul className="plain" aria-label="Following">
        {follows.map((follow) => {
          const label = follow.title ?? follow.name ?? '';
          return (
            <li key={follow.id}>
              <span>{label}</span>
              <button type="button" onClick={() => void unfollow(follow, label)}>
                {`Unfollow ${label}`}
              </button>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

function OriginalsDialog({
  licence,
  onClose,
}: {
  licence: LicenceView;
  onClose: () => void;
}): React.ReactElement {
  const [status, setStatus] = useState('');

  const download = async (frameId: string): Promise<void> => {
    setStatus('Preparing download…');
    try {
      const result = await request<{ url: string; expires_at: string }>(
        `/api/licences/${licence.id}/grants`,
        { method: 'POST', body: { frame_id: frameId } },
      );
      setStatus('Download ready.');
      window.location.assign(result.data.url);
    } catch (failure) {
      if (failure instanceof RequestFailed) {
        const code = failure.body.code;
        if (code === 'licence_ended') {
          setStatus(
            `This licence ended at ${licence.window_end_display}. Originals are no longer available.`,
          );
        } else if (code === 'licence_revoked') {
          setStatus('Licence revoked after a legal takedown. Originals are no longer available.');
        } else if (code === 'licence_pending') {
          setStatus('The invoice is still pending; originals unlock when it is raised.');
        } else if (code === 'storage_unavailable') {
          setStatus('Image storage is unreachable. Try again shortly.');
        } else {
          setStatus(failure.body.message);
        }
      } else if (failure instanceof NoAnswer) {
        setStatus(NETWORK_FAILURE);
      }
    }
  };

  return (
    <Dialog label={`Originals: ${licence.essay_title}`} onClose={onClose}>
      <h2>{licence.essay_title}</h2>
      {licence.frames.map((frame) => (
        <button key={frame.id} type="button" onClick={() => void download(frame.id)}>
          {`Download frame ${frame.position}`}
        </button>
      ))}
      <span className="status" role="status" aria-label="Download status">
        {status}
      </span>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </Dialog>
  );
}

export function Licences({ session }: { session: Session }): React.ReactElement {
  const [licences, setLicences] = useState<LicenceView[]>([]);
  const [open, setOpen] = useState<LicenceView | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(() => {
    void request<{ licences: LicenceView[] }>('/api/licences')
      .then((result) => setLicences(result.data.licences))
      .catch(() => undefined);
  }, []);

  useEffect(load, [load]);
  usePolling(load, 10_000);

  return (
    <main>
      <h1>Licences</h1>
      <table className="stacked" aria-label="Licences">
        <thead>
          <tr>
            <th>Essay</th>
            <th>Kind</th>
            <th>State</th>
            <th>Window ends</th>
            <th>Amount</th>
            <th>Invoice</th>
            <th>Receipt</th>
          </tr>
        </thead>
        <tbody>
          {licences.map((licence) => (
            <tr key={licence.id}>
              <td data-label="Essay">
                {licence.essay_title}
                {session.role === 'picture_editor' && licence.state === 'active' ? (
                  <>
                    <br />
                    <button
                      type="button"
                      onClick={(event) => {
                        opener.current = event.currentTarget;
                        setOpen(licence);
                      }}
                    >
                      {`Download originals for ${licence.essay_title}`}
                    </button>
                  </>
                ) : null}
              </td>
              <td data-label="Kind" className="mono">
                {licence.kind}
              </td>
              <td data-label="State" className={`mono state-${licence.state}`}>
                {licenceStateLabel(licence.state)}
              </td>
              <td data-label="Window ends" className="mono">
                {licence.window_end_display}
              </td>
              <td data-label="Amount" className="mono">
                {displayMoney(licence.amount_minor)}
              </td>
              <td data-label="Invoice" className="mono">
                {invoiceLabel(licence.invoice_state)}
              </td>
              <td data-label="Receipt" className="mono">
                {receiptLabel(licence.receipt_state)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {open ? (
        <OriginalsDialog
          licence={open}
          onClose={() => {
            setOpen(null);
            opener.current?.focus();
          }}
        />
      ) : null}
    </main>
  );
}

export function Usage(): React.ReactElement {
  const [totals, setTotals] = useState<UsageTotals | null>(null);
  const [licences, setLicences] = useState<LicenceView[]>([]);

  const load = useCallback(() => {
    void request<UsageTotals>('/api/usage')
      .then((result) => setTotals(result.data))
      .catch(() => undefined);
    void request<{ licences: LicenceView[] }>('/api/licences')
      .then((result) => setLicences(result.data.licences))
      .catch(() => undefined);
  }, []);

  useEffect(load, [load]);
  usePolling(load, 10_000);

  const now = Date.now();
  const expiries = licences
    .filter((licence) => licence.state === 'active' && new Date(licence.window_end).getTime() > now)
    .sort((left, right) => {
      const byEnd = new Date(left.window_end).getTime() - new Date(right.window_end).getTime();
      if (byEnd !== 0) return byEnd;
      const byConfirmed =
        new Date(left.confirmed_at).getTime() - new Date(right.confirmed_at).getTime();
      if (byConfirmed !== 0) return byConfirmed;
      return left.id < right.id ? -1 : 1;
    });

  return (
    <main>
      <h1>Usage</h1>
      <section aria-label="Usage totals">
      <dl className="totals">
        <div>
          <dt>Active</dt>
          <dd className="mono">{totals?.active ?? 0}</dd>
        </div>
        <div>
          <dt>Pending invoice</dt>
          <dd className="mono">{totals?.pending_invoice ?? 0}</dd>
        </div>
        <div>
          <dt>Expired</dt>
          <dd className="mono">{totals?.expired ?? 0}</dd>
        </div>
        <div>
          <dt>Revoked</dt>
          <dd className="mono">{totals?.revoked ?? 0}</dd>
        </div>
        <div>
          <dt>Exclusive</dt>
          <dd className="mono">{totals?.exclusive ?? 0}</dd>
        </div>
        <div>
          <dt>Standard</dt>
          <dd className="mono">{totals?.standard ?? 0}</dd>
        </div>
        <div>
          <dt>Invoiced</dt>
          <dd className="mono">{displayMoney(totals?.invoiced_minor ?? 0)}</dd>
        </div>
        <div>
          <dt>Shortlist</dt>
          <dd className="mono">{totals?.shortlist_count ?? 0}</dd>
        </div>
        <div>
          <dt>Next expiry</dt>
          <dd className="mono">{totals?.next_expiry ? totals.next_expiry.window_end_display : '—'}</dd>
        </div>
      </dl>
      </section>
      <table className="stacked" aria-label="Licence expiries">
        <thead>
          <tr>
            <th>Essay</th>
            <th>Kind</th>
            <th>Window ends</th>
          </tr>
        </thead>
        <tbody>
          {expiries.map((licence) => (
            <tr key={licence.id}>
              <td data-label="Essay">{licence.essay_title}</td>
              <td data-label="Kind" className="mono">
                {licence.kind}
              </td>
              <td data-label="Window ends" className="mono">
                {licence.window_end_display}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        <a href="/api/usage.csv">Export CSV</a>
      </p>
    </main>
  );
}
