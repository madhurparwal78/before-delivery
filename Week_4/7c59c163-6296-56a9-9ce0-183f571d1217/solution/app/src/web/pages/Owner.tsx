import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { feeBpsValid, money, monthLabel, PLAN_LABEL, type Plan, type PlanState, type Role } from "../../shared/rules";
import { api, ApiError, type Market } from "../api";
import { Dialog } from "../components/Dialog";
import { Shell } from "../components/Shell";
import { Banner, Skeleton, Status, TableScroll } from "../components/ui";
import { COPY } from "../copy";
import { useMe } from "../session";

interface Totals {
  members: number;
  open_orders: number;
  deposits_cents: number;
  refunds_cents: number;
  fees_cents: number;
  volume_cents_today: number;
  open_interest_contracts: number;
}

interface MemberHit {
  id: string;
  display_name: string;
  email: string;
  roles: Role[];
}

const ROLE_LABEL: Record<Role, string> = { trader: "Trader", builder: "Builder", market_admin: "Market admin", org_owner: "Org owner", founder_operator: "Founder operator" };
const STATE_TEXT: Record<PlanState, string> = { active: "Active", payment_failed: "Payment failed", downgraded: "Downgraded" };

/** The last 13 months of the venue, newest first, from the server's view of "now". */
function recentMonths(now: string, timeZone: string): string[] {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(new Date(now));
  let year = Number(parts.find((p) => p.type === "year")?.value);
  let month = Number(parts.find((p) => p.type === "month")?.value);
  const out: string[] = [];
  for (let i = 0; i < 13; i++) {
    out.push(`${year}-${String(month).padStart(2, "0")}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return out;
}

function MemberPicker() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<MemberHit[]>([]);
  const [active, setActive] = useState(-1);
  const [picked, setPicked] = useState<MemberHit | null>(null);
  const latest = useRef("");
  const search = (value: string) => {
    setQuery(value);
    setActive(-1);
    latest.current = value;
    if (value.trim() === "") {
      setHits([]);
      return;
    }
    api<{ members: MemberHit[] }>(`/api/venue/members?q=${encodeURIComponent(value.slice(0, 60))}`)
      .then((r) => latest.current === value && setHits(r.members))
      .catch(() => setHits([]));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && hits.length > 0) {
      event.preventDefault();
      setActive((i) => Math.min(hits.length - 1, i + 1));
    } else if (event.key === "ArrowUp" && hits.length > 0) {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      setPicked(hits[active] ?? null);
      setHits([]);
    } else if (event.key === "Escape") setHits([]);
  };
  return (
    <section className="card picker" aria-labelledby="picker-title">
      <h2 className="card-title" id="picker-title">Members</h2>
      <label htmlFor="member-picker">Find member</label>
      <div className="combo">
        <input
          id="member-picker"
          type="text"
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls="member-options"
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `member-option-${active}` : undefined}
          value={query}
          onChange={(e) => search(e.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
        />
        <ul id="member-options" role="listbox" aria-label="Members found" className="combo-list" hidden={hits.length === 0}>
          {hits.map((hit, i) => (
            <li
              key={hit.id}
              id={`member-option-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "is-active" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                setPicked(hit);
                setHits([]);
              }}
            >
              {hit.display_name} — {hit.email}
            </li>
          ))}
        </ul>
      </div>
      {picked && (
        <p className="picked">
          <strong>{picked.display_name}</strong> · {picked.roles.map((r) => ROLE_LABEL[r]).join(", ")}
        </p>
      )}
    </section>
  );
}

