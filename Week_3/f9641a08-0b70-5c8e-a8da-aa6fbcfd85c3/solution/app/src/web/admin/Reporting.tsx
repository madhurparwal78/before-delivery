import { useState } from "react";
import type { AuditEntry, GiftCardLedger, Metrics } from "../../shared/api";
import { inr, shortDateTime } from "../../shared/format";
import { Loading } from "../components/Panel";
import { ApiFail, api } from "../lib/api";
import { useData } from "../lib/useData";
import { ErrorAlert, PageTitle, SelectField, TableWrap, TextField, istDay, useFilters } from "./ui";

function useRange() {
  const [filters, setFilters] = useFilters(["from", "to"] as const);
  const from = filters.from || istDay(-29);
  const to = filters.to || istDay();
  return { from, to, setFrom: (value: string) => setFilters({ from: value }), setTo: (value: string) => setFilters({ to: value }) };
}

export function Dashboard() {
  const range = useRange();
  const { data, error, loading } = useData<Metrics>(`/api/admin/metrics?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`);
  const fields = error?.code === "validation_failed" ? error.fields : {};
  const figures: [string, string][] = data
    ? [
        ["Orders", String(data.orders)],
        ["Gross sales", inr(data.gross_sales)],
        ["Refunds", inr(data.refunds)],
        ["Net sales", inr(data.net_sales)],
        ["Units sold", String(data.units_sold)],
        ["Average order", inr(data.average_order_value)],
      ]
    : [];
  return (
    <>
      <PageTitle>Dashboard</PageTitle>
      <div className="filter-row">
        <TextField label="From" value={range.from} onChange={range.setFrom} error={fields.from} />
        <TextField label="To" value={range.to} onChange={range.setTo} error={fields.to} />
      </div>
      {error && error.code !== "validation_failed" && <ErrorAlert error={error} />}
      {loading && !data ? (
        <Loading />
      ) : (
        <section aria-label="Figures">
          <dl className="figures">
            {figures.map(([label, value]) => (
              <div key={label} className="figure">
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </>
  );
}

export function Reports() {
  const range = useRange();
  const query = `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
  return (
    <>
      <PageTitle>Reports</PageTitle>
      <div className="filter-row">
        <TextField label="From" value={range.from} onChange={range.setFrom} />
        <TextField label="To" value={range.to} onChange={range.setTo} />
      </div>
      <div className="staff-actions">
        <a className="btn btn-primary" href={`/api/admin/reports/orders.csv?${query}`} download>
          Download orders CSV
        </a>
        <a className="btn btn-primary" href="/api/admin/reports/inventory.csv" download>
          Download inventory CSV
        </a>
      </div>
    </>
  );
}

const ENTITIES = [
  { value: "", label: "Everything" },
  { value: "product", label: "Product" },
  { value: "variant", label: "Variant" },
  { value: "order", label: "Order" },
  { value: "return", label: "Return" },
  { value: "trial", label: "Trial" },
  { value: "warranty_claim", label: "Warranty claim" },
  { value: "discount_code", label: "Discount code" },
];

function show(value: unknown): string {
  return value === null || value === undefined ? "None" : JSON.stringify(value);
}

export function AuditLog() {
  const [filters, setFilters] = useFilters(["entity", "entity_id"] as const);
  const query = new URLSearchParams();
  if (filters.entity) query.set("entity", filters.entity);
  if (filters.entity_id.trim()) query.set("entity_id", filters.entity_id.trim());
  const text = query.toString();
  const { data, loading } = useData<AuditEntry[]>(`/api/admin/audit${text ? `?${text}` : ""}`);
  return (
    <>
      <PageTitle>Audit log</PageTitle>
      <div className="filter-row">
        <SelectField label="Entity" value={filters.entity} onChange={(entity) => setFilters({ entity }, false)} options={ENTITIES} />
        <TextField label="Entity id" value={filters.entity_id} onChange={(entity_id) => setFilters({ entity_id })} />
      </div>
      {loading || !data ? (
        <Loading />
      ) : (
        <TableWrap>
          <table className="tbl" aria-label="Audit log">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">Action</th>
                <th scope="col">Entity</th>
                <th scope="col">Before</th>
                <th scope="col">After</th>
              </tr>
            </thead>
            <tbody>
              {data.map((entry) => (
                <tr key={entry.id}>
                  <td>{shortDateTime(entry.at)}</td>
                  <td>
                    {entry.actor.name}, {entry.actor.role}
                  </td>
                  <td>{entry.action}</td>
                  <td>
                    {entry.entity} {entry.entity_id}
                  </td>
                  <td className="code">{show(entry.before)}</td>
                  <td className="code">{show(entry.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </>
  );
}

export function GiftCards() {
  const [code, setCode] = useState("");
  const [ledger, setLedger] = useState<GiftCardLedger | null>(null);
  const [failure, setFailure] = useState<ApiFail | null>(null);

  const lookUp = async () => {
    setFailure(null);
    try {
      setLedger(await api.get<GiftCardLedger>(`/api/admin/gift-cards/${encodeURIComponent(code.trim())}`));
    } catch (caught) {
      setLedger(null);
      setFailure(caught instanceof ApiFail ? caught : null);
    }
  };

  return (
    <>
      <PageTitle>Gift cards</PageTitle>
      <form
        className="staff-section"
        onSubmit={(event) => {
          event.preventDefault();
          void lookUp();
        }}
      >
        <TextField label="Gift card code" value={code} onChange={setCode} />
        <ErrorAlert error={failure} />
        <button type="submit" className="btn btn-primary">
          Look up
        </button>
      </form>
      {ledger && (
        <>
          <p className="staff-meta">
            {ledger.code}: balance {inr(ledger.balance)}
          </p>
          <TableWrap>
            <table className="tbl" aria-label="Gift card ledger">
              <thead>
                <tr>
                  <th scope="col">Group</th>
                  <th scope="col">Account</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Reference</th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>
                {ledger.entries.map((entry, index) => (
                  <tr key={index}>
                    <td>{entry.group_id}</td>
                    <td>{entry.account}</td>
                    <td>{inr(entry.amount)}</td>
                    <td>{entry.reason}</td>
                    <td>{entry.ref}</td>
                    <td>{shortDateTime(entry.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </>
      )}
    </>
  );
}
