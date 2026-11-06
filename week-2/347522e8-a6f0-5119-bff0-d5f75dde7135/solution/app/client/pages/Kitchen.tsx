// My kitchen: hour packs and balance, the hour ledger, documents and statements.

import { Download, FileText, OctagonAlert, Upload } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { DocumentView, LedgerView, PackView, RenterView, StatementView } from "../../shared/api.js";
import { DOCUMENT_KINDS, DOCUMENT_LABEL, type DocumentKind, documentStatusWord } from "../../shared/documents.js";
import { formatHours } from "../../shared/hours.js";
import { formatKitchenDateTime } from "../../shared/kitchenTime.js";
import { MOVEMENT_WORDS, availableAccount, runningBalance, signedMinutes } from "../../shared/ledger.js";
import { api } from "../api.js";
import { Field } from "../components/Field.js";
import { EmptySpike, type Message, StatusRegion, failure, info, success } from "../components/Feedback.js";
import { copy } from "../copy.js";
import { useKitchenToday } from "../kitchenDay.js";
import { usePlace } from "../router.js";
import { useSession } from "../session.js";

const CHECK_MS = 15_000;

interface LedgerRow {
  id: string;
  at: string;
  movement: string;
  minutes: number;
  balance: number;
}

/** One row per movement that touches the available account, oldest first, with the balance after it. */
function ledgerRows(ledger: LedgerView, renterId: string): LedgerRow[] {
  return runningBalance(ledger.entries, availableAccount(renterId)).map(({ entry, balance }) => ({
    id: entry.id,
    at: entry.created_at,
    movement: MOVEMENT_WORDS[entry.kind],
    minutes: signedMinutes(entry),
    balance,
  }));
}

