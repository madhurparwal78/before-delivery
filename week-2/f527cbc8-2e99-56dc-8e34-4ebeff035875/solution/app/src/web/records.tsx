// Horses with the client import, Invoices with honest card payments, and Prices with the API tokens (brief: Screens
// and layout; Interactions, Paying, Read-back, Other dialogs; Feedback states).
import { type CSSProperties, type FormEvent, useEffect, useRef, useState } from "react";
import {
  type ApiToken,
  type Horse,
  type ImportError,
  type ImportResult,
  type Invoice,
  type PriceList,
  type Prices,
  type ReadBack,
  type WorkCode,
  freshKey,
  get,
  request,
} from "./api";
import { failure } from "./days";
import { CARDS, DUNNING_LABELS, INVOICE_LABELS, SERVICE_NAMES, WORK_CODES, centsToDollarText, dollars, parseDollars } from "./format";
import { dueText } from "./horse";
import { rowMotion, useLiveRows, useSequence } from "./motion";
import { horsePath } from "./router";
import { useSession } from "./session";
import {
  AppLink,
  Button,
  Empty,
  Field,
  Modal,
  NotAvailable,
  Skeleton,
  StatusTag,
  billingCopy,
  focusFirstInvalid,
  focusKey,
  focusWhenReady,
  useAction,
  useNotify,
  usePendingFlag,
  useReconciled,
  useRefresh,
} from "./ui";

const PAGE_NOT_AVAILABLE = "This page isn't available.";

/** Loads one list on every refresh; `forbidden` when the caller's role may not read it. */
function useList<T>(path: string, epoch = 0): T[] | null | "forbidden" {
  const { tick } = useRefresh();
  const [list, setList] = useState<T[] | null | "forbidden">(null);
  useEffect(() => {
    let live = true;
    void get<T[]>(path).then((result) => {
      if (!live) return;
      if (result.ok) setList(result.data);
      else if (result.status === 403) setList("forbidden");
    });
    return () => {
      live = false;
    };
  }, [path, tick, epoch]);
  return list;
}

// ---- Horses and the client import ----

