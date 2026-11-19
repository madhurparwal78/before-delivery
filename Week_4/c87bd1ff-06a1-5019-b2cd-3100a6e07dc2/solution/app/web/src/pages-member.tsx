// Registration, the bidder dashboard and invoice, and the consignor's desk, lot page and statements.
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import {
  ApiError, HistoryRow, Lot, Notice, Offer, STATE_LABELS, UNEXPECTED, amount, announce, api, boot, euros, go, rotterdam, stamp,
} from "./lib";
import { Portrait } from "./portraits";
import { useResource } from "./resource";
import { EmptyState, Shell, useTick } from "./ui";

function Loading({ label }: { label: string }) {
  return (
    <div class="skeleton" aria-busy="true" aria-label={label}>
      <div class="skeleton-block" />
    </div>
  );
}

function Failed() {
  return <p class="form-message">{UNEXPECTED}</p>;
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ComponentChildren }) {
  return (
    <div class="field">
      <label for={id}>{label}</label>
      {children}
      {error && (
        <p class="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

const ROLE_ADDRESS: Record<string, string> = {
  bidder: "/bidder", consignor: "/consign", specialist: "/desk/specialist", cashier: "/desk/cashier", admin: "/desk/admin",
};

// ---- registration ----

export function RegisterPage() {
  const [role, setRole] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const known = boot.me;
  const home = known?.registration ? ROLE_ADDRESS[known.registration.role] : known?.roles.map((r) => ROLE_ADDRESS[r]).find(Boolean);
  if (home) {
    go(home);
    return <Shell><main class="narrow"><Loading label="Taking you to your desk" /></main></Shell>;
  }
  const submit = async (e: Event) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage("");
    setErrors({});
    try {
      const res = await api<{ landing: string }>("/api/register", { method: "POST", body: { role, full_name: name, phone, address } });
      go(res.landing);
    } catch (err) {
      setPending(false);
      if (err instanceof ApiError && err.fields && Object.keys(err.fields).length) {
        setErrors(err.fields);
        Object.values(err.fields).forEach(announce);
      } else {
        const text = err instanceof ApiError && err.status >= 400 && err.status < 500 ? err.message : UNEXPECTED;
        setMessage(text);
        announce(text);
      }
    }
  };
  return (
    <Shell>
      <main class="narrow">
        <h1 class="display">REGISTER</h1>
        <form class="stack" onSubmit={submit} noValidate>
          <fieldset role="radiogroup" aria-label="I am joining to">
            <legend>I am joining to</legend>
            <label class="choice">
              <input type="radio" name="role" checked={role === "bidder"} onChange={() => setRole("bidder")} />
              <span>Bid</span>
            </label>
            <label class="choice">
              <input type="radio" name="role" checked={role === "consignor"} onChange={() => setRole("consignor")} />
              <span>Consign</span>
            </label>
            {errors.role && <p class="field-error">{errors.role}</p>}
          </fieldset>
          <Field id="full-name" label="Full name" error={errors.full_name}>
            <input id="full-name" type="text" autocomplete="name" value={name} aria-invalid={errors.full_name ? "true" : undefined} aria-describedby={errors.full_name ? "full-name-error" : undefined} onInput={(e) => setName(e.currentTarget.value)} />
          </Field>
          <Field id="phone" label="Phone" error={errors.phone}>
            <input id="phone" type="text" autocomplete="tel" value={phone} aria-invalid={errors.phone ? "true" : undefined} aria-describedby={errors.phone ? "phone-error" : undefined} onInput={(e) => setPhone(e.currentTarget.value)} />
          </Field>
          <Field id="address" label="Address" error={errors.address}>
            <input id="address" type="text" autocomplete="street-address" value={address} aria-invalid={errors.address ? "true" : undefined} aria-describedby={errors.address ? "address-error" : undefined} onInput={(e) => setAddress(e.currentTarget.value)} />
          </Field>
          <button type="submit" class="gold-btn" disabled={pending} aria-busy={pending ? "true" : undefined}>
            {pending ? "Registering…" : "Register"}
          </button>
          {message && <p class="form-message">{message}</p>}
        </form>
      </main>
    </Shell>
  );
}

// ---- bidder ----

interface Dashboard {
  paddle: number | null;
  status: string;
  spending_limit: number | null;
  committed: number;
  leading: Lot[];
  watching: Lot[];
  won: Lot[];
  offers: Offer[];
  invoices: InvoiceJson[];
  seq: number;
}

export interface InvoiceJson {
  id: string;
  number: string;
  sale_title: string;
  paddle: number | null;
  status: string;
  issued_at: string;
  due_at: string;
  lines: { lot_id: string; lot_number: number; title: string; source: string; hammer: string; premium: string; vat: string }[];
  hammer_total: string;
  premium_total: string;
  vat_total: string;
  total: string;
  paid: string;
  outstanding: string;
  bidder_name?: string;
}

function Panel({ id, title, children }: { id: string; title: string; children: ComponentChildren }) {
  return (
    <section class="panel" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

function LotLinks({ lots, none }: { lots: Lot[]; none: string }) {
  if (!lots.length) return <p class="muted">{none}</p>;
  return (
    <ul class="rows">
      {lots.map((lot) => (
        <li key={lot.id}>
          <a href={`/lots/${lot.id}`}>{`Lot ${lot.lot_number}, ${lot.title}`}</a>
          <span class="muted">{` ${euros(lot.price ?? lot.opening_bid)}`}</span>
        </li>
      ))}
    </ul>
  );
}

export function BidderPage() {
  const { data, failed, reload } = useResource<Dashboard>("/api/bidder/dashboard");
  const [messages, setMessages] = useState<string[]>([]);
  const notices = useResource<{ notices: Notice[]; seq: number }>("/api/notices", (f) => f.type === "notice").data?.notices ?? [];
  useTick();
  if (failed) return <Shell><main class="desk"><Failed /></main></Shell>;
  if (!data) return <Shell><main class="desk"><Loading label="Loading your desk" /></main></Shell>;

  const answer = async (offer: Offer, verb: "accept" | "decline") => {
    let text: string;
    try {
      const res = await api<{ invoice?: InvoiceJson }>(`/api/bidder/offers/${offer.id}/${verb}`, { method: "POST" });
      text =
        verb === "accept"
          ? `Lot ${offer.lot_number} is yours for ${euros(offer.amount)}. Invoice ${res.invoice?.number} is ready.`
          : `You declined the offer on lot ${offer.lot_number}.`;
    } catch (e) {
      if (e instanceof ApiError && e.code === "offer_expired") text = "This offer has expired.";
      else if (e instanceof ApiError && e.code === "offer_closed") text = "This offer has already been answered.";
      else text = UNEXPECTED;
    }
    setMessages((m) => [text, ...m]);
    announce(text);
    reload();
  };

  const open = data.offers.filter((o) => o.status === "open");
  const approved = data.status === "active";
  return (
    <Shell>
      <main class="desk">
        <h1 class="display">{data.paddle != null ? `PADDLE ${data.paddle}` : "YOUR SALEROOM"}</h1>
        <div class="panels">
          <section class="panel" aria-label="Spending limit">
            <p class="limit">
              {approved ? `Spending limit ${euros(data.spending_limit)} · ${euros(data.committed)} committed` : "Limit pending approval"}
            </p>
          </section>
          <Panel id="p-leading" title="Leading">
            <LotLinks lots={data.leading} none="You are not leading any lot." />
          </Panel>
          <Panel id="p-watching" title="Watching">
            <LotLinks lots={data.watching} none="You are not watching any lot." />
          </Panel>
          <Panel id="p-won" title="Won">
            <LotLinks lots={data.won} none="You have not won a lot yet." />
          </Panel>
          <Panel id="p-offers" title="Offers">
            {open.length === 0 && messages.length === 0 && <p class="muted">No offers right now.</p>}
            <ul class="rows">
              {open.map((offer) => (
                <li key={offer.id}>
                  <span>{`Lot ${offer.lot_number} · ${euros(offer.amount)} · until ${rotterdam(offer.expires_at)}`}</span>
                  <span class="actions">
                    <button type="button" class="gold-btn small" onClick={() => answer(offer, "accept")}>
                      Accept offer on lot {offer.lot_number}
                    </button>
                    <button type="button" class="outline-btn small" onClick={() => answer(offer, "decline")}>
                      Decline offer on lot {offer.lot_number}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            {messages.map((m, i) => (
              <p class="form-message" key={`${m}-${i}`}>
                {m}
              </p>
            ))}
          </Panel>
          <Panel id="p-invoices" title="Invoices">
            {data.invoices.length === 0 && <p class="muted">No invoices yet.</p>}
            <ul class="rows">
              {data.invoices.map((inv) => (
                <li key={inv.id}>
                  <a href={`/bidder/invoices/${inv.id}`}>{`Invoice ${inv.number}`}</a>
                  <span class="muted">{` ${amount(inv.total)} · ${statusWord(inv.status)}`}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel id="p-notices" title="Notices">
            {notices.length === 0 && <p class="muted">No notices yet.</p>}
            <ol class="rows">
              {notices.map((n) => (
                <li key={n.id}>
                  <span>{n.text}</span>
                  <span class="muted">{rotterdam(n.created_at)}</span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </main>
    </Shell>
  );
}

function statusWord(status: string): string {
  return { issued: "Issued", paid: "Paid", defaulted: "Defaulted" }[status] ?? status;
}

export function InvoicePage({ id }: { id: string }) {
  const { data, failed } = useResource<{ invoice: InvoiceJson }>(`/api/bidder/invoices/${id}`);
  if (failed) return <Shell><main class="document"><Failed /></main></Shell>;
  if (!data) return <Shell><main class="document"><Loading label="Loading the invoice" /></main></Shell>;
  const inv = data.invoice;
  return (
    <Shell>
      <main class="document">
        <h1 class="display">{`INVOICE ${inv.number}`}</h1>
        <p class="doc-meta">
          {`${inv.sale_title} · Status ${statusWord(inv.status)} · Payment due by ${rotterdam(inv.due_at)}`}
        </p>
        <table class="data-table" aria-label="Invoice lines">
          <thead>
            <tr>
              <th scope="col">Lot</th>
              <th scope="col" class="num">Hammer</th>
              <th scope="col" class="num">Premium</th>
              <th scope="col" class="num">VAT</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.lot_id}>
                <td>{`Lot ${l.lot_number}, ${l.title}`}</td>
                <td class="num">{amount(l.hammer)}</td>
                <td class="num">{amount(l.premium)}</td>
                <td class="num">{amount(l.vat)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Totals</th>
              <td class="num">{amount(inv.hammer_total)}</td>
              <td class="num">{amount(inv.premium_total)}</td>
              <td class="num">{amount(inv.vat_total)}</td>
            </tr>
            <tr>
              <th scope="row" colSpan={3}>Total due</th>
              <td class="num">{amount(inv.total)}</td>
            </tr>
            <tr>
              <th scope="row" colSpan={3}>Paid</th>
              <td class="num">{amount(inv.paid)}</td>
            </tr>
            <tr>
              <th scope="row" colSpan={3}>Outstanding</th>
              <td class="num">{amount(inv.outstanding)}</td>
            </tr>
          </tfoot>
        </table>
      </main>
    </Shell>
  );
}

// ---- consignor ----

function resultText(lot: Lot): string {
  if (lot.hammer != null) return `Sold ${euros(lot.hammer)}`;
  if (lot.state === "closed_unsold" || lot.state === "second_chance_offered" || lot.state === "offer_lapsed") return "Unsold";
  return "";
}

interface StatementSummary {
  id: string;
  number: string;
  status: string;
  issued_at: string | null;
}

export function ConsignPage() {
  const { data, failed } = useResource<{ lots: Lot[]; seq: number }>("/api/consign/lots");
  const statements = useResource<{ statements: StatementSummary[] }>("/api/consign/statements", (f) => f.type === "notice");
  if (failed) return <Shell><main class="desk"><Failed /></main></Shell>;
  if (!data) return <Shell><main class="desk"><Loading label="Loading your consignments" /></main></Shell>;
  const lots = data.lots.map(stamp);
  return (
    <Shell>
      <main class="desk">
        <div class="desk-head">
          <h1 class="display">YOUR CONSIGNMENTS</h1>
          <a class="gold-btn" href="/consign/new">
            Offer a lot
          </a>
        </div>
        {lots.length === 0 ? (
          <EmptyState line="NOTHING CONSIGNED YET">Offer a watch or camera and our specialist will estimate it within the week.</EmptyState>
        ) : (
          <div class="panel" role="presentation">
            <div class="stack-table" style="--cols: 4" role="table" aria-label="Your lots">
              <div class="head" role="row">
                <span role="columnheader">Lot</span>
                <span role="columnheader">Title</span>
                <span role="columnheader">State</span>
                <span role="columnheader">Result</span>
              </div>
              {lots.map((lot) => (
                <div class="body-row" role="row" key={lot.id}>
                  <span role="cell" data-label="Lot">{lot.lot_number ?? ""}</span>
                  <span role="cell" data-label="Title">
                    <a href={`/consign/lots/${lot.id}`}>{lot.title}</a>
                  </span>
                  <span role="cell" data-label="State">{STATE_LABELS[lot.state ?? ""] ?? lot.state}</span>
                  <span role="cell" data-label="Result">{resultText(lot) || <span class="muted">Not yet sold</span>}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <section class="panel" aria-labelledby="p-statements">
          <h2 id="p-statements">Statements</h2>
          {(statements.data?.statements ?? []).length === 0 && <p class="muted">No statements yet.</p>}
          <ul class="rows">
            {(statements.data?.statements ?? []).map((s) => (
              <li key={s.id}>
                <a href={`/consign/statements/${s.id}`}>{`Statement ${s.number}`}</a>
                <span class="muted">{` ${s.status === "superseded" ? "Superseded" : "Issued"}`}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </Shell>
  );
}

export function ConsignNewPage() {
  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage("");
    setErrors({});
    try {
      const res = await api<{ landing: string }>("/api/consign/lots", { method: "POST", body: { category, title, description } });
      go(res.landing);
    } catch (err) {
      setPending(false);
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        setErrors(err.fields);
        Object.values(err.fields).forEach(announce);
      } else {
        setMessage(UNEXPECTED);
        announce(UNEXPECTED);
      }
    }
  };
  return (
    <Shell>
      <main class="narrow">
        <h1 class="display">OFFER A LOT</h1>
        <form class="stack" onSubmit={submit} noValidate>
          <fieldset role="radiogroup" aria-label="Category">
            <legend>Category</legend>
            <label class="choice">
              <input type="radio" name="category" checked={category === "wristwatch"} onChange={() => setCategory("wristwatch")} />
              <span>Wristwatch</span>
            </label>
            <label class="choice">
              <input type="radio" name="category" checked={category === "camera"} onChange={() => setCategory("camera")} />
              <span>Film camera</span>
            </label>
            {errors.category && <p class="field-error">{errors.category}</p>}
          </fieldset>
          <Field id="lot-title" label="Title" error={errors.title}>
            <input id="lot-title" type="text" value={title} aria-invalid={errors.title ? "true" : undefined} aria-describedby={errors.title ? "lot-title-error" : undefined} onInput={(e) => setTitle(e.currentTarget.value)} />
          </Field>
          <Field id="lot-description" label="Description" error={errors.description}>
            <textarea id="lot-description" rows={5} value={description} aria-invalid={errors.description ? "true" : undefined} aria-describedby={errors.description ? "lot-description-error" : undefined} onInput={(e) => setDescription(e.currentTarget.value)} />
          </Field>
          <button type="submit" class="gold-btn" disabled={pending} aria-busy={pending ? "true" : undefined}>
            {pending ? "Sending to the specialist…" : "Submit for estimate"}
          </button>
          {message && <p class="form-message">{message}</p>}
        </form>
      </main>
    </Shell>
  );
}

export function ConsignLotPage({ id }: { id: string }) {
  const { data, failed, reload } = useResource<{ lot: Lot; history: HistoryRow[]; seq: number }>(`/api/consign/lots/${id}`, (f) => f.type === "lot_changed" && f.lot.id === id);
  const [amountText, setAmountText] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  useTick();
  if (failed) return <Shell><main class="desk"><Failed /></main></Shell>;
  if (data === null) return <Shell><main class="desk"><EmptyState line="NOT IN THIS SALE">That page is not in the saleroom.</EmptyState></main></Shell>;
  if (!data) return <Shell><main class="desk"><Loading label="Loading the lot" /></main></Shell>;
  const lot = data.lot;
  const say = (text: string) => {
    setMessage(text);
    announce(text);
  };
  const offer = async (e: Event) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const res = await api<{ offer: Offer }>(`/api/consign/lots/${id}/second-chance`, { method: "POST", body: { amount: Number(amountText) } });
      say(`Offer sent to the top bidder until ${rotterdam(res.offer.expires_at)}.`);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields.amount) {
        setError(err.fields.amount);
        announce(err.fields.amount);
      } else say(UNEXPECTED);
    }
    setPending(false);
  };
  const leave = async () => {
    if (pending) return;
    setPending(true);
    try {
      await api(`/api/consign/lots/${id}/leave-unsold`, { method: "POST" });
      say(`Lot ${lot.lot_number} stays unsold.`);
      reload();
    } catch {
      say(UNEXPECTED);
    }
    setPending(false);
  };
  return (
    <Shell>
      <main class="desk">
        <div class="lot-summary">
          <div class="thumb">
            <Portrait kind={lot.portrait} />
          </div>
          <div>
            <h1 class="display">{lot.title}</h1>
            <dl class="facts">
              <div><dt>Lot</dt><dd>{lot.lot_number ?? "Not yet numbered"}</dd></div>
              <div><dt>State</dt><dd>{STATE_LABELS[lot.state ?? ""] ?? lot.state}</dd></div>
              <div><dt>Price</dt><dd>{lot.price != null ? euros(lot.price) : lot.opening_bid != null ? `Opening bid ${euros(lot.opening_bid)}` : "Not yet estimated"}</dd></div>
              <div><dt>Bids</dt><dd>{lot.bid_count}</dd></div>
              {lot.closes_at && <div><dt>Closes</dt><dd>{rotterdam(lot.closes_at)}</dd></div>}
              {lot.offer && <div><dt>Offer</dt><dd>{`${euros(lot.offer.amount)} until ${rotterdam(lot.offer.expires_at)} (${lot.offer.status})`}</dd></div>}
            </dl>
          </div>
        </div>
        {lot.second_chance_open && (
          <section class="panel" aria-label="Second chance">
            <form class="stack" onSubmit={offer} noValidate>
              <Field id="offer-amount" label="Offer amount" error={error}>
                <input id="offer-amount" type="text" inputMode="numeric" value={amountText} aria-invalid={error ? "true" : undefined} aria-describedby={error ? "offer-amount-error" : undefined} onInput={(e) => setAmountText(e.currentTarget.value)} />
              </Field>
              <div class="actions">
                <button type="submit" class="gold-btn" aria-disabled={pending ? "true" : undefined}>Offer to the top bidder</button>
                <button type="button" class="outline-btn" aria-disabled={pending ? "true" : undefined} onClick={leave}>Leave unsold</button>
              </div>
            </form>
          </section>
        )}
        {message && <p class="form-message">{message}</p>}
        <section class="panel" aria-labelledby="p-history">
          <h2 id="p-history">Bid history</h2>
          <table class="data-table" aria-label="Anonymous bid history">
            <thead>
              <tr>
                <th scope="col" class="num">Price</th>
                <th scope="col">Time</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((row, i) => (
                <tr key={`${row.accepted_at}-${i}`}>
                  <td class="num">{euros(row.price_after)}</td>
                  <td>{rotterdam(row.accepted_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </Shell>
  );
}

interface StatementJson extends StatementSummary {
  sale_title: string;
  version: number;
  supersedes: string | null;
  superseded_by: string | null;
  lines: { lot_id: string; lot_number: number; title: string; result: string; hammer: string | null; commission: string | null; net: string | null }[];
  hammer_total: string;
  commission_total: string;
  net_total: string;
}

export function StatementPage({ id }: { id: string }) {
  const { data, failed } = useResource<{ statement: StatementJson }>(`/api/consign/statements/${id}`, (f) => f.type === "notice");
  if (failed) return <Shell><main class="document"><Failed /></main></Shell>;
  if (!data) return <Shell><main class="document"><Loading label="Loading the statement" /></main></Shell>;
  const s = data.statement;
  const money = (v: string | null) => (v == null ? "—" : amount(v));
  return (
    <Shell>
      <main class="document">
        <h1 class="display">{`SELLER STATEMENT ${s.number}`}</h1>
        <p class="doc-meta">{`${s.sale_title} · Status ${s.status === "superseded" ? "Superseded" : "Issued"}${s.issued_at ? ` · ${rotterdam(s.issued_at)}` : ""}`}</p>
        {s.superseded_by && (
          <p class="doc-meta">
            <a href={`/consign/statements/${s.superseded_by}`}>Replaced by a newer statement</a>
          </p>
        )}
        {s.supersedes && (
          <p class="doc-meta">
            <a href={`/consign/statements/${s.supersedes}`}>Replaces an earlier statement</a>
          </p>
        )}
        <table class="data-table" aria-label="Statement lines">
          <thead>
            <tr>
              <th scope="col">Lot</th>
              <th scope="col">Result</th>
              <th scope="col" class="num">Hammer</th>
              <th scope="col" class="num">Commission</th>
              <th scope="col" class="num">Net</th>
            </tr>
          </thead>
          <tbody>
            {s.lines.map((l) => (
              <tr key={l.lot_id}>
                <td>{`Lot ${l.lot_number}, ${l.title}`}</td>
                <td>{l.result === "sold" ? "Sold" : "Unsold"}</td>
                <td class="num">{money(l.hammer)}</td>
                <td class="num">{money(l.commission)}</td>
                <td class="num">{money(l.net)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>Totals</th>
              <td class="num">{amount(s.hammer_total)}</td>
              <td class="num">{amount(s.commission_total)}</td>
              <td class="num">{amount(s.net_total)}</td>
            </tr>
          </tfoot>
        </table>
      </main>
    </Shell>
  );
}
