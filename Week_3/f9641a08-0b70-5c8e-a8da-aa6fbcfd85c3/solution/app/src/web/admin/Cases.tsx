import { useState } from "react";
import type { AdminCase, ClaimCase, ReturnCase, TrialCase } from "../../shared/api";
import { CLAIM_STATUS_WORDS, RETURN_STATUS_WORDS, TRIAL_STATUS_WORDS, inr, shortDateTime } from "../../shared/format";
import { Loading, Panel } from "../components/Panel";
import { api } from "../lib/api";
import { useLive } from "../lib/live";
import { Link } from "../lib/router";
import { useData } from "../lib/useData";
import { ErrorAlert, PageTitle, SelectField, StatusBlock, TableWrap, TextField, toneOf, useAction, useFilters } from "./ui";

export type CaseSegment = "returns" | "trials" | "warranty";
type AnyAdminCase = AdminCase<ReturnCase> | AdminCase<TrialCase> | AdminCase<ClaimCase>;

interface KindInfo {
  title: string;
  table: string;
  words: Record<string, string>;
  statuses: string[];
}

const KINDS: Record<CaseSegment, KindInfo> = {
  returns: { title: "Returns", table: "Returns queue", words: RETURN_STATUS_WORDS, statuses: ["requested", "approved", "rejected", "in_transit", "received", "inspected", "refunded", "exchanged"] },
  trials: { title: "Trials", table: "Trials queue", words: TRIAL_STATUS_WORDS, statuses: ["requested", "approved", "rejected", "returned", "refunded"] },
  warranty: { title: "Warranty", table: "Warranty queue", words: CLAIM_STATUS_WORDS, statuses: ["submitted", "under_review", "approved", "rejected", "repair", "replacement", "resolved"] },
};

