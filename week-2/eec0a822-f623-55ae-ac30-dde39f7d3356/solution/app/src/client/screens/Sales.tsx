import { useEffect, useRef, useState } from "preact/hooks";
import { COPY } from "../../shared/copy";
import { formatDay, formatTime } from "../../shared/format";
import { formatMoney } from "../../shared/money";
import { api, sharedCopy, type ApiError } from "../lib/api";
import { useInterval, useLoad, useWide } from "../lib/hooks";
import { navigate, setFlash, takeFlash } from "../lib/nav";
import { bad, Button, Field, focusFirstError, Link, NoteLine, ok, useAction, type Note } from "../ui/Controls";
import { Dialog, useDialog } from "../ui/Dialog";
import { DataTable, NotFoundPage, type Member } from "../ui/Shell";
import { Loader } from "../ui/Visuals";
import { holdStatusLabel, WEEK_STATUS, type HoldView } from "./common";

const REFRESH_MS = 10_000;

interface Yacht {
  slug: string;
  name: string;
  base: "split" | "lavrio";
  status: "on_sale" | "withdrawn";
  cabins: number;
  lengthM: number;
  beamM: number;
  draftM: number;
}

interface StaffWeek {
  weekStart: string;
  weekEnd: string;
  status: "free" | "held" | "booked";
  season: string;
  weeklyRateMinor: number;
  currency: string;
}

interface CharterView {
  id: string;
  holdId: string | null;
  yachtSlug: string;
  weekStart: string;
  weekEnd: string;
  clientName: string;
  clientEmail: string;
  currency: string;
  lines: { kind: string; label: string; eurMinor: number; amountMinor: number }[];
  totalEurMinor: number;
  totalMinor: number;
  invoiceStatus: "invoiced" | "not_invoiced";
  killbillInvoiceId: string | null;
  status: "open" | "closed";
  erasesAt: string | null;
}

const canSell = (m: Member) => m.role === "charter_manager" || m.role === "fleet_director";

/** Field errors of a 422 body, keyed by field. */
function fieldErrors(body: ApiError): Record<string, string> {
  return body.errors ?? {};
}

function useYachtNames(ws: string): Map<string, string> {
  const yachts = useLoad<{ yachts: Yacht[] }>(`/api/w/${ws}/yachts`);
  return new Map((yachts.data?.yachts ?? []).map((y) => [y.slug, y.name]));
}

/** Copy for a refused hold placement (staff and broker pages alike). */
export function holdRefusal(body: ApiError, status: number): string {
  if (body.error === "week_taken") return COPY.weekTaken(String(body.takenBy), formatTime(String(body.takenAt)));
  if (body.error === "week_booked") return COPY.weekBooked;
  if (body.error === "yacht_withdrawn") return COPY.yachtWithdrawnHold;
  return sharedCopy({ status, body });
}

function holdColumns(ws: string, names: Map<string, string>) {
  return [
    { label: "Yacht", cell: (h: HoldView) => names.get(h.yachtSlug) ?? h.yachtSlug },
    { label: "Week", cell: (h: HoldView) => formatDay(h.weekStart) },
    { label: "Client", cell: (h: HoldView) => <Link href={`/w/${ws}/holds/${h.id}`}>{h.clientName}</Link> },
    { label: "Placed by", cell: (h: HoldView) => h.placedBy.name },
    { label: "Status", cell: (h: HoldView) => <span class={`pill pill--${h.status}`}>{holdStatusLabel(h)}</span> },
    { label: "Lapses", cell: (h: HoldView) => <span class="fig">{h.status === "waiting" || !h.lapsesAt ? "—" : formatTime(h.lapsesAt)}</span> },
  ];
}

export function Holds({ member }: { member: Member }) {
  const ws = member.workspaceSlug;
  const holds = useLoad<{ holds: HoldView[] }>(`/api/w/${ws}/holds`);
  const names = useYachtNames(ws);
  useInterval(() => void holds.reload(), REFRESH_MS);
  return (
    <section>
      <h1 class="rise">Holds</h1>
      <p class="lede">Every hold on the fleet, as the server reports it. Lapse times are in Split time.</p>
      <Loader active={holds.loading} />
      {holds.data ? <DataTable name="Holds" captionHidden columns={holdColumns(ws, names)} rows={holds.data.holds} rowKey={(h) => h.id} empty="No holds yet." /> : null}
    </section>
  );
}

