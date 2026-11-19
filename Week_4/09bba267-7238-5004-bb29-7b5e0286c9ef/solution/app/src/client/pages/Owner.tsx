// The owner's pages: passcode sign-in, the live dashboard, publishing, orders and the outbox.
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { formatMoney } from "../../shared/rules.js";
import type { OutboxMessage, OwnerOrder, OwnerTier, Performance } from "../../shared/types.js";
import { announce } from "../announce.js";
import { get, request, type Answer } from "../api.js";
import { EmptyState, ErrorSummary, Field, Link, NoticeRegion } from "../components.js";
import { CHECK_DETAILS } from "../copy.js";
import { useLive, useLoader } from "../live.js";

type OwnerView = "dashboard" | "new" | "orders" | "outbox";

const WRONG_PASSCODE = "That passcode is not right.";

/** Loads an owner endpoint; `null` while loading, `false` when signed out. */
function useOwnerData<T>(path: string, refreshOn: (type: string) => boolean): [T | null | false, () => void] {
  const [data, setData] = useState<T | null | false>(null);
  const refresh = useLoader(async () => {
    const found: Answer<T> = await get<T>(path);
    if (found.ok) setData(found.data);
    else if (found.status === 401) setData(false);
  });
  useEffect(refresh, [path]);
  useLive((event) => {
    if (event.type === "resync" || refreshOn(event.type)) refresh();
  });
  return [data, refresh];
}

function SignIn({ onSignedIn }: { onSignedIn: () => void }): JSX.Element {
  const [passcode, setPasscode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    setPending(true);
    const result = await request<unknown>("POST", "/api/owner/session", { passcode });
    setPending(false);
    if (result.ok) {
      setError("");
      onSignedIn();
    } else {
      setError(WRONG_PASSCODE);
      announce(WRONG_PASSCODE);
    }
  };
  return (
    <div class="page-narrow">
      <div class="page-head">
        <p class="kicker">Venue owner</p>
        <h1>Sign in</h1>
      </div>
      <form class="signin" noValidate onSubmit={(event) => void submit(event)}>
        <Field id="owner-passcode" label="Passcode" value={passcode} error={error} type="password" autoComplete="current-password" onInput={setPasscode} />
        <div><button type="submit" disabled={pending}>Sign in</button></div>
      </form>
    </div>
  );
}

function OwnerNav({ onSignOut }: { onSignOut: () => void }): JSX.Element {
  return (
    <nav aria-label="Owner" class="owner-nav">
      <Link href="/owner">Performances</Link>
      <Link href="/owner/new">Publish performance</Link>
      <Link href="/owner/orders">Orders</Link>
      <Link href="/owner/outbox">Outbox</Link>
      <button type="button" class="quiet" onClick={onSignOut}>Sign out</button>
    </nav>
  );
}