export function OwnerPage() {
  const me = useMe();
  const zone = me.venue?.time_zone ?? "UTC";
  const [totals, setTotals] = useState<Totals | null>(null);
  const [builders, setBuilders] = useState<{ member_id: string; display_name: string; plan: Plan; effective_plan: Plan; state: PlanState }[] | null>(null);
  const [months, setMonths] = useState<string[]>([]);
  const [month, setMonth] = useState("");
  const [taker, setTaker] = useState("");
  const [maker, setMaker] = useState("");
  const [status, setStatus] = useState("");
  const [banner, setBanner] = useState("");
  const [inviting, setInviting] = useState(false);
  const [invite, setInvite] = useState({ email: "", name: "", roles: [] as Role[] });
  const [inviteError, setInviteError] = useState("");
  const emailInput = useRef<HTMLInputElement>(null);

  const loadTotals = () => api<Totals>("/api/venue/totals").then(setTotals).catch(() => undefined);
  useEffect(() => {
    void loadTotals();
    api<{ builders: NonNullable<typeof builders> }>("/api/venue/billing").then((r) => setBuilders(r.builders)).catch(() => setBuilders([]));
    api<{ markets: Market[] }>("/api/markets")
      .then((r) => {
        const first = r.markets[0];
        if (first) {
          setTaker(String(first.taker_fee_bps));
          setMaker(String(first.maker_fee_bps));
        }
      })
      .catch(() => undefined);
    // The month list follows the server's clock (its Date header), never the device's.
    fetch("/api/health").then((response) => {
      const list = recentMonths(new Date(response.headers.get("date") ?? Date.now()).toISOString(), zone);
      setMonths(list);
      setMonth(list[0] ?? "");
    }, () => undefined);
  }, []);

  const sendInvite = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invite.email.trim())) {
      setInviteError(COPY.invite.email);
      setStatus(COPY.invite.email);
      return;
    }
    if (invite.roles.length === 0) {
      setInviteError(COPY.invite.roles);
      setStatus(COPY.invite.roles);
      return;
    }
    setStatus(COPY.invite.sending);
    try {
      await api("/api/venue/invites", { body: { email: invite.email.trim(), display_name: invite.name.trim() || invite.email.trim(), roles: invite.roles } });
      setStatus(COPY.invite.sent(invite.email.trim()));
      setBanner("");
      setInviting(false);
      setInvite({ email: "", name: "", roles: [] });
      setInviteError("");
      void loadTotals();
    } catch (error) {
      const message =
        error instanceof ApiError && error.code === "already_member"
          ? COPY.invite.duplicate
          : error instanceof ApiError && error.status === 503
            ? COPY.invite.keycloakDown
            : error instanceof ApiError && error.errors.roles
              ? COPY.invite.roles
              : COPY.invite.email;
      if (error instanceof ApiError && error.status === 503) setBanner(COPY.invite.keycloakDown);
      setInviteError(message);
      setStatus(message);
    }
  };

  const saveFees = async (event: FormEvent) => {
    event.preventDefault();
    const takerValue = /^\d+$/.test(taker) ? Number(taker) : -1;
    const makerValue = /^\d+$/.test(maker) ? Number(maker) : -1;
    if (feeBpsValid(takerValue, makerValue) !== "ok") {
      setStatus(COPY.fees.invalid);
      return;
    }
    setStatus(COPY.fees.saving);
    try {
      await api("/api/venue/fees", { method: "PUT", body: { taker_fee_bps: takerValue, maker_fee_bps: makerValue } });
      setStatus(COPY.fees.saved);
    } catch {
      setStatus(COPY.fees.invalid);
    }
  };

  const generate = async () => {
    setStatus(COPY.statements.generating);
    try {
      await api("/api/venue/statements", { body: { month } });
      setBanner("");
      setStatus(COPY.statements.generated(month));
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) {
        setBanner(COPY.statements.unavailable);
        setStatus("");
      } else setStatus(COPY.statements.month);
    }
  };

  const toggleRole = (role: Role) =>
    setInvite((current) => ({ ...current, roles: current.roles.includes(role) ? current.roles.filter((r) => r !== role) : [...current.roles, role] }));

  const figures: [string, (t: Totals) => string][] = [
    ["Members", (t) => t.members.toLocaleString("en-US")],
    ["Open orders", (t) => t.open_orders.toLocaleString("en-US")],
    ["Volume today", (t) => money(t.volume_cents_today)],
    ["Open interest", (t) => t.open_interest_contracts.toLocaleString("en-US")],
    ["Deposits", (t) => money(t.deposits_cents)],
    ["Refunds", (t) => money(t.refunds_cents)],
    ["Fees", (t) => money(t.fees_cents)],
  ];

  return (
    <Shell field="slate">
      <div className="page-head">
        <h1>Venue</h1>
        <p className="muted">{me.venue?.name}</p>
      </div>
      {banner && <Banner>{banner}</Banner>}
      <Status label="Venue updates" message={status} className="page-status" />
      <section className="totals" aria-label="Venue totals">
        {figures.map(([label, format]) => (
          <div className="card total" key={label}>
            <span className="figure-label">{label}</span>
            <span className="numeral total-value">{totals ? format(totals) : "—"}</span>
          </div>
        ))}
      </section>
      <div className="card-grid two">
        <MemberPicker />
        <section className="card" aria-labelledby="invite-title">
          <h2 className="card-title" id="invite-title">Invites</h2>
          <p className="muted">Invite traders, builders and market admins. Each invitee gets a one-time link by email.</p>
          <button type="button" className="pill" onClick={() => { setInviteError(""); setInviting(true); }}>Invite member</button>
        </section>
        <section className="card" aria-labelledby="fees-title">
          <h2 className="card-title" id="fees-title">Fee schedule</h2>
          <form className="form" onSubmit={(e) => void saveFees(e)} noValidate>
            <div className="field-pair">
              <div className="field-row">
                <label htmlFor="taker-fee">Taker fee (bps)</label>
                <input id="taker-fee" type="number" min={0} max={1000} step={1} value={taker} onChange={(e) => setTaker(e.target.value)} />
              </div>
              <div className="field-row">
                <label htmlFor="maker-fee">Maker fee (bps)</label>
                <input id="maker-fee" type="number" min={0} max={1000} step={1} value={maker} onChange={(e) => setMaker(e.target.value)} />
              </div>
            </div>
            <p className="muted small">New rates apply to orders placed after you save.</p>
            <button type="submit" className="pill">Save fees</button>
          </form>
        </section>
        <section className="card" aria-labelledby="exports-title">
          <h2 className="card-title" id="exports-title">Exports and statements</h2>
          <div className="field-row">
            <label htmlFor="export-month">Export month</label>
            <select id="export-month" value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => (
                <option key={m} value={m}>{monthLabel(m)}</option>
              ))}
            </select>
          </div>
          <div className="actions">
            <a className="pill" href={`/api/venue/fills.csv?month=${month}`} download={`fills-${me.venue?.slug ?? "venue"}-${month}.csv`}>Export fills (CSV)</a>
            <button type="button" className="pill" onClick={() => void generate()}>Generate statements</button>
          </div>
        </section>
      </div>
      <section className="card" aria-labelledby="billing-title">
        <h2 className="card-title" id="billing-title">Builder billing</h2>
        {builders === null ? (
          <Skeleton />
        ) : (
          <TableScroll labelledBy="billing-title">
            <table className="table" aria-labelledby="billing-title">
              <thead>
                <tr><th scope="col">Builder</th><th scope="col">Plan</th><th scope="col">Effective plan</th><th scope="col">State</th></tr>
              </thead>
              <tbody>
                {builders.map((b) => (
                  <tr key={b.member_id}>
                    <td>{b.display_name}</td>
                    <td>{PLAN_LABEL[b.plan]}</td>
                    <td>{PLAN_LABEL[b.effective_plan]}</td>
                    <td>{STATE_TEXT[b.state]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </section>
      <Dialog title="Invite member" open={inviting} onClose={() => setInviting(false)} initialFocus={emailInput}>
        <form className="form" onSubmit={(e) => void sendInvite(e)} noValidate>
          <div className="field-row">
            <label htmlFor="invite-email">Email</label>
            <input ref={emailInput} id="invite-email" type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
          </div>
          <div className="field-row">
            <label htmlFor="invite-name">Display name</label>
            <input id="invite-name" type="text" value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} />
          </div>
          <fieldset className="checks">
            <legend>Roles</legend>
            {(["trader", "builder", "market_admin"] as const).map((role) => (
              <label key={role} className="check">
                <input type="checkbox" checked={invite.roles.includes(role)} onChange={() => toggleRole(role)} />
                <span>{ROLE_LABEL[role]}</span>
              </label>
            ))}
          </fieldset>
          <p className="field-error">{inviteError}</p>
          <div className="dialog-actions">
            <button type="submit" className="pill">Send invite</button>
          </div>
        </form>
      </Dialog>
    </Shell>
  );
}