export function StaffYacht({ member, slug }: { member: Member; slug: string }) {
  const ws = member.workspaceSlug;
  const wide = useWide();
  const yacht = useLoad<{ yacht: Yacht }>(`/api/w/${ws}/yachts/${slug}`);
  const weeks = useLoad<{ weeks: StaffWeek[] }>(`/api/w/${ws}/yachts/${slug}/weeks`);
  const holds = useLoad<{ holds: HoldView[] }>(canSell(member) || member.role === "finance_lead" ? `/api/w/${ws}/holds?yachtSlug=${slug}` : null);
  const names = new Map([[slug, yacht.data?.yacht.name ?? slug]]);
  const dialog = useDialog();
  const [week, setWeek] = useState<StaffWeek | null>(null);
  const [client, setClient] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const action = useAction();
  const placeButton = useRef<HTMLButtonElement>(null);

  if (yacht.result && !yacht.result.ok) return <NotFoundPage />;
  const y = yacht.data?.yacht;

  const open = (event: MouseEvent, w: StaffWeek) => {
    setWeek(w);
    setClient("");
    setErrors({});
    action.setNote(null);
    dialog.show(event);
  };

  const submit = (event: Event) => {
    event.preventDefault();
    if (!week || !y) return;
    void action.run("Placing hold", async () => {
      const result = await api<{ hold: HoldView }>("POST", `/api/w/${ws}/holds`, {
        yachtSlug: slug, weekStart: week.weekStart, clientName: client, queue: week.status === "held",
      });
      if (result.ok) {
        const hold = result.data.hold;
        const message = hold.status === "live"
          ? COPY.holdPlaced(hold.clientName, y.name, formatDay(hold.weekStart), formatTime(hold.lapsesAt!))
          : COPY.joinedLine(hold.clientName, hold.position!, y.name, formatDay(hold.weekStart));
        setFlash(`/w/${ws}/holds/${hold.id}`, message);
        navigate(`/w/${ws}/holds/${hold.id}`);
        return null;
      }
      const found = fieldErrors(result.body);
      setErrors(found);
      action.focusLater(() => focusFirstError(found.clientName ? ["hold-client"] : [], placeButton.current));
      void weeks.reload();
      return result.status === 422 ? null : bad(holdRefusal(result.body, result.status));
    });
  };

  return (
    <section>
      <Loader active={!y} />
      {y ? (
        <>
          <h1 class="rise">{y.name}</h1>
          <p class="lede">
            {y.status === "withdrawn" ? "Withdrawn from sale. " : ""}Weeks run Saturday to Saturday on the Split calendar.
          </p>
          <h2>Weeks</h2>
          <div class={wide ? "week-strip" : "week-stack"} tabIndex={wide ? 0 : undefined} role={wide ? "region" : undefined} aria-label={wide ? "Weeks, scroll sideways" : undefined}>
            <ul class="weeks" aria-label="Weeks">
              {(weeks.data?.weeks ?? []).map((w) => (
                <li key={w.weekStart} class={`week week--${w.status}`}>
                  <span class="week__date">Week of {formatDay(w.weekStart)}</span>
                  <span class={`pill pill--${w.status}`}>{WEEK_STATUS[w.status]}</span>
                  <span class="week__rate fig">{formatMoney(w.currency, w.weeklyRateMinor)}</span>
                  {canSell(member) && w.status !== "booked" ? (
                    <Button variant={w.status === "free" ? "primary" : "quiet"} onClick={(e) => open(e as unknown as MouseEvent, w)}>
                      Hold week of {formatDay(w.weekStart)}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            {weeks.data && !weeks.data.weeks.length ? <p class="empty">No weeks yet.</p> : null}
          </div>
          {holds.data ? (
            <DataTable name="Holds on this yacht" columns={holdColumns(ws, names)} rows={holds.data.holds} rowKey={(h) => h.id} empty="No holds yet." />
          ) : null}
        </>
      ) : null}
      <Dialog handle={dialog} title="Place hold">
        <form class="form" onSubmit={submit} noValidate>
          {week ? <p class="dialog__context">Week of {formatDay(week.weekStart)} · {y?.name}</p> : null}
          <Field id="hold-client" label="Client name" value={client} onInput={setClient} error={errors.clientName} first />
          {errors.weekStart ? <p class="field__error">{errors.weekStart}</p> : null}
          <NoteLine note={action.note} />
          <div class="dialog__actions">
            <Button type="submit" pending={action.pending} pendingLabel="Placing hold" buttonRef={placeButton}>
              {week?.status === "held" ? "Join the line" : "Place hold"}
            </Button>
            <Button variant="quiet" onClick={dialog.hide}>
              Cancel
            </Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}

interface Quote {
  currency: string;
  rate: string;
  lines: { kind: string; label: string; eurMinor: number; amountMinor: number }[];
  totalEurMinor: number;
  totalMinor: number;
}

function PriceTable({ name, currency, lines, totalEur, total }: {
  name: string;
  currency: string;
  lines: Quote["lines"];
  totalEur: number;
  total: number;
}) {
  const both = currency !== "EUR";
  return (
    <table class="table table--lines" aria-label={name}>
      <caption class="sr-only">{name}</caption>
      <thead>
        <tr>
          <th scope="col">Line</th>
          <th scope="col" class="num">EUR</th>
          {both ? <th scope="col" class="num">{currency}</th> : null}
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.kind}>
            <th scope="row">{l.label}</th>
            <td class="num fig">{formatMoney("EUR", l.eurMinor)}</td>
            {both ? <td class="num fig">{formatMoney(currency, l.amountMinor)}</td> : null}
          </tr>
        ))}
        <tr class="total">
          <th scope="row">Total</th>
          <td class="num fig">{formatMoney("EUR", totalEur)}</td>
          {both ? <td class="num fig">{formatMoney(currency, total)}</td> : null}
        </tr>
      </tbody>
    </table>
  );
}

export function Hold({ member, id }: { member: Member; id: string }) {
  const ws = member.workspaceSlug;
  const hold = useLoad<{ hold: HoldView }>(`/api/w/${ws}/holds/${id}`);
  const h = hold.data?.hold;
  const yacht = useLoad<{ yacht: Yacht }>(h ? `/api/w/${ws}/yachts/${h.yachtSlug}` : null);
  useInterval(() => void hold.reload(), REFRESH_MS);
  const page = useAction();
  const deposit = useDialog();
  const release = useDialog();
  const depositAction = useAction();
  const [email, setEmail] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [quote, setQuote] = useState<Quote | null>(null);
  const depositButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const flash = takeFlash(location.pathname);
    if (flash) page.setNote(ok(flash));
  }, []);

  useEffect(() => {
    if (!deposit.open) return;
    let current = true;
    void api<{ quote: Quote }>("GET", `/api/w/${ws}/holds/${id}/quote?currency=${currency}`).then((result) => {
      if (current && result.ok) setQuote(result.data.quote);
    });
    return () => void (current = false);
  }, [deposit.open, currency]);

  if (hold.result && !hold.result.ok && hold.result.status !== 401) return <NotFoundPage />;
  const yachtName = yacht.data?.yacht.name ?? "";

  const refusal = (result: { status: number; body: ApiError }): string => {
    if (result.body.error === "hold_lapsed") return COPY.holdLapsed(formatTime(String(result.body.lapsedAt)));
    if (result.body.error === "hold_not_live") return COPY.holdNotLive;
    return sharedCopy(result);
  };

  const submitDeposit = (event: Event) => {
    event.preventDefault();
    void depositAction.run("Recording deposit", async () => {
      const result = await api<{ charter: CharterView }>("POST", `/api/w/${ws}/holds/${id}/deposit`, { clientEmail: email, currency });
      if (result.ok) {
        const path = `/w/${ws}/charters/${result.data.charter.id}`;
        setFlash(path, COPY.depositRecorded(result.data.charter.clientEmail));
        navigate(path);
        return null;
      }
      const found = fieldErrors(result.body);
      setErrors(found);
      depositAction.focusLater(() => focusFirstError(found.clientEmail ? ["deposit-email"] : [], depositButton.current));
      void hold.reload();
      return result.status === 422 ? null : bad(refusal(result));
    });
  };

  const confirmRelease = () => {
    void page.run("Releasing hold", async () => {
      const result = await api<{ hold: HoldView }>("POST", `/api/w/${ws}/holds/${id}/release`);
      release.hide();
      await hold.reload();
      return result.ok ? ok(COPY.holdReleased) : bad(refusal(result));
    });
  };

  return (
    <section>
      <Loader active={!h} />
      {h ? (
        <>
          <h1 class="rise">Hold for {h.clientName}</h1>
          <div class="two-col">
            <div class="card">
              <dl class="details">
                <div><dt>Yacht</dt><dd>{yachtName}</dd></div>
                <div><dt>Week</dt><dd class="fig">{formatDay(h.weekStart)} to {formatDay(h.weekEnd)}</dd></div>
                <div><dt>Client</dt><dd>{h.clientName}</dd></div>
                <div><dt>Placed by</dt><dd>{h.placedBy.name}</dd></div>
                <div><dt>Status</dt><dd><span class={`pill pill--${h.status}`}>{holdStatusLabel(h)}</span></dd></div>
                <div><dt>Lapses</dt><dd class="fig">{h.status === "waiting" || !h.lapsesAt ? "—" : formatTime(h.lapsesAt)}</dd></div>
              </dl>
            </div>
            <div class="card actions-card">
              <h2>Actions</h2>
              {canSell(member) ? (
                <div class="stack-actions">
                  <Button
                    disabled={h.status !== "live"}
                    onClick={(e) => {
                      setErrors({});
                      depositAction.setNote(null);
                      deposit.show(e);
                    }}
                    aria-haspopup="dialog"
                  >
                    Record deposit
                  </Button>
                  <Button variant="quiet" disabled={h.status !== "live" && h.status !== "waiting"} pending={page.pending} pendingLabel="Releasing hold" onClick={release.show} aria-haspopup="dialog">
                    Release hold
                  </Button>
                  {h.status === "charter" && h.charterId ? (
                    <Link class="btn btn--quiet" href={`/w/${ws}/charters/${h.charterId}`}>Open charter</Link>
                  ) : null}
                </div>
              ) : (
                <p class="muted">Deposits and releases are made by the charter team.</p>
              )}
              <NoteLine note={page.note} />
            </div>
          </div>
        </>
      ) : null}
      <Dialog handle={deposit} title="Record deposit">
        <form class="form" onSubmit={submitDeposit} noValidate>
          <Field id="deposit-email" label="Client email" type="email" value={email} onInput={setEmail} error={errors.clientEmail} first />
          <fieldset class="choice" aria-describedby={errors.currency ? "deposit-currency-error" : undefined}>
            <legend id="deposit-currency-label">Currency</legend>
            <div role="radiogroup" aria-labelledby="deposit-currency-label" class="choice__options">
              {["EUR", "GBP", "USD"].map((c) => (
                <label key={c} class="choice__option">
                  <input type="radio" name="deposit-currency" value={c} checked={currency === c} onChange={() => setCurrency(c)} />
                  <span>{c}</span>
                </label>
              ))}
            </div>
            {errors.currency ? <p class="field__error" id="deposit-currency-error">{errors.currency}</p> : null}
          </fieldset>
          {quote ? <PriceTable name="Price" currency={quote.currency} lines={quote.lines} totalEur={quote.totalEurMinor} total={quote.totalMinor} /> : <Loader active />}
          <NoteLine note={depositAction.note} />
          <div class="dialog__actions">
            <Button type="submit" pending={depositAction.pending} pendingLabel="Recording deposit" buttonRef={depositButton}>
              Record deposit
            </Button>
            <Button variant="quiet" onClick={deposit.hide}>
              Cancel
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog handle={release} title="Release hold">
        <p>The next hold in line, if any, becomes live at once.</p>
        <div class="dialog__actions">
          <Button variant="quiet" onClick={release.hide}>Keep hold</Button>
          <Button variant="danger" onClick={confirmRelease} pending={page.pending} pendingLabel="Releasing hold">Release hold</Button>
        </div>
      </Dialog>
    </section>
  );
}

