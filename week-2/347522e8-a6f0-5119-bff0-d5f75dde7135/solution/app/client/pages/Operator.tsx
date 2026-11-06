// Operator: renters (review, transitions, adjustments, shelf), stations, compliance links, notifications.

import { Copy, RefreshCw, Ban } from "lucide-react";
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type {
  ComplianceLinkView,
  DocumentView,
  NotificationView,
  RenterSummary,
  RenterView,
  StationSettingsView,
  StationView,
  StationsResponse,
} from "../../shared/api.js";
import { isLinkLive } from "../../shared/complianceLinks.js";
import { DOCUMENT_KINDS, DOCUMENT_LABEL, documentStatusWord } from "../../shared/documents.js";
import { formatHours } from "../../shared/hours.js";
import { formatKitchenDateTime } from "../../shared/kitchenTime.js";
import { type ApiFailure, api } from "../api.js";
import { syncServerClock, useServerNow } from "../clock.js";
import { Field } from "../components/Field.js";
import { EmptySpike, type Message, StatusRegion, failure, info, success } from "../components/Feedback.js";
import { Modal } from "../components/Modal.js";
import { copy } from "../copy.js";
import { RENTER_WORDS, complianceLine } from "../words.js";

type Say = (message: Message) => void;

function operatorError(error: ApiFailure): string {
  switch (error.error) {
    case "documents_incomplete":
      return copy.operator.incomplete;
    case "document_expired":
      return copy.operator.documentExpired;
    case "billing_unavailable":
      return copy.operator.billingDown;
    case "renter_not_active":
      return copy.operator.shelfNotActive;
    case "already_subscribed":
      return "That renter already has a shelf subscription.";
    case "not_subscribed":
      return "That renter has no shelf subscription to end.";
    case "has_future_bookings":
      return "This renter still has upcoming holds or bookings.";
    case "insufficient_hours":
      return `That would take the balance below zero: ${formatHours(Number(error.balance_minutes ?? 0))} hours are available.`;
    case "invalid_transition":
      return `That change isn't possible from ${String(error.from ?? "this status").replace("_", " ")}.`;
    case "validation":
      return Object.values(error.errors ?? {})[0] ?? copy.unexpected;
    default:
      return copy.unexpected;
  }
}

