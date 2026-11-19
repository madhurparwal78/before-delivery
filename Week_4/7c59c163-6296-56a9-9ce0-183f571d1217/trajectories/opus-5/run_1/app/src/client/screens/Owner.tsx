import { useEffect, useRef, useState } from 'react';
import { BILLING_STATE_BADGE, COPY, PLAN_LABELS } from '../copy.js';
import { RequestFailed, get, post, put } from '../api.js';
import { formatAmount, formatInteger, monthLabel } from '../format.js';
import { Shell } from '../components/Shell.js';
import { Dialog } from '../components/Dialog.js';
import { Banner } from '../components/Banner.js';
import type { BillingState, MemberSummary, Me, Plan, Role, VenueTotals } from '../api.js';

interface BuilderBilling {
  member_id: string;
  display_name: string;
  plan: Plan;
  effective_plan: Plan;
  state: BillingState;
}

const INVITE_ROLES: { role: Role; label: string }[] = [
  { role: 'trader', label: 'Trader' },
  { role: 'builder', label: 'Builder' },
  { role: 'market_admin', label: 'Market admin' },
];

/** The months that have ended in the venue's time zone, newest first. */
function endedMonths(timeZone: string, count: number): string[] {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' })
    .format(new Date())
    .split('-');
  const year = Number.parseInt(parts[0] as string, 10);
  const month = Number.parseInt(parts[1] as string, 10);
  const months: string[] = [];
  for (let back = 1; back <= count; back += 1) {
    const date = new Date(Date.UTC(year, month - 1 - back, 1));
    months.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

export function OwnerScreen(props: { me: Me }): React.JSX.Element {
  const [totals, setTotals] = useState<VenueTotals | null>(null);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<MemberSummary[]>([]);
  const [activeMatch, setActiveMatch] = useState(0);
  const [picked, setPicked] = useState<MemberSummary | null>(null);
  const [taker, setTaker] = useState('0');
  const [maker, setMaker] = useState('0');
  const months = endedMonths(props.me.venue?.time_zone ?? 'UTC', 12);
  const [month, setMonth] = useState(months[0] as string);
  const [status, setStatus] = useState('');
  const [identityDown, setIdentityDown] = useState(false);
  const [statementsDown, setStatementsDown] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [builders, setBuilders] = useState<BuilderBilling[]>([]);

  useEffect(() => {
    void get<VenueTotals>('/api/venue/totals').then(setTotals).catch(() => undefined);
    void get<{ builders: BuilderBilling[] }>('/api/venue/billing')
      .then((value) => setBuilders(value.builders))
      .catch(() => undefined);
    void get<{ markets: { taker_fee_bps: number; maker_fee_bps: number }[] }>('/api/markets')
      .then((value) => {
        const first = value.markets[0];
        if (first === undefined) return;
        setTaker(String(first.taker_fee_bps));
        setMaker(String(first.maker_fee_bps));
      })
      .catch(() => undefined);
  }, []);

  /** Typing updates the listbox after each keystroke, with no submit. */
  useEffect(() => {
    if (query.length === 0) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    void get<{ members: MemberSummary[] }>(`/api/venue/members?q=${encodeURIComponent(query)}`)
      .then((value) => {
        if (!cancelled) {
          setMatches(value.members);
          setActiveMatch(0);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [query]);

  const saveFees = async (): Promise<void> => {
    setStatus(COPY.feesPending);
    try {
      await put('/api/venue/fees', {
        taker_fee_bps: Math.round(Number(taker)),
        maker_fee_bps: Math.round(Number(maker)),
      });
      setStatus(COPY.feesSaved);
    } catch (error) {
      if (error instanceof RequestFailed && error.code === 'validation') {
        setStatus(COPY.feesError);
        return;
      }
      throw error;
    }
  };

  const generate = async (): Promise<void> => {
    setStatus(COPY.generatingPending);
    try {
      await post('/api/venue/statements', { month });
      setStatementsDown(false);
      setStatus(COPY.statementsGenerating(month));
    } catch (error) {
      if (!(error instanceof RequestFailed)) throw error;
      if (error.code === 'statements_unavailable') {
        setStatementsDown(true);
        setStatus('');
        return;
      }
      setStatus(COPY.monthNotClosed);
    }
  };

  const onPickerKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (matches.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveMatch((current) => Math.min(current + 1, matches.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveMatch((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      setPicked(matches[activeMatch] ?? null);
    }
  };

  return (
    <Shell me={props.me} path="/owner" field="slate" stickers={['envelope']}>
      <h1>Venue</h1>
      {identityDown ? <Banner>{COPY.identityUnavailable}</Banner> : null}
      {statementsDown ? <Banner>{COPY.statementsUnavailable}</Banner> : null}

      <section className="card" role="region" aria-label="Venue totals">
        <h2>Venue totals</h2>
        <div className="grid grid--three">
          {[
            { label: 'Members', value: formatInteger(totals?.members ?? 0) },
            { label: 'Open orders', value: formatInteger(totals?.open_orders ?? 0) },
            { label: 'Deposits', value: formatAmount(totals?.deposits_cents ?? 0) },
            { label: 'Refunds', value: formatAmount(totals?.refunds_cents ?? 0) },
            { label: 'Fees', value: formatAmount(totals?.fees_cents ?? 0) },
            { label: 'Volume today', value: formatAmount(totals?.volume_cents_today ?? 0) },
            {
              label: 'Open interest',
              value: formatInteger(totals?.open_interest_contracts ?? 0),
            },
          ].map((item) => (
            <div key={item.label}>
              <span className="label">{item.label}</span>
              <span className="numeral">{item.value}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card combo">
        <h2>Members</h2>
        <label htmlFor="find-member">Find member</label>
        <input
          id="find-member"
          type="text"
          role="combobox"
          aria-expanded={matches.length > 0}
          aria-controls="member-options"
          aria-autocomplete="list"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onPickerKeyDown}
        />
        <ul id="member-options" role="listbox" aria-label="Find member">
          {matches.map((member, index) => (
            <li
              key={member.id}
              role="option"
              aria-selected={index === activeMatch}
              onClick={() => setPicked(member)}
            >
              {member.display_name} — {member.email}
            </li>
          ))}
        </ul>
        {picked !== null ? (
          <p className="label">
            {picked.display_name}: {picked.roles.join(', ')}
          </p>
        ) : null}
        <button type="button" className="pill" onClick={() => setInviting(true)}>
          Invite member
        </button>
      </section>

      <section className="card">
        <h2>Fee schedule</h2>
        <div className="form-inline">
          <div>
            <label htmlFor="taker-fee">Taker fee (bps)</label>
            <input
              id="taker-fee"
              type="number"
              step={1}
              value={taker}
              onChange={(event) => setTaker(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="maker-fee">Maker fee (bps)</label>
            <input
              id="maker-fee"
              type="number"
              step={1}
              value={maker}
              onChange={(event) => setMaker(event.target.value)}
            />
          </div>
          <button type="button" className="pill" onClick={() => void saveFees()}>
            Save fees
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Exports and statements</h2>
        <div className="form-inline">
          <div>
            <label htmlFor="export-month">Export month</label>
            <select
              id="export-month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            >
              {months.map((option) => (
                <option key={option} value={option}>
                  {monthLabel(option)}
                </option>
              ))}
            </select>
          </div>
          <a className="pill" href={`/api/venue/fills.csv?month=${month}`} download>
            Export fills (CSV)
          </a>
          <button type="button" className="pill" onClick={() => void generate()}>
            Generate statements
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Builder billing</h2>
        <div className="table-scroll">
          <table aria-label="Builder billing">
            <thead>
              <tr>
                <th scope="col">Builder</th>
                <th scope="col">Plan</th>
                <th scope="col">Effective plan</th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {builders.map((builder) => (
                <tr key={builder.member_id}>
                  <td>{builder.display_name}</td>
                  <td>{PLAN_LABELS[builder.plan]}</td>
                  <td>{PLAN_LABELS[builder.effective_plan]}</td>
                  <td>{BILLING_STATE_BADGE[builder.state]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <span className="status" role="status" aria-live="polite" aria-label="Venue updates">
        {status}
      </span>

      {inviting ? (
        <InviteDialog
          onClose={() => setInviting(false)}
          onStatus={setStatus}
          onIdentityDown={setIdentityDown}
          onDone={() => {
            setInviting(false);
            void get<VenueTotals>('/api/venue/totals').then(setTotals).catch(() => undefined);
          }}
        />
      ) : null}
    </Shell>
  );
}

function InviteDialog(props: {
  onClose: () => void;
  onStatus: (text: string) => void;
  onIdentityDown: (down: boolean) => void;
  onDone: () => void;
}): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [roles, setRoles] = useState<Role[]>(['trader']);
  const [message, setMessage] = useState('');
  const emailRef = useRef<HTMLInputElement | null>(null);

  const toggle = (role: Role): void =>
    setRoles((current) =>
      current.includes(role) ? current.filter((item) => item !== role) : [...current, role],
    );

  const send = async (): Promise<void> => {
    props.onStatus(COPY.invitePending);
    setMessage('');
    try {
      await post('/api/venue/invites', { email, display_name: displayName, roles });
      props.onIdentityDown(false);
      props.onStatus(COPY.inviteSent(email));
      props.onDone();
    } catch (error) {
      if (!(error instanceof RequestFailed)) throw error;
      props.onStatus('');
      if (error.code === 'already_member') setMessage(COPY.inviteDuplicate);
      else if (error.code === 'identity_unavailable') {
        props.onIdentityDown(true);
        props.onClose();
      } else if (error.fields.roles !== undefined) setMessage(COPY.inviteRolesError);
      else setMessage(COPY.inviteEmailError);
    }
  };

  return (
    <Dialog label="Invite member" initialFocus={emailRef} onClose={props.onClose}>
      <h2>Invite member</h2>
      <div className="form-row">
        <label htmlFor="invite-email">Email</label>
        <input
          id="invite-email"
          ref={emailRef}
          type="text"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="form-row">
        <label htmlFor="invite-name">Display name</label>
        <input
          id="invite-name"
          type="text"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </div>
      <fieldset>
        <legend>Roles</legend>
        <div className="check-row">
          {INVITE_ROLES.map((item) => (
            <label key={item.role}>
              <input
                type="checkbox"
                checked={roles.includes(item.role)}
                onChange={() => toggle(item.role)}
              />
              {item.label}
            </label>
          ))}
        </div>
      </fieldset>
      {message !== '' ? <p className="banner">{message}</p> : null}
      <div className="dialog__actions">
        <button type="button" className="pill" onClick={() => void send()}>
          Send invite
        </button>
        <button type="button" className="pill pill--quiet" onClick={props.onClose}>
          Back
        </button>
      </div>
    </Dialog>
  );
}
