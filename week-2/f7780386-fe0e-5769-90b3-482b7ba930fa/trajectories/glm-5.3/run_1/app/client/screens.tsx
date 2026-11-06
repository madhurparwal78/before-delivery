// The role screens: Hours, Documents, Invoices, Shifts, Review, Members,
// Usage and Packets. Each follows the same feedback pattern: pending copy in
// status "Updates", refusals in alert "Problems".

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSession, useFeedback } from './app';
import {
  getLedger,
  buyPack,
  adjustHours,
  reverseTransaction,
  getDocuments,
  uploadDocument,
  reviewDocument,
  getMembers,
  getUsage,
  getInvoices,
  createPacket,
  getPackets,
  revokePacket,
  regeneratePacket,
  getBookings,
  checkIn,
  saveBusinessName,
  api,
} from './api';
import { hoursText } from '../shared/rules';
import { documentKindLabel, documentStatusLabel, addDays } from './format';
import type { Transaction, Document, Booking, Packet } from '../shared/types';

function errOffline(): string {
  return 'Passboard could not reach the server. Nothing changed; try again.';
}

function key(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Hours (member).
// ---------------------------------------------------------------------------

export function HoursScreen() {
  const { kitchen } = useSession();
  const { setUpdates, setProblems } = useFeedback();
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [savingName, setSavingName] = useState(false);

  const load = useCallback(async () => {
    const res = await getLedger();
    if (res.ok && res.body) {
      setBalance(res.body.balance_minutes);
      setTransactions(res.body.transactions);
    }
  }, []);

  useEffect(() => {
    void load();
    void api<{ user: { business_name: string | null } }>('GET', '/api/me').then((r) => {
      if (r.ok && r.body) setBusinessName(r.body.user.business_name ?? '');
    });
  }, [load]);

  const onBuy = async (packId: string, packName: string) => {
    setBusy(packId);
    setUpdates(`Buying ${packName}…`);
    setProblems('');
    const res = await buyPack(packId, key());
    setBusy(null);
    if (res.ok && res.body) {
      setUpdates(`${packName} added. Balance: ${hoursText(res.body.balance_minutes)} h.`);
      await load();
    } else if (res.error === 'billing_unavailable') {
      setProblems('Billing is unreachable right now. No charge was made; try again shortly.');
      setUpdates('');
    } else {
      setProblems(errOffline());
      setUpdates('');
    }
  };

  const onSaveName = async (e: FormEvent) => {
    e.preventDefault();
    setSavingName(true);
    setUpdates('Saving…');
    setProblems('');
    const res = await saveBusinessName(businessName);
    setSavingName(false);
    if (res.ok) {
      setUpdates('Business name saved.');
    } else if (res.errors && res.errors['business_name'] === 'length') {
      setProblems('Business names are 1 to 80 characters.');
      setUpdates('');
    } else {
      setProblems(errOffline());
      setUpdates('');
    }
  };

  return (
    <>
      <h1>Hours</h1>
      <p className="hint">
        Balance <strong className="num">{hoursText(balance)} h</strong>
      </p>
      <section>
        {kitchen.packs.map((p) => (
          <span key={p.id} style={{ marginRight: 12 }}>
            <button type="button" disabled={busy === p.id} onClick={() => onBuy(p.id, p.name)}>
              Buy {p.name}
            </button>{' '}
            <span className="hint num">${p.price}</span>
          </span>
        ))}
      </section>
      <section className="card">
        <h2>Business name</h2>
        <form className="inline" onSubmit={onSaveName}>
          <label>
            Business name
            <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
          </label>
          <button type="submit" disabled={savingName}>Save business name</button>
        </form>
      </section>
      <table className="cards" aria-label="Hours ledger">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Kind</th>
            <th scope="col">Hours</th>
            <th scope="col">Booking</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => (
            <tr key={t.id}>
              <td data-label="Date" className="num">{t.created_at.slice(0, 10)}</td>
              <td data-label="Kind">{kindLabel(t.kind)}</td>
              <td data-label="Hours" className="num">{hoursText(t.member_minutes)}</td>
              <td data-label="Booking" className="num">{t.booking_id ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function kindLabel(kind: Transaction['kind']): string {
  switch (kind) {
    case 'opening':
      return 'Opening balance';
    case 'pack_purchase':
      return 'Hour pack';
    case 'booking_debit':
      return 'Booking';
    case 'cancellation_refund':
      return 'Cancellation refund';
    case 'adjustment':
      return 'Adjustment';
    case 'reversal':
      return 'Reversal';
  }
}

// ---------------------------------------------------------------------------
// Documents (member and crew cook).
// ---------------------------------------------------------------------------

export function DocumentsScreen() {
  const { user } = useSession();
  const { setUpdates, setProblems } = useFeedback();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [kind, setKind] = useState('liability_insurance');
  const [expiresOn, setExpiresOn] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [crewCooks, setCrewCooks] = useState<{ id: string; name: string }[]>([]);
  const [crewCookId, setCrewCookId] = useState('');
  const [busy, setBusy] = useState(false);

  const isCrew = user.role === 'crew_cook';

  const load = useCallback(async () => {
    const res = await getDocuments();
    if (res.ok && res.body) {
      setDocuments(res.body.documents);
      // Members file a crew cook's card: the combobox offers the cooks whose
      // cards are already on file, so renewals attach to the right cook.
      const cooks = new Map<string, string>();
      for (const d of res.body.documents) {
        if (d.kind === 'food_handler_card' && d.crew_cook_id) {
          cooks.set(d.crew_cook_id, d.crew_cook_name ?? d.crew_cook_id);
        }
      }
      setCrewCooks([...cooks].map(([id, name]) => ({ id, name })));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) {
      setProblems('Only PDF, PNG or JPEG files are accepted.');
      return;
    }
    setBusy(true);
    setUpdates('Uploading…');
    setProblems('');
    const form = new FormData();
    form.set('kind', isCrew ? 'food_handler_card' : kind);
    form.set('expires_on', expiresOn);
    if (isCrew) form.set('crew_cook_id', user.id);
    else if (kind === 'food_handler_card' && crewCookId) form.set('crew_cook_id', crewCookId);
    form.set('file', file, file.name);
    const res = await uploadDocument(form);
    setBusy(false);
    if (res.ok) {
      setUpdates('Document uploaded and waiting for review.');
      setFile(null);
      setExpiresOn('');
      await load();
      return;
    }
    setUpdates('');
    switch (res.error) {
      case 'unsupported_file_type':
        setProblems('Only PDF, PNG or JPEG files are accepted.');
        break;
      case 'file_too_large':
        setProblems('Files must be 5,000,000 bytes or smaller.');
        break;
      case 'payload_too_large':
        setProblems('Files must be 5,000,000 bytes or smaller.');
        break;
      case 'storage_unavailable':
        setProblems('File storage is unreachable. Nothing was saved; try again shortly.');
        break;
      case 'validation_failed': {
        const code = res.errors ? Object.values(res.errors)[0] : undefined;
        if (code === 'file_empty') setProblems('That file is empty.');
        else if (code === 'file_invalid_filename') setProblems("Rename the file: its name can't contain slashes or two dots in a row.");
        else setProblems('Only PDF, PNG or JPEG files are accepted.');
        break;
      }
      default:
        setProblems(errOffline());
    }
  };

  return (
    <>
      <h1>Documents</h1>
      <section className="card">
        <h2>Upload a document</h2>
        <p className="hint">PDF, PNG or JPEG, up to 5,000,000 bytes</p>
        <form aria-label="Upload document" className="stack" onSubmit={submit}>
          {!isCrew && (
            <label>
              Document type
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="liability_insurance">Liability insurance</option>
                <option value="food_handler_card">Food handler card</option>
              </select>
            </label>
          )}
          {!isCrew && kind === 'food_handler_card' && (
            <label>
              Crew cook
              <select value={crewCookId} onChange={(e) => setCrewCookId(e.target.value)}>
                <option value="">Select a crew cook</option>
                {crewCooks.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            Expires on
            <input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
          </label>
          <label>
            File
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button type="submit" disabled={busy}>Upload document</button>
        </form>
      </section>
      <table className="cards" aria-label="Documents on file">
        <thead>
          <tr>
            <th scope="col">Type</th>
            <th scope="col">Person</th>
            <th scope="col">Expires on</th>
            <th scope="col">Status</th>
            <th scope="col">File</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((d) => (
            <tr key={d.id}>
              <td data-label="Type">{documentKindLabel(d.kind)}</td>
              <td data-label="Person">{d.crew_cook_name ?? user.business_name}</td>
              <td data-label="Expires on" className="num">{d.expires_on}</td>
              <td data-label="Status">{documentStatusLabel(d.status)}</td>
              <td data-label="File">
                <a href={`/api/documents/${d.id}/file`}>Download</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// ---------------------------------------------------------------------------
// Invoices (member).
// ---------------------------------------------------------------------------

export function InvoicesScreen() {
  const { setUpdates, setProblems } = useFeedback();
  const [invoices, setInvoices] = useState<{ id: string; date: string; amount: string; balance: string; items: { description: string; amount: string }[] }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setUpdates('Loading invoices…');
    void getInvoices().then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.ok && res.body) {
        setInvoices(res.body.invoices);
        setUpdates('');
      } else if (res.error === 'billing_unavailable') {
        setProblems('Invoices are unavailable while billing is unreachable.');
        setUpdates('');
      } else {
        setProblems(errOffline());
        setUpdates('');
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <h1>Invoices</h1>
      {loading && <p className="hint">Loading invoices…</p>}
      <table className="cards" aria-label="Invoices">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Items</th>
            <th scope="col">Amount</th>
            <th scope="col">Balance</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id}>
              <td data-label="Date" className="num">{inv.date}</td>
              <td data-label="Items">{inv.items.map((i) => `${i.description} ($${i.amount})`).join('; ')}</td>
              <td data-label="Amount" className="num">${inv.amount}</td>
              <td data-label="Balance" className="num">${inv.balance}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// ---------------------------------------------------------------------------
// Shifts (crew cook home).
// ---------------------------------------------------------------------------

export function ShiftsScreen() {
  const { kitchen } = useSession();
  const { setUpdates, setProblems } = useFeedback();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await getBookings(kitchen.today, addDays(kitchen.today, 28));
    if (res.ok && res.body) setBookings(res.body.bookings);
  }, [kitchen.today]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);

  const onCheckIn = async (b: Booking) => {
    setBusy(b.id);
    setUpdates('Checking in…');
    setProblems('');
    const res = await checkIn(b.id, key());
    setBusy(null);
    if (res.ok) {
      const checkIn = res.ok && 'check_in' in res.body! ? res.body.check_in : null;
      void checkIn;
      setUpdates(`Checked in for ${b.station_name}, ${b.start}–${b.end}.`);
      await load();
      return;
    }
    setUpdates('');
    if (res.error === 'food_handler_card_not_current') {
      setProblems('Your food handler card is not approved and current for this shift.');
    } else if (res.error === 'outside_check_in_window') {
      setProblems('Check-in opens 15 minutes before the shift starts and closes when it ends.');
    } else if (res.error === 'invalid_transition') {
      setProblems('Check-in opens 15 minutes before the shift starts and closes when it ends.');
    } else {
      setProblems(errOffline());
    }
  };

  return (
    <>
      <h1>Shifts</h1>
      <ul aria-label="Upcoming shifts" style={{ listStyle: 'none', padding: 0 }}>
        {bookings.filter((b) => b.status !== 'cancelled_free' && b.status !== 'cancelled_with_fee').map((b) => {
          const mine = b.check_ins.length > 0;
          return (
            <li key={b.id} className="card">
              <p>
                <strong>{b.station_name}</strong> — {b.date} {b.start}–{b.end}
                {b.payment === 'payment_pending' && <span className="hint"> Payment pending</span>}
              </p>
              {mine ? (
                <p className="hint">Checked in {b.check_ins.map((c) => c.at.slice(11, 16)).join(', ')}</p>
              ) : (
                <button type="button" disabled={busy === b.id} onClick={() => onCheckIn(b)}>
                  Check in: {b.station_name}, {b.date} {b.start}
                </button>
              )}
            </li>
          );
        })}
        {bookings.length === 0 && <li className="hint">No upcoming shifts.</li>}
      </ul>
    </>
  );
}

// ---------------------------------------------------------------------------
// Review (operator home).
// ---------------------------------------------------------------------------

export function ReviewScreen() {
  const { setUpdates, setProblems } = useFeedback();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await getDocuments('uploaded');
    if (res.ok && res.body) setDocuments(res.body.documents);
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);

  const onReview = async (doc: Document, action: 'approve' | 'reject') => {
    setBusy(doc.id);
    setUpdates('Saving review…');
    setProblems('');
    const reason = reasons[doc.id] ?? '';
    const res = await reviewDocument(doc.id, action, action === 'reject' ? reason : undefined);
    setBusy(null);
    if (res.ok) {
      setUpdates(action === 'approve' ? 'Document approved.' : 'Document rejected.');
      await load();
      return;
    }
    setUpdates('');
    if (res.error === 'invalid_transition') {
      setProblems('This document was already reviewed.');
      await load();
    } else if (res.errors && res.errors['reason'] === 'length') {
      setProblems('This document was already reviewed.');
    } else {
      setProblems(errOffline());
    }
  };

  return (
    <>
      <h1>Review</h1>
      <table className="cards" aria-label="Documents to review">
        <thead>
          <tr>
            <th scope="col">Business</th>
            <th scope="col">Type</th>
            <th scope="col">Person</th>
            <th scope="col">Expiry date</th>
            <th scope="col">File</th>
            <th scope="col">Review</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((d) => (
            <tr key={d.id}>
              <td data-label="Business">{d.member_id}</td>
              <td data-label="Type">{documentKindLabel(d.kind)}</td>
              <td data-label="Person">{d.crew_cook_name ?? ''}</td>
              <td data-label="Expiry date" className="num">{d.expires_on}</td>
              <td data-label="File">
                <a href={`/api/documents/${d.id}/file`}>Download</a>
              </td>
              <td data-label="Review">
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85em' }}>
                    Rejection reason
                    <input
                      aria-label={`Rejection reason ${d.id}`}
                      value={reasons[d.id] ?? ''}
                      onChange={(e) => setReasons({ ...reasons, [d.id]: e.target.value })}
                      style={{ minHeight: 36 }}
                    />
                  </label>
                  <button type="button" disabled={busy === d.id} onClick={() => onReview(d, 'approve')}>Approve</button>
                  <button type="button" className="ghost" disabled={busy === d.id} onClick={() => onReview(d, 'reject')}>Reject</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {documents.length === 0 && <p className="hint">Nothing waiting for review.</p>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Members (operator).
// ---------------------------------------------------------------------------

export function MembersScreen() {
  const { kitchen } = useSession();
  const { setUpdates, setProblems } = useFeedback();
  const [members, setMembers] = useState<{ id: string; business_name: string; contact_email: string; balance_minutes: number; liability_insurance: { status: string; expires_on: string } | null }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [ledger, setLedger] = useState<{ balance_minutes: number; transactions: Transaction[] } | null>(null);
  const [lateCancellations, setLateCancellations] = useState<Booking[]>([]);
  const [adjustments, setAdjustments] = useState<Record<string, { hours: string; reason: string }>>({});
  const [reverseReasons, setReverseReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    const res = await getMembers();
    if (res.ok && res.body) setMembers(res.body.members);
  }, []);

  const loadLedger = useCallback(async (memberId: string) => {
    const res = await getLedger(memberId);
    if (res.ok && res.body) setLedger({ balance_minutes: res.body.balance_minutes, transactions: res.body.transactions });
  }, []);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    if (!selected) return;
    void loadLedger(selected);
  }, [selected, loadLedger]);

  // The late-cancellations table reads bookings with a fee, within the
  // window the bookings endpoint serves.
  const loadLate = useCallback(async () => {
    const today = kitchen.today;
    const res = await getBookings(addDays(today, -30), addDays(today, 28));
    if (res.ok && res.body) setLateCancellations(res.body.bookings.filter((b) => b.status === 'cancelled_with_fee'));
  }, [kitchen.today]);

  useEffect(() => {
    void loadLate();
    const timer = setInterval(() => void loadLate(), 10000);
    return () => clearInterval(timer);
  }, [loadLate]);

  const onAdjust = async (memberId: string) => {
    const entry = adjustments[memberId] ?? { hours: '', reason: '' };
    const hours = Number(entry.hours);
    const minutes = Math.round(hours * 60);
    setBusy(memberId);
    setUpdates('Adjusting hours…');
    setProblems('');
    const res = await adjustHours(memberId, minutes, entry.reason, key());
    setBusy(null);
    if (res.ok && res.body) {
      setUpdates(`Hours adjusted. Balance: ${hoursText(res.body.balance_minutes)} h.`);
      await loadMembers();
      if (selected === memberId) await loadLedger(memberId);
      return;
    }
    setUpdates('');
    if (res.error === 'insufficient_hours') {
      setProblems('That would take the balance below zero.');
    } else if (res.errors && res.errors['reason'] === 'length') {
      setProblems('That would take the balance below zero.');
    } else if (res.errors && res.errors['minutes'] === 'invalid') {
      setProblems('That would take the balance below zero.');
    } else {
      setProblems(errOffline());
    }
  };

  const onReverse = async (txId: string) => {
    const reason = reverseReasons[txId] ?? 'Correction';
    setBusy(txId);
    setUpdates('Reversing…');
    setProblems('');
    const res = await reverseTransaction(txId, reason, key());
    setBusy(null);
    if (res.ok && res.body) {
      setUpdates(`Transaction reversed. Balance: ${hoursText(res.body.balance_minutes)} h.`);
      await loadMembers();
      if (selected) await loadLedger(selected);
      return;
    }
    setUpdates('');
    if (res.error === 'already_reversed') {
      setProblems('That transaction was already reversed.');
    } else if (res.error === 'not_reversible') {
      setProblems('Only adjustments and opening balances can be reversed.');
    } else if (res.error === 'insufficient_hours') {
      setProblems('That would take the balance below zero.');
    } else {
      setProblems(errOffline());
    }
  };

  const onWaive = async (b: Booking) => {
    setBusy(b.id);
    setUpdates('Waiving fee…');
    setProblems('');
    const res = await api<{ booking: Booking }>('POST', `/api/bookings/${b.id}/waive-fee`, {}, key());
    setBusy(null);
    if (res.ok) {
      setUpdates('Late-cancellation fee waived.');
      await loadLate();
      return;
    }
    setUpdates('');
    if (res.error === 'invalid_transition') {
      setProblems('There is no fee left to waive on this booking.');
      await loadLate();
    } else {
      setProblems(errOffline());
    }
  };

  return (
    <>
      <h1>Members</h1>
      <table className="cards" aria-label="Members">
        <thead>
          <tr>
            <th scope="col">Business</th>
            <th scope="col">Contact</th>
            <th scope="col">Balance</th>
            <th scope="col">Insurance</th>
            <th scope="col">Adjust hours</th>
            <th scope="col">Ledger</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td data-label="Business">{m.business_name}</td>
              <td data-label="Contact">{m.contact_email}</td>
              <td data-label="Balance" className="num">{hoursText(m.balance_minutes)} h</td>
              <td data-label="Insurance">{m.liability_insurance ? `${m.liability_insurance.status} (${m.liability_insurance.expires_on})` : 'none'}</td>
              <td data-label="Adjust hours">
                <form aria-label="Adjust hours" className="inline" onSubmit={(e) => { e.preventDefault(); void onAdjust(m.id); }}>
                  <label>
                    Hours change
                    <input
                      type="number"
                      step="0.25"
                      value={adjustments[m.id]?.hours ?? ''}
                      onChange={(e) => setAdjustments({ ...adjustments, [m.id]: { hours: e.target.value, reason: adjustments[m.id]?.reason ?? '' } })}
                      style={{ width: 110, minHeight: 36 }}
                    />
                  </label>
                  <label>
                    Reason
                    <input
                      value={adjustments[m.id]?.reason ?? ''}
                      onChange={(e) => setAdjustments({ ...adjustments, [m.id]: { hours: adjustments[m.id]?.hours ?? '', reason: e.target.value } })}
                      style={{ width: 160, minHeight: 36 }}
                    />
                  </label>
                  <button type="submit" disabled={busy === m.id}>Adjust hours</button>
                </form>
              </td>
              <td data-label="Ledger">
                <button type="button" className="ghost" onClick={() => setSelected(selected === m.id ? null : m.id)}>
                  {selected === m.id ? 'Hide ledger' : `Open ledger: ${m.business_name}`}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selected && ledger && (
        <section className="card">
          <h2>Ledger</h2>
          <table className="cards" aria-label="Member ledger">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Kind</th>
                <th scope="col">Hours</th>
                <th scope="col">Reason</th>
                <th scope="col">Reverse</th>
              </tr>
            </thead>
            <tbody>
              {ledger.transactions.map((t) => {
                const reversible = (t.kind === 'adjustment' || t.kind === 'opening') && !t.reversed_by;
                return (
                  <tr key={t.id}>
                    <td data-label="Date" className="num">{t.created_at.slice(0, 10)}</td>
                    <td data-label="Kind">{kindLabel(t.kind)}{t.reversed_by ? ' (reversed)' : ''}</td>
                    <td data-label="Hours" className="num">{hoursText(t.member_minutes)}</td>
                    <td data-label="Reason">{t.reason ?? ''}</td>
                    <td data-label="Reverse">
                      {reversible && (
                        <form className="inline" onSubmit={(e) => { e.preventDefault(); void onReverse(t.id); }}>
                          <input
                            placeholder="Reason"
                            value={reverseReasons[t.id] ?? ''}
                            onChange={(e) => setReverseReasons({ ...reverseReasons, [t.id]: e.target.value })}
                            style={{ minHeight: 36 }}
                          />
                          <button type="submit" disabled={busy === t.id}>Reverse</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h2>Late cancellations</h2>
        <table className="cards" aria-label="Late cancellations">
          <thead>
            <tr>
              <th scope="col">Business</th>
              <th scope="col">Station</th>
              <th scope="col">Date</th>
              <th scope="col">Fee</th>
              <th scope="col">Fee status</th>
              <th scope="col">Waive</th>
            </tr>
          </thead>
          <tbody>
            {lateCancellations.map((b) => (
              <tr key={b.id}>
                <td data-label="Business">{b.business_name}</td>
                <td data-label="Station">{b.station_name}</td>
                <td data-label="Date" className="num">{b.date}</td>
                <td data-label="Fee" className="num">${b.fee?.amount ?? '0.00'}</td>
                <td data-label="Fee status">{b.fee?.status ?? ''}</td>
                <td data-label="Waive">
                  <button type="button" disabled={busy === b.id || b.fee?.status === 'waived'} onClick={() => onWaive(b)}>Waive fee</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {lateCancellations.length === 0 && <p className="hint">No late cancellations.</p>}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Usage (operator).
// ---------------------------------------------------------------------------

export function UsageScreen() {
  const { kitchen } = useSession();
  const [date, setDate] = useState(kitchen.today);
  const [month, setMonth] = useState(kitchen.today.slice(0, 7));
  const [usage, setUsage] = useState<{ stations: { station_name: string; booked_minutes: number; cleaning_minutes: number; bookings: number }[]; total_booked_minutes: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getUsage(date).then((res) => {
      if (!cancelled && res.ok && res.body) {
        setUsage({ stations: res.body.stations, total_booked_minutes: res.body.total_booked_minutes });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [date]);

  return (
    <>
      <h1>Usage</h1>
      <section className="card">
        <h2>Daily usage</h2>
        <form className="inline" onSubmit={(e) => e.preventDefault()}>
          <label>
            Usage date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </form>
        <table className="cards" aria-label="Daily usage">
          <thead>
            <tr>
              <th scope="col">Station</th>
              <th scope="col">Booked</th>
              <th scope="col">Cleaning</th>
              <th scope="col">Bookings</th>
            </tr>
          </thead>
          <tbody>
            {(usage?.stations ?? []).map((s) => (
              <tr key={s.station_name}>
                <td data-label="Station">{s.station_name}</td>
                <td data-label="Booked" className="num">{hoursText(s.booked_minutes)} h</td>
                <td data-label="Cleaning" className="num">{hoursText(s.cleaning_minutes)} h</td>
                <td data-label="Bookings" className="num">{s.bookings}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {usage && (
          <p className="hint">
            Total booked: <strong className="num">{hoursText(usage.total_booked_minutes)} h</strong>
          </p>
        )}
      </section>
      <section className="card">
        <h2>Monthly export</h2>
        <form className="inline" onSubmit={(e) => e.preventDefault()}>
          <label>
            Export month
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
        </form>
        <p>
          <a href={`/api/exports/usage.csv?month=${month}`}>Export month CSV</a>
        </p>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Packets (operator).
// ---------------------------------------------------------------------------

export function PacketsScreen() {
  const { kitchen } = useSession();
  const { setUpdates, setProblems } = useFeedback();
  const [from, setFrom] = useState(kitchen.today);
  const [to, setTo] = useState(kitchen.today);
  const [expiresAt, setExpiresAt] = useState('');
  const [packets, setPackets] = useState<Packet[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await getPackets();
    if (res.ok && res.body) setPackets(res.body.packets);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('new');
    setUpdates('Creating packet…');
    setProblems('');
    const instant = expiresAt ? toInstant(expiresAt) : '';
    const res = await createPacket(from, to, instant, key());
    setBusy(null);
    if (res.ok && res.body) {
      const p = res.body.packet;
      const exp = p.expires_at.replace('T', ' ').slice(0, 16);
      setUpdates(`Packet link created. It expires ${exp}.`);
      await load();
      return;
    }
    setUpdates('');
    if (res.error === 'storage_unavailable') {
      setProblems('File storage is unreachable. Nothing was saved; try again shortly.');
    } else {
      setProblems(errOffline());
    }
  };

  const onAction = async (p: Packet, action: 'revoke' | 'regenerate') => {
    setBusy(p.id);
    setUpdates(action === 'revoke' ? 'Revoking link…' : 'Regenerating link…');
    setProblems('');
    const res = action === 'revoke' ? await revokePacket(p.id) : await regeneratePacket(p.id);
    setBusy(null);
    if (res.ok) {
      setUpdates(action === 'revoke' ? 'Packet link revoked.' : 'New packet link created. The old link no longer works.');
      await load();
      return;
    }
    setUpdates('');
    if (res.error === 'invalid_transition') {
      setProblems(action === 'revoke' ? 'This link was already revoked.' : 'A revoked link can\'t be regenerated.');
      await load();
    } else if (res.error === 'storage_unavailable') {
      setProblems('File storage is unreachable. Nothing was saved; try again shortly.');
    } else {
      setProblems(errOffline());
    }
  };

  const copyLink = async (p: Packet) => {
    if (!p.url) return;
    await navigator.clipboard.writeText(window.location.origin + p.url);
    setUpdates('Link copied.');
  };

  return (
    <>
      <h1>Packets</h1>
      <p className="hint">Times are kitchen time ({kitchen.time_zone})</p>
      <section className="card">
        <h2>New packet</h2>
        <form aria-label="New packet" className="inline" onSubmit={onCreate}>
          <label>
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label>
            Link expires at
            <input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </label>
          <button type="submit" disabled={busy === 'new'}>Create packet link</button>
        </form>
      </section>
      <table className="cards" aria-label="Packet links">
        <thead>
          <tr>
            <th scope="col">From</th>
            <th scope="col">To</th>
            <th scope="col">Expires at</th>
            <th scope="col">Status</th>
            <th scope="col">Link</th>
          </tr>
        </thead>
        <tbody>
          {packets.map((p) => (
            <tr key={p.id}>
              <td data-label="From" className="num">{p.from}</td>
              <td data-label="To" className="num">{p.to}</td>
              <td data-label="Expires at" className="num">{p.expires_at.replace('T', ' ').slice(0, 16)}</td>
              <td data-label="Status">{p.status === 'active' ? 'Active' : p.status === 'revoked' ? 'Revoked' : 'Expired'}</td>
              <td data-label="Link">
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button type="button" className="ghost" disabled={!p.url || busy === p.id} onClick={() => void copyLink(p)}>Copy link</button>
                  {p.status === 'active' && (
                    <button type="button" disabled={busy === p.id} onClick={() => void onAction(p, 'revoke')}>Revoke link</button>
                  )}
                  {p.status !== 'revoked' && (
                    <button type="button" className="ghost" disabled={busy === p.id} onClick={() => void onAction(p, 'regenerate')}>Regenerate link</button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** A datetime-local value to an ISO 8601 instant with the kitchen's offset. */
function toInstant(local: string): string {
  // datetime-local values are kitchen time; the server validates the instant.
  return `${local}:00`;
}
