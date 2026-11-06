import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { api, newIdempotencyKey, type Course, type Dashboard, type Enrolment, type LedgerEntry, type Nurse, type Pack, type User } from "../api";
import { ENROLMENT_LABELS, fundingLabel, instantDate, monDYyyy, monthLabel, providerDate } from "../format";
import { Dialog, type CloseDialog } from "../ui/Dialog";
import { Alert, describeFailure, FieldError, useFeedback, WITHDRAWN_COPY } from "../ui/feedback";
import { Empty, Icon } from "../ui/icons";
import { PageHeading } from "../ui/router";
import { useLoad } from "../ui/useLoad";
import { ProgressBar } from "./Learning";

const PACK_COPY: Record<string, string> = {
  course_not_open: WITHDRAWN_COPY,
  payments_unavailable: "Payments are unavailable right now. Your hospital has not been charged. Try again in a few minutes.",
  pack_expired: "This pack has expired.",
  already_enrolled: "This nurse is already enrolled in this course.",
  pack_empty: "No seats left in this pack.",
  seat_in_use: "This nurse has started the course, so the seat can't be returned.",
  already_returned: "This seat has already been returned.",
  storage_unavailable: "File storage is unavailable right now. Try the export again in a few minutes.",
};


/** The Buy button label total (display only; the server charges seats × list price): whole cents, no floats. */
function packTotal(listPrice: string, seats: number): string {
  const [whole, cents] = listPrice.split(".");
  const total = (parseInt(whole ?? "0", 10) * 100 + parseInt(cents ?? "0", 10)) * seats;
  return `${(total - (total % 100)) / 100}.${String(total % 100).padStart(2, "0")}`;
}

