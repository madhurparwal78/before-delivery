import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Cohort, RosterRow, SharedEntry } from "../../shared/api";
import { formatPrice } from "../../shared/money";
import { api } from "../api";
import { COPY, phaseLabel, rosterNight } from "../copy";
import { useLayout } from "../layout";
import { follow, navigate } from "../router";
import { Dialog } from "../ui/dialog";
import { EmptyNightDrawing } from "../ui/icons";
import { FieldError, Status } from "../ui/Status";

const ROSTER_REFRESH_MS = 30_000;

const percent = (rate: number): string => `${Math.round(rate * 100)}%`;
const statusLabel = (status: RosterRow["status"]): string => (status === "active" ? "Active" : "Refunded");

/** A dollar amount with at most two decimals ("240", "12.50") as whole cents, without floats; null otherwise. */
const PRIVACY_NOTE = "You see aggregates and the entries dreamers choose to share, never private dream text.";

function cents(text: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match?.[1]) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

function NewCohortForm({ onCreated, onNameTaken, focusOnOpen }: { onCreated: (cohort: Cohort) => void; onNameTaken: () => void; focusOnOpen: boolean }) {
  const ids = { title: useId(), name: useId(), starts: useId(), price: useId(), seats: useId() };
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [price, setPrice] = useState("");
  const [seats, setSeats] = useState("12");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusOnOpen) nameRef.current?.focus();
  }, [focusOnOpen]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const priceCents = cents(price);
    if (priceCents === null) {
      setErrors({ price_cents: "Use a price from $1.00 to $1,000.00." });
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ cohort: Cohort }>("POST", "/api/coach/cohorts", {
        name,
        starts_on: startsOn,
        price_cents: priceCents,
        seats: seats.trim() === "" ? null : Number(seats),
      });
      if (result.status === 201) {
        setErrors({});
        setName("");
        setStartsOn("");
        setPrice("");
        onCreated(result.data.cohort);
      } else if (result.data.error === "cohort_name_taken") {
        setErrors({});
        onNameTaken();
      } else {
        setErrors(result.data.errors ?? {});
      }
    } catch {
      setErrors({ name: COPY.needsConnection });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="panel form-stack" aria-labelledby={ids.title} noValidate onSubmit={(event) => void submit(event)}>
      <h2 id={ids.title} className="dialog-title">
        New cohort
      </h2>
      <div className="field">
        <label htmlFor={ids.name}>Cohort name</label>
        <input ref={nameRef} id={ids.name} className="input" value={name} aria-describedby={`${ids.name}-e`} onChange={(e) => setName(e.target.value)} />
        <FieldError id={`${ids.name}-e`} message={errors.name} />
      </div>
      <div className="field">
        <label htmlFor={ids.starts}>First night</label>
        <input id={ids.starts} className="input" inputMode="numeric" placeholder="2026-11-02" value={startsOn} aria-describedby={`${ids.starts}-e`} onChange={(e) => setStartsOn(e.target.value)} />
        <FieldError id={`${ids.starts}-e`} message={errors.starts_on} />
      </div>
      <div className="field">
        <label htmlFor={ids.price}>Seat price (USD)</label>
        <input id={ids.price} className="input" inputMode="decimal" placeholder="240.00" value={price} aria-describedby={`${ids.price}-e`} onChange={(e) => setPrice(e.target.value)} />
        <FieldError id={`${ids.price}-e`} message={errors.price_cents} />
      </div>
      <div className="field">
        <label htmlFor={ids.seats}>Seats</label>
        <input id={ids.seats} className="input" type="number" min={1} max={50} step={1} value={seats} aria-describedby={`${ids.seats}-e`} onChange={(e) => setSeats(e.target.value)} />
        <FieldError id={`${ids.seats}-e`} message={errors.seats} />
      </div>
      <button type="submit" className="button primary" disabled={busy}>
        Create cohort
      </button>
    </form>
  );
}

interface RowActionsProps {
  row: RosterRow;
  onRefund: (row: RosterRow, opener: HTMLButtonElement) => void;
  onRead: (row: RosterRow, entry: SharedEntry, opener: HTMLButtonElement) => void;
}