export function HorsesScreen() {
  const { user } = useSession();
  const [epoch, setEpoch] = useState(0);
  const horses = useList<Horse>("/api/horses", epoch);
  const sorted = Array.isArray(horses) ? [...horses].sort((a, b) => a.name.localeCompare(b.name)) : null;
  const { list, ref } = useLiveRows(sorted, (horse) => horse.id);
  const [importing, setImporting] = useState(false);
  if (horses === "forbidden") return <NotAvailable copy={PAGE_NOT_AVAILABLE} />;
  return (
    <section className="sheet" aria-labelledby="horses-title">
      <div className="page-head">
        <h1 id="horses-title" className="page-title">
          Horses
        </h1>
        {user.role === "farrier" ? (
          <Button data-focus="import-csv" onClick={() => setImporting(true)}>
            Import CSV
          </Button>
        ) : null}
      </div>
      {sorted === null ? (
        <Skeleton />
      ) : sorted.length === 0 ? (
        <Empty>No horses yet.</Empty>
      ) : (
        <div className="table-scroll">
          <table className="ledger" aria-label="Horses">
            <thead>
              <tr>
                {["Horse", "Barn", "Stall", "Cycle (weeks)", "Last worked", "Due"].map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((entry) => {
                const horse = entry.row;
                return (
                  <tr key={entry.key} ref={ref(entry.key)} {...rowMotion(entry)}>
                    <td data-label="Horse">
                      <AppLink href={horsePath(horse.id)}>{horse.name}</AppLink>
                    </td>
                    <td data-label="Barn">{horse.barn.name}</td>
                    <td data-label="Stall" className="num">
                      {horse.stall}
                    </td>
                    <td data-label="Cycle (weeks)" className="num">
                      {horse.cycle_weeks}
                    </td>
                    <td data-label="Last worked" className="num">
                      {horse.last_worked_date ?? "—"}
                    </td>
                    <td data-label="Due">
                      <span className="due-tag num" data-due={horse.due_status}>
                        {dueText(horse)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {user.role === "farrier" ? (
        <ImportDialog
          open={importing}
          onClose={(imported) => {
            setImporting(false);
            focusWhenReady(focusKey("import-csv"));
            if (imported) setEpoch((value) => value + 1);
          }}
        />
      ) : null}
    </section>
  );
}

/** The client list import: a refused file keeps the dialog open with every bad row listed. */
function ImportDialog({ open, onClose }: { open: boolean; onClose: (imported: boolean) => void }) {
  const notify = useNotify();
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<ImportError[]>([]);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [busy, run] = useAction();
  useEffect(() => {
    if (open) {
      setErrors([]);
      setFieldError(undefined);
    }
  }, [open]);

  function submit(event: FormEvent): void {
    event.preventDefault();
    void run("Importing…", async () => {
      if (!file) {
        setFieldError("This is required.");
        notify("Check the highlighted fields.", "error");
        focusWhenReady("#csv-file");
        return;
      }
      const result = await request<ImportResult>("POST", "/api/imports", {
        raw: { data: file, type: "text/csv" },
        idempotencyKey: freshKey(),
      });
      if (result.ok) {
        const c = result.data;
        notify(
          `Import finished: ${c.created_owners} owners created, ${c.matched_owners} matched, ${c.created_horses} horses created, ${c.updated_horses} updated.`,
          "success",
        );
        setFile(null);
        onClose(true);
      } else if (result.error.error === "import_invalid") {
        setErrors(result.error.import_errors ?? []);
        notify("Nothing was imported. Fix the rows listed and try again.", "error");
        focusWhenReady(() => document.querySelector<HTMLElement>("#import-errors"));
      } else
        notify(
          failure(result.error, { idempotency_in_progress: "This import is still running.", payload_too_large: "That file is over 1,000,000 bytes." }, result.retryAfter),
          "error",
        );
    });
  }

  return (
    <Modal title="Import CSV" open={open} onDismiss={() => onClose(false)}>
      <form className="dialog-form" onSubmit={submit} noValidate>
        <p className="dialog-body">
          One row per horse with the header <code>owner_name,owner_email,owner_phone,horse_name,barn_name,stall,cycle_weeks</code>. A file with any bad
          row imports nothing.
        </p>
        <Field label="CSV file" error={fieldError}>
          {(props) => <input {...props} id="csv-file" type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />}
        </Field>
        {errors.length ? (
          <div className="table-scroll import-errors">
            <table className="ledger" aria-label="Import errors" id="import-errors" tabIndex={-1}>
              <thead>
                <tr>
                  <th scope="col">Line</th>
                  <th scope="col">Column</th>
                  <th scope="col">Code</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((error) => (
                  <tr key={`${error.line}-${error.column}-${error.code}`}>
                    <td data-label="Line" className="num">
                      {error.line}
                    </td>
                    <td data-label="Column">
                      <code>{error.column}</code>
                    </td>
                    <td data-label="Code">
                      <code>{error.code}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <div className="dialog-actions">
          <Button type="submit" variant="primary" busy={busy}>
            Import
          </Button>
          <Button onClick={() => onClose(false)}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

// ---- Invoices ----

const RECONCILIATION_LABELS: Record<ReadBack["status"], string> = { matched: "Matched", mismatch: "Mismatch", unavailable: "Unavailable" };

/** The farrier's read-back of every listed invoice against a live Kill Bill read, a few at a time. */
function useReadBack(invoices: Invoice[] | null, enabled: boolean): Record<string, ReadBack["status"]> {
  const [results, setResults] = useState<Record<string, ReadBack["status"]>>({});
  useEffect(() => {
    if (!enabled || !invoices) return;
    let live = true;
    const queue = [...invoices];
    const worker = async (): Promise<void> => {
      for (let invoice = queue.shift(); invoice && live; invoice = queue.shift()) {
        const id = invoice.id;
        const result = await get<ReadBack>(`/api/invoices/${encodeURIComponent(id)}/reconciliation`);
        if (live && result.ok) setResults((current) => ({ ...current, [id]: result.data.status }));
      }
    };
    void Promise.all([worker(), worker(), worker(), worker()]);
    return () => {
      live = false;
    };
  }, [invoices, enabled]);
  return results;
}

/** The decline copy: soft, hard, or any decline on an invoice that was already blocked (brief: Feedback states). */
function declineCopy(before: Invoice, after: Invoice | undefined, code: string | undefined): string {
  if (before.dunning_state === "blocked") return "Your card was declined. This invoice is still unpaid.";
  const where = `${before.horse.name} on ${before.business_date}`;
  if (code === "do_not_honor") return `Account on hold: ${where}. New bookings are on hold until this invoice is paid.`;
  return `Payment failed: ${where}. We will try again on ${after?.dunning_next_try ?? before.business_date}.`;
}

export function InvoicesScreen() {
  const { user } = useSession();
  const { refresh } = useRefresh();
  const notify = useNotify();
  const play = useSequence();
  const reconciled = useReconciled();
  const [epoch, setEpoch] = useState(0);
  const invoices = useList<Invoice>("/api/invoices", epoch);
  const [card, setCard] = useState<string>(CARDS[0].token);
  const [paying, setPaying] = useState<string | null>(null);
  const owner = user.role === "owner";
  const list = Array.isArray(invoices) ? invoices : null;
  const readBack = useReadBack(list, user.role === "farrier");
  const { list: rows, ref } = useLiveRows(list, (invoice) => invoice.id);

  useEffect(() => {
    if (!list) return;
    reconciled(
      list.map((invoice) => ({
        id: invoice.id,
        pending: invoice.status === "pending",
        copy: billingCopy(invoice.kind, invoice.horse.name, invoice.total_cents),
        element: () => document.querySelector<HTMLElement>(`[data-invoice="${CSS.escape(invoice.id)}"]`),
      })),
    );
  }, [list, reconciled]);
  usePendingFlag("invoices", Boolean(list?.some((invoice) => invoice.status === "pending")));

  if (invoices === "forbidden") return <NotAvailable copy={PAGE_NOT_AVAILABLE} />;

  /** One payment request with a fresh key; the row keeps its status until the server answers 201. */
  async function pay(invoice: Invoice): Promise<void> {
    if (paying) return;
    setPaying(invoice.id);
    notify("Recording payment…", "pending");
    const result = await request<Invoice>("POST", `/api/invoices/${encodeURIComponent(invoice.id)}/payments`, {
      body: { card_token: card },
      idempotencyKey: freshKey(),
    });
    setPaying(null);
    const row = (): HTMLElement | null => document.querySelector<HTMLElement>(`[data-invoice="${CSS.escape(invoice.id)}"]`);
    if (result.ok) {
      setEpoch((value) => value + 1);
      const copy = `Payment of ${dollars(invoice.balance_cents)} recorded.`;
      requestAnimationFrame(() => play(invoice.dunning_state === "none" ? "payment-captured" : "dunning-cleared", row(), copy));
      refresh();
      return;
    }
    focusWhenReady(focusKey(`pay-${invoice.id}`));
    if (result.error.error === "card_declined") {
      const after = await get<Invoice[]>("/api/invoices");
      notify(declineCopy(invoice, after.ok ? after.data.find((item) => item.id === invoice.id) : undefined, result.error.decline_code), "error");
    } else
      notify(
        result.error.errors?.card_token ??
          failure(
            result.error,
            {
              already_paid: "This invoice is already paid.",
              invoice_pending: "This invoice is still pending. Try again once it shows as unpaid.",
              billing_unavailable: "Billing is unreachable. Your payment was not recorded; try again shortly.",
            },
            result.retryAfter,
          ),
        "error",
      );
    setEpoch((value) => value + 1);
  }

  const columns = ["Date", "Horse", "Kind", "Total", "Balance", "Status", "Dunning", ...(owner ? ["Pay"] : ["Reconciliation"])];
  return (
    <section className="sheet" aria-labelledby="invoices-title">
      <h1 id="invoices-title" className="page-title">
        Invoices
      </h1>
      {owner ? (
        <div className="owner-controls">
          <div className="field">
            <label htmlFor="invoice-card">Card</label>
            <select id="invoice-card" value={card} onChange={(event) => setCard(event.target.value)}>
              {CARDS.map((option) => (
                <option key={option.token} value={option.token}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}
      {list === null ? (
        <Skeleton />
      ) : list.length === 0 ? (
        <Empty>No invoices yet.</Empty>
      ) : (
        <div className="table-scroll">
          <table className="ledger" aria-label="Invoices">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column} scope="col" className={column === "Total" || column === "Balance" ? "right" : undefined}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => {
                const invoice = entry.row;
                const status = INVOICE_LABELS[invoice.status];
                return (
                  <tr key={entry.key} ref={ref(entry.key)} data-invoice={invoice.id} data-status={invoice.status} {...rowMotion(entry)}>
                    <td data-label="Date" className="num">
                      {invoice.business_date}
                    </td>
                    <td data-label="Horse">{invoice.horse.name}</td>
                    <td data-label="Kind">{invoice.kind === "visit" ? "Visit" : "Trip share"}</td>
                    <td data-label="Total" className="num right">
                      {dollars(invoice.total_cents)}
                    </td>
                    <td data-label="Balance" className="num right">
                      {dollars(invoice.balance_cents)}
                    </td>
                    <td data-label="Status">
                      <span className="chip" data-live={invoice.status === "pending" ? "pending" : undefined} data-state={invoice.status}>
                        {status}
                      </span>
                    </td>
                    <td data-label="Dunning">
                      {invoice.dunning_state !== "none" ? <StatusTag status={invoice.dunning_state}>{DUNNING_LABELS[invoice.dunning_state]}</StatusTag> : null}
                    </td>
                    {owner ? (
                      <td data-label="Pay">
                        {invoice.status === "unpaid" ? (
                          <Button
                            variant="primary"
                            data-focus={`pay-${invoice.id}`}
                            busy={paying === invoice.id}
                            disabled={paying !== null && paying !== invoice.id}
                            aria-label={`Pay ${invoice.horse.name} ${invoice.business_date}`}
                            onClick={() => void pay(invoice)}
                          >
                            Pay
                          </Button>
                        ) : null}
                      </td>
                    ) : (
                      <td data-label="Reconciliation">
                        {readBack[invoice.id] ? <StatusTag status={readBack[invoice.id] ?? ""}>{RECONCILIATION_LABELS[readBack[invoice.id] ?? "unavailable"]}</StatusTag> : <span className="muted">Checking…</span>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---- Prices and API tokens (farrier) ----

type PriceForm = { effective_from: string; deposit: string } & Record<WorkCode, string>;

export function PricesScreen() {
  const { refresh } = useRefresh();
  const notify = useNotify();
  const [epoch, setEpoch] = useState(0);
  const lists = useList<PriceList>("/api/price-lists", epoch);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PriceForm>({
    effective_from: "",
    deposit: "",
    trim: "",
    front_reset: "",
    full_reset: "",
    front_new: "",
    full_new: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, run] = useAction();
  const formRef = useRef<HTMLFormElement>(null);

  if (lists === "forbidden") return <NotAvailable copy={PAGE_NOT_AVAILABLE} />;

  function openDialog(): void {
    const latest = Array.isArray(lists) ? lists[0] : undefined;
    if (latest) {
      setForm({
        effective_from: "",
        deposit: centsToDollarText(latest.deposit_cents),
        ...(Object.fromEntries(WORK_CODES.map((code) => [code, centsToDollarText(latest.prices[code])])) as Record<WorkCode, string>),
      });
    }
    setErrors({});
    setOpen(true);
  }

  function close(): void {
    setOpen(false);
    focusWhenReady(focusKey("new-price-list"));
  }

  function save(event: FormEvent): void {
    event.preventDefault();
    void run("Saving…", async () => {
      const local: Record<string, string> = {};
      const prices: Partial<Prices> = {};
      for (const code of WORK_CODES) {
        const cents = parseDollars(form[code]);
        if (cents === null || cents <= 0) local[`prices.${code}`] = "Enter an amount in dollars, like 45.00.";
        else prices[code] = cents;
      }
      const deposit = parseDollars(form.deposit);
      if (deposit === null) local.deposit_cents = "Enter an amount in dollars, like 45.00.";
      if (Object.keys(local).length) {
        setErrors(local);
        notify("Check the highlighted fields.", "error");
        focusFirstInvalid(formRef.current);
        return;
      }
      const result = await request<PriceList>("POST", "/api/price-lists", {
        body: { effective_from: form.effective_from.trim(), deposit_cents: deposit, prices },
      });
      if (result.ok) {
        notify("Price list saved.", "success");
        setEpoch((value) => value + 1);
        refresh();
        close();
      } else if (result.error.error === "validation") {
        setErrors(result.error.errors ?? {});
        notify("Check the highlighted fields.", "error");
        focusFirstInvalid(formRef.current);
      } else notify(failure(result.error, { price_list_exists: "A price list already starts on that date." }), "error");
    });
  }

  return (
    <section className="sheet" aria-labelledby="prices-title">
      <div className="page-head">
        <h1 id="prices-title" className="page-title">
          Prices
        </h1>
        <Button data-focus="new-price-list" onClick={openDialog}>
          New price list
        </Button>
      </div>
      {lists === null ? (
        <Skeleton rows={2} />
      ) : (
        <div className="table-scroll">
          <table className="ledger" aria-label="Price lists">
            <thead>
              <tr>
                <th scope="col">Effective from</th>
                <th scope="col" className="right">
                  Deposit
                </th>
                {WORK_CODES.map((code) => (
                  <th key={code} scope="col" className="right">
                    {SERVICE_NAMES[code]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lists.map((list, index) => (
                <tr key={list.id} className={index < 6 ? "row-enter" : undefined} style={{ "--i": String(index) } as CSSProperties}>
                  <td data-label="Effective from" className="num">
                    {list.effective_from}
                  </td>
                  <td data-label="Deposit" className="num right">
                    {dollars(list.deposit_cents)}
                  </td>
                  {WORK_CODES.map((code) => (
                    <td key={code} data-label={SERVICE_NAMES[code]} className="num right">
                      {dollars(list.prices[code])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ApiTokens />
      <Modal title="New price list" open={open} onDismiss={close}>
        <form ref={formRef} className="dialog-form" onSubmit={save} noValidate>
          <div className="field-row">
            <Field label="Effective from" error={errors.effective_from} hint="YYYY-MM-DD">
              {(props) => (
                <input {...props} type="text" inputMode="numeric" value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} />
              )}
            </Field>
            <Field label="Deposit" error={errors.deposit_cents} hint="Dollars, held at booking">
              {(props) => <input {...props} type="text" inputMode="decimal" value={form.deposit} onChange={(e) => setForm({ ...form, deposit: e.target.value })} />}
            </Field>
          </div>
          <div className="price-grid">
            {WORK_CODES.map((code) => (
              <Field key={code} label={SERVICE_NAMES[code]} error={errors[`prices.${code}`]}>
                {(props) => <input {...props} type="text" inputMode="decimal" value={form[code]} onChange={(e) => setForm({ ...form, [code]: e.target.value })} />}
              </Field>
            ))}
          </div>
          <div className="dialog-actions">
            <Button type="submit" variant="primary" busy={busy}>
              Save price list
            </Button>
            <Button onClick={close}>Cancel</Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}

/** Scoped API tokens: the plaintext shows once in the dialog, which stays open with it (brief: Other dialogs). */
function ApiTokens() {
  const notify = useNotify();
  const [epoch, setEpoch] = useState(0);
  const tokens = useList<ApiToken>("/api/tokens", epoch);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read_only" | "billing">("read_only");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [made, setMade] = useState<string | null>(null);
  const [busy, run] = useAction();
  const [revoking, setRevoking] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function close(): void {
    setOpen(false);
    setMade(null);
    focusWhenReady(focusKey("new-api-token"));
  }

  function create(event: FormEvent): void {
    event.preventDefault();
    void run("Saving…", async () => {
      const result = await request<ApiToken & { token: string }>("POST", "/api/tokens", { body: { name, scope } });
      if (result.ok) {
        setErrors({});
        setMade(result.data.token);
        setName("");
        notify("Copy this token now. It won't be shown again.", "success");
        setEpoch((value) => value + 1);
      } else if (result.error.error === "validation") {
        setErrors(result.error.errors ?? {});
        notify("Check the highlighted fields.", "error");
        focusFirstInvalid(formRef.current);
      } else notify(failure(result.error), "error");
    });
  }

  async function revoke(token: ApiToken): Promise<void> {
    setRevoking(token.id);
    notify("Revoking…", "pending");
    const result = await request("DELETE", `/api/tokens/${encodeURIComponent(token.id)}`);
    setRevoking(null);
    notify(result.ok ? "Token revoked." : failure(result.error), result.ok ? "success" : "error");
    setEpoch((value) => value + 1);
    focusWhenReady(focusKey("new-api-token"));
  }

  return (
    <section className="subsection" aria-labelledby="tokens-title">
      <div className="section-head">
        <h2 id="tokens-title" className="section-title">
          API tokens
        </h2>
        <Button data-focus="new-api-token" onClick={() => setOpen(true)}>
          New API token
        </Button>
      </div>
      {tokens === null || tokens === "forbidden" ? (
        <Skeleton rows={1} />
      ) : tokens.length === 0 ? (
        <p className="muted">No API tokens yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="ledger" aria-label="API tokens">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Scope</th>
                <th scope="col">Created</th>
                <th scope="col">
                  <span className="visually-hidden">Revoke</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((token) => (
                <tr key={token.id}>
                  <td data-label="Name" className="wrap">
                    {token.name}
                  </td>
                  <td data-label="Scope">{token.scope === "read_only" ? "Read only" : "Billing"}</td>
                  <td data-label="Created" className="num">
                    {token.created_at.slice(0, 10)} {token.created_at.slice(11, 16)}
                  </td>
                  <td data-label="Revoke">
                    <Button busy={revoking === token.id} aria-label={`Revoke token ${token.name}`} onClick={() => void revoke(token)}>
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal title="New API token" open={open} onDismiss={close}>
        <form ref={formRef} className="dialog-form" onSubmit={create} noValidate>
          <Field label="Name" error={errors.name}>
            {(props) => <input {...props} type="text" maxLength={80} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Scope" error={errors.scope}>
            {(props) => (
              <select {...props} value={scope} onChange={(e) => setScope(e.target.value as "read_only" | "billing")}>
                <option value="read_only">Read only</option>
                <option value="billing">Billing</option>
              </select>
            )}
          </Field>
          {made ? (
            <div className="token-once">
              <p>Copy this token now. It won't be shown again.</p>
              <code className="token-text wrap">{made}</code>
            </div>
          ) : null}
          <div className="dialog-actions">
            <Button type="submit" variant="primary" busy={busy}>
              Create token
            </Button>
            <Button onClick={close}>{made ? "Done" : "Cancel"}</Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