function BuySeats({ courses, close, onBought }: { courses: Course[]; close: CloseDialog; onBought: () => void }) {
  const { announce } = useFeedback();
  const [title, setTitle] = useState(courses[0]?.title ?? "");
  const [seats, setSeats] = useState("1");
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const key = useRef({ body: "", key: newIdempotencyKey() });
  const course = courses.find((c) => c.title === title);
  const count = /^\d+$/.test(seats) ? parseInt(seats, 10) : 0;

  const buy = async () => {
    if (pending || !course) return;
    const body = { course_id: course.id, seats: count };
    const signature = JSON.stringify(body);
    if (key.current.body !== signature) key.current = { body: signature, key: newIdempotencyKey() };
    setPending(true);
    setAlert(null);
    try {
      await api("POST", "/api/sponsor/packs", body, { "Idempotency-Key": key.current.key });
      announce(`${count} seats added to your hospital's packs.`);
      close();
      onBought();
    } catch (error) {
      const failure = describeFailure(error, PACK_COPY);
      setFields(failure.fields);
      setAlert(failure.alert);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      {alert && <Alert>{alert}</Alert>}
      <div className="field">
        <label htmlFor="buy-course">Course</label>
        <select id="buy-course" value={title} onChange={(e) => setTitle(e.target.value)} aria-describedby={fields.course_id ? "buy-course-error" : undefined}>
          {courses.map((c) => (
            <option key={c.id} value={c.title}>
              {c.title}
            </option>
          ))}
        </select>
        <FieldError id="buy-course-error" message={fields.course_id} />
      </div>
      <div className="field">
        <label htmlFor="buy-seats">Seats</label>
        <input id="buy-seats" type="number" min={1} max={500} step={1} value={seats} onChange={(e) => setSeats(e.target.value)} aria-describedby={fields.seats ? "buy-seats-error" : "buy-seats-hint"} />
        <p id="buy-seats-hint" className="hint">
          {course ? `$${course.list_price} per seat.` : ""}
        </p>
        <FieldError id="buy-seats-error" message={fields.seats} />
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn secondary" onClick={() => close()}>
          Cancel
        </button>
        <button type="button" data-primary="" className={`btn${pending ? " busy" : ""}`} disabled={pending || !course} onClick={buy}>
          {pending ? "Recording the purchase…" : `Buy ${count} seats for $${course ? packTotal(course.list_price, count) : "0.00"}`}
        </button>
      </div>
    </>
  );
}

function AssignSeat({ pack, nurses, close, onAssigned }: { pack: Pack; nurses: Nurse[]; close: CloseDialog; onAssigned: () => void }) {
  const { announce } = useFeedback();
  const [name, setName] = useState(nurses[0]?.display_name ?? "");
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const nurse = nurses.find((n) => n.display_name === name);

  const assign = async () => {
    if (pending || !nurse) return;
    setPending(true);
    setAlert(null);
    try {
      await api("POST", `/api/sponsor/packs/${pack.id}/assignments`, { nurse_id: nurse.id });
      announce(`Seat assigned to ${nurse.display_name}. We've emailed them an invitation.`);
      close();
      onAssigned();
    } catch (error) {
      setAlert(describeFailure(error, PACK_COPY).alert);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <p className="muted">
        {pack.course_title} · <span className="fig">{pack.balance}</span> seats available
      </p>
      {alert && <Alert>{alert}</Alert>}
      <div className="field">
        <label htmlFor="assign-nurse">Nurse</label>
        <select id="assign-nurse" value={name} onChange={(e) => setName(e.target.value)}>
          {nurses.map((n) => (
            <option key={n.id} value={n.display_name}>
              {n.display_name}
            </option>
          ))}
        </select>
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn secondary" onClick={() => close()}>
          Cancel
        </button>
        <button type="button" data-primary="" className={`btn${pending ? " busy" : ""}`} disabled={pending || !nurse} onClick={assign}>
          {pending ? "Assigning…" : "Assign"}
        </button>
      </div>
    </>
  );
}

function accountLabel(account: string, nurses: Nurse[]): string {
  if (!account.startsWith("nurse:")) return account.charAt(0).toUpperCase() + account.slice(1);
  const nurse = nurses.find((n) => `nurse:${n.id}` === account);
  return `Nurse · ${nurse?.display_name ?? account.slice(6)}`;
}

function Ledger({ pack, nurses }: { pack: Pack; nurses: Nurse[] }) {
  const { data, failure } = useLoad(() => api<{ entries: LedgerEntry[]; balance: number }>("GET", `/api/sponsor/packs/${pack.id}/ledger`));
  if (failure) return <Alert>{failure}</Alert>;
  return (
    <table className="data stacks" aria-label="Ledger">
      <thead>
        <tr>
          <th scope="col">Posted</th>
          <th scope="col">Movement</th>
          <th scope="col">Account</th>
          <th scope="col" className="fig">
            Seats
          </th>
        </tr>
      </thead>
      <tbody>
        {data?.entries.map((e, index) => (
          <tr key={`${e.movement_id}-${index}`}>
            <td data-label="Posted">{instantDate(e.posted_at)}</td>
            <td data-label="Movement">{e.kind.charAt(0).toUpperCase() + e.kind.slice(1)}</td>
            <td data-label="Account">{accountLabel(e.account, nurses)}</td>
            <td className="fig" data-label="Seats">
              {e.seats > 0 ? `+${e.seats}` : e.seats}
            </td>
          </tr>
        ))}
        {data && (
          <tr className="total">
            <td colSpan={3} data-label="Summary">
              Pack balance
            </td>
            <td className="fig" data-label="Seats">
              {data.balance}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function NurseEnrolments({ nurse, user, onReturned }: { nurse: Nurse; user: User; onReturned: () => void }) {
  const { announce, showAlert } = useFeedback();
  const record = useLoad(() => api<{ enrolments: Enrolment[] }>("GET", `/api/sponsor/learners/${nurse.id}`), { not_found: "This nurse has no enrolments funded by your hospital yet." });
  const [pending, setPending] = useState<string | null>(null);

  const returnSeat = async (enrolment: Enrolment) => {
    if (pending || !enrolment.assignment_id) return;
    setPending(enrolment.id);
    showAlert(null);
    try {
      await api("DELETE", `/api/sponsor/assignments/${enrolment.assignment_id}`);
      announce("Seat returned to the pack.");
      onReturned();
      await record.reload();
    } catch (error) {
      showAlert(describeFailure(error, PACK_COPY).alert);
    } finally {
      setPending(null);
    }
  };

  if (record.failure) return <p className="muted">{record.failure}</p>;
  return (
    <table className="data stacks" aria-label="Nurse enrolments">
      <thead>
        <tr>
          <th scope="col">Course</th>
          <th scope="col">State</th>
          <th scope="col">Funding</th>
          <th scope="col">Progress</th>
          <th scope="col">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {record.data?.enrolments.map((e) => (
          <tr key={e.id}>
            <td data-label="Course">{e.course_title}</td>
            <td data-label="State">{ENROLMENT_LABELS[e.state]}</td>
            <td data-label="Funding">{fundingLabel(e, user)}</td>
            <td data-label="Progress">
              <ProgressBar label={`${e.course_title} progress for ${nurse.display_name}`} percent={e.progress_percent} />
            </td>
            <td>
              {e.funding === "seat" && e.state === "confirmed" && (
                <button type="button" className={`btn secondary${pending === e.id ? " busy" : ""}`} disabled={pending !== null} onClick={() => void returnSeat(e)}>
                  {pending === e.id ? "Returning…" : "Return seat"}
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Coverage({ dashboard, onSaved }: { dashboard: Dashboard; onSaved: () => void }) {
  const { announce, showAlert } = useFeedback();
  const today = providerDate(new Date());
  const [percent, setPercent] = useState(dashboard.coverage.coverage_percent);
  const [from, setFrom] = useState(today);
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    showAlert(null);
    try {
      const saved = await api<{ coverage_percent: string; scheduled: { coverage_percent: string; effective_on: string } | null }>("PATCH", "/api/sponsor/coverage", {
        coverage_percent: percent,
        effective_on: from,
      });
      setFields({});
      announce(from === today ? "Tuition coverage saved." : `Tuition coverage of ${saved.scheduled?.coverage_percent ?? percent}% scheduled from ${monDYyyy(from)}.`);
      onSaved();
    } catch (error) {
      const failure = describeFailure(error);
      setFields(failure.fields);
      showAlert(failure.alert);
    } finally {
      setPending(false);
    }
  };

  const scheduled = dashboard.coverage.scheduled;
  return (
    <form className="stack" onSubmit={save} noValidate>
      <p>
        Your hospital covers <strong className="fig">{dashboard.coverage.coverage_percent}%</strong> of each nurse's tuition today.
      </p>
      <div className="form-row">
        <div className="field">
          <label htmlFor="coverage-percent">Tuition covered (%)</label>
          <input id="coverage-percent" type="text" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} aria-invalid={fields.coverage_percent ? true : undefined} aria-describedby={fields.coverage_percent ? "coverage-percent-error" : undefined} />
          <FieldError id="coverage-percent-error" message={fields.coverage_percent} />
        </div>
        <div className="field">
          <label htmlFor="coverage-from">Effective from</label>
          <input id="coverage-from" type="text" inputMode="numeric" placeholder="YYYY-MM-DD" value={from} onChange={(e) => setFrom(e.target.value)} aria-invalid={fields.effective_on ? true : undefined} aria-describedby={fields.effective_on ? "coverage-from-error" : undefined} />
          <FieldError id="coverage-from-error" message={fields.effective_on} />
        </div>
        <div>
          <button type="submit" className={`btn${pending ? " busy" : ""}`} disabled={pending}>
            {pending ? "Saving…" : "Save coverage"}
          </button>
        </div>
      </div>
      {scheduled && <p className="scheduled">{`Scheduled: ${scheduled.coverage_percent}% from ${monDYyyy(scheduled.effective_on)}`}</p>}
    </form>
  );
}

type Months = { month: string; completions: number; hours: string }[];

function MonthlyHours({ initial, thisYear }: { initial: Months; thisYear: number }) {
  const [year, setYear] = useState(String(thisYear));
  const [months, setMonths] = useState(initial);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => setMonths(initial), [initial]);
  const choose = async (next: string) => {
    setYear(next);
    try {
      setMonths((await api<{ months: Months }>("GET", `/api/sponsor/reports/monthly?year=${next}`)).months);
      setFailure(null);
    } catch (error) {
      setFailure(describeFailure(error).alert);
    }
  };
  return (
    <div className="stack">
      <div className="field" style={{ maxWidth: "220px" }}>
        <label htmlFor="report-year">Report year</label>
        <select id="report-year" value={year} onChange={(e) => void choose(e.target.value)}>
          {Array.from({ length: 6 }, (_, i) => String(thisYear - 4 + i)).map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
      {failure && <Alert>{failure}</Alert>}
      <table className="data" aria-label="Monthly hours">
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col" className="fig">
              Completions
            </th>
            <th scope="col" className="fig">
              Hours
            </th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month}>
              <td>
                {monthLabel(m.month)}
              </td>
              <td className="fig">{m.completions}</td>
              <td className="fig">{m.hours}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExportForm() {
  const { announce, showAlert } = useFeedback();
  const today = providerDate(new Date());
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [download, setDownload] = useState<string | null>(null);

  const run = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    showAlert(null);
    try {
      const body = await api<{ export: { rows: number; download_url: string } }>("POST", "/api/sponsor/exports", { from, to });
      setFields({});
      setDownload(body.export.download_url);
      announce(`Export ready: ${body.export.rows} rows.`);
    } catch (error) {
      const failure = describeFailure(error, PACK_COPY);
      setFields(failure.fields);
      showAlert(failure.alert);
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="stack" onSubmit={run} noValidate>
      <div className="form-row">
        <div className="field">
          <label htmlFor="export-from">From</label>
          <input id="export-from" type="text" inputMode="numeric" placeholder="YYYY-MM-DD" value={from} onChange={(e) => setFrom(e.target.value)} aria-invalid={fields.from ? true : undefined} aria-describedby={fields.from ? "export-from-error" : undefined} />
          <FieldError id="export-from-error" message={fields.from} />
        </div>
        <div className="field">
          <label htmlFor="export-to">To</label>
          <input id="export-to" type="text" inputMode="numeric" placeholder="YYYY-MM-DD" value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={fields.to ? true : undefined} aria-describedby={fields.to ? "export-to-error" : undefined} />
          <FieldError id="export-to-error" message={fields.to} />
        </div>
        <div>
          <button type="submit" className={`btn${pending ? " busy" : ""}`} disabled={pending}>
            {pending ? "Preparing your CSV…" : "Export completions CSV"}
          </button>
        </div>
      </div>
      {download && (
        <p>
          <a href={download} className="btn secondary" download>
            <Icon name="download" />
            Download CSV
          </a>
        </p>
      )}
    </form>
  );
}

interface SponsorData {
  dashboard: Dashboard;
  packs: Pack[];
  courses: Course[];
  nurses: Nurse[];
  months: Months;
}

export function Sponsor({ user }: { user: User }) {
  const thisYear = parseInt(providerDate(new Date()).slice(0, 4), 10);
  const page = useLoad<SponsorData>(async () => {
    const [dashboard, packs, courses, nurses, monthly] = await Promise.all([
      api<Dashboard>("GET", "/api/sponsor/dashboard"),
      api<{ packs: Pack[] }>("GET", "/api/sponsor/packs"),
      api<{ courses: Course[] }>("GET", "/api/courses"),
      api<{ learners: Nurse[] }>("GET", "/api/sponsor/learners?q="),
      api<{ months: Months }>("GET", `/api/sponsor/reports/monthly?year=${thisYear}`),
    ]);
    return { dashboard, packs: packs.packs, courses: courses.courses, nurses: nurses.learners, months: monthly.months };
  });
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState<Nurse[] | null>(null);
  const [searchError, setSearchError] = useState<string | undefined>(undefined);
  const [openNurse, setOpenNurse] = useState<string | null>(null);
  const [openLedger, setOpenLedger] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [assigning, setAssigning] = useState<Pack | null>(null);
  const searchSerial = useRef(0);
  const typed = useRef(false);

  const search = async (text: string) => {
    const serial = ++searchSerial.current;
    try {
      const body = await api<{ learners: Nurse[] }>("GET", `/api/sponsor/learners?q=${encodeURIComponent(text)}`);
      if (serial !== searchSerial.current) return;
      setSearched(body.learners);
      setSearchError(undefined);
    } catch (error) {
      if (serial !== searchSerial.current) return;
      const failure = describeFailure(error);
      setSearchError(failure.fields.q ?? failure.alert ?? undefined);
    }
  };

  useEffect(() => {
    if (!typed.current) return;
    const id = window.setTimeout(() => void search(query), 250);
    return () => window.clearTimeout(id);
  }, [query]);

  const refreshSeats = () => {
    void page.reload();
    if (searched) void search(query);
  };

  if (!page.data) return page.failure ? <Alert>{page.failure}</Alert> : <p aria-busy="true" className="muted">Loading your hospital's seats…</p>;
  const sellable = page.data.courses.filter((c) => c.format === "self_paced" && c.state === "published");
  const nurses = page.data.nurses;
  const shown = searched ?? nurses;
  const d = page.data.dashboard;
  const totals: [string, string | number][] = [
    ["Seats purchased", d.seats_purchased],
    ["Assigned", d.seats_assigned],
    ["Available", d.seats_available],
    ["Expired", d.seats_expired],
    ["Completions", d.completions],
    ["Hours awarded", d.hours_awarded],
  ];

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">{user.organisation?.name}</p>
        <PageHeading>Hospital seats</PageHeading>
        <p className="lede">Prepaid seats, tuition coverage and completions for your hospital's nurses, all in one place.</p>
      </div>
      {page.failure && <Alert>{page.failure}</Alert>}
      <section aria-label="Totals" className="totals">
        {totals.map(([label, value]) => (
          <div key={label}>
            <span className="tlabel">{label}</span>
            <span className="value">{value}</span>
          </div>
        ))}
      </section>

      <section className="section" aria-labelledby="packs-heading">
        <div className="section-head">
          <h2 id="packs-heading">Seat packs</h2>
          <button type="button" className="btn" onClick={() => setBuying(true)}>
            <Icon name="plus" />
            Buy seats
          </button>
        </div>
        <table className="data stacks" aria-label="Seat packs">
          <thead>
            <tr>
              <th scope="col">Course</th>
              <th scope="col" className="fig">
                Seats
              </th>
              <th scope="col" className="fig">
                Balance
              </th>
              <th scope="col" className="fig">
                Price
              </th>
              <th scope="col">Expires</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {page.data.packs.map((p) => (
              <Fragment key={p.id}>
                <tr>
                  <td className="course" data-label="Course">
                    {p.course_title}
                  </td>
                  <td className="fig" data-label="Seats">
                    {p.seats_purchased}
                  </td>
                  <td className="fig" data-label="Balance">
                    {p.balance}
                  </td>
                  <td className="fig" data-label="Price">
                    ${p.price_total}
                  </td>
                  <td data-label="Expires">{p.state === "expired" ? `Expired ${instantDate(p.expires_at)}` : instantDate(p.expires_at)}</td>
                  <td className="actions">
                    <div className="row-actions">
                      {p.state === "active" && (
                        <button type="button" className="btn secondary" onClick={() => setAssigning(p)}>
                          Assign seat
                        </button>
                      )}
                      <button type="button" className="btn secondary" aria-expanded={openLedger === p.id} onClick={() => setOpenLedger(openLedger === p.id ? null : p.id)}>
                        {openLedger === p.id ? "Hide ledger" : "Show ledger"}
                      </button>
                    </div>
                  </td>
                </tr>
                {openLedger === p.id && (
                  <tr className="sub">
                    <td colSpan={6}>
                      <Ledger pack={p} nurses={nurses} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {page.data.packs.length === 0 && <Empty>No seat packs yet. Buy seats for a self-paced course to assign them to your nurses.</Empty>}
      </section>

      <section className="section" aria-labelledby="coverage-heading">
        <div className="section-head">
          <h2 id="coverage-heading">Tuition coverage</h2>
        </div>
        <Coverage dashboard={d} onSaved={refreshSeats} />
      </section>

      <section className="section" aria-labelledby="nurses-heading">
        <div className="section-head">
          <h2 id="nurses-heading">Nurses</h2>
        </div>
        <div className="field" style={{ maxWidth: "420px", marginBottom: "var(--s4)" }}>
          <label htmlFor="nurse-search">Search nurses</label>
          <input
            id="nurse-search"
            type="search"
            value={query}
            onChange={(e) => {
              typed.current = true;
              setQuery(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void search(query);
              }
            }}
            aria-invalid={searchError ? true : undefined}
            aria-describedby={searchError ? "nurse-search-error" : undefined}
          />
          <FieldError id="nurse-search-error" message={searchError} />
        </div>
        <table className="data stacks" aria-label="Nurses">
          <thead>
            <tr>
              <th scope="col">Nurse</th>
              <th scope="col">Email</th>
              <th scope="col" className="fig">
                Seats held
              </th>
              <th scope="col" className="fig">
                Hours completed
              </th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((n) => (
              <Fragment key={n.id}>
                <tr>
                  <td data-label="Nurse">{n.display_name}</td>
                  <td data-label="Email">{n.email}</td>
                  <td className="fig" data-label="Seats held">
                    {n.seats_held}
                  </td>
                  <td className="fig" data-label="Hours completed">
                    {n.hours_completed}
                  </td>
                  <td className="actions">
                    <button type="button" className="btn secondary" aria-expanded={openNurse === n.id} onClick={() => setOpenNurse(openNurse === n.id ? null : n.id)}>
                      {openNurse === n.id ? "Hide enrolments" : "Show enrolments"}
                    </button>
                  </td>
                </tr>
                {openNurse === n.id && (
                  <tr className="sub">
                    <td colSpan={5}>
                      <NurseEnrolments nurse={n} user={user} onReturned={refreshSeats} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No nurses match that search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="section" aria-labelledby="monthly-heading">
        <div className="section-head">
          <h2 id="monthly-heading">Monthly hours</h2>
        </div>
        <MonthlyHours initial={page.data.months} thisYear={thisYear} />
      </section>

      <section className="section" aria-labelledby="export-heading">
        <div className="section-head">
          <h2 id="export-heading">Completions export</h2>
          <p className="muted">Up to 366 days of sealed certificates your hospital funded, as a CSV file.</p>
        </div>
        <ExportForm />
      </section>

      {buying && (
        <Dialog title="Buy seats" onClosed={() => setBuying(false)}>
          {(close) => <BuySeats courses={sellable} close={close} onBought={refreshSeats} />}
        </Dialog>
      )}
      {assigning && (
        <Dialog title="Assign seat" onClosed={() => setAssigning(null)}>
          {(close) => <AssignSeat pack={assigning} nurses={nurses} close={close} onAssigned={refreshSeats} />}
        </Dialog>
      )}
    </>
  );
}