function ReviewDialog({ renterId, today, onClose, onChanged, say }: { renterId: string; today: string; onClose: () => void; onChanged: () => void; say: Say }) {
  const [renter, setRenter] = useState<RenterView | null>(null);
  const [documents, setDocuments] = useState<DocumentView[]>([]);
  const [busy, setBusy] = useState(false);
  const [minutes, setMinutes] = useState("");
  const [reason, setReason] = useState("");
  const [shelfLabel, setShelfLabel] = useState("");

  const load = useCallback(async () => {
    const [view, docs] = await Promise.all([api<{ renter: RenterView }>(`/api/renters/${renterId}`), api<{ documents: DocumentView[] }>(`/api/renters/${renterId}/documents`)]);
    if (view.ok) setRenter(view.data.renter);
    if (docs.ok) setDocuments(docs.data.documents);
  }, [renterId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (run: () => Promise<{ ok: true } | { ok: false; error: ApiFailure }>, done: string): Promise<void> => {
    setBusy(true);
    say(info(copy.operator.saving));
    const result = await run();
    await load();
    onChanged();
    setBusy(false);
    say(result.ok ? success(done) : failure(operatorError(result.error)));
  };

  const title = renter ? `Review ${renter.business_name}` : "Review renter";
  const latest = DOCUMENT_KINDS.map((kind) => ({ kind, document: documents.find((d) => d.kind === kind) ?? null }));
  const shelf = renter?.shelf_subscription ?? null;

  return (
    <Modal title={title} onClose={onClose}>
      {renter ? (
        <div className="review">
          <dl className="facts">
            <div>
              <dt>Contact</dt>
              <dd>{renter.contact_name}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{renter.email}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd className="mono">{renter.phone}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <span className="stamp">{RENTER_WORDS[renter.status]}</span>
              </dd>
            </div>
            <div>
              <dt>Balance</dt>
              <dd className="mono">{formatHours(renter.balance_minutes)} h</dd>
            </div>
            <div>
              <dt>Compliance</dt>
              <dd>{complianceLine(renter.compliance)}</dd>
            </div>
          </dl>
          <h3 className="review__heading">Documents</h3>
          <ul className="doc-rows">
            {latest.map(({ kind, document }) => (
              <li key={kind} className="doc-row">
                <span className="doc-row__label">{DOCUMENT_LABEL[kind]}</span>
                {document ? (
                  <>
                    <span className="doc-row__expiry mono">{document.expires_on ? `Expires ${document.expires_on}` : "No expiry"}</span>
                    <span className="stamp">{documentStatusWord(document, today)}</span>
                    <a className="link" href={`/api/documents/${document.id}/file`} target="_blank" rel="noopener">
                      Open scan
                    </a>
                    {document.status === "pending_review" ? (
                      <span className="doc-row__actions">
                        <button
                          type="button"
                          className="button button--primary"
                          disabled={busy}
                          onClick={() =>
                            void act(() => api(`/api/documents/${document.id}/review`, { method: "POST", json: { decision: "approve" } }), copy.operator.approved(DOCUMENT_LABEL[kind]))
                          }
                        >
                          {`Approve ${DOCUMENT_LABEL[kind]}`}
                        </button>
                        <button
                          type="button"
                          className="button"
                          disabled={busy}
                          onClick={() =>
                            void act(() => api(`/api/documents/${document.id}/review`, { method: "POST", json: { decision: "reject" } }), copy.operator.rejected(DOCUMENT_LABEL[kind]))
                          }
                        >
                          {`Reject ${DOCUMENT_LABEL[kind]}`}
                        </button>
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="doc-row__missing">Not uploaded yet</span>
                )}
              </li>
            ))}
          </ul>
          <div className="review__row">
            <button
              type="button"
              className="button button--primary"
              disabled={busy}
              onClick={() => void act(() => api(`/api/renters/${renterId}/transitions`, { method: "POST", json: { to: "active" } }), copy.operator.activated)}
            >
              Activate renter
            </button>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void act(() => api(`/api/renters/${renterId}/transitions`, { method: "POST", json: { to: "offboarded" } }), copy.operator.offboarded)}
            >
              Offboard renter
            </button>
          </div>
          <h3 className="review__heading">Hour adjustment</h3>
          <form
            className="form form--inline"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void act(
                () => api(`/api/renters/${renterId}/adjustments`, { method: "POST", json: { minutes: Number(minutes.replace("−", "-")), reason: reason.trim() } }),
                copy.operator.adjusted,
              ).then(() => {
                setMinutes("");
                setReason("");
              });
            }}
          >
            <Field label="Adjustment minutes" inputMode="numeric" hint="Multiples of 15; negative to remove." value={minutes} onChange={(event) => setMinutes(event.target.value)} />
            <Field label="Adjustment reason" value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} />
            <button type="submit" className="button button--primary" disabled={busy}>
              Record adjustment
            </button>
          </form>
          <h3 className="review__heading">Walk-in shelf</h3>
          <p className="shelf-line">{shelf ? `Shelf: ${shelf.shelf_label} · billing ${shelf.billing_state.toLowerCase()}` : "Shelf: none"}</p>
          {shelf ? (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void act(() => api(`/api/renters/${renterId}/shelf-subscription`, { method: "DELETE" }), copy.operator.shelfEnded(renter.business_name))}
            >
              End shelf subscription
            </button>
          ) : (
            <form
              className="form form--inline"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void act(
                  () => api(`/api/renters/${renterId}/shelf-subscription`, { method: "POST", json: { shelf_label: shelfLabel.trim() } }),
                  copy.operator.shelfStarted(renter.business_name),
                ).then(() => setShelfLabel(""));
              }}
            >
              <Field label="Shelf label" maxLength={40} value={shelfLabel} onChange={(event) => setShelfLabel(event.target.value)} />
              <button type="submit" className="button button--primary" disabled={busy}>
                Start shelf subscription
              </button>
            </form>
          )}
        </div>
      ) : (
        <span className="skeleton" />
      )}
      <div className="modal__actions">
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

