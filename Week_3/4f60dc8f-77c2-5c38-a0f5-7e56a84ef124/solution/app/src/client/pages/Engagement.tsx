// The client's engagement page: invoices (table or cards by width), receipts, intake files and the way to the rig.
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api, toSignIn, type Engagement, type Invoice } from "../api";
import { PayDialog } from "../components/PayDialog";
import { Shell } from "../components/Shell";
import { useMedia } from "../motion";
import { fileSize, intakeStatus, payBy, STATUS_WORDS } from "../words";
import { formatMoney } from "../../shared/money";
import { longDate, MILESTONE_LABELS } from "../../shared/format";
import { NotFound } from "./Public";

const LEDGER_KINDS = { deposit: "Deposit payment", invoice_payment: "Invoice payment", refund: "Refund" } as const;

function StatusCell({ invoice }: { invoice: Invoice }) {
  return (
    <>
      <span class="status-word" data-status={invoice.status}>
        {STATUS_WORDS[invoice.status]}
      </span>
      {invoice.status === "payment_failed" && invoice.overdue_at && <span class="pay-by">{payBy(invoice.overdue_at)}</span>}
    </>
  );
}

export function EngagementPage({ id }: { id: string }) {
  const [engagement, setEngagement] = useState<Engagement | null>(null);
  const [missing, setMissing] = useState(false);
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [paid, setPaid] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const desktop = useMedia("(min-width: 1200px)");
  const phone = useMedia("(max-width: 767.98px)");

  const load = useCallback(async () => {
    const reply = await api<Engagement>("GET", `/api/engagements/${id}`);
    if (reply.status === 401) return toSignIn();
    if (reply.status === 404) return setMissing(true);
    if (reply.ok) setEngagement(reply.data);
  }, [id]);

  useEffect(() => void load(), [load]);
  const failing = engagement?.invoices.some((invoice) => invoice.status === "payment_failed") ?? false;
  useEffect(() => {
    if (!failing) return;
    const timer = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(timer);
  }, [failing, load]);
  useEffect(() => {
    if (engagement) document.title = `${engagement.reference} ${engagement.title} — Gloamwork`;
  }, [engagement?.reference]);

  if (missing) return <NotFound />;
  const money = (minor: number): string => (engagement ? formatMoney(minor, engagement.brand.currency) : "");
  const payButton = (invoice: Invoice) =>
    ["issued", "payment_failed", "overdue"].includes(invoice.status) ? (
      <button
        type="button"
        class="button primary"
        onClick={(event) => {
          opener.current = event.currentTarget;
          setPaid(false);
          setPaying(invoice);
        }}
      >
        Pay invoice {invoice.number}
      </button>
    ) : null;
  const closeDialog = (): void => {
    setPaying(null);
    opener.current?.focus();
    void load();
  };

  return (
    <Shell banner={["billing", "storage", "documents"]}>
      <div class="wrap page">
        {!engagement ? (
          <div class="skeleton" aria-hidden="true" />
        ) : (
          <>
            <span class="eyebrow">{engagement.reference}</span>
            <h1>{engagement.title}</h1>
            <p class="meta-line">
              <span>{engagement.brand.name}</span>
              <span>State: {engagement.state.replace(/_/g, " ")}</span>
              <a href={`/rig/${engagement.id}`}>Open the Shot Rig</a>
            </p>
            {paid && (
              <div class="success notice" tabindex={-1}>
                <h2>Invoice paid</h2>
                <p>Thank you. A receipt will follow by email.</p>
              </div>
            )}
            <h2 id="invoices-title">Invoices</h2>
            {engagement.invoices.length === 0 && <p class="muted">No invoices yet. The deposit invoice appears here once the deposit is paid.</p>}
            {engagement.invoices.length > 0 && desktop && (
              <table aria-label="Invoices">
                <thead>
                  <tr>
                    <th scope="col">Milestone</th>
                    <th scope="col">Invoice</th>
                    <th scope="col" class="num">
                      Amount
                    </th>
                    <th scope="col">Status</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {engagement.invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td>{MILESTONE_LABELS[invoice.milestone]}</td>
                      <td class="num">{invoice.number}</td>
                      <td class="num">{money(invoice.amount_minor)}</td>
                      <td>
                        <StatusCell invoice={invoice} />
                      </td>
                      <td>{payButton(invoice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {engagement.invoices.length > 0 && !desktop && !phone && (
              <table aria-label="Invoices">
                <thead>
                  <tr>
                    <th scope="col">Milestone</th>
                    <th scope="col" class="num">
                      Amount
                    </th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {engagement.invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td>
                        {MILESTONE_LABELS[invoice.milestone]}
                        <span class="pay-by muted">Invoice {invoice.number}</span>
                      </td>
                      <td class="num">{money(invoice.amount_minor)}</td>
                      <td>
                        <StatusCell invoice={invoice} />
                        {payButton(invoice)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {engagement.invoices.length > 0 && phone && (
              <ul class="invoice-cards" aria-label="Invoices">
                {engagement.invoices.map((invoice) => (
                  <li key={invoice.id}>
                    <strong>{MILESTONE_LABELS[invoice.milestone]}</strong>
                    <span class="muted">Invoice {invoice.number}</span>
                    <span class="num">{money(invoice.amount_minor)}</span>
                    <span>
                      <StatusCell invoice={invoice} />
                    </span>
                    {payButton(invoice)}
                  </li>
                ))}
              </ul>
            )}
            <h2>Receipts</h2>
            {engagement.ledger.length === 0 ? (
              <p class="muted">No payments yet.</p>
            ) : (
              <ul class="plain-list" aria-label="Receipts">
                {engagement.ledger.map((entry) => (
                  <li key={entry.id}>
                    <span>{LEDGER_KINDS[entry.kind]}</span>
                    <span class="num">{money(entry.amount_minor)}</span>
                    <span class="muted">{longDate(entry.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
            <h2>Intake files</h2>
            {engagement.files.length === 0 ? (
              <p class="muted">No files yet. Upload your product's GLB from the Shot Rig.</p>
            ) : (
              <ul class="plain-list" aria-label="Intake files">
                {engagement.files.map((file) => (
                  <li key={file.id}>
                    <span>{file.name}</span>
                    <span class="muted num">{fileSize(file.size_bytes)}</span>
                    <span class="status-word" data-status={file.status}>
                      {intakeStatus(file)}
                    </span>
                    <a href={`/api/engagements/${engagement.id}/files/${file.id}/content`} download={file.name}>
                      Download {file.name}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      {paying && engagement && (
        <PayDialog<{ invoice: Invoice }>
          title={`Pay invoice ${paying.number}`}
          payLabel={`Pay ${money(paying.balance_minor)}`}
          path={`/api/invoices/${paying.id}/payments`}
          onClose={closeDialog}
          onPaid={() => {
            setPaying(null);
            setPaid(true);
            void load();
          }}
        />
      )}
    </Shell>
  );
}
