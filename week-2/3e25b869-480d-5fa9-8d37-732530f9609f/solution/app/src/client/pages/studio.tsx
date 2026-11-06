// The studio: one shell, a navigation filtered by role, and the six work pages.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { BATCH_STATE_LABELS, CADENCE_LABELS, coreScent, DROP_SCENTS, dropScent, pick, STUDIO_ACCESS, STUDIO_PAGES } from '../../shared/catalog.js';
import type { Messages } from '../../shared/copy.js';
import { formatMoney } from '../../shared/money.js';
import { dropTime, longDate } from '../../shared/toronto.js';
import { api, etagHeader, newKey, type Result } from '../api';
import { useCopy } from '../state';
import type { AuditEntry, Notice, PackingOrder, ReconLine, StaffBatch, StaffMember, StaffOrder, StaffSubscription } from '../types';
import { BarItem, Dialog, EmptyState, Field, Live, PriceRows } from '../ui';

type Announce = (text: string) => void;

/** The studio message for a failed call: its published copy, or the network line. */
function failure(m: Messages, r: Result<unknown>): string {
  if (r.ok) return '';
  if (r.status === 0) return m.network;
  if (r.status === 403) return m.forbidden;
  return Object.values(r.error.fields ?? {})[0] ?? r.error.message;
}

const PAGE_TITLES = (m: Messages): Record<string, string> => ({
  batches: m.navBatches,
  packing: m.navPacking,
  finance: m.navFinance,
  reconciliation: m.navReconciliation,
  audit: m.navAudit,
  notices: m.navNotices,
});

function StudioSignIn({ onSignedIn }: { onSignedIn: (staff: StaffMember) => void }) {
  const { m } = useCopy();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const submit = async (e: Event) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    const r = await api<{ staff: StaffMember }>('POST', '/api/staff/sign-in', { email, password });
    setPending(false);
    if (r.ok) onSignedIn(r.data.staff);
    else {
      setFailed(true);
      queueMicrotask(() => alertRef.current?.focus());
    }
  };
  return (
    <div class="page narrow">
      <h1 tabIndex={-1}>{m.studioSignIn}</h1>
      {failed && (
        <p role="alert" class="summary" tabIndex={-1} ref={alertRef}>
          {m.signInFailed}
        </p>
      )}
      <form class="stack" onSubmit={submit} noValidate>
        <Field id="f-staff-email" label={m.email} type="email" autocomplete="username" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
        <Field
          id="f-staff-password"
          label={m.password}
          type="password"
          autocomplete="current-password"
          value={password}
          onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
        />
        <div class="actions">
          <button type="submit" class="button primary" aria-busy={pending ? 'true' : undefined}>
            {pending ? m.saving : m.signIn}
          </button>
        </div>
      </form>
    </div>
  );
}

