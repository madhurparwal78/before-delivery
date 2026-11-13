/**
 * Traces: the list and the trace page with the span tree, time bars and latency table.
 */
import { api } from "./api";
import { namedAlert } from "./shell";
import { h } from "./core";

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

interface TraceInfo {
  trace_id: string;
  roots: SpanNode[];
  missing_parent: SpanNode[];
  critical_path: string[];
  latency: { service: string; spans: number; p50: number; p95: number; p99: number }[];
}

function goTo(path: string): void {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function buildSpanTree(items: HTMLElement, nodes: SpanNode[], pathSet: Set<string>, depth: number, minStart: number, maxEnd: number): void {
  for (const node of nodes) {
    const label = [
      `Span ${node.name}, ${node.duration_ms} ms, self time ${node.self_ms} ms`,
      node.on_critical_path ? ", on critical path" : "",
      node.shift_ms > 0 ? `, shifted +${node.shift_ms} ms` : "",
    ].join("");
    const item = h("div", { role: "treeitem", "aria-level": String(depth + 1), "aria-label": label, class: "mono" });
    item.style.paddingLeft = `${depth * 18 + 4}px`;
    item.style.paddingTop = "4px";
    item.style.paddingBottom = "4px";
    item.style.fontSize = "12px";
    const textEl = Object.assign(document.createElement("span"), { textContent: label });
    item.append(textEl);
    // time bar
    const range = Math.max(1, maxEnd - minStart);
    const left = ((node.start_ms - minStart) / range) * 100;
    const width = Math.max(0.5, (node.duration_ms / range) * 100);
    const bar = h("div", {});
    bar.style.position = "relative";
    bar.style.height = "8px";
    bar.style.marginTop = "2px";
    bar.style.marginBottom = "4px";
    const fill = h("div", {});
    fill.style.position = "absolute";
    fill.style.left = `${left}%`;
    fill.style.width = `${width}%`;
    fill.style.height = "8px";
    fill.style.background = node.on_critical_path ? "var(--critical)" : "var(--accent)";
    fill.style.borderRadius = "2px";
    bar.append(fill);
    item.append(bar);
    items.append(item);
    buildSpanTree(items, node.children, pathSet, depth + 1, minStart, maxEnd);
  }
}

function treeRange(nodes: SpanNode[], acc: { min: number; max: number }): void {
  for (const n of nodes) {
    acc.min = Math.min(acc.min, n.start_ms);
    acc.max = Math.max(acc.max, n.start_ms + n.duration_ms);
    treeRange(n.children, acc);
  }
}

export function buildTraces(view: HTMLElement): void {
  const holder = h("div", {});
  view.append(holder);
  void (async () => {
    try {
      const res = await api<{ traces: string[] }>("/api/traces");
      const table = h("table", {});
      table.setAttribute("aria-label", "Traces");
      const thead = h("thead", {});
      const headRow = h("tr", {});
      headRow.append(h("th", {}, "Trace"));
      thead.append(headRow);
      const tbody = h("tbody", {});
      for (const t of res.traces) {
        const tr = h("tr", {});
        const a = document.createElement("a");
        a.href = `/traces/${t}`;
        a.textContent = `Trace ${t}`;
        a.addEventListener("click", (e) => {
          e.preventDefault();
          goTo(`/traces/${t}`);
        });
        const td = h("td", {});
        td.append(a);
        tr.append(td);
        tbody.append(tr);
      }
      table.append(thead, tbody);
      holder.replaceChildren(table);
      if (res.traces.length === 0) {
        const link = document.createElement("a");
        link.href = "/rules";
        link.textContent = "Published rules";
        link.addEventListener("click", (e) => {
          e.preventDefault();
          goTo("/rules");
        });
        const band = h("div", { class: "empty-band", role: "region", "aria-label": "Empty" });
        band.append(h("div", {}, "No traces yet."), link);
        holder.append(band);
      }
    } catch {
      holder.replaceChildren(namedAlert("Load failed", "Spoorline can't reach the server. Retry when your connection is back."));
    }
  })();
}

export function buildTracePage(view: HTMLElement, traceId: string): void {
  const wrap = h("div", {});
  view.append(wrap);
  void (async () => {
    try {
      const res = await api<TraceInfo>(`/api/traces/${encodeURIComponent(traceId)}`);
      wrap.append(h("h2", {}, `Trace ${res.trace_id}`));
      const tree = h("div", { role: "tree", "aria-label": "Spans" });
      const acc = { min: Infinity, max: -Infinity };
      treeRange(res.roots, acc);
      treeRange(res.missing_parent, acc);
      if (res.missing_parent.length > 0) {
        const missing = h("div", { role: "treeitem", "aria-label": "Missing parent", class: "mono" });
        missing.style.fontWeight = "600";
        missing.textContent = "Missing parent";
        tree.append(missing);
        buildSpanTree(tree, res.missing_parent, new Set(res.critical_path), 1, acc.min, acc.max);
      }
      buildSpanTree(tree, res.roots, new Set(res.critical_path), 0, acc.min, acc.max);
      wrap.append(tree);
      const latency = h("table", {});
      latency.setAttribute("aria-label", "Latency");
      const thead = h("thead", {});
      const headRow = h("tr", {});
      for (const c of ["Service", "Spans", "p50 ms", "p95 ms", "p99 ms"]) headRow.append(h("th", {}, c));
      thead.append(headRow);
      const tbody = h("tbody", {});
      for (const l of res.latency) {
        tbody.append(
          h("tr", {}, h("td", { class: "mono" }, l.service), h("td", { class: "mono" }, String(l.spans)), h("td", { class: "mono" }, String(l.p50)), h("td", { class: "mono" }, String(l.p95)), h("td", { class: "mono" }, String(l.p99))),
        );
      }
      latency.append(thead, tbody);
      wrap.append(h("h3", {}, "Latency"), latency);
    } catch {
      wrap.replaceChildren(namedAlert("Load failed", "Spoorline can't reach the server. Retry when your connection is back."));
    }
  })();
}
