// Traces: the list, and one trace as a span tree with time bars and a latency table.
import { api } from "../lib/api";
import { Link } from "../lib/router";
import { EmptyBand, LoadFailed, Skeleton } from "../lib/ui";
import { Tree, type TreeNode } from "../lib/tree";
import { useResource } from "../lib/useResource";

export function TracesPage() {
  const list = useResource(() => api.get<{ traces: Array<{ trace_id: string; spans: number; services: string[]; duration_ms: number }> }>("/api/traces"), []);
  return (
    <div className="stack">
      <h1>Traces</h1>
      {list.error ? <LoadFailed failure={list.error} onRetry={list.reload} /> : null}
      {!list.data && !list.error ? <Skeleton /> : null}
      {list.data?.traces.length === 0 ? <EmptyBand line="No traces yet."><Link to="/rules" className="btn btn-primary">Published rules</Link></EmptyBand> : null}
      {list.data && list.data.traces.length > 0 ? (
        <div className="table-wrap">
          <table className="data" aria-label="Traces">
            <thead><tr><th scope="col">Trace</th><th scope="col" className="num">Spans</th><th scope="col">Services</th><th scope="col" className="num">Duration ms</th></tr></thead>
            <tbody>
              {list.data.traces.map((trace) => (
                <tr key={trace.trace_id}>
                  <td><Link to={`/traces/${trace.trace_id}`} className="mono" aria-label={`Trace ${trace.trace_id}`}>{`Trace ${trace.trace_id}`}</Link></td>
                  <td className="num">{trace.spans}</td><td className="mono">{trace.services.join(", ")}</td><td className="num">{trace.duration_ms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

interface SpanNode {
  span_id: string;
  name: string;
  service: string;
  start_ms: number;
  duration_ms: number;
  shift_ms: number;
  self_ms: number;
  on_critical_path: boolean;
  children: SpanNode[];
}

interface TraceView {
  trace_id: string;
  roots: SpanNode[];
  missing_parent: SpanNode[];
  critical_path: string[];
  latency: Array<{ service: string; spans: number; p50: number; p95: number; p99: number }>;
}

function bounds(nodes: SpanNode[]): { from: number; to: number } {
  let from = Infinity;
  let to = -Infinity;
  const visit = (node: SpanNode): void => {
    from = Math.min(from, node.start_ms + node.shift_ms);
    to = Math.max(to, node.start_ms + node.shift_ms + node.duration_ms);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return { from, to: Math.max(to, from + 1) };
}

export function TracePage({ id }: { id: string }) {
  const detail = useResource(() => api.get<TraceView>(`/api/traces/${encodeURIComponent(id)}`), [id]);
  const view = detail.data;
  const range = view ? bounds([...view.roots, ...view.missing_parent]) : { from: 0, to: 1 };
  const span = range.to - range.from;

  const toNode = (node: SpanNode, orphan = false): TreeNode => {
    const label = `Span ${node.name}, ${node.duration_ms} ms, self time ${node.self_ms} ms${node.on_critical_path ? ", on critical path" : ""}${node.shift_ms > 0 ? `, shifted +${node.shift_ms} ms` : ""}`;
    const left = ((node.start_ms + node.shift_ms - range.from) / span) * 100;
    const width = Math.max((node.duration_ms / span) * 100, 0.5);
    return {
      id: node.span_id,
      label,
      children: node.children.map((child) => toNode(child, orphan)),
      content: (
        <span className="span-line">
          <span className="span-text">
            <span className="span-name mono">{node.name},</span>{" "}
            <span className="span-meta mono">{node.duration_ms} ms, self time {node.self_ms} ms{node.on_critical_path ? ", on critical path" : ""}{node.shift_ms > 0 ? `, shifted +${node.shift_ms} ms` : ""}</span>
          </span>
          <span className={`span-track${orphan ? " orphan" : ""}`} aria-hidden="true"><span className={`span-bar${node.on_critical_path ? " critical" : ""}${node.shift_ms > 0 ? " shifted" : ""}`} style={{ left: `${left}%`, width: `${width}%` }} /></span>
        </span>
      ),
    };
  };

  const nodes: TreeNode[] = view
    ? [
        ...view.roots.map((root) => toNode(root)),
        ...(view.missing_parent.length > 0
          ? [{ id: "missing-parent", label: "Missing parent", content: <span className="span-name mono">Missing parent</span>, children: view.missing_parent.map((child) => toNode(child, true)) }]
          : []),
      ]
    : [];

  return (
    <div className="stack">
      <div className="page-head"><h1>Trace <span className="mono">{id}</span></h1><Link to="/traces">All traces</Link></div>
      {detail.error ? <LoadFailed failure={detail.error} onRetry={detail.reload} /> : null}
      {view ? (
        <>
          <Tree name="Spans" nodes={nodes} />
          <h2>Latency</h2>
          <div className="table-wrap">
            <table className="data" aria-label="Latency">
              <thead><tr><th scope="col">Service</th><th scope="col" className="num">Spans</th><th scope="col" className="num">p50 ms</th><th scope="col" className="num">p95 ms</th><th scope="col" className="num">p99 ms</th></tr></thead>
              <tbody>{view.latency.map((row) => <tr key={row.service}><td className="mono">{row.service}</td><td className="num">{row.spans}</td><td className="num">{row.p50}</td><td className="num">{row.p95}</td><td className="num">{row.p99}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      ) : !detail.error ? <Skeleton /> : null}
    </div>
  );
}