export function CaseQueue({ segment }: { segment: CaseSegment }) {
  const info = KINDS[segment];
  const [filters, setFilters] = useFilters(["status"] as const);
  const { data, loading, reload } = useData<AnyAdminCase[]>(`/api/admin/${segment}${filters.status ? `?status=${filters.status}` : ""}`);
  useLive("queue", () => void reload());

  return (
    <>
      <PageTitle>{info.title}</PageTitle>
      <SelectField
        label="Status"
        value={filters.status}
        onChange={(status) => setFilters({ status }, false)}
        options={[{ value: "", label: "All statuses" }, ...info.statuses.map((value) => ({ value, label: info.words[value] ?? value }))]}
      />
      {loading || !data ? (
        <Loading />
      ) : data.length === 0 ? (
        <Panel tone="teal">Nothing waiting.</Panel>
      ) : (
        <TableWrap>
          <table className="tbl" aria-label={info.table}>
            <thead>
              <tr>
                <th scope="col">Case</th>
                <th scope="col">Customer</th>
                <th scope="col">Order</th>
                <th scope="col">Item</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((item) => (
                <tr key={item.number} aria-label={item.number}>
                  <th scope="row">
                    <Link href={`/admin/${segment}/${item.number}`}>{item.number}</Link>
                  </th>
                  <td>{item.customer.email}</td>
                  <td>{item.order_number}</td>
                  <td>{item.variant}</td>
                  <td>
                    <StatusBlock word={info.words[item.status] ?? item.status} tone={toneOf(item.status)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </>
  );
}

interface Move {
  to: string;
  label: string;
}

function isReturn(item: AnyAdminCase): item is AdminCase<ReturnCase> {
  return "outcome" in item;
}

function isClaim(item: AnyAdminCase): item is AdminCase<ClaimCase> {
  return "component" in item;
}

/** The legal next moves of a case; only these buttons are shown. */
function movesOf(item: AnyAdminCase): Move[] {
  const approve = { to: "approved", label: "Approve" };
  const reject = { to: "rejected", label: "Reject" };
  if (isClaim(item)) {
    switch (item.status) {
      case "submitted":
        return [{ to: "under_review", label: "Start review" }];
      case "under_review":
        return [approve, reject];
      case "approved":
        return [
          { to: "repair", label: "Book repair" },
          { to: "replacement", label: "Send replacement" },
        ];
      case "repair":
      case "replacement":
        return [{ to: "resolved", label: "Mark resolved" }];
      default:
        return [];
    }
  }
  if (isReturn(item)) {
    switch (item.status) {
      case "requested":
        return [approve, reject];
      case "approved":
        return [{ to: "in_transit", label: "Mark in transit" }];
      case "in_transit":
        return [{ to: "received", label: "Mark received" }];
      case "received":
        return [{ to: "inspected", label: "Mark inspected" }];
      case "inspected":
        return item.outcome === "exchange" ? [{ to: "exchanged", label: "Complete exchange" }] : [{ to: "refunded", label: "Issue refund" }];
      default:
        return [];
    }
  }
  switch (item.status) {
    case "requested":
      return [approve, reject];
    case "approved":
      return [{ to: "returned", label: "Mark returned" }];
    case "returned":
      return [{ to: "refunded", label: "Issue refund" }];
    default:
      return [];
  }
}

export function CasePage({ segment, number }: { segment: CaseSegment; number: string }) {
  const { data, error, loading, reload } = useData<AnyAdminCase>(`/api/admin/${segment}/${number}`);
  const refresh = (changed: string) => {
    if (changed === number) void reload();
  };
  useLive("return", (event) => refresh(event.number));
  useLive("trial", (event) => refresh(event.number));
  useLive("warranty", (event) => refresh(event.number));
  if (error) return <Panel tone="red">{error.message}</Panel>;
  if (loading || !data) return <Loading />;
  return <CaseDetail segment={segment} item={data} reload={reload} />;
}

function CaseDetail({ segment, item, reload }: { segment: CaseSegment; item: AnyAdminCase; reload: () => Promise<void> }) {
  const info = KINDS[segment];
  const [reason, setReason] = useState("");
  const { pending, error, run, clear } = useAction();
  const moves = movesOf(item);
  const rejecting = moves.some((m) => m.to === "rejected");

  const move = (to: string) =>
    run(async () => {
      const body: Record<string, unknown> = { version: item.version, to };
      if (to === "rejected") body.reason = reason;
      const updated = await api.post<AnyAdminCase>(`/api/admin/${segment}/${item.number}/transition`, body);
      await reload();
      setReason("");
      return `${item.number} is now ${info.words[updated.status] ?? updated.status}.`;
    });

  const reloadLatest = () => {
    clear();
    void reload();
  };

  return (
    <>
      <PageTitle>
        {item.number} <StatusBlock word={info.words[item.status] ?? item.status} tone={toneOf(item.status)} />
      </PageTitle>
      <p>
        <Link href={`/admin/${segment}`}>Back to {info.title.toLowerCase()}</Link>
      </p>
      <dl className="facts">
        <dt>Customer</dt>
        <dd>
          {item.customer.name}, {item.customer.email}
        </dd>
        <dt>Order</dt>
        <dd>{item.order_number}</dd>
        <dt>Item</dt>
        <dd>{item.variant}</dd>
        {isReturn(item) && (
          <>
            <dt>Quantity</dt>
            <dd>{item.quantity}</dd>
            <dt>Reason</dt>
            <dd>{item.request_reason}</dd>
            <dt>Outcome</dt>
            <dd>{item.outcome === "exchange" ? `Exchange for ${item.exchange_sku ?? "another variant"}` : "Refund"}</dd>
            {item.exchange_order_number && (
              <>
                <dt>Exchange order</dt>
                <dd>{item.exchange_order_number}</dd>
              </>
            )}
          </>
        )}
        {isClaim(item) ? (
          <>
            <dt>Component</dt>
            <dd>{item.component}</dd>
            <dt>What happened</dt>
            <dd>{item.description}</dd>
            {item.resolution_order_number && (
              <>
                <dt>Replacement order</dt>
                <dd>{item.resolution_order_number}</dd>
              </>
            )}
          </>
        ) : (
          !isReturn(item) && (
            <>
              <dt>Traveller's note</dt>
              <dd>{item.note || "None"}</dd>
            </>
          )
        )}
        {item.refund_amount !== null && (
          <>
            <dt>Refund</dt>
            <dd>{inr(item.refund_amount)}</dd>
          </>
        )}
        {item.reason && (
          <>
            <dt>Rejected because</dt>
            <dd>{item.reason}</dd>
          </>
        )}
      </dl>

      {isClaim(item) && (
        <section aria-labelledby="evidence-heading" className="staff-section">
          <h2 id="evidence-heading">Evidence</h2>
          <ul className="evidence">
            {item.evidence.map((e) => {
              const src = `/api/admin/warranty/evidence/${e.id}/content`;
              return (
                <li key={e.id}>
                  {e.kind === "photo" ? (
                    <img src={src} alt={`Evidence ${e.filename}`} className="evidence-photo" />
                  ) : (
                    <a href={src} className="btn" download>
                      Receipt {e.filename}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <h2>History</h2>
      <ol className="timeline" aria-label="Case history">
        {item.history.map((h, i) => (
          <li key={i}>
            {info.words[h.status] ?? h.status} <span className="muted">{shortDateTime(h.at)}</span>
          </li>
        ))}
      </ol>

      {moves.length > 0 && (
        <section className="staff-section" aria-labelledby="moves-heading">
          <h2 id="moves-heading">Next step</h2>
          {rejecting && <TextField label="Reason" value={reason} onChange={setReason} error={error?.fields.reason} hint="Needed to reject: 5 to 500 characters." />}
          <ErrorAlert error={error && error.code !== "validation_failed" ? error : null} onReload={reloadLatest} />
          <div className="staff-actions">
            {moves.map((m) => (
              <button key={m.to} type="button" className={m.to === "rejected" ? "btn" : "btn btn-primary"} disabled={pending} onClick={() => void move(m.to)}>
                {pending ? "Saving" : m.label}
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