function Dashboard({ shows }: { shows: Performance<OwnerTier>[] }): JSX.Element {
  return (
    <>
      {shows.map((show) => (
        <section class="performance-table" key={show.id} aria-labelledby={`title-${show.id}`}>
          <h2 id={`title-${show.id}`}>{show.title}</h2>
          <p class="when">{show.startsAtVenue}{show.salesOpen ? "" : " · Sales closed"}</p>
          <div class="table-frame" tabIndex={0} role="region" aria-label={`${show.title}: seats by tier`}>
          <table aria-labelledby={`title-${show.id}`}>
            <thead>
              <tr><th scope="col">Tier</th><th scope="col" class="num">On sale</th><th scope="col" class="num">Held</th>
                <th scope="col" class="num">Sold</th><th scope="col" class="num">Offered</th><th scope="col" class="num">Waitlist</th></tr>
            </thead>
            <tbody>
              {show.tiers.map((tier) => (
                <tr key={tier.id}>
                  <td>{tier.name} <span class="amount">{formatMoney(tier.faceCents)}</span></td>
                  <td class="num">{tier.onSale}</td><td class="num">{tier.held}</td><td class="num">{tier.sold}</td>
                  <td class="num">{tier.offered}</td><td class="num">{tier.waitlistLength}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>
      ))}
    </>
  );
}

const STATUS_WORDS: Record<OwnerOrder["status"], string> = {
  pending_payment: "Pending payment", paid: "Paid", partially_refunded: "Partially refunded", refunded: "Refunded", cancelled: "Cancelled",
};

function Orders({ orders }: { orders: OwnerOrder[] }): JSX.Element {
  return (
    <>
    <div class="table-frame wide" tabIndex={0} role="region" aria-label="Orders, scrollable">
      <table aria-label="Orders">
        <thead>
          <tr><th scope="col">Order</th><th scope="col">Performance</th><th scope="col">Buyer</th><th scope="col">Status</th>
            <th scope="col" class="num">Total</th><th scope="col" class="num">Net paid</th><th scope="col">Kill Bill payments</th><th scope="col">Receipt</th></tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td class="order-number">{o.id}</td>
              <td>{o.performanceTitle}</td>
              <td>{o.name}<br />{o.email}</td>
              <td>{STATUS_WORDS[o.status]}<br />{o.tickets.length} {o.tickets.length === 1 ? "ticket" : "tickets"}</td>
              <td class="num amount">{formatMoney(o.totalCents)}</td>
              <td class="num amount">{formatMoney(o.netPaidCents)}</td>
              <td>{o.killbillPaymentIds.length ? o.killbillPaymentIds.map((id) => <div key={id}>{id}</div>) : "None"}</td>
              <td>{o.receipt === "sent" ? "Sent" : o.receipt === "queued" ? "Queued" : "None"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {orders.length === 0 ? <EmptyState text="No orders yet." /> : null}
    </>
  );
}

function Outbox({ messages }: { messages: OutboxMessage[] }): JSX.Element {
  return (
    <>
    <div class="table-frame wide" tabIndex={0} role="region" aria-label="Outbox, scrollable">
      <table aria-label="Outbox">
        <thead>
          <tr><th scope="col">To</th><th scope="col">Subject</th><th scope="col">Kind</th><th scope="col">Status</th><th scope="col" class="num">Attempts</th></tr>
        </thead>
        <tbody>
          {messages.map((m) => (
            <tr key={m.id}>
              <td>{m.to}</td><td>{m.subject}</td><td>{m.kind}</td>
              <td><span class="status-word" data-status={m.status}>{m.status === "sent" ? "Sent" : "Queued"}</span></td>
              <td class="num">{m.attempts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {messages.length === 0 ? <EmptyState text="No emails yet." /> : null}
    </>
  );
}

interface TierDraft {
  key: number;
  name: string;
  face: string;
  places: string;
}

/** `68.00` or `1,000` dollars to whole cents; anything else is not a face value. */
function dollarsToCents(text: string): number | null {
  const match = /^\$?(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text.replace(/,/g, "").trim());
  return match ? Number(match[1]) * 100 + Number((match[2] ?? "0").padEnd(2, "0")) : null;
}

function Publish(): JSX.Element {
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [tiers, setTiers] = useState<TierDraft[]>([{ key: 1, name: "", face: "", places: "" }]);
  const [nextKey, setNextKey] = useState(2);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");

  const update = (key: number, change: Partial<TierDraft>): void =>
    setTiers((list) => list.map((t) => (t.key === key ? { ...t, ...change } : t)));

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    setPending(true);
    const body = {
      title,
      startsLocal: start.trim(),
      tiers: tiers.map((t) => {
        const places = t.places.split(",").map((p) => p.trim().toUpperCase()).filter(Boolean);
        return {
          name: t.name,
          faceCents: dollarsToCents(t.face),
          rows: places.filter((p) => p.split("-").length === 2),
          seats: places.filter((p) => p.split("-").length !== 2),
        };
      }),
    };
    const result = await request<{ performance: Performance }>("POST", "/api/owner/performances", body);
    setPending(false);
    if (result.ok) {
      const copy = `Published ${result.data.performance.title}.`;
      setErrors({});
      setNotice(copy);
      announce(copy);
      setTitle("");
      setStart("");
      setTiers([{ key: nextKey, name: "", face: "", places: "" }]);
      setNextKey((k) => k + 1);
    } else if (result.error.fields) {
      setErrors(result.error.fields);
      setNotice("");
      announce(CHECK_DETAILS);
    }
  };

  return (
    <form class="publish-form" noValidate onSubmit={(event) => void submit(event)}>
      <NoticeRegion label="Publish notice" text={notice} />
      <ErrorSummary errors={errors} fieldIds={{ title: "publish-title", startsLocal: "publish-start", tiers: `tier-name-${tiers[0]?.key ?? 1}` }} />
      <Field id="publish-title" label="Title" value={title} error={errors.title} onInput={setTitle} />
      <Field id="publish-start" label="Start (venue time)" value={start} error={errors.startsLocal}
        hint="Chicago wall time as YYYY-MM-DDTHH:MM, for example 2027-11-07T01:30" onInput={setStart} />
      {errors.tiers ? <p class="field-error">{errors.tiers}</p> : null}
      {tiers.map((tier, index) => (
        <fieldset class="tier-fieldset" key={tier.key}>
          <legend>Tier {index + 1}</legend>
          <Field id={`tier-name-${tier.key}`} label="Tier name" value={tier.name} onInput={(v) => update(tier.key, { name: v })} />
          <Field id={`tier-face-${tier.key}`} label="Face value in dollars" value={tier.face} onInput={(v) => update(tier.key, { face: v })} />
          <Field id={`tier-places-${tier.key}`} label="Rows and seats" value={tier.places} hint="Row ids like ST-B and seat ids like ST-A-15, separated by commas"
            onInput={(v) => update(tier.key, { places: v })} />
          {tiers.length > 1 ? (
            <div><button type="button" class="quiet" onClick={() => setTiers((list) => list.filter((t) => t.key !== tier.key))}>Remove tier {index + 1}</button></div>
          ) : null}
        </fieldset>
      ))}
      <div class="dialog-actions">
        <button type="button" class="quiet" disabled={tiers.length >= 6} onClick={() => {
          setTiers((list) => [...list, { key: nextKey, name: "", face: "", places: "" }]);
          setNextKey((k) => k + 1);
        }}>Add tier</button>
        <button type="submit" disabled={pending}>Publish</button>
      </div>
    </form>
  );
}

const HEADINGS: Record<OwnerView, string> = { dashboard: "Performances", new: "Publish performance", orders: "Orders", outbox: "Outbox" };

function OwnerFrame({ view, signedIn, onSignedIn, onSignOut, children }: {
  view: OwnerView; signedIn: boolean | null; onSignedIn: () => void; onSignOut: () => void; children: JSX.Element;
}): JSX.Element {
  // Keyed so the page that replaces it is a new node, not this centred one moved (a layout shift).
  if (signedIn === null) return <div key="loading" class="page-narrow" aria-busy="true"><div class="skeleton-line" /></div>;
  if (!signedIn) return <SignIn onSignedIn={onSignedIn} />;
  return (
    <div>
      <div class="page-head">
        <p class="kicker">Venue owner</p>
        <h1>{HEADINGS[view]}</h1>
        <OwnerNav onSignOut={onSignOut} />
      </div>
      {children}
    </div>
  );
}

const PATHS: Record<OwnerView, string> = {
  dashboard: "/api/owner/performances", new: "/api/owner/performances", orders: "/api/owner/orders", outbox: "/api/owner/outbox",
};

const REFRESH_ON: Record<OwnerView, (type: string) => boolean> = {
  dashboard: (type) => type === "seats" || type === "performances",
  new: () => false,
  orders: (type) => type === "seats" || type === "outbox" || type === "performances",
  outbox: (type) => type === "outbox",
};

export function OwnerPage({ view }: { view: OwnerView }): JSX.Element {
  const [data, reload] = useOwnerData<{ performances?: Performance<OwnerTier>[]; orders?: OwnerOrder[]; messages?: OutboxMessage[] }>(
    PATHS[view], REFRESH_ON[view]);
  const signOut = async (): Promise<void> => {
    await request<unknown>("DELETE", "/api/owner/session");
    reload();
  };
  return (
    <OwnerFrame view={view} signedIn={data === null ? null : data !== false} onSignedIn={reload} onSignOut={() => void signOut()}>
      {view === "new" ? <Publish />
        : view === "orders" ? <Orders orders={(data && data.orders) || []} />
          : view === "outbox" ? <Outbox messages={(data && data.messages) || []} />
            : <Dashboard shows={(data && data.performances) || []} />}
    </OwnerFrame>
  );
}