function SettingsDialog({ station, today, onClose, onSaved, say }: { station: StationView; today: string; onClose: () => void; onSaved: () => void; say: Say }) {
  const [values, setValues] = useState({
    effective_from: today,
    hour_weight: String(station.hour_weight),
    off_peak_percent: String(station.off_peak_percent),
    overage_usd_per_hour: station.overage_usd_per_hour,
    buffer_minutes: String(station.buffer_minutes),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof values) => (event: ChangeEvent<HTMLInputElement>) => setValues({ ...values, [key]: event.target.value });

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    say(info(copy.operator.saving));
    const result = await api<{ settings: StationSettingsView }>(`/api/stations/${station.id}/settings`, {
      method: "POST",
      json: {
        effective_from: values.effective_from.trim(),
        hour_weight: Number(values.hour_weight),
        off_peak_percent: Number(values.off_peak_percent),
        overage_usd_per_hour: values.overage_usd_per_hour.trim(),
        buffer_minutes: Number(values.buffer_minutes),
      },
    });
    setBusy(false);
    if (result.ok) {
      say(success(copy.operator.settingsSaved(result.data.settings.effective_from)));
      onSaved();
      onClose();
    } else {
      setErrors(result.error.errors ?? {});
      say(failure(operatorError(result.error)));
    }
  };

  return (
    <Modal title="Station settings" onClose={onClose} lede={<p className="modal__lede">{station.name}</p>}>
      <form className="form" noValidate onSubmit={(event) => void save(event)}>
        <Field label="Effective from" placeholder="YYYY-MM-DD" value={values.effective_from} onChange={set("effective_from")} error={errors.effective_from ?? null} />
        <Field label="Hour weight" inputMode="numeric" hint="1, 2 or 3" value={values.hour_weight} onChange={set("hour_weight")} error={errors.hour_weight ?? null} />
        <Field label="Off-peak percent" inputMode="numeric" hint="50 to 100 in steps of 10" value={values.off_peak_percent} onChange={set("off_peak_percent")} error={errors.off_peak_percent ?? null} />
        <Field label="Overage rate per hour" inputMode="decimal" hint="USD, like 48.00" value={values.overage_usd_per_hour} onChange={set("overage_usd_per_hour")} error={errors.overage_usd_per_hour ?? null} />
        <Field label="Buffer minutes" inputMode="numeric" hint="0 to 120 in steps of 15" value={values.buffer_minutes} onChange={set("buffer_minutes")} error={errors.buffer_minutes ?? null} />
        <div className="modal__actions">
          <button type="submit" className="button button--primary" disabled={busy}>
            Save settings
          </button>
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </div>
      </form>
    </Modal>
  );
}

const EXPIRY_CHOICES = [
  { label: "1 hour", seconds: 3600 },
  { label: "1 day", seconds: 86_400 },
  { label: "7 days", seconds: 604_800 },
  { label: "30 days", seconds: 2_592_000 },
];

function linkState(link: ComplianceLinkView, now: number | null): string {
  if (link.revoked_at) return "Revoked";
  if (now !== null && !isLinkLive(false, Date.parse(link.expires_at), now)) return "Expired";
  return `Live until ${formatKitchenDateTime(Date.parse(link.expires_at))}`;
}