export function StudioPage({ section }: { section: string }) {
  const { m } = useCopy();
  const [staff, setStaff] = useState<StaffMember | null | 'signed-out'>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    void api<{ staff: StaffMember }>('GET', '/api/staff/me').then((r) => setStaff(r.ok ? r.data.staff : 'signed-out'));
  }, []);
  if (staff === null) return <p class="page loading">{m.loading}</p>;
  if (staff === 'signed-out') return <StudioSignIn onSignedIn={setStaff} />;
  const pages = STUDIO_PAGES.filter((p) => STUDIO_ACCESS[p.area].includes(staff.role));
  const page = STUDIO_PAGES.find((p) => p.slug === section);
  const allowed = page ? STUDIO_ACCESS[page.area].includes(staff.role) : true;
  const titles = PAGE_TITLES(m);
  const body: Record<string, () => ComponentChildren> = {
    batches: () => <BatchBoard announce={setMessage} />,
    packing: () => <Packing announce={setMessage} />,
    finance: () => <Finance announce={setMessage} />,
    reconciliation: () => <Reconciliation announce={setMessage} />,
    audit: () => <Audit />,
    notices: () => <Notices announce={setMessage} />,
  };
  return (
    <div class="page studio">
      <div class="studio-bar">
        <nav aria-label={m.studioNav} class="studio-nav">
          {pages.map((p) => (
            <a key={p.slug} href={`/studio/${p.slug}`} aria-current={p.slug === section ? 'page' : undefined}>
              {titles[p.slug]}
            </a>
          ))}
        </nav>
        <div class="studio-who">
          <span class="muted">{m.signedInStaff(staff.name, m.roles[staff.role])}</span>
          <button
            type="button"
            class="button secondary small"
            onClick={async () => {
              await api('POST', '/api/staff/sign-out', {});
              setStaff('signed-out');
            }}
          >
            {m.signOut}
          </button>
        </div>
      </div>
      {!page ? (
        <>
          <h1 tabIndex={-1}>{m.studioHome}</h1>
          <p class="lede">{m.studioHomeIntro}</p>
          <ul class="ruled studio-home">
            {pages.map((p) => (
              <li key={p.slug}>
                <a href={`/studio/${p.slug}`}>{titles[p.slug]}</a>
                <p class="muted">{m.studioPageHints[p.slug]}</p>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <h1 tabIndex={-1}>{page.slug === 'packing' ? m.packToday : page.slug === 'finance' ? m.finance : page.slug === 'batches' ? m.batchBoard : titles[page.slug]}</h1>
          <Live name={m.studioUpdates} text={message} class="result-line ruled-result" />
          {allowed ? body[page.slug]?.() : <p class="lede">{m.roleDenied}</p>}
        </>
      )}
      {!page && <Live name={m.studioUpdates} text={message} class="result-line" />}
    </div>
  );
}

function TableBox({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="table-box" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

function usePoll(load: () => Promise<void>, every: number | null) {
  useEffect(() => {
    void load();
    if (every === null) return undefined;
    const id = setInterval(() => void load(), every);
    return () => clearInterval(id);
  }, []);
}

type BatchDialog = { kind: 'cut' | 'schedule' | 'withdraw'; code: string } | null;

function BatchBoard({ announce }: { announce: Announce }) {
  const { m, l } = useCopy();
  const [batches, setBatches] = useState<StaffBatch[] | null>(null);
  const [form, setForm] = useState({ scent: DROP_SCENTS[0]?.slug ?? '', poured_on: '', cure_days: '28' });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [dialog, setDialog] = useState<BatchDialog>(null);
  const [dialogValue, setDialogValue] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [cutoff, setCutoff] = useState('');
  const [cutoffError, setCutoffError] = useState('');
  const openers = useRef(new Map<string, HTMLButtonElement>());
  const opener = useRef<HTMLElement | null>(null);
  const [focusHeading, setFocusHeading] = useState(false);
  useEffect(() => {
    if (focusHeading) document.querySelector<HTMLElement>('main h1')?.focus();
    setFocusHeading(false);
  }, [focusHeading]);

  const load = async () => {
    const r = await api<{ batches: StaffBatch[] }>('GET', '/api/staff/batches');
    if (r.ok) setBatches(r.data.batches);
  };
  usePoll(load, 5000);
  useEffect(() => {
    void api<{ packing_cutoff_local: string }>('GET', '/api/staff/settings').then((r) => r.ok && setCutoff(r.data.packing_cutoff_local));
  }, []);

  const logLoaf = async (e: Event) => {
    e.preventDefault();
    setPending('log');
    const r = await api<{ batch: StaffBatch }>('POST', '/api/staff/batches', {
      scent: form.scent,
      poured_on: form.poured_on,
      cure_days: form.cure_days === '' ? null : Number(form.cure_days),
    });
    setPending(null);
    if (r.ok) {
      setFormErrors({});
      announce(m.loafLogged(r.data.batch.code));
      void load();
    } else {
      setFormErrors(r.error.fields ?? {});
      announce(failure(m, r));
    }
  };

  const openDialog = (kind: 'cut' | 'schedule' | 'withdraw', code: string) => {
    opener.current = openers.current.get(`${kind}:${code}`) ?? null;
    setDialogValue('');
    setDialogError('');
    setDialog({ kind, code });
  };

  const closeDialog = () => setDialog(null);

  const run = async (action: 'cut' | 'schedule' | 'open' | 'withdraw', code: string, body: unknown) => {
    setPending(`${action}:${code}`);
    const r = await api<{ batch: StaffBatch }>('POST', `/api/staff/batches/${code}/${action}`, body);
    setPending(null);
    if (!r.ok) {
      const text = failure(m, r);
      if (dialog) setDialogError(text);
      announce(text);
      return;
    }
    const b = r.data.batch;
    const messages = {
      cut: () => m.cutSaved(code, b.bars_cut),
      schedule: () => m.dropScheduled(code, b.drop_at ? dropTime(new Date(b.drop_at), l) : ''),
      open: () => m.openedNow(code),
      withdraw: () => m.withdrawn(code),
    };
    announce(messages[action]());
    if (dialog) {
      setDialog(null);
      setFocusHeading(true);
    }
    void load();
  };

  const saveCutoff = async (e: Event) => {
    e.preventDefault();
    setPending('cutoff');
    const r = await api<{ packing_cutoff_local: string }>('PUT', '/api/staff/settings', { packing_cutoff_local: cutoff });
    setPending(null);
    if (r.ok) {
      setCutoffError('');
      announce(m.cutoffSaved(r.data.packing_cutoff_local));
    } else {
      setCutoffError(failure(m, r));
      announce(failure(m, r));
    }
  };

  const busy = (key: string) => (pending === key ? { 'aria-busy': 'true' as const, 'aria-disabled': 'true' as const } : {});
  const ref = (key: string) => (el: HTMLButtonElement | null) => {
    if (el) openers.current.set(key, el);
    else openers.current.delete(key);
  };

  if (batches === null) return <p class="loading">{m.loading}</p>;
  return (
    <>
      <section aria-label={m.logLoaf} class="ruled">
        <h2>{m.logLoaf}</h2>
        <form class="inline-form" onSubmit={logLoaf} noValidate>
          <div class="field">
            <label for="f-scent">{m.scent}</label>
            <select id="f-scent" value={form.scent} onChange={(e) => setForm({ ...form, scent: (e.target as HTMLSelectElement).value })}>
              {DROP_SCENTS.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {pick(s.name, l)}
                </option>
              ))}
            </select>
          </div>
          <Field
            id="f-poured"
            label={m.pourDate}
            type="date"
            value={form.poured_on}
            onInput={(e) => setForm({ ...form, poured_on: (e.target as HTMLInputElement).value })}
            error={formErrors.poured_on}
          />
          <Field
            id="f-cure"
            label={m.cureDays}
            type="number"
            min={28}
            max={60}
            value={form.cure_days}
            onInput={(e) => setForm({ ...form, cure_days: (e.target as HTMLInputElement).value })}
            error={formErrors.cure_days}
          />
          <button type="submit" class="button primary" {...busy('log')}>
            {pending === 'log' ? m.saving : m.logLoafButton}
          </button>
        </form>
      </section>
      <TableBox label={m.batches}>
        <table aria-label={m.batches} class="ledger">
          <thead>
            <tr>
              <th scope="col">{m.colCode}</th>
              <th scope="col">{m.colScent}</th>
              <th scope="col">{m.colState}</th>
              <th scope="col">{m.colPoured}</th>
              <th scope="col">{m.colCure}</th>
              <th scope="col">{m.colDrop}</th>
              <th scope="col" class="num">{m.colCut}</th>
              <th scope="col" class="num">{m.colAvailable}</th>
              <th scope="col" class="num">{m.colHeld}</th>
              <th scope="col" class="num">{m.colSold}</th>
              <th scope="col">{m.colBars}</th>
              <th scope="col">{m.colActions}</th>
            </tr>
          </thead>
          <tbody>
            {(batches ?? []).map((b) => (
              <tr key={b.code}>
                <th scope="row">{b.code}</th>
                <td>{pick(dropScent(b.scent)?.name ?? { en: b.scent, fr: b.scent }, l)}</td>
                <td>{pick(BATCH_STATE_LABELS[b.state], l)}</td>
                <td class="num nowrap">{b.poured_on}</td>
                <td class="num nowrap">{b.cure_date}</td>
                <td>{b.drop_at ? dropTime(new Date(b.drop_at), l) : '—'}</td>
                <td class="num">{b.bars_cut}</td>
                <td class="num">{b.available}</td>
                <td class="num">{b.held}</td>
                <td class="num">{b.sold}</td>
                <td>
                  <ul aria-label={m.barsOf(b.code)} class="bar-marks">
                    {b.bars.map((bar) => (
                      <BarItem key={bar.number} k={bar.number} status={bar.status} />
                    ))}
                  </ul>
                </td>
                <td>
                  <div class="row-actions">
                    {b.state === 'poured' && (
                      <button type="button" class="button secondary small" ref={ref(`cut:${b.code}`)} onClick={() => openDialog('cut', b.code)}>
                        {m.cutButton(b.code)}
                      </button>
                    )}
                    {(b.state === 'curing' || b.state === 'scheduled') && (
                      <>
                        <button type="button" class="button secondary small" ref={ref(`schedule:${b.code}`)} onClick={() => openDialog('schedule', b.code)}>
                          {m.scheduleButton(b.code)}
                        </button>
                        <button type="button" class="button primary small" {...busy(`open:${b.code}`)} onClick={() => void run('open', b.code, {})}>
                          {pending === `open:${b.code}` ? m.saving : m.openNow(b.code)}
                        </button>
                      </>
                    )}
                    {b.state !== 'sold_out' && b.state !== 'withdrawn' && (
                      <button type="button" class="button secondary small danger" ref={ref(`withdraw:${b.code}`)} onClick={() => openDialog('withdraw', b.code)}>
                        {m.withdrawButton(b.code)}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableBox>
      <form class="ruled inline-form" onSubmit={saveCutoff} noValidate>
        <Field id="f-cutoff" label={m.cutoffField} type="time" value={cutoff} onInput={(e) => setCutoff((e.target as HTMLInputElement).value)} error={cutoffError} />
        <button type="submit" class="button secondary" {...busy('cutoff')}>
          {pending === 'cutoff' ? m.saving : m.saveCutoff}
        </button>
      </form>
      <Dialog
        title={dialog ? (dialog.kind === 'cut' ? m.cutButton(dialog.code) : dialog.kind === 'schedule' ? m.scheduleButton(dialog.code) : m.withdrawQ(dialog.code)) : ''}
        open={dialog !== null}
        opener={opener}
        onClose={closeDialog}
      >
        {dialog?.kind === 'cut' && (
          <form
            class="stack"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void run('cut', dialog.code, { bars: dialogValue === '' ? null : Number(dialogValue) });
            }}
          >
            <Field id="f-bars" label={m.barsCutField} type="number" min={1} max={24} value={dialogValue} onInput={(e) => setDialogValue((e.target as HTMLInputElement).value)} error={dialogError} />
            <div class="actions">
              <button type="submit" class="button primary" {...busy(`cut:${dialog.code}`)}>
                {pending === `cut:${dialog.code}` ? m.saving : m.saveCut}
              </button>
              <button type="button" class="button secondary" onClick={() => { closeDialog(); opener.current?.focus(); }}>
                {m.close}
              </button>
            </div>
          </form>
        )}
        {dialog?.kind === 'schedule' && (
          <form
            class="stack"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void run('schedule', dialog.code, { drop_at_local: dialogValue });
            }}
          >
            <Field id="f-drop" label={m.dropLocal} type="datetime-local" value={dialogValue} onInput={(e) => setDialogValue((e.target as HTMLInputElement).value)} error={dialogError} />
            <div class="actions">
              <button type="submit" class="button primary" {...busy(`schedule:${dialog.code}`)}>
                {pending === `schedule:${dialog.code}` ? m.saving : m.saveDrop}
              </button>
              <button type="button" class="button secondary" onClick={() => { closeDialog(); opener.current?.focus(); }}>
                {m.close}
              </button>
            </div>
          </form>
        )}
        {dialog?.kind === 'withdraw' && (
          <>
            <p>{m.withdrawBody}</p>
            {dialogError && <p class="field-error">{dialogError}</p>}
            <div class="actions">
              <button type="button" class="button primary" {...busy(`withdraw:${dialog.code}`)} onClick={() => void run('withdraw', dialog.code, {})}>
                {pending === `withdraw:${dialog.code}` ? m.saving : m.yesWithdraw}
              </button>
              <button type="button" class="button secondary" onClick={() => { closeDialog(); opener.current?.focus(); }}>
                {m.keepIt}
              </button>
            </div>
          </>
        )}
      </Dialog>
    </>
  );
}

function Packing({ announce }: { announce: Announce }) {
  const { m, l } = useCopy();
  const [orders, setOrders] = useState<PackingOrder[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const load = async () => {
    const r = await api<{ orders: PackingOrder[] }>('GET', '/api/staff/packing');
    if (r.ok) setOrders(r.data.orders);
  };
  usePoll(load, null);
  const ship = async (number: string) => {
    setPending(number);
    const r = await api('POST', `/api/staff/orders/${number}/ship`, {});
    setPending(null);
    announce(r.ok ? m.shipped(number) : failure(m, r));
    void load();
  };
  if (orders === null) return <p class="loading">{m.loading}</p>;
  if (orders.length === 0) return <EmptyState>{m.nothingToPack}</EmptyState>;
  return (
    <TableBox label={m.ordersToPack}>
      <table aria-label={m.ordersToPack} class="ledger">
        <thead>
          <tr>
            <th scope="col">{m.colOrder}</th>
            <th scope="col">{m.colShipOn}</th>
            <th scope="col">{m.colName}</th>
            <th scope="col">{m.colAddress}</th>
            <th scope="col">{m.colBars}</th>
            <th scope="col">{m.colActions}</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.number}>
              <th scope="row">{o.number}</th>
              <td class="num">{longDate(o.ship_on, l)}</td>
              <td>{o.name}</td>
              <td>
                {o.address.line1}, {o.address.city} {o.address.province} {o.address.postal_code}
              </td>
              <td>
                <ul class="plain">
                  {o.bars.map((b) => (
                    <li key={`${b.batch}-${b.bar}`}>{m.heldRow(b.bar, pick(dropScent(b.scent)?.name ?? { en: b.scent, fr: b.scent }, l), b.batch)}</li>
                  ))}
                </ul>
              </td>
              <td>
                <button
                  type="button"
                  class="button primary small"
                  aria-busy={pending === o.number ? 'true' : undefined}
                  aria-disabled={pending === o.number ? 'true' : undefined}
                  onClick={() => void ship(o.number)}
                >
                  {pending === o.number ? m.saving : m.markShipped(o.number)}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableBox>
  );
}

/** Dollars typed as "25" or "25.00" to integer cents, read digit by digit; null when not a valid amount. */
function centsFromInput(text: string): number | null {
  const match = /^\s*\$?\s*(\d{1,4})(?:[.,](\d{1,2}))?\s*\$?\s*$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '0').padEnd(2, '0'));
}

type Record_ = { kind: 'order'; data: StaffOrder; version: number } | { kind: 'subscription'; data: StaffSubscription; version: number };

function Finance({ announce }: { announce: Announce }) {
  const { m, l } = useCopy();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ orders: { number: string }[]; subscriptions: { number: string }[] } | null>(null);
  const [record, setRecord] = useState<Record_ | null>(null);
  const [qError, setQError] = useState('');
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [restock, setRestock] = useState(false);
  const [reason, setReason] = useState('');
  const [credit, setCredit] = useState({ amount: '', reason: '' });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [creditFields, setCreditFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<'refund' | 'credit' | null>(null);

  const open = async (number: string) => {
    const kind = number.startsWith('PDL-') ? 'order' : 'subscription';
    const r = await api<StaffOrder & StaffSubscription>('GET', `/api/staff/${kind === 'order' ? 'orders' : 'subscriptions'}/${number}`);
    if (!r.ok) {
      announce(failure(m, r));
      return;
    }
    setRecord(kind === 'order' ? { kind, data: r.data, version: r.data.version } : { kind, data: r.data, version: r.data.version });
    setChosen(new Set());
    setFields({});
    setCreditFields({});
  };

  const search = async (e: Event) => {
    e.preventDefault();
    const r = await api<{ orders: { number: string }[]; subscriptions: { number: string }[] }>('GET', `/api/staff/search?q=${encodeURIComponent(q)}`);
    if (!r.ok) {
      setQError(failure(m, r));
      return;
    }
    setQError('');
    const all = [...r.data.orders, ...r.data.subscriptions];
    if (all.length === 1 && all[0]) {
      setResults(null);
      await open(all[0].number);
    } else {
      setRecord(null);
      setResults(r.data);
    }
  };

  const refund = async () => {
    if (!record || record.kind !== 'order' || pending) return;
    setPending('refund');
    const order = record.data;
    const bars = order.lines.filter((line) => chosen.has(line.bar)).map((line) => ({ batch: line.batch, bar: line.bar }));
    const r = await api<{ refund: { number: string; amount: { cents: number } } }>(
      'POST',
      `/api/staff/orders/${order.number}/refunds`,
      { bars, restock, reason },
      { 'Idempotency-Key': newKey(), ...etagHeader(record.version) },
    );
    setPending(null);
    if (r.ok) {
      setFields({});
      setReason('');
      announce(m.refundIssued(r.data.refund.number, formatMoney(r.data.refund.amount.cents, l)));
    } else {
      setFields(r.status === 422 ? (r.error.fields ?? {}) : {});
      announce(failure(m, r));
    }
    if (r.ok || r.status === 503) await open(order.number);
  };

  const addCredit = async () => {
    if (!record || pending) return;
    setPending('credit');
    const r = await api<{ credit: { number: string; amount: { cents: number } } }>(
      'POST',
      '/api/staff/credits',
      { target: record.data.number, amount_cents: centsFromInput(credit.amount), reason: credit.reason },
      { 'Idempotency-Key': newKey(), ...etagHeader(record.version) },
    );
    setPending(null);
    if (r.ok) {
      setCreditFields({});
      setCredit({ amount: '', reason: '' });
      announce(m.creditAdded(r.data.credit.number, formatMoney(r.data.credit.amount.cents, l)));
    } else {
      setCreditFields(r.status === 422 ? (r.error.fields ?? {}) : {});
      announce(failure(m, r));
    }
    if (r.ok || r.status === 503) await open(record.data.number);
  };

  const credits = record?.data.credits ?? [];
  return (
    <>
      <form class="ruled inline-form" role="search" onSubmit={search} noValidate>
        <Field id="f-q" label={m.findLabel} type="search" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} error={qError} />
        <button type="submit" class="button primary">
          {m.find}
        </button>
      </form>
      {!results && !record && <EmptyState>{m.financeIdle}</EmptyState>}
      {results && (
        <section class="ruled" aria-labelledby="results-title">
          <h2 id="results-title">{m.results}</h2>
          {results.orders.length + results.subscriptions.length === 0 ? (
            <EmptyState>{m.noResults}</EmptyState>
          ) : (
            <ul class="record-list">
              {[...results.orders, ...results.subscriptions].map((x) => (
                <li key={x.number}>
                  <button type="button" class="button secondary small" onClick={() => void open(x.number)}>
                    {x.number}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {record?.kind === 'order' && (
        <section class="ruled record" aria-labelledby="record-title">
          <h2 id="record-title">{m.orderHeading(record.data.number)}</h2>
          <p class="muted">
            {record.data.email} · {m.orderStatus[record.data.status]} · {m.fulfilment[record.data.fulfilment]}
          </p>
          <PriceRows rows={[[m.subtotal, record.data.subtotal], [m.shipping, record.data.shipping_fee]]} taxes={record.data.taxes} total={[m.total, record.data.total]} />
          <fieldset class="group">
            <legend>{m.lines}</legend>
            {record.data.lines.map((line) =>
              line.refunded ? (
                <p key={line.bar} class="muted">
                  {m.heldRow(line.bar, pick(dropScent(line.scent)?.name ?? { en: line.scent, fr: line.scent }, l), line.batch)} · {m.refundedWord}
                </p>
              ) : (
                <label key={line.bar} class="check">
                  <input
                    type="checkbox"
                    checked={chosen.has(line.bar)}
                    onChange={(e) => {
                      const next = new Set(chosen);
                      if ((e.target as HTMLInputElement).checked) next.add(line.bar);
                      else next.delete(line.bar);
                      setChosen(next);
                    }}
                  />
                  <span>{m.refundBar(line.bar)}</span>
                  <span class="muted">
                    {line.batch} · {formatMoney(line.unit_price.cents, l)}
                  </span>
                </label>
              ),
            )}
            {fields.bars && <p class="field-error">{fields.bars}</p>}
            <label class="check">
              <input type="checkbox" checked={restock} onChange={(e) => setRestock((e.target as HTMLInputElement).checked)} />
              <span>{m.restock}</span>
            </label>
            {fields.restock && <p class="field-error">{fields.restock}</p>}
            <Field id="f-refund-reason" label={m.refundReason} value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} error={fields.reason} />
            <div class="actions">
              <button type="button" class="button primary" aria-busy={pending === 'refund' ? 'true' : undefined} aria-disabled={pending === 'refund' ? 'true' : undefined} onClick={() => void refund()}>
                {pending === 'refund' ? m.refunding : m.issueRefund}
              </button>
            </div>
          </fieldset>
          <TableBox label={m.refundsOf(record.data.number)}>
            <table aria-label={m.refundsOf(record.data.number)} class="ledger">
              <thead>
                <tr>
                  <th scope="col">{m.colNumber}</th>
                  <th scope="col">{m.colStatus}</th>
                  <th scope="col">{m.colBars}</th>
                  <th scope="col" class="num">{m.colShipping}</th>
                  {record.data.taxes.map((t) => (
                    <th scope="col" class="num" key={t.code}>
                      {t.code}
                    </th>
                  ))}
                  <th scope="col" class="num">{m.colAmount}</th>
                </tr>
              </thead>
              <tbody>
                {record.data.refunds.length === 0 && (
                  <tr>
                    <td colSpan={5 + record.data.taxes.length}>{m.noRefunds}</td>
                  </tr>
                )}
                {record.data.refunds.map((r) => (
                  <tr key={r.number}>
                    <th scope="row">{r.number}</th>
                    <td>{r.status}</td>
                    <td>{r.bars.map((b) => `${b.batch} #${b.bar}`).join(', ')}</td>
                    <td class="num">{formatMoney(r.allocation.shipping.cents, l)}</td>
                    {r.allocation.taxes.map((t) => (
                      <td class="num" key={t.code}>
                        {formatMoney(t.amount.cents, l)}
                      </td>
                    ))}
                    <td class="num">{formatMoney(r.amount.cents, l)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableBox>
        </section>
      )}
      {record?.kind === 'subscription' && (
        <section class="ruled record" aria-labelledby="record-title">
          <h2 id="record-title">{m.subHeading(record.data.number)}</h2>
          <p class="muted">
            {record.data.email} · {m.stateLabels[record.data.state]} · {pick(coreScent(record.data.scent)?.name ?? { en: '', fr: '' }, l)} ·{' '}
            {pick(CADENCE_LABELS[record.data.cadence], l)}
          </p>
          <PriceRows
            rows={[[m.subtotal, record.data.price.subtotal], [m.discount, record.data.price.discount, true]]}
            taxes={record.data.price.taxes}
            total={[m.total, record.data.price.total]}
          />
        </section>
      )}
      {record && (
        <section class="ruled" aria-labelledby="credits-title">
          <h2 id="credits-title">{m.credits}</h2>
          {credits.length === 0 ? (
            <EmptyState>{m.noCredits}</EmptyState>
          ) : (
            <ul class="record-list">
              {credits.map((c) => (
                <li key={c.number}>
                  <span>{c.number}</span>
                  <span>{c.status}</span>
                  <span class="num">{formatMoney(c.amount.cents, l)}</span>
                  <span class="muted">{c.reason}</span>
                </li>
              ))}
            </ul>
          )}
          <div class="inline-form">
            <Field id="f-credit-amount" label={m.creditAmount} inputMode="decimal" value={credit.amount} onInput={(e) => setCredit({ ...credit, amount: (e.target as HTMLInputElement).value })} error={creditFields.amount_cents} />
            <Field id="f-credit-reason" label={m.creditReason} value={credit.reason} onInput={(e) => setCredit({ ...credit, reason: (e.target as HTMLInputElement).value })} error={creditFields.reason} />
            <button type="button" class="button primary" aria-busy={pending === 'credit' ? 'true' : undefined} aria-disabled={pending === 'credit' ? 'true' : undefined} onClick={() => void addCredit()}>
              {pending === 'credit' ? m.saving : m.addCredit}
            </button>
          </div>
        </section>
      )}
    </>
  );
}

function Reconciliation({ announce }: { announce: Announce }) {
  const { m, l } = useCopy();
  const [month, setMonth] = useState('');
  const [data, setData] = useState<{ month: string; stale: boolean; checked_at: string | null; lines: ReconLine[]; totals: { shop: { cents: number }; killbill: { cents: number } } } | null>(null);
  const [onlyMismatches, setOnlyMismatches] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [monthError, setMonthError] = useState('');

  const load = async (value = month) => {
    const r = await api<NonNullable<typeof data>>('GET', `/api/staff/reconciliation${value ? `?month=${encodeURIComponent(value)}` : ''}`);
    if (r.ok) {
      setMonthError('');
      setData(r.data);
      if (!value) setMonth(r.data.month);
    } else setMonthError(failure(m, r));
  };
  usePoll(() => load(''), null);

  const act = async (kind: 'accept' | 'refund-orphan', line: ReconLine) => {
    setPending(line.key);
    const r = await api<{ line: ReconLine; refund?: { amount: { cents: number } } }>('POST', `/api/staff/reconciliation/${kind}`, { month: data?.month ?? month, key: line.key });
    setPending(null);
    if (r.ok) {
      announce(
        kind === 'accept'
          ? m.figureAccepted(formatMoney(r.data.line.killbill?.cents ?? 0, l), line.key)
          : m.orphanRefunded(line.key, formatMoney(r.data.refund?.amount.cents ?? 0, l)),
      );
    } else announce(failure(m, r));
    void load();
  };

  const staleText = data?.stale ? (data.checked_at ? m.staleWith(dropTime(new Date(data.checked_at), l)) : m.staleNone) : '';
  const lines = (data?.lines ?? []).filter((x) => !onlyMismatches || x.status === 'mismatch');
  const money = (v: { cents: number } | null) => (v ? formatMoney(v.cents, l) : '—');
  return (
    <>
      <div class="ruled inline-form">
        <Field
          id="f-month"
          label={m.month}
          type="month"
          value={month}
          onInput={(e) => {
            const value = (e.target as HTMLInputElement).value;
            setMonth(value);
            if (/^\d{4}-\d{2}$/.test(value)) void load(value);
          }}
          error={monthError}
        />
        <button
          type="button"
          role="switch"
          aria-checked={onlyMismatches ? 'true' : 'false'}
          class="switch"
          onClick={() => setOnlyMismatches(!onlyMismatches)}
        >
          <span class="switch-track" aria-hidden="true">
            <span class="switch-thumb" />
          </span>
          <span>{m.onlyMismatches}</span>
        </button>
      </div>
      <div role="status" aria-label={m.reconStatus} class={`service-status${staleText ? ' is-on' : ''}`}>
        {staleText}
      </div>
      {data && !data.stale && data.checked_at && <p class="muted">{m.checkedAt(dropTime(new Date(data.checked_at), l))}</p>}
      <TableBox label={m.reconLines}>
        <table aria-label={m.reconLines} class="ledger">
          <thead>
            <tr>
              <th scope="col">{m.colKey}</th>
              <th scope="col">{m.colKind}</th>
              <th scope="col" class="num">{m.colShop}</th>
              <th scope="col" class="num">{m.colKillBill}</th>
              <th scope="col">{m.colStatus}</th>
              <th scope="col">{m.colActions}</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={6}>{data ? m.noLines : m.loading}</td>
              </tr>
            )}
            {lines.map((line) => (
              <tr key={line.key}>
                <th scope="row" class="key">{line.key}</th>
                <td>{line.kind}</td>
                <td class="num">{money(line.shop)}</td>
                <td class="num">{money(line.killbill)}</td>
                <td>{line.status}</td>
                <td>
                  {line.status === 'mismatch' && (
                    <button type="button" class="button primary small" aria-busy={pending === line.key ? 'true' : undefined} onClick={() => void act('accept', line)}>
                      {pending === line.key ? m.saving : m.acceptFor(line.key)}
                    </button>
                  )}
                  {line.status === 'kb_only' && (
                    <button type="button" class="button primary small" aria-busy={pending === line.key ? 'true' : undefined} onClick={() => void act('refund-orphan', line)}>
                      {pending === line.key ? m.saving : m.refundOrphan(line.key)}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {data && (
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>
                  {m.totals}
                </th>
                <td class="num">{money(data.totals.shop)}</td>
                <td class="num">{money(data.totals.killbill)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </TableBox>
    </>
  );
}

function Audit() {
  const { m, l } = useCopy();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  usePoll(async () => {
    const r = await api<{ entries: AuditEntry[] }>('GET', '/api/staff/audit');
    if (r.ok) setEntries(r.data.entries);
  }, null);
  if (entries === null) return <p class="loading">{m.loading}</p>;
  return (
    <TableBox label={m.financeAudit}>
      <table aria-label={m.financeAudit} class="ledger">
        <thead>
          <tr>
            <th scope="col">{m.colAt}</th>
            <th scope="col">{m.colActor}</th>
            <th scope="col">{m.colAction}</th>
            <th scope="col">{m.colTarget}</th>
            <th scope="col">{m.colReason}</th>
            <th scope="col" class="num">{m.colAmount}</th>
            <th scope="col">{m.colRef}</th>
            <th scope="col">{m.colOutcome}</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 && (
            <tr>
              <td colSpan={8}>{m.noAudit}</td>
            </tr>
          )}
          {entries.map((e) => (
            <tr key={e.id}>
              <td class="num">{dropTime(new Date(e.at), l)}</td>
              <td>
                {e.actor} ({m.roles[e.role as keyof Messages['roles']] ?? e.role})
              </td>
              <td>{e.action}</td>
              <td class="key">{e.target}</td>
              <td>{e.reason}</td>
              <td class="num">{formatMoney(e.amount.cents, l)}</td>
              <td class="key">{e.killbill_ref ?? '—'}</td>
              <td>{e.outcome}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableBox>
  );
}

function Notices({ announce }: { announce: Announce }) {
  const { m, l } = useCopy();
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const load = async () => {
    const r = await api<{ notices: Notice[] }>('GET', '/api/staff/notices');
    if (r.ok) setNotices(r.data.notices);
  };
  usePoll(load, null);
  const resend = async (number: string) => {
    setPending(number);
    const r = await api('POST', `/api/staff/notices/${number}/resend`, {});
    setPending(null);
    announce(r.ok ? m.noticeResent(number) : failure(m, r));
    void load();
  };
  if (notices === null) return <p class="loading">{m.loading}</p>;
  return (
    <TableBox label={m.notices}>
      <table aria-label={m.notices} class="ledger">
        <thead>
          <tr>
            <th scope="col">{m.colNumber}</th>
            <th scope="col">{m.colTo}</th>
            <th scope="col">{m.colSubject}</th>
            <th scope="col">{m.colStatus}</th>
            <th scope="col">{m.colAttempts}</th>
            <th scope="col">{m.colActions}</th>
          </tr>
        </thead>
        <tbody>
          {notices.length === 0 && (
            <tr>
              <td colSpan={6}>{m.noNotices}</td>
            </tr>
          )}
          {notices.map((n) => (
            <tr key={n.number}>
              <th scope="row">{n.number}</th>
              <td>{n.to}</td>
              <td>{n.subject}</td>
              <td>{n.status}</td>
              <td>
                <ul class="plain">
                  {n.attempts.map((a) => (
                    <li key={a.at} class="num">
                      {dropTime(new Date(a.at), l)} · {a.outcome === 'failed' ? `failed · ${m.mailUnreachable}` : a.outcome}
                    </li>
                  ))}
                </ul>
              </td>
              <td>
                {n.status === 'failed' && (
                  <button type="button" class="button primary small" aria-busy={pending === n.number ? 'true' : undefined} onClick={() => void resend(n.number)}>
                    {pending === n.number ? m.saving : m.resend(n.number)}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableBox>
  );
}
