// The ledger strip pinned under the graph: one mono row per stage, the delivery queue and the rail log.
import type { GraphNode, ServiceStatus } from "../shared/api";
import { clusterTime } from "../shared/zone";

export function Ledger({ nodes, status, announcements }: { nodes: GraphNode[]; status: ServiceStatus | null; announcements: string[] }) {
  const notices = [
    status?.storage === "down" ? "Evidence storage is unreachable. Snapshots are queued and will be stored when it returns." : null,
    status?.mail === "down" ? "Mail is unreachable. Notices are queued and will be sent when it returns." : null,
  ].filter((n): n is string => n !== null);
  return (
    <section aria-label="Ledger" className="ledger">
      <table className="ledger-table">
        <colgroup>
          <col className="ledger-col-stage" /><col className="ledger-col-version" /><col className="ledger-col-digest" />
          <col className="ledger-col-healthy" /><col />
        </colgroup>
        <thead>
          <tr><th scope="col">Stage</th><th scope="col">Version</th><th scope="col">Digest</th><th scope="col">Last healthy</th><th scope="col">In sync</th></tr>
        </thead>
        <tbody>
          {nodes.map((n) => (
            <tr key={n.stage}>
              <th scope="row" data-label="Stage">{n.stage}</th>
              <td data-label="Version" className="mono">{n.current?.version ?? "none"}</td>
              <td data-label="Digest" className="mono">{n.current?.short_digest ?? "none"}</td>
              <td data-label="Last healthy" className="mono">{n.last_healthy_at ? clusterTime(n.last_healthy_at, n.time_zone) : "never"}</td>
              <td data-label="In sync" className="mono"><span className="ledger-word">in sync </span>{`${n.counter?.in_sync ?? 0}/${n.counter?.total ?? 0}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ledger-queue">
        <span className="mono">{`Evidence uploads queued: ${status?.queued_uploads ?? 0}`}</span>
        <span className="mono">{`Notices queued: ${status?.queued_notices ?? 0}`}</span>
        <span className={`reach reach-${status?.storage ?? "up"}`}>{`Storage ${status?.storage ?? "…"}`}</span>
        <span className={`reach reach-${status?.mail ?? "up"}`}>{`Mail ${status?.mail ?? "…"}`}</span>
      </div>
      <div role="status" aria-label="Delivery queue" className="ledger-notices">
        {notices.map((n) => <p key={n}>{n}</p>)}
      </div>
      <div role="status" aria-label="Promotion progress" className="ledger-log mono">
        {announcements.map((line, i) => <p key={`${i}-${line}`}>{line}</p>)}
      </div>
    </section>
  );
}
