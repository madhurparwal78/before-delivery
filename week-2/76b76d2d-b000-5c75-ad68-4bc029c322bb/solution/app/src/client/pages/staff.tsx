import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Account, AuditEntry, Booking, CreditMovement, DoorTicket, Enquiry, Gift, OutboxMessage, Reconciliation, Refund, SeasonDetail } from "../../shared/api.ts";
import { AUDITORIUMS, FORMATS, formatMoney } from "../../shared/domain.ts";
import { api } from "../api.ts";
import { useApp } from "../context.tsx";
import { dollarsToCents, localDate, localTime, type Strings } from "../i18n.ts";
import { Dialog, Field, Num, SelectField, type Action, useAction } from "../ui.tsx";

type DoorScreening = { id: string; film_title: string; starts_at: string; auditorium: string };

function StaffFeedback({ t, action }: { t: Strings; action: Action }) {
  return (
    <div class="feedback staff-feedback">
      <div role="status" aria-live="polite" aria-label={t.staffStatus} class="status-line">{action.status}</div>
      <div role="alert" aria-label={t.staffError} class={action.error ? "alert-line is-shown" : "alert-line"}>{action.error ? <p>{action.error}</p> : null}</div>
    </div>
  );
}

function screeningLabel(s: DoorScreening): string {
  return `${s.film_title} — ${localDate(s.starts_at)} ${localTime(s.starts_at)} — ${s.auditorium}`;
}

