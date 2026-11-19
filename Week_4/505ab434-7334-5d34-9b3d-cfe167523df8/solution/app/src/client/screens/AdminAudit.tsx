import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { AuditRecord } from "../../shared/api.ts";
import { AUDIT_ACTIONS } from "../../shared/domain.ts";
import { get, messageOf } from "../lib/api.ts";
import { stampOf } from "../lib/format.ts";
import { useHeadingFocus, useTitle } from "../lib/focus.ts";
import { Alert, Button, EmptyState, Loading } from "../ui/index.ts";
import "../admin/admin.css";

interface Filters {
  requestId: string;
  action: string;
  from: string;
  to: string;
}
const NO_FILTERS: Filters = { requestId: "", action: "", from: "", to: "" };

/** `field: value` lines, keys A to Z, strings unquoted; `none` for a missing object. */
function cellLines(value: Record<string, unknown> | null): string[] {
  const entries = value ? Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) : [];
  if (entries.length === 0) return ["none"];
  return entries.map(([key, inner]) => `${key}: ${typeof inner === "string" ? inner : JSON.stringify(inner)}`);
}

function queryOf(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.requestId) params.set("requestId", filters.requestId.trim());
  if (filters.action) params.set("action", filters.action);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** `/admin/audit` (owner, legal reviewer): the audit log, its filters and chain verification. */
export function AdminAudit(_props: { params: string[] }): ReactNode {
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [applied, setApplied] = useState<Filters>(NO_FILTERS);
  const [records, setRecords] = useState<AuditRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [chain, setChain] = useState("");
  useTitle("Audit log");
  useHeadingFocus(records !== null);

  const load = useCallback(async (filters: Filters) => {
    try {
      setRecords((await get<{ records: AuditRecord[] }>(`/api/audit${queryOf(filters)}`)).records);
      setLoadError(null);
    } catch (failure) {
      setLoadError(messageOf(failure));
      setRecords((current) => current ?? []);
    }
  }, []);
  useEffect(() => void load(applied), [load, applied]);

  async function verify(): Promise<void> {
    setVerifying(true);
    try {
      const result = await get<{ ok: boolean; records: number; brokenAt: number | null }>("/api/audit/verify");
      setChain(result.ok ? `Chain verified: ${result.records} records.` : `Chain broken at record ${result.brokenAt}.`);
    } catch (failure) {
      setChain(messageOf(failure));
    } finally {
      setVerifying(false);
    }
  }

  const apply = (event: FormEvent): void => {
    event.preventDefault();
    setApplied(draft);
    void load(draft);
  };
  const set = (patch: Partial<Filters>): void => setDraft((current) => ({ ...current, ...patch }));

  return (
    <>
      <div className="screen-head" data-frame>
        <h1>Audit log</h1>
        <p className="muted">Every decision is chained to the one before it. Verification names the first broken record.</p>
      </div>
      <form className="filters" data-frame onSubmit={apply}>
        <div className="field">
          <label htmlFor="audit-request">Request id</label>
          <input id="audit-request" type="text" value={draft.requestId} onChange={(event) => set({ requestId: event.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="audit-action">Action</label>
          <select id="audit-action" value={draft.action} onChange={(event) => set({ action: event.target.value })}>
            <option value="">All actions</option>
            {AUDIT_ACTIONS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="audit-from">From</label>
          <input id="audit-from" type="date" value={draft.from} onChange={(event) => set({ from: event.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="audit-to">To</label>
          <input id="audit-to" type="date" value={draft.to} onChange={(event) => set({ to: event.target.value })} />
        </div>
        <Button primary type="submit">
          Apply filters
        </Button>
      </form>
      <div className="verify-bar" data-frame>
        <Button pending={verifying && "verify"} onClick={() => void verify()}>
          Verify chain
        </Button>
        <div role="status" aria-label="Chain status" className="chain-status">
          {chain}
        </div>
      </div>
      <Alert message={loadError} />
      {records === null ? (
        <Loading />
      ) : records.length === 0 ? (
        <EmptyState glyph="list">No audit records match.</EmptyState>
      ) : (
        <div className="table-cell" data-frame>
          <div className="table-wrap">
            <table className="table" aria-label="Audit log">
              <thead>
                <tr>
                  {["Sequence", "Time", "Actor", "Action", "Resource", "Before", "After", "Outcome"].map((name) => (
                    <th key={name} scope="col">
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.sequence}>
                    <td>{record.sequence}</td>
                    <td>{stampOf(record.occurredAt)}</td>
                    <td>{record.actorName ?? (record.actorId === "system" ? "System" : record.actorId)}</td>
                    <td>{record.action}</td>
                    <td>{`${record.resourceType} ${record.resourceId}`}</td>
                    <td className="lines">
                      {cellLines(record.before).map((line) => (
                        <div key={line}>{line}</div>
                      ))}
                    </td>
                    <td className="lines">
                      {cellLines(record.after).map((line) => (
                        <div key={line}>{line}</div>
                      ))}
                    </td>
                    <td>{record.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