function ComplianceLinks({ say }: { say: Say }) {
  const [links, setLinks] = useState<ComplianceLinkView[] | null>(null);
  const [label, setLabel] = useState("");
  const [seconds, setSeconds] = useState(86_400);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const now = useServerNow(30_000);

  const load = useCallback(async () => {
    const result = await api<{ links: ComplianceLinkView[] }>("/api/compliance-links");
    if (result.ok) setLinks(result.data.links);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async <T,>(call: Promise<{ ok: true; data: T } | { ok: false; error: ApiFailure }>, done: (data: T) => string): Promise<void> => {
    setBusy(true);
    say(info(copy.operator.saving));
    const result = await call;
    await load();
    setBusy(false);
    say(result.ok ? success(done(result.data)) : failure(operatorError(result.error)));
  };

  const create = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void run(api<{ link: ComplianceLinkView }>("/api/compliance-links", { method: "POST", json: { label: label.trim(), expires_in_seconds: seconds } }), (data) => {
      setLabel("");
      return copy.operator.linkCreated(formatKitchenDateTime(Date.parse(data.link.expires_at)));
    });
  };

  const copyLink = async (link: ComplianceLinkView): Promise<void> => {
    await navigator.clipboard.writeText(`${location.origin}${link.url}`);
    setCopied(link.id);
    setTimeout(() => setCopied((current) => (current === link.id ? null : current)), 2000);
  };

  return (
    <section className="card" aria-labelledby="links-title" role="region">
      <h2 id="links-title" className="card__title">
        Compliance links
      </h2>
      <form className="form form--inline" onSubmit={create} noValidate>
        <Field label="Link label" maxLength={80} placeholder="Health inspector" value={label} onChange={(event) => setLabel(event.target.value)} />
        <div className="field">
          <label className="field__label" htmlFor="link-expiry">
            Expires after
          </label>
          <select id="link-expiry" className="field__input" value={seconds} onChange={(event) => setSeconds(Number(event.target.value))}>
            {EXPIRY_CHOICES.map((choice) => (
              <option key={choice.seconds} value={choice.seconds}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="button button--primary" disabled={busy}>
          Create link
        </button>
      </form>
      {links === null ? (
        <span className="skeleton" />
      ) : links.length === 0 ? (
        <EmptySpike text={copy.empty.links} />
      ) : (
        <ul className="links pane" tabIndex={0} aria-label="Link list">
          {links.map((link) => {
            const state = linkState(link, now);
            const open = !link.revoked_at;
            return (
              <li key={link.id} className="links__item">
                <span className="links__label">{link.label}</span>
                <span className="links__state">{state.startsWith("Live") ? <span className="mono">{state}</span> : <span className="stamp">{state}</span>}</span>
                <span className="links__actions">
                  {open && !state.startsWith("Expired") ? (
                    <>
                      <button type="button" className="button" onClick={() => void copyLink(link)}>
                        <Copy aria-hidden="true" className="icon" />
                        Copy link<span className="visually-hidden">{` ${link.label}`}</span>
                      </button>
                      {copied === link.id ? <span className="copied">Copied</span> : null}
                    </>
                  ) : null}
                  {open ? (
                    <>
                      <button type="button" className="button" disabled={busy} onClick={() => void run(api(`/api/compliance-links/${link.id}/regenerate`, { method: "POST", json: {} }), () => copy.operator.linkRegenerated)}>
                        <RefreshCw aria-hidden="true" className="icon" />
                        Regenerate<span className="visually-hidden">{` ${link.label}`}</span>
                      </button>
                      <button type="button" className="button" disabled={busy} onClick={() => void run(api(`/api/compliance-links/${link.id}/revoke`, { method: "POST", json: {} }), () => copy.operator.linkRevoked)}>
                        <Ban aria-hidden="true" className="icon" />
                        Revoke<span className="visually-hidden">{` ${link.label}`}</span>
                      </button>
                    </>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function Operator() {
  const heading = useRef<HTMLHeadingElement>(null);
  const [today, setToday] = useState<string | null>(null);
  const [renters, setRenters] = useState<RenterSummary[] | null>(null);
  const [stations, setStations] = useState<StationView[] | null>(null);
  const [notifications, setNotifications] = useState<NotificationView[] | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [setting, setSetting] = useState<StationView | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  useEffect(() => heading.current?.focus(), []);

  const loadRenters = useCallback(async () => {
    const result = await api<{ renters: RenterSummary[] }>("/api/renters");
    if (result.ok) setRenters(result.data.renters);
  }, []);
  const loadStations = useCallback(async () => {
    const result = await api<StationsResponse>("/api/stations");
    if (!result.ok) return;
    syncServerClock(result.data.server_now);
    setToday(result.data.date);
    setStations(result.data.stations);
  }, []);
  const loadNotifications = useCallback(async () => {
    const result = await api<{ notifications: NotificationView[] }>("/api/notifications");
    if (result.ok) setNotifications(result.data.notifications);
  }, []);

  useEffect(() => {
    void loadRenters();
    void loadStations();
    void loadNotifications();
    const timer = setInterval(() => void loadNotifications(), 15_000);
    return () => clearInterval(timer);
  }, [loadRenters, loadStations, loadNotifications]);

  return (
    <div className="screen screen--operator">
      <div className="screen__head">
        <h1 ref={heading} tabIndex={-1} className="screen__title">
          Operator
        </h1>
        <StatusRegion name="Operator status" message={message} className="screen__notice" />
      </div>
      {renters === null || stations === null || notifications === null ? (
        <div className="operator-grid" aria-busy="true">
          <div className="card card--placeholder">
            <span className="skeleton" />
          </div>
          <div className="card card--placeholder">
            <span className="skeleton" />
          </div>
        </div>
      ) : (
      <div className="operator-grid">
        <section className="card" aria-labelledby="renters-title">
          <h2 id="renters-title" className="card__title">
            Renters
          </h2>
          <div className="table-frame table-frame--pane">
            <table className="table table--cards" aria-labelledby="renters-title">
              <thead>
                <tr>
                  <th scope="col">Business</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">
                    Balance
                  </th>
                  <th scope="col">Compliance</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {renters.map((renter) => (
                  <tr key={renter.id}>
                    <td data-label="Business">
                      <strong>{renter.business_name}</strong>
                      <span className="cell-sub">{renter.contact_name}</span>
                    </td>
                    <td data-label="Status">
                      <span className="stamp">{RENTER_WORDS[renter.status]}</span>
                    </td>
                    <td data-label="Balance" className="num mono">
                      {formatHours(renter.balance_minutes)} h
                    </td>
                    <td data-label="Compliance">{complianceLine(renter.compliance).replace("Compliance: ", "")}</td>
                    <td data-label="Actions">
                      <button type="button" className="button" onClick={() => setReviewing(renter.id)}>
                        Review<span className="visually-hidden">{` ${renter.business_name}`}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card" aria-labelledby="stations-title">
          <h2 id="stations-title" className="card__title">
            Stations
          </h2>
          <div className="table-frame">
            <table className="table table--cards" aria-labelledby="stations-title">
              <thead>
                <tr>
                  <th scope="col">Station</th>
                  <th scope="col">In force today</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {stations.map((station) => (
                  <tr key={station.id}>
                    <td data-label="Station">
                      <strong className="station-name">{station.name}</strong>
                      {station.upcoming_settings.map((row) => (
                        <span key={row.effective_from} className="cell-sub mono">
                          {`From ${row.effective_from}: ×${row.hour_weight} · ${row.off_peak_percent}% · $${row.overage_usd_per_hour}/h · ${row.buffer_minutes} min`}
                        </span>
                      ))}
                    </td>
                    <td data-label="In force today" className="mono">
                      <span className="rates">
                        <span>{`Weight ×${station.hour_weight}`}</span>
                        <span>{`Off-peak ${station.off_peak_percent}%`}</span>
                        <span>{`Overage $${station.overage_usd_per_hour}/h`}</span>
                        <span>{`Buffer ${station.buffer_minutes} min`}</span>
                      </span>
                    </td>
                    <td data-label="Actions">
                      <button type="button" className="button" onClick={() => setSetting(station)}>
                        Change settings<span className="visually-hidden">{` for ${station.name}`}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <ComplianceLinks say={setMessage} />
        <section className="card" aria-labelledby="notifications-title">
          <h2 id="notifications-title" className="card__title">
            Notifications
          </h2>
          <div className="table-frame table-frame--pane" tabIndex={0} role="region" aria-label="Notification list">
            <table className="table table--cards" aria-labelledby="notifications-title">
              <thead>
                <tr>
                  <th scope="col">Queued at</th>
                  <th scope="col">To</th>
                  <th scope="col">Subject</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">
                    Attempts
                  </th>
                </tr>
              </thead>
              <tbody>
                {notifications.map((note) => (
                  <tr key={note.id}>
                    <td data-label="Queued at" className="mono">
                      {formatKitchenDateTime(Date.parse(note.created_at))}
                    </td>
                    <td data-label="To" className="cell-wrap">
                      {note.to}
                    </td>
                    <td data-label="Subject" className="cell-wrap">
                      {note.subject}
                    </td>
                    <td data-label="Status">
                      <span className="stamp">{note.status === "sent" ? "Sent" : "Queued"}</span>
                    </td>
                    <td data-label="Attempts" className="num mono">
                      {note.attempts}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      )}
      {reviewing && today ? (
        <ReviewDialog renterId={reviewing} today={today} onClose={() => setReviewing(null)} onChanged={() => void loadRenters()} say={setMessage} key={reviewing} />
      ) : null}
      {setting && today ? <SettingsDialog station={setting} today={today} onClose={() => setSetting(null)} onSaved={() => void loadStations()} say={setMessage} /> : null}
    </div>
  );
}
