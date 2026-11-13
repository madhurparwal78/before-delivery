// The workspace: left rail, stage graph with the ledger pinned beneath it, and the evidence column.
// It reads the graph and the status endpoint every 2 seconds; everything shown is the server's state.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Bundle, Graph as GraphData, Phase, Promotion, ServiceStatus, SessionBody, StageHealth } from "../shared/api";
import { call } from "./api";
import { EvidenceColumn } from "./Evidence";
import { FeedbackRegions } from "./feedback";
import { Graph, type EdgeBundle } from "./Graph";
import { navigate, useEvery, useLocation } from "./hooks";
import { Ledger } from "./Ledger";
import { Shell } from "./Shell";

const REFRESH_MS = 2000;
const PHASE_WORDS: Record<Phase, string> = {
  idle: "", queued: "Queued", window_check: "Blocked by window", applying: "Applying", health_wait: "Health wait",
  healthy: "Healthy", degraded: "Degraded", stopped: "Stopped",
};

export function Workspace({ session, slug }: { session: SessionBody; slug: string }) {
  const { search } = useLocation();
  const selected = search.get("stage");
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [missing, setMissing] = useState(false);
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [shownId, setShownId] = useState<string | null>(search.get("promotion"));
  const [column, setColumn] = useState<{ stage: string; history: Promotion[]; health: StageHealth; extra: Promotion | null } | null>(null);
  const [announcements, setAnnouncements] = useState<string[]>([]);
  const known = useRef(new Map<string, EdgeBundle>());
  const lastEdges = useRef<Map<string, { id: string | null; phase: Phase }> | null>(null);
  const inflight = useRef<Promise<void> | null>(null);

  const remember = (promotions: (Promotion | null)[]) => {
    for (const p of promotions) if (p) known.current.set(p.id, { version: p.bundle.version, short: p.bundle.short_digest });
  };

  const announce = useCallback((next: GraphData) => {
    for (const n of next.nodes) {
      remember([n.active_promotion]);
      if (n.current) known.current.set(n.current.promotion_id, { version: n.current.version, short: n.current.short_digest });
    }
    const previous = lastEdges.current;
    lastEdges.current = new Map(next.edges.map((e) => [e.to, { id: e.promotion_id, phase: e.phase }]));
    if (!previous) return;
    const lines: string[] = [];
    for (const edge of next.edges) {
      const before = previous.get(edge.to);
      if (edge.phase === "idle" || !edge.promotion_id || (before?.id === edge.promotion_id && before.phase === edge.phase)) continue;
      const bundle = known.current.get(edge.promotion_id);
      lines.push(`${bundle?.version ?? "A bundle"} to ${edge.to}: ${PHASE_WORDS[edge.phase]}`);
    }
    if (lines.length) setAnnouncements((current) => [...current, ...lines].slice(-4));
  }, []);

  const refreshColumn = useCallback(async (stage: string, wanted: string | null) => {
    const [history, health] = await Promise.all([
      call<{ promotions: Promotion[] }>("GET", `/api/projects/${slug}/promotions?stage=${encodeURIComponent(stage)}&limit=50`),
      call<StageHealth>("GET", `/api/projects/${slug}/stages/${encodeURIComponent(stage)}/health`),
    ]);
    if (!history.ok || !health.ok) return;
    remember(history.data.promotions);
    let extra: Promotion | null = null;
    if (wanted && !history.data.promotions.some((p) => p.id === wanted)) {
      const found = await call<Promotion>("GET", `/api/promotions/${wanted}`);
      extra = found.ok ? found.data : null;
    }
    setColumn({ stage, history: history.data.promotions, health: health.data, extra });
  }, [slug]);

  const again = useRef(false);
  /** Reads the graph, status and bundles; a call during a read queues one more and shares its promise. */
  const refresh = useCallback((): Promise<void> => {
    if (inflight.current) {
      again.current = true;
      return inflight.current;
    }
    const read = async () => {
      do {
        again.current = false;
        const [g, s, b] = await Promise.all([
          call<GraphData>("GET", `/api/projects/${slug}/graph`),
          call<ServiceStatus>("GET", "/api/status"),
          call<{ bundles: Bundle[] }>("GET", `/api/projects/${slug}/bundles`),
        ]);
        if (g.ok) {
          announce(g.data);
          setGraph(g.data);
        } else if (g.status === 404) {
          setMissing(true);
        }
        if (s.ok) setStatus(s.data);
        if (b.ok) setBundles(b.data.bundles);
        if (selected) await refreshColumn(selected, shownId);
      } while (again.current);
    };
    inflight.current = read().finally(() => {
      inflight.current = null;
    });
    return inflight.current;
  }, [slug, selected, shownId, announce, refreshColumn]);

  useEvery(REFRESH_MS, () => void refresh());
  useEffect(() => {
    if (selected) void refreshColumn(selected, shownId);
  }, [selected, shownId, refreshColumn]);

  const select = useCallback((stage: string) => {
    setShownId(null);
    navigate(`/projects/${slug}?stage=${encodeURIComponent(stage)}`, true);
  }, [slug]);

  const closeColumn = useCallback(() => {
    const stage = selected;
    navigate(`/projects/${slug}`, true);
    setShownId(null);
    if (stage) document.querySelector<HTMLButtonElement>(`.node[data-stage="${CSS.escape(stage)}"]`)?.focus();
  }, [slug, selected]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && selected && !document.querySelector("dialog[open]")) closeColumn();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, closeColumn]);

  const edgeBundles = useMemo(() => new Map(known.current), [graph, column]);
  const node = graph?.nodes.find((n) => n.stage === selected) ?? null;
  const columnData = column && column.stage === selected ? column : null;
  const showId = shownId ?? node?.active_promotion?.id ?? node?.current?.promotion_id ?? null;
  const shown = node?.active_promotion?.id === showId ? node.active_promotion
    : columnData?.history.find((p) => p.id === showId) ?? (columnData?.extra?.id === showId ? columnData.extra : null);
  const stages = graph?.nodes.map((n) => n.stage) ?? [];
  const newest = bundles[0] ? { version: bundles[0].version, short: bundles[0].short_digest } : null;

  if (missing) {
    return (
      <main className="lost">
        <h1>Project not found</h1>
        <p>You are not a member of a project at this address.</p>
        <FeedbackRegions />
      </main>
    );
  }

  const evidence = graph && node ? (
    <EvidenceColumn project={slug} role={graph.role} node={node} shown={shown} history={columnData?.history ?? []}
      health={columnData?.health ?? null} loading={!columnData} bundles={bundles} onShow={setShownId} onClose={closeColumn}
      onChanged={refresh} />
  ) : undefined;

  return (
    <Shell session={session} slug={slug} stages={stages} selected={selected} onStage={select} title={graph?.project.name ?? "Keelson"} aside={evidence}>
      {graph ? (
        <>
          <Graph graph={graph} selected={selected} onSelect={select} edgeBundles={edgeBundles} bundleCount={bundles.length} newest={newest} />
          <Ledger nodes={graph.nodes} status={status} announcements={announcements} />
        </>
      ) : <p className="loading">Loading…</p>}
    </Shell>
  );
}
