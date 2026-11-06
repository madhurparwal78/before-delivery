// Lineage drawings: a horizontal row of asset nodes with "derived from" connectors, used by the Run
// screen's lineage strip and by the asset dialog. Gone assets keep their place as tombstones.

import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { ApiError, get, query, type Asset, type Lineage, type LineageNode } from "./api";
import { day, usePoll } from "./hooks";
import { Icon, mediaIcon } from "./icons";

/** Signed links last 300 s; a node keeps its first link for 4 minutes so thumbnails do not reload. */
const links = new Map<string, { url: string; at: number }>();
export function stableLink(id: string, url: string | undefined): string | undefined {
  if (!url) return undefined;
  const now = performance.now();
  const kept = links.get(id);
  if (kept && now - kept.at < 240_000) return kept.url;
  links.set(id, { url, at: now });
  return url;
}

interface Edge {
  from: string;
  to: string;
}

export function LineageGraph({ nodes, edges, selected, onSelect, modelName, empty }: {
  nodes: LineageNode[];
  edges: Edge[];
  selected?: string | null;
  onSelect: (node: LineageNode) => void;
  modelName: (slug: string | null) => string;
  empty?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [wires, setWires] = useState<{ d: string; key: string }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const box = track.current;
    if (!box) return;
    const draw = () => {
      const origin = box.getBoundingClientRect();
      const rectOf = (id: string) => box.querySelector<HTMLElement>(`[data-node="${id}"]`)?.getBoundingClientRect();
      const paths: { d: string; key: string }[] = [];
      for (const edge of edges) {
        const a = rectOf(edge.from);
        const b = rectOf(edge.to);
        if (!a || !b) continue;
        const forward = a.left <= b.left;
        const x1 = (forward ? a.right : a.left) - origin.left;
        const x2 = (forward ? b.left : b.right) - origin.left;
        const y1 = a.top + a.height / 2 - origin.top;
        const y2 = b.top + b.height / 2 - origin.top;
        const bend = Math.max(16, Math.abs(x2 - x1) / 2) * (forward ? 1 : -1);
        paths.push({ key: `${edge.from}-${edge.to}`, d: `M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}` });
      }
      setWires(paths);
      setSize({ w: box.scrollWidth, h: box.scrollHeight });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(box);
    return () => observer.disconnect();
  }, [nodes, edges]);

  useLayoutEffect(() => {
    const strip = scroller.current;
    const node = selected ? strip?.querySelector<HTMLElement>(`[data-node="${selected}"]`) : null;
    if (strip && node) strip.scrollLeft = node.offsetLeft - (strip.clientWidth - node.offsetWidth) / 2;
  }, [selected, nodes]);

  if (!nodes.length) {
    return (
      <p class="empty">
        <Icon name="empty" size={28} />
        <span>{empty ?? "No outputs yet."}</span>
      </p>
    );
  }

  const linked = new Set(selected ? edges.flatMap((e) => (e.from === selected || e.to === selected ? [e.from, e.to] : [])) : []);
  return (
    <div class="lineage__scroll" ref={scroller}>
      <div class="lineage__track" ref={track}>
        <svg class="lineage__wires" width={size.w} height={size.h} aria-hidden="true">
          {wires.map((w) => <path key={w.key} d={w.d} />)}
        </svg>
        <ol class="lineage__nodes">
          {nodes.map((node) => {
            const state = node.id === selected ? " is-selected" : linked.has(node.id) ? " is-linked" : "";
            if (node.state === "tombstone") {
              return (
                <li key={node.id}>
                  <button type="button" data-node={node.id} class={`node node--tombstone${state}`}
                    aria-label={`Removed asset ${node.id}`} onClick={() => onSelect(node)}>
                    <span class="node__gone">Removed <span class="nowrap">{day(node.removed_at)} ({node.reason})</span></span>
                    <span class="node__id num">{node.id}</span>
                  </button>
                </li>
              );
            }
            const thumb = stableLink(node.id, node.thumbnail_url);
            return (
              <li key={node.id}>
                <button type="button" data-node={node.id} class={`node${state}`} aria-label={`Asset ${node.id}`}
                  onClick={() => onSelect(node)}>
                  <span class="node__thumb">
                    {thumb ? <img src={thumb} alt="" width={64} height={64} loading="lazy" /> : <Icon name={mediaIcon(node.media_type)} size={24} />}
                  </span>
                  <span class="node__id num">{node.id}</span>
                  <span class="node__model">{modelName(node.model)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

const liveNode = (a: Asset): LineageNode => ({
  id: a.id, state: "live", media_type: a.media_type, model: a.model, job_id: a.job_id, created_at: a.created_at,
  thumbnail_url: a.media_type.startsWith("image/") ? a.url : undefined, prompt: a.prompt,
});

/** The Run screen's footer band: the team's 20 most recent outputs, or the chosen asset's lineage. */
export function LineageStrip({ teamId, modelName }: { teamId: string; modelName: (slug: string | null) => string }) {
  const [recent, setRecent] = useState<{ nodes: LineageNode[]; edges: Edge[] }>({ nodes: [], edges: [] });
  const [focus, setFocus] = useState<{ id: string; lineage: Lineage } | null>(null);
  const outside = useRef(new Map<string, { node: LineageNode; at: number }>());

  usePoll(async () => {
    const { assets } = await get<{ assets: Asset[] }>(`/api/assets${query({ team: teamId, kind: "output" })}`);
    const shown = assets.slice(0, 20).reverse();
    const ids = new Set(shown.map((a) => a.id));
    const edges = shown.flatMap((a) => (a.derived_from ?? []).map((from) => ({ from, to: a.id })));
    const missing = [...new Set(edges.map((e) => e.from).filter((id) => !ids.has(id)))];
    const now = performance.now();
    await Promise.all(missing.map(async (id) => {
      const kept = outside.current.get(id);
      if (kept && (kept.node.state === "tombstone" || now - kept.at < 10_000)) return;
      try {
        const { asset } = await get<{ asset: Asset }>(`/api/assets/${id}`);
        outside.current.set(id, { node: liveNode(asset), at: now });
      } catch (error) {
        const gone = error instanceof ApiError ? error.body : null;
        if (gone?.code === "asset_gone" && gone.removed_at && gone.reason) {
          outside.current.set(id, { node: { id, state: "tombstone", removed_at: gone.removed_at, reason: gone.reason }, at: now });
        }
      }
    }));
    const extra = missing.map((id) => outside.current.get(id)?.node).filter((n): n is LineageNode => Boolean(n));
    // Each outside source sits just before the first output derived from it.
    const nodes: LineageNode[] = [];
    for (const a of shown) {
      for (const source of extra) {
        if (!nodes.includes(source) && (a.derived_from ?? []).includes(source.id)) nodes.push(source);
      }
      nodes.push(liveNode(a));
    }
    setRecent({ nodes, edges: edges.filter((e) => nodes.some((n) => n.id === e.from)) });
  }, 2000, [teamId]);

  const select = async (node: LineageNode) => {
    if (node.state === "tombstone") {
      setFocus(null);
      return;
    }
    try {
      setFocus({ id: node.id, lineage: await get<Lineage>(`/api/assets/${node.id}/lineage`) });
    } catch {
      setFocus(null);
    }
  };

  const view = focus ? { nodes: focus.lineage.nodes, edges: focus.lineage.edges } : recent;
  return (
    <section class="panel lineage" role="region" aria-label="Lineage">
      <header class="panel__head">
        <h2 class="panel__title">Lineage</h2>
        {focus && (
          <button type="button" class="btn btn--quiet" onClick={() => setFocus(null)}>Show recent outputs</button>
        )}
      </header>
      <LineageGraph nodes={view.nodes} edges={view.edges} selected={focus?.id ?? null} onSelect={select}
        modelName={modelName} empty="No outputs yet. Run a model and its outputs appear here." />
    </section>
  );
}