export function Charters({ member }: { member: Member }) {
  const ws = member.workspaceSlug;
  const charters = useLoad<{ charters: CharterView[] }>(`/api/w/${ws}/charters`);
  const names = useYachtNames(ws);
  return (
    <section>
      <h1 class="rise">Charters</h1>
      <p class="lede">Which charters Kill Bill has invoiced. Invoicing happens only when a deposit is recorded.</p>
      <Loader active={charters.loading} />
      {charters.data ? (
        <DataTable
          name="Charters"
          captionHidden
          rows={charters.data.charters}
          rowKey={(c) => c.id}
          empty="No charters yet."
          columns={[
            { label: "Yacht", cell: (c) => names.get(c.yachtSlug) ?? c.yachtSlug },
            { label: "Week", cell: (c) => formatDay(c.weekStart) },
            { label: "Client", cell: (c) => <Link href={`/w/${ws}/charters/${c.id}`}>{c.clientName}</Link> },
            { label: "Total", numeric: true, cell: (c) => <span class="fig">{formatMoney(c.currency, c.totalMinor)}</span> },
            { label: "Invoice", cell: (c) => <span class={`pill pill--${c.invoiceStatus}`}>{c.invoiceStatus === "invoiced" ? "Invoiced" : "Not invoiced"}</span> },
          ]}
        />
      ) : null}
    </section>
  );
}