function RowActions({ row, onRefund, onRead }: RowActionsProps) {
  return (
    <div className="actions">
      {row.status === "active" ? (
        // The row already names the dreamer, so the visible label is the verb the accessible name starts with.
        <button type="button" className="button quiet" aria-label={`Refund ${row.display_name}`} onClick={(e) => onRefund(row, e.currentTarget)}>
          Refund
        </button>
      ) : null}
      {row.shared_entries.map((entry) => (
        // The verb holds one line and the title sits muted beneath it; the accessible name keeps both.
        <button key={entry.entry_id} type="button" className="button quiet read-shared" aria-label={`Read shared entry ${entry.title}`} onClick={(e) => onRead(row, entry, e.currentTarget)}>
          <span className="read-verb">Read shared entry</span>{" "}
          <span className="read-title">{entry.title}</span>
        </button>
      ))}
    </div>
  );
}

/** The cohort chooser per layout. Its accessible name is exactly the cohort name; the phase label describes it. */
/**
 * The phase label under a cohort's name. It is the control's description, never part of its name: the control is
 * named by aria-labelledby on the name alone and described by this visible line. It is aria-hidden so the control's
 * visible text (its label-in-name) is the name alone; aria-describedby still reads it.
 */
function PhaseLine({ id, label }: { id: string; label: string }) {
  return <small id={id} aria-hidden="true">{label}</small>;
}

function CohortChooser({ cohorts, chosen, onChoose, layout }: { cohorts: Cohort[]; chosen: string | null; onChoose: (id: string) => void; layout: string }) {
  const named = (cohort: Cohort, body: (nameId: string, phaseId: string) => ReactNode) => body(`cohort-name-${cohort.id}`, `cohort-phase-${cohort.id}`);
  if (layout === "desktop") {
    return (
      <nav aria-label="Cohort list" className="cohort-nav">
        <ul className="cohort-list">
          {cohorts.map((c) =>
            named(c, (nameId, phaseId) => (
              <li key={c.id}>
                <a className="cohort-link" href={`/coach?cohort=${c.id}`} aria-current={c.id === chosen ? "page" : undefined} aria-labelledby={nameId} aria-describedby={phaseId} onClick={follow}>
                  <span id={nameId}>{c.name}</span>
                  <PhaseLine id={phaseId} label={phaseLabel(c)} />
                </a>
              </li>
            )),
          )}
        </ul>
      </nav>
    );
  }
  if (layout === "tablet") {
    return (
      <div role="tablist" aria-label="Cohort list" className="tabs">
        {cohorts.map((c) =>
          named(c, (nameId, phaseId) => (
            <button key={c.id} type="button" role="tab" className="tab" aria-selected={c.id === chosen} aria-labelledby={nameId} aria-describedby={phaseId} onClick={() => onChoose(c.id)}>
              <span id={nameId}>{c.name}</span>
              <PhaseLine id={phaseId} label={phaseLabel(c)} />
            </button>
          )),
        )}
      </div>
    );
  }
  const selected = cohorts.find((c) => c.id === chosen);
  return (
    <div className="field">
      <label htmlFor="cohort-picker">Cohort</label>
      <select id="cohort-picker" className="input" value={chosen ?? ""} aria-describedby="cohort-picker-phase" onChange={(e) => onChoose(e.target.value)}>
        {cohorts.map((c) => (
          <option key={c.id} value={c.id} title={phaseLabel(c)}>
            {c.name}
          </option>
        ))}
      </select>
      <p id="cohort-picker-phase" className="hint">
        {selected ? phaseLabel(selected) : ""}
      </p>
    </div>
  );
}

type Busy = "publish" | "close" | "digest" | "refund" | null;