function DoorSection({ t, action }: { t: Strings; action: Action }) {
  const [screenings, setScreenings] = useState<DoorScreening[]>([]);
  const [screeningId, setScreeningId] = useState("");
  const [tickets, setTickets] = useState<DoorTicket[] | null>(null);
  const [code, setCode] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const current = useRef("");

  const loadList = (id: string) => {
    if (!id) return;
    void api<{ tickets: DoorTicket[] }>("GET", `/api/door/screenings/${encodeURIComponent(id)}/list`).then((r) => {
      if (r.ok && current.current === id) setTickets(r.data.tickets);
    });
  };
  useLayoutEffect(() => {
    void api<{ screenings: DoorScreening[] }>("GET", "/api/door/screenings").then((r) => r.ok && setScreenings(r.data.screenings));
    const timer = setInterval(() => loadList(current.current), 10000);
    return () => clearInterval(timer);
  }, []);

  const choose = (id: string) => {
    current.current = id;
    setScreeningId(id);
    setTickets(null);
    loadList(id);
  };
  const checkIn = (event: Event) => {
    event.preventDefault();
    const value = code.trim().toUpperCase();
    if (!value) return;
    setCode("");
    searchRef.current?.focus();
    const done = value.startsWith("HB-")
      ? action.run(
        () => api<{ checked_in: number; already_checked_in: number; tickets: DoorTicket[] }>("POST", `/api/door/bookings/${encodeURIComponent(value)}/check-in`, {}),
        (data) => t.checkedInBooking(data.checked_in, data.checked_in + data.already_checked_in),
      )
      : action.run(
        () => api<{ ticket: DoorTicket; checked_in_at: string }>("POST", `/api/door/tickets/${encodeURIComponent(value)}/check-in`, {}),
        (data) => t.checkedInSeat(data.ticket.seat),
      );
    void done.then(() => {
      loadList(current.current);
      searchRef.current?.focus();
    });
  };

  return (
    <section id="door" class="staff-section" aria-labelledby="door-heading">
      <h2 id="door-heading" class="panel-title">{t.door}</h2>
      <div class="staff-panes">
        <div class="pane-main">
          <SelectField label={t.screening} value={screeningId} onChange={choose}
            options={[{ value: "", label: t.chooseScreening }, ...screenings.map((s) => ({ value: s.id, label: screeningLabel(s) }))]} />
          <div class="table-wrap">
            <table aria-label={t.doorList} class="data-table compact">
              <thead><tr><th scope="col">{t.seat}</th><th scope="col">{t.initial}</th><th scope="col">{t.ticket}</th><th scope="col">{t.status}</th></tr></thead>
              <tbody>
                {tickets === null ? (screeningId ? <tr class="skeleton"><td colSpan={4}><span /></td></tr> : (
                  <tr><td colSpan={4} class="muted">{t.chooseScreening}</td></tr>
                )) : tickets.length === 0 ? (
                  <tr><td colSpan={4} class="muted">{t.noTickets}</td></tr>
                ) : tickets.map((ticket) => (
                  <tr key={ticket.ticket_code}>
                    <td><Num>{ticket.seat}</Num></td><td>{ticket.initial}</td><td><Num>{ticket.ticket_code}</Num></td>
                    <td><span class={`badge is-${ticket.status}`}>{t.ticketStatus[ticket.status]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <form class="pane-detail stack-form" role="search" onSubmit={checkIn}>
          <div class="field">
            <label for="door-code">{t.doorSearch}</label>
            <input id="door-code" ref={searchRef} type="search" value={code} autocomplete="off" onInput={(e) => setCode(e.currentTarget.value)} />
          </div>
          <button type="submit" class="button primary">{t.checkIn}</button>
        </form>
      </div>
    </section>
  );
}

function ProgrammeSection({ t, locale, action }: { t: Strings; locale: "en" | "fr"; action: Action }) {
  const [seasons, setSeasons] = useState<SeasonDetail[] | null>(null);
  const [slug, setSlug] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [titleFr, setTitleFr] = useState("");
  const [saleDate, setSaleDate] = useState("");
  const [season, setSeason] = useState("");
  const [film, setFilm] = useState("");
  const [format, setFormat] = useState<string>(FORMATS[0]);
  const [auditorium, setAuditorium] = useState<string>(AUDITORIUMS[0]);
  const [first, setFirst] = useState("");
  const [weeks, setWeeks] = useState("1");
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const load = () => {
    void api<{ seasons: SeasonDetail[] }>("GET", "/api/programmer/seasons").then((r) => {
      if (!r.ok) return;
      setSeasons(r.data.seasons);
      setSeason((current) => current || (r.data.seasons[0]?.slug ?? ""));
    });
  };
  useLayoutEffect(load, []);

  const createSeason = (event: Event) => {
    event.preventDefault();
    void action.run(
      () => api<{ season: SeasonDetail }>("POST", "/api/programmer/seasons", { slug: slug.trim(), title_en: titleEn, title_fr: titleFr, public_sale_date: saleDate }),
      (data) => {
        load();
        setSeason(data.season.slug);
        return t.seasonCreated;
      },
    );
  };
  const addScreenings = (event: Event) => {
    event.preventDefault();
    void action.run(
      () => api<{ screenings: { id: string }[] }>("POST", `/api/programmer/seasons/${encodeURIComponent(season)}/screenings`, {
        film_title: film, format, auditorium, first_local: first, weeks: Number.parseInt(weeks, 10) || 0,
      }),
      (data) => {
        load();
        return t.screeningsAdded(data.screenings.length);
      },
    );
  };
  const transition = (target: string, to: "scheduled" | "archived" | "withdrawn", body: Record<string, string> = {}) => {
    void action.run(
      () => api<{ season: SeasonDetail; refunded_bookings: number }>("POST", `/api/programmer/seasons/${encodeURIComponent(target)}/transition`, { to, ...body }),
      (data) => {
        load();
        setWithdrawing(null);
        return to === "scheduled" ? t.scheduled : to === "archived" ? t.archived : t.withdrawn(data.refunded_bookings);
      },
    );
  };

  return (
    <section id="programme" class="staff-section" aria-labelledby="programme-heading">
      <h2 id="programme-heading" class="panel-title">{t.programmeSection}</h2>
      {/* The panes appear with the seasons: rows arriving later would push the forms below the table down. */}
      {seasons === null ? <p class="muted">{t.loading}</p> : <div class="staff-panes">
        <div class="pane-main">
          <div class="table-wrap">
            <table aria-label={t.seasonsTable} class="data-table compact">
              <thead><tr><th scope="col">{t.slug}</th><th scope="col">{t.title}</th><th scope="col">{t.state}</th><th scope="col">{t.publicSale}</th><th scope="col">{t.screeningsCol}</th><th scope="col">{t.actions}</th></tr></thead>
              <tbody>
                {seasons.map((s) => (
                  <tr key={s.slug}>
                    <td><Num>{s.slug}</Num></td>
                    <td>{locale === "fr" ? s.title_fr : s.title_en}</td>
                    <td><span class="badge">{s.state}</span></td>
                    <td><Num>{s.public_sale_date}</Num></td>
                    <td><Num>{s.screenings.length}</Num></td>
                    <td class="row-actions">
                      <button type="button" class="button ghost small" onClick={() => transition(s.slug, "scheduled")}>{t.schedule_}</button>
                      <button type="button" class="button ghost small" onClick={() => transition(s.slug, "archived")}>{t.archive}</button>
                      <button type="button" class="button ghost small" onClick={() => { setReason(""); setWithdrawing(s.slug); }}>{t.withdraw}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div class="pane-detail">
          <form class="stack-form" noValidate onSubmit={createSeason}>
            <h3 class="pane-title">{t.createSeasonHeading}</h3>
            <Field label={t.slug} value={slug} onInput={setSlug} error={action.fields["slug"]} />
            <Field label={t.titleEn} value={titleEn} onInput={setTitleEn} error={action.fields["title_en"]} />
            <Field label={t.titleFr} value={titleFr} onInput={setTitleFr} error={action.fields["title_fr"]} />
            <Field label={t.publicSale} type="date" value={saleDate} onInput={setSaleDate} error={action.fields["public_sale_date"]} />
            <button type="submit" class="button primary" disabled={action.busy}>{t.createSeason}</button>
          </form>
          <form class="stack-form" noValidate onSubmit={addScreenings}>
            <h3 class="pane-title">{t.addScreeningsHeading}</h3>
            <SelectField label={t.season} value={season} onChange={setSeason} options={seasons.map((s) => ({ value: s.slug, label: s.slug }))} error={action.fields["slug"]} />
            <Field label={t.filmTitle} value={film} onInput={setFilm} error={action.fields["film_title"]} />
            <SelectField label={t.format} value={format} onChange={setFormat} options={FORMATS.map((f) => ({ value: f, label: f }))} error={action.fields["format"]} />
            <SelectField label={t.auditorium} value={auditorium} onChange={setAuditorium} options={AUDITORIUMS.map((a) => ({ value: a, label: a }))} error={action.fields["auditorium"]} />
            <Field label={t.firstShowtime} type="datetime-local" value={first} onInput={setFirst} error={action.fields["first_local"]} />
            <Field label={t.weekly} type="number" min={1} max={26} value={weeks} onInput={setWeeks} error={action.fields["weeks"]} />
            <button type="submit" class="button primary" disabled={action.busy}>{t.addScreenings}</button>
          </form>
        </div>
      </div>}
      <Dialog title={t.withdraw} open={withdrawing !== null} onClose={() => setWithdrawing(null)}>
        <form class="dialog-body" noValidate onSubmit={(e) => { e.preventDefault(); if (withdrawing) transition(withdrawing, "withdrawn", { reason }); }}>
          <p>{t.withdrawIntro}</p>
          <Field label={t.reason} value={reason} onInput={setReason} error={action.fields["reason"]} />
          <div class="dialog-actions">
            <button type="submit" class="button primary" disabled={action.busy}>{action.busy ? t.working : t.confirmWithdrawal}</button>
            <button type="button" class="button ghost" onClick={() => setWithdrawing(null)}>{t.close}</button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}

type Lookup =
  | { kind: "booking"; booking: Booking; patron: { name: string; email: string; phone: string | null; account_number: string | null } }
  | { kind: "account"; account: Account; ledger: CreditMovement[] }
  | { kind: "gift"; gift: Gift };

function FinanceSection({ t, locale, action }: { t: Strings; locale: "en" | "fr"; action: Action }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Lookup | null>(null);
  const [miss, setMiss] = useState("");
  const [dialog, setDialog] = useState<"refund" | "goodwill" | "accept" | null>(null);
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState("");
  const [recon, setRecon] = useState<Reconciliation | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [outbox, setOutbox] = useState<OutboxMessage[]>([]);
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [openRef, setOpenRef] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);

  const loadLists = () => {
    void api<{ entries: AuditEntry[] }>("GET", "/api/finance/audit").then((r) => r.ok && setAudit(r.data.entries));
    void api<{ messages: OutboxMessage[] }>("GET", "/api/finance/outbox").then((r) => r.ok && setOutbox(r.data.messages));
    void api<{ enquiries: Enquiry[] }>("GET", "/api/finance/enquiries").then((r) => r.ok && setEnquiries(r.data.enquiries));
  };
  useLayoutEffect(() => {
    loadLists();
    void api<{ checked_at: string }>("GET", "/api/status").then((r) => r.ok && setDay((d) => d || r.data.checked_at.slice(0, 10)));
  }, []);
  useLayoutEffect(() => {
    if (result) resultHeading.current?.focus();
  }, [result]);

  const search = (event: Event) => {
    event.preventDefault();
    const q = query;
    setMiss("");
    void action.run(
      () => api<Lookup>("GET", `/api/finance/lookup?q=${encodeURIComponent(q)}`),
      (data) => {
        setResult(data);
        return "";
      },
      (error) => {
        setResult(null);
        if (error.code === "not_found") {
          action.setError("");
          setMiss(t.lookupMiss(q.trim()));
        }
        searchRef.current?.focus();
      },
    );
  };
  const refreshResult = () => {
    if (!result) return;
    const q = result.kind === "booking" ? result.booking.ref : result.kind === "account" ? result.account.number ?? "" : result.gift.ref;
    void api<Lookup>("GET", `/api/finance/lookup?q=${encodeURIComponent(q)}`).then((r) => r.ok && setResult(r.data));
  };
  const accountNumber = result?.kind === "booking" ? result.patron.account_number : result?.kind === "account" ? result.account.number : null;

  const refund = (event: Event) => {
    event.preventDefault();
    if (result?.kind !== "booking") return;
    void action.run(
      () => api<{ refund: Refund; audit_id: number }>("POST", `/api/finance/bookings/${encodeURIComponent(result.booking.ref)}/refund`, { reason }),
      (data) => {
        setDialog(null);
        refreshResult();
        loadLists();
        return t.refundDone(formatMoney(data.refund.refunded_cents, locale), data.refund.recredited_cents ? formatMoney(data.refund.recredited_cents, locale) : null);
      },
    );
  };
  const goodwill = (event: Event) => {
    event.preventDefault();
    if (!accountNumber) return;
    void action.run(
      () => api<{ credit: { account_number: string; amount_cents: number } }>("POST", "/api/finance/credits", {
        account_number: accountNumber, amount_cents: dollarsToCents(amount) ?? -1, reason,
      }),
      (data) => {
        setDialog(null);
        refreshResult();
        loadLists();
        return t.goodwillDone(formatMoney(data.credit.amount_cents, locale), data.credit.account_number);
      },
    );
  };
  const loadDay = (event: Event) => {
    event.preventDefault();
    void action.run(
      () => api<Reconciliation>("GET", `/api/finance/reconciliation?date=${encodeURIComponent(day)}`),
      (data) => {
        setRecon(data);
        return t.reconStatus[data.status];
      },
    );
  };
  const accept = (event: Event) => {
    event.preventDefault();
    if (!recon) return;
    void action.run(
      () => api<Reconciliation>("POST", "/api/finance/reconciliation/accept", { date: recon.date, reason }),
      (data) => {
        setRecon(data);
        setDialog(null);
        loadLists();
        return t.acceptDone(data.date, formatMoney(data.accepted_difference_cents ?? data.difference_cents, locale));
      },
    );
  };
  const sendReply = (event: Event) => {
    event.preventDefault();
    const enquiry = enquiries.find((e) => e.ref === openRef);
    if (!enquiry) return;
    void action.run(
      () => api<{ reply: { enquiry_ref: string; queued_at: string } }>("POST", `/api/finance/enquiries/${encodeURIComponent(enquiry.ref)}/reply`, { body: reply }),
      () => {
        setReply("");
        loadLists();
        return t.replyDone(enquiry.email);
      },
    );
  };
  const openDialog = (kind: "refund" | "goodwill" | "accept") => {
    setReason("");
    setAmount("");
    setDialog(kind);
  };
  const selected = enquiries.find((e) => e.ref === openRef) ?? null;

  return (
    <section id="finance" class="staff-section" aria-labelledby="finance-heading">
      <h2 id="finance-heading" class="panel-title">{t.finance}</h2>
      <div class="staff-panes">
        <div class="pane-main">
          <form class="search-row" role="search" onSubmit={search}>
            <div class="field">
              <label for="finance-q">{t.findBooking}</label>
              <input id="finance-q" ref={searchRef} type="search" value={query} autocomplete="off" onInput={(e) => setQuery(e.currentTarget.value)} />
            </div>
            <button type="submit" class="button primary" disabled={action.busy}>{t.search}</button>
          </form>
          {miss ? <p class="lookup-miss">{miss}</p> : null}

          <section class="panel" aria-labelledby="recon-heading">
            <h3 id="recon-heading" class="pane-title">{t.reconciliation}</h3>
            <form class="search-row" noValidate onSubmit={loadDay}>
              <Field label={t.businessDay} type="date" value={day} onInput={setDay} error={action.fields["date"]} />
              <button type="submit" class="button primary" disabled={action.busy}>{t.loadDay}</button>
            </form>
            {recon ? (
              <>
                <p class="recon-status"><span class={`badge is-${recon.status}`}>{t.reconStatus[recon.status]}</span> <Num>{recon.date}</Num></p>
                <div class="table-wrap">
                  <table aria-label={t.takings} class="data-table compact">
                    <thead><tr><th scope="col">{t.kind}</th><th scope="col">{t.amount}</th></tr></thead>
                    <tbody>
                      {([
                        [`${t.local} · ${t.figures.admission}`, recon.local.admission_cents],
                        [`${t.local} · ${t.figures.gst}`, recon.local.gst_cents],
                        [`${t.local} · ${t.figures.qst}`, recon.local.qst_cents],
                        [`${t.local} · ${t.figures.uplift}`, recon.local.uplift_cents],
                        [`${t.local} · ${t.figures.gift}`, recon.local.gift_cents],
                        [`${t.local} · ${t.figures.membership}`, recon.local.membership_cents],
                        [`${t.local} · ${t.figures.credit}`, recon.local.credit_spent_cents],
                        [`${t.local} · ${t.figures.refunds}`, recon.local.refunds_cents],
                        [`${t.local} · ${t.figures.net}`, recon.local.net_payments_cents],
                        [`${t.killbill} · ${t.figures.payments}`, recon.killbill.payments_cents],
                        [`${t.killbill} · ${t.figures.refunds}`, recon.killbill.refunds_cents],
                        [`${t.killbill} · ${t.figures.net}`, recon.killbill.net_payments_cents],
                        [t.difference, recon.difference_cents],
                      ] as [string, number][]).map(([label, cents]) => (
                        <tr key={label}><th scope="row">{label}</th><td><Num>{formatMoney(cents, locale)}</Num></td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div class="row-actions">
                  <a class="button ghost" href={`/api/finance/reconciliation.csv?date=${encodeURIComponent(recon.date)}`} download={`halide-takings-${recon.date}.csv`}>{t.downloadCsv}</a>
                  {recon.status === "mismatch" ? <button type="button" class="button primary" onClick={() => openDialog("accept")}>{t.acceptKb}</button> : null}
                </div>
              </>
            ) : null}
          </section>

          <h3 class="pane-title">{t.auditList}</h3>
          <div class="table-wrap">
            <table aria-label={t.auditList} class="data-table compact">
              <thead><tr><th scope="col">{t.time}</th><th scope="col">{t.actor}</th><th scope="col">{t.action}</th><th scope="col">{t.target}</th><th scope="col">{t.amount}</th><th scope="col">{t.reason}</th></tr></thead>
              <tbody>
                {audit.length === 0 ? <tr><td colSpan={6} class="muted">{t.empty}</td></tr> : audit.map((entry) => (
                  <tr key={entry.id}>
                    <td><Num>{localDate(entry.at)} {localTime(entry.at)}</Num></td><td>{entry.actor}</td><td>{entry.action}</td><td><Num>{entry.target}</Num></td>
                    <td><Num>{entry.amount_cents === null ? "" : formatMoney(entry.amount_cents, locale)}</Num></td><td>{entry.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 class="pane-title">{t.outbox}</h3>
          <div class="table-wrap">
            <table aria-label={t.outbox} class="data-table compact">
              <thead><tr><th scope="col">{t.time}</th><th scope="col">{t.key}</th><th scope="col">{t.to}</th><th scope="col">{t.status}</th><th scope="col">{t.attempts}</th></tr></thead>
              <tbody>
                {outbox.length === 0 ? <tr><td colSpan={5} class="muted">{t.empty}</td></tr> : outbox.map((m) => (
                  <tr key={m.seq}>
                    <td><Num>{localDate(m.enqueued_at)} {localTime(m.enqueued_at)}</Num></td><td><Num>{m.key}</Num></td><td>{m.to}</td>
                    <td><span class={`badge is-${m.state}`}>{t.outboxState[m.state]}</span></td><td><Num>{m.attempts.length}</Num></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 class="pane-title">{t.enquiries}</h3>
          <div class="table-wrap">
            <table aria-label={t.enquiries} class="data-table compact">
              <thead><tr><th scope="col">{t.reference}</th><th scope="col">{t.subject}</th><th scope="col">{t.status}</th><th scope="col">{t.actions}</th></tr></thead>
              <tbody>
                {enquiries.length === 0 ? <tr><td colSpan={4} class="muted">{t.empty}</td></tr> : enquiries.map((e) => (
                  <tr key={e.ref}>
                    <td><Num>{e.ref}</Num></td><td>{e.subject}</td><td>{t.enquiryState[e.state]}</td>
                    <td><button type="button" class="button ghost small" onClick={() => { setOpenRef(e.ref); setReply(""); }}>{t.open(e.ref)}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div class="pane-detail">
          {result?.kind === "booking" ? (
            <section class="panel" aria-label={t.bookingRegion(result.booking.ref)}>
              <h3 ref={resultHeading} tabIndex={-1} class="pane-title">{t.bookingRegion(result.booking.ref)}</h3>
              <dl class="facts">
                <div><dt>{t.film}</dt><dd>{result.booking.screening.film_title}</dd></div>
                <div><dt>{t.showtime}</dt><dd><Num>{localDate(result.booking.screening.starts_at)} {localTime(result.booking.screening.starts_at)}</Num></dd></div>
                <div><dt>{t.seatsLabel}</dt><dd><Num>{result.booking.seats.join(", ")}</Num></dd></div>
                <div><dt>{t.status}</dt><dd>{t.bookingState[result.booking.state]}</dd></div>
                <div><dt>{t.total}</dt><dd><Num>{formatMoney(result.booking.total_cents, locale)}</Num></dd></div>
                <div><dt>{t.creditApplied}</dt><dd><Num>{formatMoney(result.booking.credit_applied_cents, locale)}</Num></dd></div>
                <div><dt>{t.patron}</dt><dd>{result.patron.name} · {result.patron.email}{result.patron.phone ? ` · ${result.patron.phone}` : ""}</dd></div>
                {result.patron.account_number ? <div><dt>{t.memberNumber}</dt><dd><Num>{result.patron.account_number}</Num></dd></div> : null}
              </dl>
              <div class="row-actions">
                <button type="button" class="button ghost" onClick={() => openDialog("refund")}>{t.refundBooking}</button>
                {accountNumber ? <button type="button" class="button ghost" onClick={() => openDialog("goodwill")}>{t.issueGoodwill}</button> : null}
              </div>
            </section>
          ) : null}
          {result?.kind === "account" && result.account.number ? (
            <section class="panel" aria-label={t.accountRegion(result.account.number)}>
              <h3 ref={resultHeading} tabIndex={-1} class="pane-title">{t.accountRegion(result.account.number)}</h3>
              <dl class="facts">
                <div><dt>{t.name}</dt><dd>{result.account.name}</dd></div>
                <div><dt>{t.email}</dt><dd>{result.account.email}</dd></div>
                <div><dt>{t.credit}</dt><dd><Num>{formatMoney(result.account.credit_balance_cents, locale)}</Num></dd></div>
              </dl>
              <div class="table-wrap">
                <table aria-label={t.creditMovements} class="data-table compact">
                  <thead><tr><th scope="col">{t.date}</th><th scope="col">{t.kind}</th><th scope="col">{t.amount}</th></tr></thead>
                  <tbody>
                    {result.ledger.length === 0 ? <tr><td colSpan={3} class="muted">{t.noMovements}</td></tr> : result.ledger.map((m) => (
                      <tr key={m.id}><td><Num>{localDate(m.at)}</Num></td><td>{t.movementKind[m.kind]}</td><td><Num>{formatMoney(m.amount_cents, locale)}</Num></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" class="button ghost" onClick={() => openDialog("goodwill")}>{t.issueGoodwill}</button>
            </section>
          ) : null}
          {result?.kind === "gift" ? (
            <section class="panel" aria-label={t.giftRegion(result.gift.ref)}>
              <h3 ref={resultHeading} tabIndex={-1} class="pane-title">{t.giftRegion(result.gift.ref)}</h3>
              <dl class="facts">
                <div><dt>{t.tier}</dt><dd>{result.gift.tier}</dd></div>
                <div><dt>{t.price}</dt><dd><Num>{formatMoney(result.gift.price_cents, locale)}</Num></dd></div>
                <div><dt>{t.recipient}</dt><dd>{result.gift.recipient_name} · {result.gift.recipient_email}</dd></div>
                <div><dt>{t.status}</dt><dd>{t.giftState[result.gift.state]}</dd></div>
              </dl>
            </section>
          ) : null}
          {selected ? (
            <section class="panel" aria-labelledby="enquiry-heading">
              <h3 id="enquiry-heading" class="pane-title"><Num>{selected.ref}</Num> · {selected.subject}</h3>
              <p class="muted">{selected.name} · {selected.email} · <Num>{localDate(selected.received_at)}</Num></p>
              <p class="enquiry-message">{selected.message}</p>
              <form class="stack-form" noValidate onSubmit={sendReply}>
                <Field label={t.reply} value={reply} onInput={setReply} multiline error={action.fields["body"]} />
                <button type="submit" class="button primary" disabled={action.busy}>{action.busy ? t.working : t.sendReply}</button>
              </form>
            </section>
          ) : null}
        </div>
      </div>

      <Dialog title={t.refundBooking} open={dialog === "refund"} onClose={() => setDialog(null)}>
        <form class="dialog-body" noValidate onSubmit={refund}>
          <Field label={t.reason} value={reason} onInput={setReason} error={action.fields["reason"]} />
          <div class="dialog-actions">
            <button type="submit" class="button primary" disabled={action.busy}>{action.busy ? t.working : t.confirmRefund}</button>
            <button type="button" class="button ghost" onClick={() => setDialog(null)}>{t.close}</button>
          </div>
        </form>
      </Dialog>
      <Dialog title={t.issueGoodwill} open={dialog === "goodwill"} onClose={() => setDialog(null)}>
        <form class="dialog-body" noValidate onSubmit={goodwill}>
          <Field label={t.amountDollars} value={amount} onInput={setAmount} inputMode="decimal" error={action.fields["amount_cents"]} />
          <Field label={t.reason} value={reason} onInput={setReason} error={action.fields["reason"]} />
          <div class="dialog-actions">
            <button type="submit" class="button primary" disabled={action.busy}>{action.busy ? t.working : t.issueCredit}</button>
            <button type="button" class="button ghost" onClick={() => setDialog(null)}>{t.close}</button>
          </div>
        </form>
      </Dialog>
      <Dialog title={t.acceptKb} open={dialog === "accept"} onClose={() => setDialog(null)}>
        <form class="dialog-body" noValidate onSubmit={accept}>
          <p>{t.acceptIntro}</p>
          <Field label={t.reason} value={reason} onInput={setReason} error={action.fields["reason"]} />
          <div class="dialog-actions">
            <button type="submit" class="button primary" disabled={action.busy}>{action.busy ? t.working : t.confirm}</button>
            <button type="button" class="button ghost" onClick={() => setDialog(null)}>{t.close}</button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}

export function StaffPage() {
  const { locale, t, me } = useApp();
  const action = useAction();
  const role = me?.role;
  const sections: [string, string][] = role === "door" ? [["door", t.door]] : role === "programmer" ? [["programme", t.programmeSection]] : role === "finance" ? [["finance", t.finance]] : [];
  return (
    <section class="page staff-page">
      <h1 tabIndex={-1} class="page-title">{t.staffHeading}</h1>
      {me === undefined ? <p class="muted">{t.loading}</p> : sections.length === 0 ? (
        <p class="muted"><a href={`/${locale}/signin?next=${encodeURIComponent(location.pathname)}`}>{t.staffOnly}</a></p>
      ) : (
        <>
          <nav aria-label={t.staffNav} class="staff-nav">
            <ul>{sections.map(([id, label]) => <li key={id}><a href={`#${id}`}>{label}</a></li>)}</ul>
          </nav>
          <StaffFeedback t={t} action={action} />
          {role === "door" ? <DoorSection t={t} action={action} /> : null}
          {role === "programmer" ? <ProgrammeSection t={t} locale={locale} action={action} /> : null}
          {role === "finance" ? <FinanceSection t={t} locale={locale} action={action} /> : null}
        </>
      )}
    </section>
  );
}