interface ManifestView {
  page: { status: "live" | "ended" | "none"; endsAt: string | null };
  guests: { id: string; fullName: string; nationality?: string | null; dateOfBirth?: string | null; passportNumber?: string | null; photoOnFile?: boolean }[];
}

export function Charter({ member, id }: { member: Member; id: string }) {
  const ws = member.workspaceSlug;
  const charter = useLoad<{ charter: CharterView }>(`/api/w/${ws}/charters/${id}`);
  const manifest = useLoad<ManifestView>(member.role === "finance_lead" ? null : `/api/w/${ws}/charters/${id}/manifest`);
  const c = charter.data?.charter;
  const yacht = useLoad<{ yacht: Yacht }>(c ? `/api/w/${ws}/yachts/${c.yachtSlug}` : null);
  const page = useAction();
  const send = useDialog();
  const end = useDialog();
  const close = useDialog();
  const sendAction = useAction();
  const [lead, setLead] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const sendButton = useRef<HTMLButtonElement>(null);
  const seesPassports = member.role === "captain" || member.role === "fleet_director";

  useEffect(() => {
    const flash = takeFlash(location.pathname);
    if (flash) page.setNote(ok(flash));
  }, []);

  if (charter.result && !charter.result.ok && charter.result.status !== 401) return <NotFoundPage />;

  const submitSend = (event: Event) => {
    event.preventDefault();
    void sendAction.run("Sending page", async () => {
      const result = await api("POST", `/api/w/${ws}/charters/${id}/manifest-page`, { leadGuestName: lead, leadGuestEmail: leadEmail });
      if (result.ok) {
        send.hide();
        await manifest.reload();
        page.setNote(ok(COPY.manifestSent(leadEmail.trim().toLowerCase())));
        return null;
      }
      const found = fieldErrors(result.body);
      setErrors(found);
      sendAction.focusLater(() =>
        focusFirstError([found.leadGuestName ? "lead-name" : "", found.leadGuestEmail ? "lead-email" : ""].filter(Boolean), sendButton.current));
      if (result.body.error === "charter_closed") return bad(COPY.charterAlreadyClosed);
      return result.status === 422 ? null : bad(sharedCopy(result));
    });
  };

  const confirmEnd = () => {
    void page.run("Ending page", async () => {
      const result = await api("POST", `/api/w/${ws}/charters/${id}/manifest-page/end`);
      end.hide();
      await manifest.reload();
      return result.ok ? ok(COPY.pageEnded) : bad(result.body.error === "page_not_live" ? COPY.pageEnded : sharedCopy(result));
    });
  };

  const confirmClose = () => {
    void page.run("Closing charter", async () => {
      const result = await api<{ charter: CharterView }>("POST", `/api/w/${ws}/charters/${id}/close`);
      close.hide();
      await charter.reload();
      await manifest.reload();
      if (result.ok) return ok(COPY.charterClosed(formatTime(result.data.charter.erasesAt!)));
      return bad(result.body.error === "charter_closed" ? COPY.charterAlreadyClosed : sharedCopy(result));
    });
  };

  const m = manifest.data;
  const pageStatus = !m
    ? ""
    : m.page.status === "live"
      ? `Manifest page live until ${formatTime(m.page.endsAt!)}`
      : m.page.status === "ended"
        ? "Manifest page ended"
        : "No manifest page sent";

  return (
    <section>
      <Loader active={!c} />
      {c ? (
        <>
          <h1 class="rise">Charter for {c.clientName}</h1>
          <p class="lede">
            {yacht.data?.yacht.name ?? ""}, week of <span class="fig">{formatDay(c.weekStart)}</span> to <span class="fig">{formatDay(c.weekEnd)}</span>
            {c.status === "closed" ? " · Closed" : ""}
          </p>
          <NoteLine note={page.note} />
          <div class="two-col">
            <div class="card">
              <h2>Price</h2>
              <PriceTable name="Charter lines" currency={c.currency} lines={c.lines} totalEur={c.totalEurMinor} total={c.totalMinor} />
              <dl class="details">
                <div>
                  <dt>Invoice</dt>
                  <dd><span class={`pill pill--${c.invoiceStatus}`}>{c.invoiceStatus === "invoiced" ? "Invoiced" : "Not invoiced"}</span></dd>
                </div>
                {c.killbillInvoiceId ? <div><dt>Kill Bill invoice</dt><dd class="fig mono-wrap">{c.killbillInvoiceId}</dd></div> : null}
                <div><dt>Client email</dt><dd class="mono-wrap">{c.clientEmail}</dd></div>
              </dl>
            </div>
            <div class="card">
              <h2>Guest manifest</h2>
              {member.role === "finance_lead" ? (
                <p class="muted">The guest manifest is kept by the charter team and the captain.</p>
              ) : (
                <>
                  <p class="page-status">{pageStatus}</p>
                  {canSell(member) ? (
                    <div class="stack-actions">
                      <Button onClick={(e) => { setErrors({}); sendAction.setNote(null); send.show(e); }} aria-haspopup="dialog">Send manifest page</Button>
                      {m?.page.status === "live" ? (
                        <Button variant="quiet" onClick={end.show} pending={page.pending} pendingLabel="Ending page" aria-haspopup="dialog">End manifest page</Button>
                      ) : null}
                    </div>
                  ) : null}
                  <DataTable
                    name="Guests"
                    rows={m?.guests ?? []}
                    rowKey={(g) => g.id}
                    empty="No guests yet."
                    columns={
                      seesPassports
                        ? [
                            { label: "Name", cell: (g) => g.fullName },
                            { label: "Nationality", cell: (g) => g.nationality ?? "—" },
                            { label: "Date of birth", cell: (g) => <span class="fig">{g.dateOfBirth ? formatDay(g.dateOfBirth) : "—"}</span> },
                            { label: "Passport number", cell: (g) => <span class="fig">{g.passportNumber ?? "—"}</span> },
                            {
                              label: "Photo",
                              cell: (g) => g.photoOnFile
                                ? <a href={`/api/w/${ws}/charters/${id}/manifest/guests/${g.id}/photo`} target="_blank" rel="noopener">Photo of {g.fullName}</a>
                                : "—",
                            },
                          ]
                        : [{ label: "Name", cell: (g) => g.fullName }]
                    }
                  />
                </>
              )}
              {seesPassports && c.status === "open" ? (
                <Button variant="danger" onClick={close.show} pending={page.pending} pendingLabel="Closing charter" aria-haspopup="dialog">Close charter</Button>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
      <Dialog handle={send} title="Send manifest page">
        <form class="form" onSubmit={submitSend} noValidate>
          <Field id="lead-name" label="Lead guest name" value={lead} onInput={setLead} error={errors.leadGuestName} first />
          <Field id="lead-email" label="Lead guest email" type="email" value={leadEmail} onInput={setLeadEmail} error={errors.leadGuestEmail} />
          <NoteLine note={sendAction.note} />
          <div class="dialog__actions">
            <Button type="submit" pending={sendAction.pending} pendingLabel="Sending page" buttonRef={sendButton}>Send manifest page</Button>
            <Button variant="quiet" onClick={send.hide}>Cancel</Button>
          </div>
        </form>
      </Dialog>
      <Dialog handle={end} title="End manifest page">
        <p>The lead guest's link stops working at once.</p>
        <div class="dialog__actions">
          <Button variant="quiet" onClick={end.hide}>Keep page</Button>
          <Button variant="danger" onClick={confirmEnd}>End page</Button>
        </div>
      </Dialog>
      <Dialog handle={close} title="Close charter">
        <p>Closing ends the manifest page. Passport details are erased after the retention time, leaving only guest names.</p>
        <div class="dialog__actions">
          <Button variant="quiet" onClick={close.hide}>Cancel</Button>
          <Button variant="danger" onClick={confirmClose}>Close charter</Button>
        </div>
      </Dialog>
    </section>
  );
}

interface BrokerView {
  id: string;
  name: string;
  contactName: string;
  email: string;
  notes: string;
  page: { status: "live" | "ended" | "none"; endsAt: string | null };
}

export function Brokers({ member }: { member: Member }) {
  const ws = member.workspaceSlug;
  const brokers = useLoad<{ brokers: BrokerView[] }>(`/api/w/${ws}/brokers`);
  const issue = useDialog();
  const end = useDialog();
  const action = useAction();
  const [target, setTarget] = useState<BrokerView | null>(null);

  const run = (label: string, path: string, success: (b: BrokerView) => Note) => {
    const broker = target!;
    void action.run(label, async () => {
      const result = await api("POST", `/api/w/${ws}/brokers/${broker.id}/${path}`, path === "page" ? {} : undefined);
      issue.hide();
      end.hide();
      await brokers.reload();
      if (result.ok) return success(broker);
      return bad(result.body.error === "page_not_live" ? COPY.pageEnded : sharedCopy(result));
    });
  };

  return (
    <section>
      <h1 class="rise">Brokers</h1>
      <p class="lede">Private availability pages for partner brokers. Times are in Split time.</p>
      <NoteLine note={action.note} />
      <Loader active={brokers.loading} />
      {brokers.data ? (
        <DataTable
          name="Brokers"
          captionHidden
          rows={brokers.data.brokers}
          rowKey={(b) => b.id}
          empty="No brokers yet."
          columns={[
            { label: "Broker", cell: (b) => <><strong>{b.name}</strong><span class="muted block">{b.notes}</span></> },
            { label: "Contact", cell: (b) => <>{b.contactName}<span class="muted block mono-wrap">{b.email}</span></> },
            {
              label: "Page",
              cell: (b) => (
                <span class="fig">{b.page.status === "live" ? `Live until ${formatTime(b.page.endsAt!)}` : b.page.status === "ended" ? "Ended" : "No page"}</span>
              ),
            },
            {
              label: "Actions",
              cell: (b) => (
                <div class="row-actions">
                  <Button onClick={(e) => { setTarget(b); issue.show(e); }} aria-haspopup="dialog">Issue broker page for {b.name}</Button>
                  {b.page.status === "live" ? (
                    <Button variant="quiet" onClick={(e) => { setTarget(b); end.show(e); }} aria-haspopup="dialog">End broker page for {b.name}</Button>
                  ) : null}
                </div>
              ),
            },
          ]}
        />
      ) : null}
      <Dialog handle={issue} title="Issue broker page">
        <p>{target ? `A new private page for ${target.name}, sent to ${target.email}. ` : ""}Any earlier page for this broker ends at once.</p>
        <div class="dialog__actions">
          <Button variant="quiet" onClick={issue.hide}>Cancel</Button>
          <Button pending={action.pending} pendingLabel="Sending page" onClick={() => run("Sending page", "page", (b) => ok(COPY.brokerSent(b.email)))}>Issue page</Button>
        </div>
      </Dialog>
      <Dialog handle={end} title="End broker page">
        <p>{target ? `${target.name}'s page stops working at once.` : ""}</p>
        <div class="dialog__actions">
          <Button variant="quiet" onClick={end.hide}>Keep page</Button>
          <Button variant="danger" pending={action.pending} pendingLabel="Ending page" onClick={() => run("Ending page", "page/end", () => ok(COPY.pageEnded))}>End page</Button>
        </div>
      </Dialog>
    </section>
  );
}