export function Coach({ selectedId }: { selectedId: string | null }) {
  const layout = useLayout();
  const [cohorts, setCohorts] = useState<Cohort[] | null>(null);
  const [roster, setRoster] = useState<{ cohort: Cohort; dreamers: RosterRow[] } | null>(null);
  const [updates, setUpdates] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [formOpen, setFormOpen] = useState(false);
  // The first cohort list and roster reads have settled: until then the page is one skeleton, so nothing moves on arrival.
  const [settled, setSettled] = useState(false);
  const [refunding, setRefunding] = useState<{ row: RosterRow; opener: HTMLButtonElement; open: boolean } | null>(null);
  const [reading, setReading] = useState<{ enrollmentId: string; entry: SharedEntry; opener: HTMLButtonElement; open: boolean } | null>(null);
  const formButton = useRef<HTMLButtonElement>(null);
  const readingRef = useRef(reading);
  readingRef.current = reading;
  // Where focus goes when a shared entry is withdrawn under its open dialog: that dreamer's row or card heading.
  const withdrawnFocus = useRef<HTMLElement | null>(null);

  const loadCohorts = useCallback(async () => {
    const result = await api<{ cohorts: Cohort[] }>("GET", "/api/coach/cohorts");
    if (result.status === 200) setCohorts(result.data.cohorts);
    if (result.status !== 200 || result.data.cohorts.length === 0) setSettled(true);
  }, []);

  const chosen = cohorts?.some((c) => c.id === selectedId) ? selectedId : null;
  const chosenRef = useRef(chosen);
  chosenRef.current = chosen;

  // No cohort in the address, or one that is not this coach's: the earliest cohort replaces it without new history.
  useEffect(() => {
    if (!cohorts || chosen !== null) return;
    const earliest = cohorts[0];
    if (selectedId !== null) setUpdates(COPY.unavailableCohort);
    if (earliest) navigate(`/coach?cohort=${earliest.id}`, { replace: true });
  }, [cohorts, chosen, selectedId]);

  const loadRoster = useCallback(async () => {
    if (!chosen) return;
    const result = await api<{ cohort: Cohort; dreamers: RosterRow[] }>("GET", `/api/coach/cohorts/${chosen}/roster`);
    setSettled(true);
    if (result.status !== 200) return;
    const { cohort, dreamers } = result.data;
    // A late answer for a cohort no longer chosen (Back pressed meanwhile) is dropped.
    if (cohort.id !== chosenRef.current) return;
    setRoster({ cohort, dreamers });
    setCohorts((current) => current?.map((c) => (c.id === cohort.id ? cohort : c)) ?? current);
    const open = readingRef.current;
    if (open?.open && !dreamers.some((row) => row.enrollment_id === open.enrollmentId && row.shared_entries.some((e) => e.entry_id === open.entry.entry_id))) {
      withdrawnFocus.current = document.querySelector<HTMLElement>(`[data-dreamer="${open.enrollmentId}"]`);
      setReading({ ...open, open: false });
      setUpdates(COPY.withdrawn);
    }
  }, [chosen]);

  useEffect(() => void loadCohorts(), [loadCohorts]);
  useEffect(() => {
    setRoster(null);
    void loadRoster();
  }, [loadRoster]);

  // The open roster refreshes in place every 30 seconds while the page is visible, and once when it shows again.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void loadRoster();
    }, ROSTER_REFRESH_MS);
    const shown = () => {
      if (document.visibilityState === "visible") void loadRoster();
    };
    document.addEventListener("visibilitychange", shown);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", shown);
    };
  }, [loadRoster]);

  const choose = (id: string) => navigate(`/coach?cohort=${id}`);

  const act = async (kind: "publish" | "close" | "digest") => {
    if (!roster) return;
    setBusy(kind);
    if (kind === "digest") setUpdates(COPY.sendingDigest);
    try {
      const result = await api<{ digest: { to: string; replayed: boolean } }>("POST", `/api/coach/cohorts/${roster.cohort.id}/${kind}`);
      const ok = result.status === 200;
      if (kind === "digest") {
        const sent = result.data.digest;
        setUpdates(
          ok && sent ? (sent.replayed ? `This week's digest was already sent to ${sent.to}.` : `Digest sent to ${sent.to}.`)
            : result.data.error === "mail_unavailable" ? COPY.mailOutage
            : COPY.illegal,
        );
      } else {
        setUpdates(ok ? (kind === "publish" ? COPY.published : COPY.closed) : COPY.illegal);
      }
    } catch {
      setUpdates(kind === "digest" ? COPY.mailOutage : COPY.needsConnection);
    } finally {
      setBusy(null);
      await Promise.all([loadCohorts(), loadRoster()]);
    }
  };

  const refund = async () => {
    if (!refunding) return;
    const { row } = refunding;
    setRefunding({ ...refunding, open: false });
    setBusy("refund");
    try {
      const result = await api("POST", `/api/coach/enrollments/${row.enrollment_id}/refund`);
      const error = result.data.error;
      setUpdates(
        result.status === 200 ? `Refunded ${row.display_name}.`
          : error === "refund_window_closed" ? COPY.refundWindow
          : error === "not_refundable" ? COPY.comped
          : error === "billing_unavailable" ? COPY.billingOutage
          : error === "illegal_transition" ? COPY.alreadyRefunded
          : COPY.illegal,
      );
    } catch {
      setUpdates(COPY.billingOutage);
    } finally {
      setBusy(null);
      await Promise.all([loadCohorts(), loadRoster()]);
    }
  };

  const onCreated = (cohort: Cohort) => {
    setUpdates(COPY.cohortCreated);
    setFormOpen(false);
    setCohorts((current) => [...(current ?? []), cohort]);
    navigate(`/coach?cohort=${cohort.id}`);
    void loadCohorts();
  };

  const cohort = roster?.cohort;
  const openRefund = (row: RosterRow, opener: HTMLButtonElement) => setRefunding({ row, opener, open: true });
  const openShared = (row: RosterRow, entry: SharedEntry, opener: HTMLButtonElement) => {
    withdrawnFocus.current = null;
    setReading({ enrollmentId: row.enrollment_id, entry, opener, open: true });
  };

  const rosterView = !roster ? (
    chosen ? <div className="skeleton" style={{ height: 220 }} aria-hidden="true" /> : null
  ) : roster.dreamers.length === 0 ? (
    <div className="empty">
      <EmptyNightDrawing />
      <p>No dreamers have a seat in this cohort yet.</p>
    </div>
  ) : layout === "phone" ? (
    <div className="dreamer-cards">
      {roster.dreamers.map((row) => (
        <article key={row.enrollment_id} className="dreamer-card panel" aria-labelledby={`dreamer-${row.enrollment_id}`}>
          <h3 id={`dreamer-${row.enrollment_id}`} tabIndex={-1} data-dreamer={row.enrollment_id}>
            {row.display_name}
          </h3>
          <dl>
            <dt>Status</dt>
            <dd>{statusLabel(row.status)}</dd>
            <dt>Night</dt>
            <dd>{rosterNight(row.night_number)}</dd>
            <dt>Recall</dt>
            <dd>{percent(row.recall_rate)}</dd>
            <dt>Technique minutes</dt>
            <dd>{row.technique_minutes}</dd>
            <dt>WBTB nights</dt>
            <dd>{row.wbtb_nights}</dd>
            <dt>Reality checks</dt>
            <dd>{row.reality_checks}</dd>
            <dt>Inner awareness</dt>
            <dd>{row.sign_tallies.inner_awareness}</dd>
            <dt>Action</dt>
            <dd>{row.sign_tallies.action}</dd>
            <dt>Form</dt>
            <dd>{row.sign_tallies.form}</dd>
            <dt>Context</dt>
            <dd>{row.sign_tallies.context}</dd>
          </dl>
          <RowActions row={row} onRefund={openRefund} onRead={openShared} />
        </article>
      ))}
    </div>
  ) : (
    <section className="roster-view" aria-label="Roster view" tabIndex={0}>
      <table className="roster" aria-label="Roster">
        <thead>
          <tr>
            <th scope="col">Dreamer</th>
            <th scope="col">Status</th>
            <th scope="col" className="num">Night</th>
            <th scope="col" className="num">Recall</th>
            <th scope="col" className="num">Technique minutes</th>
            <th scope="col" className="num">WBTB nights</th>
            <th scope="col" className="num">Reality checks</th>
            <th scope="col" className="num">Inner awareness</th>
            <th scope="col" className="num">Action</th>
            <th scope="col" className="num">Form</th>
            <th scope="col" className="num">Context</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {roster.dreamers.map((row) => (
            <tr key={row.enrollment_id}>
              <th scope="row" tabIndex={-1} data-dreamer={row.enrollment_id}>
                {row.display_name}
              </th>
              <td>{statusLabel(row.status)}</td>
              <td className="num">{rosterNight(row.night_number)}</td>
              <td className="num">{percent(row.recall_rate)}</td>
              <td className="num">{row.technique_minutes}</td>
              <td className="num">{row.wbtb_nights}</td>
              <td className="num">{row.reality_checks}</td>
              <td className="num">{row.sign_tallies.inner_awareness}</td>
              <td className="num">{row.sign_tallies.action}</td>
              <td className="num">{row.sign_tallies.form}</td>
              <td className="num">{row.sign_tallies.context}</td>
              <td>
                <RowActions row={row} onRefund={openRefund} onRead={openShared} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint roster-note">{PRIVACY_NOTE}</p>
    </section>
  );

  if (!settled) {
    return (
      <main key="loading" className="coach" aria-busy="true">
        <div className="coach-side">
          <h1>Cohorts</h1>
          <div className="skeleton" style={{ height: 180 }} aria-hidden="true" />
        </div>
        <div className="coach-main">
          <div className="skeleton" style={{ height: 220 }} aria-hidden="true" />
        </div>
      </main>
    );
  }

  return (
    <main key="ready" className="coach">
      <div className="coach-side">
        <h1>Cohorts</h1>
        {cohorts === null ? (
          <div className="skeleton" style={{ height: 180 }} aria-hidden="true" />
        ) : (
          <CohortChooser cohorts={cohorts} chosen={chosen} onChoose={choose} layout={layout} />
        )}
        {cohorts === null ? null : layout === "desktop" ? (
          <NewCohortForm onCreated={onCreated} onNameTaken={() => setUpdates(COPY.nameTaken)} focusOnOpen={false} />
        ) : (
          <>
            <button ref={formButton} type="button" className="button start" aria-expanded={formOpen} onClick={() => setFormOpen(!formOpen)}>
              New cohort
            </button>
            {formOpen ? <NewCohortForm onCreated={onCreated} onNameTaken={() => setUpdates(COPY.nameTaken)} focusOnOpen /> : null}
          </>
        )}
      </div>
      <div className="coach-main">
        <section className="cohort-head panel" aria-labelledby={cohort ? "cohort-heading" : undefined}>
          {cohort ? (
            <>
              <div className="cohort-title">
                <h2 id="cohort-heading">{cohort.name}</h2>
                <span className="pill">{phaseLabel(cohort)}</span>
              </div>
              <p className="hint cohort-facts-line">
                <span>{`First night ${cohort.starts_on}`}</span>
                {" · "}
                <span>{formatPrice(cohort.price_cents)}</span>
                {" · "}
                <span>{`${cohort.seats_left} of ${cohort.seats} seats left`}</span>
              </p>
              <div className="cohort-actions">
                {cohort.phase === "draft" ? (
                  <button type="button" className="button primary" disabled={busy === "publish"} onClick={() => void act("publish")}>
                    Publish cohort
                  </button>
                ) : null}
                {cohort.phase === "technique" ? (
                  <button type="button" className="button" disabled={busy === "close"} onClick={() => void act("close")}>
                    Close cohort
                  </button>
                ) : null}
                {cohort.phase === "baseline" || cohort.phase === "technique" ? (
                  <button type="button" className="button" disabled={busy === "digest"} onClick={() => void act("digest")}>
                    Send weekly digest
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
          <Status label="Coach updates">{updates}</Status>
        </section>
        {rosterView}
        {layout === "phone" ? <p className="hint">{PRIVACY_NOTE}</p> : null}
      </div>
      <Dialog open={refunding?.open ?? false} title="Refund seat" onDismiss={() => refunding && setRefunding({ ...refunding, open: false })} returnFocus={() => refunding?.opener ?? null}>
        <p>{refunding && cohort ? `Refund ${refunding.row.display_name}'s seat of ${formatPrice(cohort.price_cents)}?` : ""}</p>
        <div className="dialog-actions">
          <button type="button" className="button primary" onClick={() => void refund()}>
            Confirm refund
          </button>
          <button type="button" className="button quiet" onClick={() => refunding && setRefunding({ ...refunding, open: false })}>
            Cancel
          </button>
        </div>
      </Dialog>
      <Dialog
        open={reading?.open ?? false}
        title="Shared entry"
        onDismiss={() => reading && setReading({ ...reading, open: false })}
        returnFocus={() => withdrawnFocus.current ?? (reading?.opener.isConnected ? reading.opener : null)}
      >
        {reading ? (
          <>
            <h3>{reading.entry.title || COPY.untitled}</h3>
            <p className="hint">{reading.entry.night_key}</p>
            <p style={{ whiteSpace: "pre-wrap" }}>{reading.entry.text}</p>
            {reading.entry.has_memo && cohort ? (
              <audio controls preload="none" aria-label="Voice memo" src={`/api/coach/cohorts/${cohort.id}/shared/${reading.entry.entry_id}/memo`} style={{ width: "100%" }} />
            ) : null}
          </>
        ) : null}
        <div className="dialog-actions">
          <button type="button" className="button quiet" onClick={() => reading && setReading({ ...reading, open: false })}>
            Close
          </button>
        </div>
      </Dialog>
    </main>
  );
}