function HourPacks({ renterId, balance, onBought }: { renterId: string; balance: number | null; onBought: () => Promise<void> }) {
  const [packs, setPacks] = useState<PackView[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const last = useRef<boolean | null>(null);

  const check = useCallback(async () => {
    const result = await api<{ packs: PackView[]; purchases_available: boolean }>("/api/packs");
    if (!result.ok) return;
    setPacks(result.data.packs);
    const now = result.data.purchases_available;
    if (now !== last.current) {
      if (!now) setMessage(failure(copy.packs.outage));
      else if (last.current === false) setMessage(success(copy.packs.availableAgain));
    }
    last.current = now;
    setAvailable(now);
  }, []);

  useEffect(() => {
    void check();
    const timer = setInterval(() => void check(), CHECK_MS);
    const onFocus = (): void => void check();
    addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      removeEventListener("focus", onFocus);
    };
  }, [check]);

  const buy = async (pack: PackView): Promise<void> => {
    setBuying(pack.id);
    setMessage(info(copy.packs.pending));
    const result = await api<{ balance_minutes: number }>("/api/purchases", {
      method: "POST",
      json: { pack_id: pack.id },
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    if (result.ok) {
      await onBought();
      setMessage(success(copy.packs.paid(pack.hours * 60)));
    } else if (result.status === 503) {
      last.current = false;
      setAvailable(false);
      setMessage(failure(copy.packs.outage));
    } else if (result.status === 402) setMessage(failure(copy.packs.declined));
    else if (result.error.error === "renter_not_active") setMessage(failure(copy.hold.notActive));
    else setMessage(failure(copy.unexpected));
    setBuying(null);
  };

  return (
    <section className="card" aria-labelledby={`packs-${renterId}`} role="region">
      <h2 id={`packs-${renterId}`} className="card__title">
        Hour packs
      </h2>
      <div className="tally">
        <span className="tally__label">Balance</span>
        <p role="status" aria-label="Hour balance" className="tally__value mono">
          {balance === null ? "—" : `${formatHours(balance)} h`}
        </p>
      </div>
      {available === false ? (
        <p className="banner">
          <OctagonAlert aria-hidden="true" className="banner__icon" />
          {copy.packs.outage}
        </p>
      ) : null}
      <ul className="packs">
        {packs.map((pack) => (
          <li key={pack.id} className="pack">
            <span className="pack__name">{pack.name}</span>
            <span className="pack__hours mono">{pack.hours} hours</span>
            <span className="pack__price mono">${pack.amount_usd}</span>
            <button type="button" className="button button--primary pack__buy" disabled={available !== true || buying !== null} onClick={() => void buy(pack)}>
              {`Buy ${pack.name}`}
            </button>
          </li>
        ))}
      </ul>
      <StatusRegion name="Purchase status" message={message} />
    </section>
  );
}

function HourLedger({ rows }: { rows: LedgerRow[] | null }) {
  return (
    <section className="card card--ledger" aria-labelledby="ledger-title">
      <h2 id="ledger-title" className="card__title">
        Hour ledger
      </h2>
      <div className="table-frame">
        <table className="table table--ledger table--cards" aria-labelledby="ledger-title">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Movement</th>
              <th scope="col" className="num">
                Hours
              </th>
              <th scope="col" className="num">
                Balance
              </th>
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr className="skeleton-row">
                <td colSpan={4}>
                  <span className="skeleton" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4}>
                  <EmptySpike text={copy.empty.ledger} />
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td data-label="When" className="mono">
                    {formatKitchenDateTime(Date.parse(row.at))}
                  </td>
                  <td data-label="Movement">{row.movement}</td>
                  <td data-label="Hours" className="num mono">
                    {row.minutes >= 0 ? `+${formatHours(row.minutes)}` : formatHours(row.minutes)}
                  </td>
                  <td data-label="Balance" className="num mono">
                    {formatHours(row.balance)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function latestByKind(documents: DocumentView[]): Map<DocumentKind, DocumentView> {
  const latest = new Map<DocumentKind, DocumentView>();
  for (const document of documents) if (!latest.has(document.kind)) latest.set(document.kind, document);
  return latest;
}

function Documents({ renterId, today, documents, onUploaded }: { renterId: string; today: string; documents: DocumentView[] | null; onUploaded: () => Promise<void> }) {
  const [message, setMessage] = useState<Message | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const latest = latestByKind(documents ?? []);

  const upload = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const kind = DOCUMENT_KINDS.find((k) => k === data.get("kind")) ?? "coi";
    if (!String(data.get("expires_on") ?? "").trim()) data.delete("expires_on");
    setPending(true);
    setErrors({});
    setMessage(info(copy.upload.pending));
    const result = await api<{ document: DocumentView }>(`/api/renters/${renterId}/documents`, { method: "POST", form: data });
    setPending(false);
    if (result.ok) {
      await onUploaded();
      form.reset();
      setMessage(success(copy.upload.done(kind)));
      return;
    }
    if (result.status === 413) setMessage(failure(copy.upload.tooLarge));
    else if (result.status === 415) setMessage(failure(copy.upload.wrongType));
    else if (result.status === 503) setMessage(failure(copy.upload.storageDown));
    else if (result.status === 422) {
      setErrors(result.error.errors ?? {});
      setMessage(failure(Object.values(result.error.errors ?? {})[0] ?? copy.unexpected));
    } else if (result.error.error === "renter_offboarded") setMessage(failure("Your account is offboarded, so it can't take new documents."));
    else setMessage(failure(copy.unexpected));
  };

  return (
    <section className="card" aria-labelledby="documents-title" role="region">
      <h2 id="documents-title" className="card__title">
        Documents
      </h2>
      <ul className="doc-rows">
        {DOCUMENT_KINDS.map((kind) => {
          const document = latest.get(kind);
          return (
            <li key={kind} className="doc-row">
              <span className="doc-row__label">{DOCUMENT_LABEL[kind]}</span>
              {document ? (
                <>
                  <span className="doc-row__expiry mono">{document.expires_on ? `Expires ${document.expires_on}` : "No expiry"}</span>
                  <span className="stamp">{documentStatusWord(document, today)}</span>
                  <a className="link link--icon" href={`/api/documents/${document.id}/file`} target="_blank" rel="noopener">
                    <FileText aria-hidden="true" className="icon" />
                    {`View ${DOCUMENT_LABEL[kind]}`}
                  </a>
                </>
              ) : (
                <span className="doc-row__missing">Not uploaded yet</span>
              )}
            </li>
          );
        })}
      </ul>
      <form className="form form--upload" onSubmit={(event) => void upload(event)} noValidate>
        <div className="field">
          <label className="field__label" htmlFor="document-kind">
            Document type
          </label>
          <select id="document-kind" name="kind" className="field__input" aria-invalid={errors.kind ? true : undefined}>
            {DOCUMENT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {DOCUMENT_LABEL[kind]}
              </option>
            ))}
          </select>
        </div>
        <Field label="Expiry date" name="expires_on" placeholder="YYYY-MM-DD" inputMode="numeric" error={errors.expires_on ?? null} hint="Optional for a business licence." />
        <div className="field">
          <label className="field__label" htmlFor="document-file">
            Scan file
          </label>
          <input id="document-file" name="file" type="file" className="field__input field__input--file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" />
        </div>
        <StatusRegion name="Upload status" message={message} />
        <button type="submit" className="button button--primary" disabled={pending}>
          <Upload aria-hidden="true" className="icon" />
          Upload document
        </button>
      </form>
    </section>
  );
}

function Statements({ renterId, today, statements, onCreated }: { renterId: string; today: string; statements: StatementView[] | null; onCreated: () => Promise<void> }) {
  const [month, setMonth] = useState("");
  const [message, setMessage] = useState<Message | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setMonth((value) => value || today.slice(0, 7));
  }, [today]);

  const create = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setMessage(info(copy.statement.pending));
    const result = await api<{ statement: StatementView }>(`/api/renters/${renterId}/statements`, { method: "POST", json: { month: month.trim() } });
    setPending(false);
    if (result.ok) {
      await onCreated();
      setMessage(success(copy.statement.ready(result.data.statement.month)));
    } else if (result.status === 503) setMessage(failure(copy.upload.storageDown));
    else if (result.status === 422) setMessage(failure(result.error.errors?.month ?? copy.unexpected));
    else setMessage(failure(copy.unexpected));
  };

  return (
    <section className="card" aria-labelledby="statements-title" role="region">
      <h2 id="statements-title" className="card__title">
        Statements
      </h2>
      <form className="form form--inline" onSubmit={(event) => void create(event)} noValidate>
        <Field label="Statement month" name="month" placeholder="YYYY-MM" value={month} onChange={(event) => setMonth(event.target.value)} />
        <button type="submit" className="button button--primary" disabled={pending}>
          Create statement
        </button>
      </form>
      <StatusRegion name="Statement status" message={message} />
      {statements === null ? (
        <span className="skeleton" />
      ) : statements.length === 0 ? (
        <EmptySpike text={copy.empty.statements} />
      ) : (
        <ul className="statement-list">
          {statements.map((statement) => (
            <li key={statement.id}>
              <a className="link link--icon" href={`/api/statements/${statement.id}/file`} target="_blank" rel="noopener">
                <Download aria-hidden="true" className="icon" />
                {`Download ${statement.month} statement`}
              </a>
              <span className="statement-list__made mono">{formatKitchenDateTime(Date.parse(statement.created_at))}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Kitchen({ renterId }: { renterId: string }) {
  const session = useSession();
  const { notice } = usePlace();
  const heading = useRef<HTMLHeadingElement>(null);
  const today = useKitchenToday();
  const [renter, setRenter] = useState<RenterView | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[] | null>(null);
  const [documents, setDocuments] = useState<DocumentView[] | null>(null);
  const [statements, setStatements] = useState<StatementView[] | null>(null);

  useEffect(() => heading.current?.focus(), []);

  const loadHours = useCallback(async () => {
    const [view, entries] = await Promise.all([api<{ renter: RenterView }>(`/api/renters/${renterId}`), api<LedgerView>(`/api/renters/${renterId}/ledger`)]);
    if (view.ok) setRenter(view.data.renter);
    if (entries.ok) setLedger(ledgerRows(entries.data, renterId));
  }, [renterId]);

  const loadDocuments = useCallback(async () => {
    const result = await api<{ documents: DocumentView[] }>(`/api/renters/${renterId}/documents`);
    if (result.ok) setDocuments(result.data.documents);
    await session.refresh();
  }, [renterId, session]);

  const loadStatements = useCallback(async () => {
    const result = await api<{ statements: StatementView[] }>(`/api/renters/${renterId}/statements`);
    if (result.ok) setStatements(result.data.statements);
  }, [renterId]);

  useEffect(() => {
    void loadHours();
    void loadStatements();
    void api<{ documents: DocumentView[] }>(`/api/renters/${renterId}/documents`).then((result) => {
      if (result.ok) setDocuments(result.data.documents);
    });
  }, [loadHours, loadStatements, renterId]);

  return (
    <div className="screen screen--kitchen">
      <div className="screen__head">
        <h1 ref={heading} tabIndex={-1} className="screen__title">
          My kitchen
        </h1>
        {renter ? <p className="screen__sub">{renter.business_name}</p> : null}
        <StatusRegion name="Application status" message={notice ? success(notice) : null} className="screen__notice" />
      </div>
      {renter === null || ledger === null || documents === null || statements === null || today === null ? (
        <div className="kitchen-grid" aria-busy="true">
          <div className="card card--placeholder">
            <span className="skeleton" />
          </div>
        </div>
      ) : (
      <div className="kitchen-grid">
        <div className="kitchen-grid__packs">
          <HourPacks renterId={renterId} balance={renter.balance_minutes} onBought={loadHours} />
        </div>
        <div className="kitchen-grid__ledger">
          <HourLedger rows={ledger} />
        </div>
        <div className="kitchen-grid__papers">
          <Documents renterId={renterId} today={today} documents={documents} onUploaded={loadDocuments} />
          <Statements renterId={renterId} today={today} statements={statements} onCreated={loadStatements} />
        </div>
      </div>
      )}
    </div>
  );
}
