import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { LineageBody, SessionUser } from '../../shared/api';
import type { Tag } from '../../shared/domain';
import { canTrace } from '../../shared/permissions';
import { apiGet } from './api';
import { COPY } from './hooks';
import { TagGlyphs } from './ui';

export interface LineageViewProps {
  user: SessionUser;
  columnId: string | null;
  onOpenColumn: (id: string) => void;
  onActivity: (text: string) => void;
  asOf: string | null;
  narrow: boolean;
  railOpen: boolean;
  setRailOpen: (open: boolean) => void;
  /** Events to react to: open-canvas updates and role changes. */
  refreshSignal: number;
  roleSignal: number;
}

interface NodeState {
  column: string;
  asset: string;
  hop: number;
  lit: boolean;
  tags: Tag[];
  sealed: Tag[];
  deprecated: boolean;
  deprecatedUpstream: string | null;
  sources: Partial<Record<Tag, string[]>>;
  edgeState: 'current' | 'new';
}

interface EdgeState {
  id: string;
  from: string;
  to: string;
  kind: 'flow' | 'seal' | 'cycle';
  drawn: boolean;
  state: 'current' | 'new';
}

const HOP_FILL_MS = 220;

/**
 * The lineage drawing (DP-41..DP-48): upstream and downstream hop bands with a
 * sweep from time zero, keyboard navigation, pan and zoom, and the open-canvas
 * updates that keep every other node's state.
 */
export function LineageView(props: LineageViewProps): ReactNode {
  const { user, columnId, onOpenColumn, onActivity, asOf, narrow, railOpen, setRailOpen, refreshSignal, roleSignal } = props;
  const traceable = canTrace(user.role);

  const [upstream, setUpstream] = useState<LineageBody | null>(null);
  const [, setDownstream] = useState<LineageBody | null>(null);
  const [sweep, setSweep] = useState<'idle' | 'running' | 'done'>('idle');
  const [sweepCount, setSweepCount] = useState(0);
  const [summary, setSummary] = useState('');
  const [lineageStatus, setLineageStatus] = useState('');
  const [layout, setLayout] = useState<'settling' | 'settled'>('settled');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const [focusNode, setFocusNode] = useState<string | null>(null);
  const [, setChosenHop] = useState<string | null>(null);
  const [nodes, setNodes] = useState<Map<string, NodeState>>(new Map());
  const [edges, setEdges] = useState<EdgeState[]>([]);
  const traceSeqRef = useRef(0);
  const sweepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const rovingRef = useRef<string | null>(null);

  const mayTrace = canTrace(user.role);

  const cancelSweep = useCallback((): void => {
    if (sweepTimerRef.current) clearTimeout(sweepTimerRef.current);
    sweepTimerRef.current = null;
    traceSeqRef.current += 1;
  }, []);

  // Opening a column draws the canvas at rest; a role change cancels a pending trace (DP-95).
  useEffect(() => {
    cancelSweep();
    setSelected(null);
    setChosenHop(null);
    setSweep('idle');
    setSweepCount(0);
    setSummary('');
    if (!columnId) {
      setUpstream(null);
      setDownstream(null);
      setNodes(new Map());
      setEdges([]);
      return;
    }
    const seq = ++traceSeqRef.current;
    const suffix = asOf ? `&as_of_seq=${asOf}` : '';
    void (async () => {
      const up = await apiGet<LineageBody>(`/api/columns/${encodeURIComponent(columnId)}/lineage?direction=upstream${suffix}`);
      const down = await apiGet<LineageBody>(`/api/columns/${encodeURIComponent(columnId)}/lineage?direction=downstream${suffix}`);
      if (traceSeqRef.current !== seq) return;
      if (up.status === 200 && down.status === 200) {
        setUpstream(up.body);
        setDownstream(down.body);
        const map = new Map<string, NodeState>();
        const focusTags = down.body.focus_tags;
        const focusAsset = assetOf(columnId);
        map.set(columnId, {
          column: columnId,
          asset: focusAsset,
          hop: 0,
          lit: true,
          tags: focusTags,
          sealed: [],
          deprecated: down.body.assets[focusAsset]?.state === 'deprecated',
          deprecatedUpstream: down.body.assets[focusAsset]?.deprecated_upstream ?? null,
          sources: down.body.focus_tag_sources,
          edgeState: 'current',
        });
        for (const r of up.body.reached) {
          map.set(r.column, {
            column: r.column,
            asset: r.asset,
            hop: -r.hop,
            lit: false,
            tags: r.carried_tags,
            sealed: r.sealed_tags,
            deprecated: up.body.assets[r.asset]?.state === 'deprecated',
            deprecatedUpstream: up.body.assets[r.asset]?.deprecated_upstream ?? null,
            sources: r.tag_sources,
            edgeState: 'current',
          });
        }
        for (const r of down.body.reached) {
          map.set(r.column, {
            column: r.column,
            asset: r.asset,
            hop: r.hop,
            lit: false,
            tags: [],
            sealed: r.sealed_tags,
            deprecated: down.body.assets[r.asset]?.state === 'deprecated',
            deprecatedUpstream: down.body.assets[r.asset]?.deprecated_upstream ?? null,
            sources: r.tag_sources,
            edgeState: 'current',
          });
        }
        setNodes(map);
        const allEdges: EdgeState[] = [];
        for (const e of up.body.edges) {
          allEdges.push({ id: `${e.from}|${e.to}`, from: e.from, to: e.to, kind: e.kind, drawn: true, state: 'current' });
        }
        for (const e of down.body.edges) {
          allEdges.push({ id: `${e.from}|${e.to}`, from: e.from, to: e.to, kind: e.kind, drawn: false, state: 'current' });
        }
        setEdges(allEdges);
        setLayout('settling');
        requestAnimationFrame(() => setLayout('settled'));
        setFocusNode(columnId);
        rovingRef.current = columnId;
      }
    })();
    return cancelSweep;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnId, asOf, roleSignal]);

  // Open-canvas updates (DP-04, DP-97, DP-99): tag, certification and lineage changes.
  useEffect(() => {
    if (refreshSignal === 0 || !columnId || asOf !== null) return;
    const suffix = asOf ? `&as_of_seq=${asOf}` : '';
    void (async () => {
      const up = await apiGet<LineageBody>(`/api/columns/${encodeURIComponent(columnId)}/lineage?direction=upstream${suffix}`);
      const down = await apiGet<LineageBody>(`/api/columns/${encodeURIComponent(columnId)}/lineage?direction=downstream${suffix}`);
      if (up.status !== 200 || down.status !== 200) return;
      setUpstream(up.body);
      setDownstream(down.body);
      let changedEdges = false;
      setNodes((prev) => {
        const next = new Map(prev);
        const applyResponse = (body: LineageBody, upstreamSide: boolean): void => {
          for (const r of body.reached) {
            const existing = next.get(r.column);
            if (!existing) continue;
            const updated: NodeState = {
              ...existing,
              tags: existing.lit || existing.hop < 0 || existing.hop === 0 ? (upstreamSide ? r.carried_tags : existing.lit ? r.carried_tags : existing.tags) : existing.tags,
              sealed: r.sealed_tags,
              deprecated: body.assets[r.asset]?.state === 'deprecated',
              deprecatedUpstream: body.assets[r.asset]?.deprecated_upstream ?? null,
              sources: r.tag_sources,
            };
            next.set(r.column, updated);
          }
        };
        applyResponse(down.body, false);
        applyResponse(up.body, true);
        const focus = next.get(columnId);
        if (focus) {
          next.set(columnId, { ...focus, tags: down.body.focus_tags, sources: down.body.focus_tag_sources });
        }
        return next;
      });
      setEdges((prev) => {
        const listed = new Set<string>();
        for (const e of [...up.body.edges, ...down.body.edges]) listed.add(`${e.from}|${e.to}`);
        const kept = prev.filter((e) => listed.has(e.id) || !e.drawn);
        const known = new Set(kept.map((e) => e.id));
        for (const e of [...up.body.edges, ...down.body.edges]) {
          if (!known.has(`${e.from}|${e.to}`)) {
            kept.push({ id: `${e.from}|${e.to}`, from: e.from, to: e.to, kind: e.kind, drawn: true, state: 'new' });
            changedEdges = true;
          }
        }
        return kept;
      });
      if (changedEdges) setLineageStatus(COPY.lineageChanged);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const startTrace = useCallback((): void => {
    if (!columnId || !mayTrace) return;
    cancelSweep();
    setSweep('idle');
    setSweepCount(0);
    setSummary(COPY.tracing);
    const seq = traceSeqRef.current;
    const suffix = asOf ? `&as_of_seq=${asOf}` : '';
    void (async () => {
      const res = await apiGet<LineageBody>(`/api/columns/${encodeURIComponent(columnId)}/lineage?direction=downstream${suffix}`);
      if (traceSeqRef.current !== seq) return;
      if (res.status !== 200) {
        setSummary(COPY.traceUnavailable);
        setSweep('idle');
        return;
      }
      const body = res.body;
      setDownstream(body);
      setSweep('running');
      setSweepCount(0);
      setSummary(COPY.tracing);
      // Reset the downstream side to unlit, per the sweep rules.
      setNodes((prev) => {
        const next = new Map(prev);
        for (const [id, node] of next) {
          if (node.hop > 0) {
            next.set(id, { ...node, lit: false, tags: [], sealed: node.sealed, edgeState: 'current' });
          }
        }
        for (const r of body.reached) {
          if (!next.has(r.column)) {
            next.set(r.column, {
              column: r.column,
              asset: r.asset,
              hop: r.hop,
              lit: false,
              tags: [],
              sealed: r.sealed_tags,
              deprecated: body.assets[r.asset]?.state === 'deprecated',
              deprecatedUpstream: body.assets[r.asset]?.deprecated_upstream ?? null,
              sources: r.tag_sources,
              edgeState: 'current',
            });
          }
        }
        return next;
      });
      setEdges((prev) => {
        const keptUpstream = prev.filter((e) => e.state === 'current' && e.kind !== 'cycle' ? true : true);
        const upstreamIds = new Set<string>();
        if (upstream) {
          for (const e of upstream.edges) upstreamIds.add(`${e.from}|${e.to}`);
        }
        const cycleKeys = new Set(body.cycles.map((c) => `${c.from}|${c.to}`));
        const newEdges: EdgeState[] = [];
        for (const e of body.edges) {
          newEdges.push({
            id: `${e.from}|${e.to}`,
            from: e.from,
            to: e.to,
            kind: e.kind,
            drawn: false,
            state: 'current',
          });
        }
        void keptUpstream;
        void upstreamIds;
        void cycleKeys;
        return newEdges;
      });

      const deepest = body.totals.hops;
      const step = Math.min(140, deepest > 0 ? Math.floor(1580 / deepest) : 140);
      const totalByHop = new Map<number, number>();
      for (const r of body.reached) {
        totalByHop.set(r.hop, (totalByHop.get(r.hop) ?? 0) + 1);
      }
      const cumulative = new Map<number, number>();
      let acc = 0;
      for (let k = 1; k <= deepest; k++) {
        acc += totalByHop.get(k) ?? 0;
        cumulative.set(k, acc);
      }
      if (deepest === 0) {
        setSweep('done');
        setSummary(body.summary);
        onActivity(body.summary);
        return;
      }
      for (let k = 1; k <= deepest; k++) {
        setTimeout(() => {
          if (traceSeqRef.current !== seq) return;
          setNodes((prev) => {
            const next = new Map(prev);
            for (const r of body.reached.filter((x) => x.hop === k)) {
              const existing = next.get(r.column);
              if (existing) {
                next.set(r.column, { ...existing, lit: true, tags: r.carried_tags, sealed: r.sealed_tags });
              } else {
                next.set(r.column, {
                  column: r.column,
                  asset: r.asset,
                  hop: r.hop,
                  lit: true,
                  tags: r.carried_tags,
                  sealed: r.sealed_tags,
                  deprecated: body.assets[r.asset]?.state === 'deprecated',
                  deprecatedUpstream: body.assets[r.asset]?.deprecated_upstream ?? null,
                  sources: r.tag_sources,
                  edgeState: 'current',
                });
              }
            }
            return next;
          });
          setEdges((prev) =>
            prev.map((e) =>
              !e.drawn && e.kind !== 'cycle' && body.reached.some((r) => r.column === e.to && r.hop === k)
                ? { ...e, drawn: true }
                : e
            )
          );
        }, k * step);
        setTimeout(() => {
          if (traceSeqRef.current !== seq) return;
          setSweepCount(cumulative.get(k) ?? 0);
        }, k * step + HOP_FILL_MS);
      }
      const finishAt = deepest * step + HOP_FILL_MS;
      sweepTimerRef.current = setTimeout(() => {
        if (traceSeqRef.current !== seq) return;
        setEdges((prev) => prev.map((e) => ({ ...e, drawn: true })));
        setSweep('done');
        setSweepCount(body.totals.columns);
        setSummary(body.summary);
        onActivity(body.summary);
      }, finishAt);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnId, mayTrace, asOf, onActivity, upstream]);

  const bands = useMemo(() => {
    const byHop = new Map<number, NodeState[]>();
    for (const node of nodes.values()) {
      const list = byHop.get(node.hop) ?? [];
      list.push(node);
      byHop.set(node.hop, list);
    }
    for (const list of byHop.values()) list.sort((a, b) => (a.column < b.column ? -1 : a.column > b.column ? 1 : 0));
    return [...byHop.entries()].sort((a, b) => a[0] - b[0]);
  }, [nodes]);

  const chooseNode = (id: string): void => {
    setSelected(id);
    const node = nodes.get(id);
    setChosenHop(node ? String(node.hop) : null);
    if (node) setLineageStatus(COPY.nodeChosen(node.column, String(node.hop)));
  };

  const openColumn = (id: string): void => {
    onOpenColumn(id);
  };

  // Keyboard: one roving Tab stop, arrows, Home, End, Enter, Space, T, zoom keys (DP-45, DP-46).
  const onNodeKeyDown = (ev: React.KeyboardEvent, id: string): void => {
    const node = nodes.get(id);
    if (!node) return;
    const band = bands.find(([, list]) => list.some((n) => n.column === id));
    const list = band?.[1] ?? [];
    const rowIndex = list.findIndex((n) => n.column === id);
    const focusColumnId = (target: string | null | undefined): void => {
      if (!target) return;
      setFocusNode(target);
      rovingRef.current = target;
      const el = groupRef.current?.querySelector<HTMLButtonElement>(`[data-column="${cssEscape(target)}"]`);
      el?.focus();
    };
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
      ev.preventDefault();
      const dir = ev.key === 'ArrowRight' ? 1 : -1;
      const nextBand = bands.find(([h]) => h === node.hop + dir);
      if (!nextBand) return;
      if (dir === 1) {
        const linked = list.flatMap((n) => edges.filter((e) => e.from === n.column).map((e) => e.to));
        const firstLinked = [...nodes.values()].filter((n) => nextBand[1].some((x) => x.column === n.column) && linked.includes(n.column)).sort((a, b) => (a.column < b.column ? -1 : 1))[0];
        focusColumnId(firstLinked?.column ?? nextBand[1][Math.min(rowIndex, nextBand[1].length - 1)]?.column ?? null);
      } else {
        const linkedInto = edges.filter((e) => e.to === id).map((e) => e.from);
        const candidates = nextBand[1].filter((n) => linkedInto.includes(n.column));
        focusColumnId(candidates[0]?.column ?? nextBand[1][Math.min(rowIndex, nextBand[1].length - 1)]?.column ?? null);
      }
      return;
    }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const next = list[rowIndex + (ev.key === 'ArrowDown' ? 1 : -1)];
      focusColumnId(next?.column ?? null);
      return;
    }
    if (ev.key === 'Home') {
      ev.preventDefault();
      focusColumnId(columnId ?? '');
      return;
    }
    if (ev.key === 'End') {
      ev.preventDefault();
      const lastBand = bands.filter(([h]) => h > 0).at(-1);
      const target = lastBand ? lastBand[1].at(-1) : (columnId !== null ? nodes.get(columnId) : undefined);
      focusColumnId(target?.column ?? columnId ?? '');
      return;
    }
    if (ev.key === ' ' || ev.key === 'Spacebar') {
      ev.preventDefault();
      chooseNode(id);
      return;
    }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      chooseNode(id);
      openColumn(id);
      return;
    }
    if (ev.key === 't' || ev.key === 'T') {
      ev.preventDefault();
      startTrace();
      return;
    }
    if (ev.key === '+' || ev.key === '=') {
      ev.preventDefault();
      zoomBy(0.25);
      return;
    }
    if (ev.key === '-') {
      ev.preventDefault();
      zoomBy(-0.25);
      return;
    }
    if (ev.key === '0') {
      ev.preventDefault();
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
  };

  const zoomBy = (delta: number): void => {
    const content = contentRef.current;
    const current = zoom;
    const next = Math.min(2, Math.max(0.5, current + delta));
    if (next === current) return;
    if (content) {
      const rect = content.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      setPan({
        x: cx - (cx - pan.x) * (next / current),
        y: cy - (cy - pan.y) * (next / current),
      });
    }
    setZoom(next);
  };

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ dist: number; mid: { x: number; y: number }; zoom: number; pan: { x: number; y: number } } | null>(null);

  const onPointerDown = (ev: React.PointerEvent): void => {
    const target = ev.target as HTMLElement;
    if (target.closest('button') || target.closest('[data-canvas-header]')) return;
    if (!contentRef.current) return;
    if (!contentRef.current.contains(target) && !target.hasAttribute('data-canvas-strip')) return;
    pointers.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const rect = contentRef.current.getBoundingClientRect();
      pinchStart.current = {
        dist: Math.hypot(a!.x - b!.x, a!.y - b!.y),
        mid: { x: (a!.x + b!.x) / 2 - rect.left, y: (a!.y + b!.y) / 2 - rect.top },
        zoom,
        pan: { ...pan },
      };
      return;
    }
    if (pointers.current.size > 1) return;
    const startX = ev.clientX;
    const startY = ev.clientY;
    const startPan = { ...pan };
    let active = true;
    const onMove = (e: PointerEvent): void => {
      if (!active) return;
      setPan({ x: startPan.x + (e.clientX - startX), y: startPan.y + (e.clientY - startY) });
    };
    const onUp = (e: PointerEvent): void => {
      active = false;
      pointers.current.delete(e.pointerId);
      pinchStart.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onPointerMove = (ev: React.PointerEvent): void => {
    if (!pointers.current.has(ev.pointerId)) return;
    pointers.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const start = pinchStart.current;
    if (!start || pointers.current.size !== 2 || !contentRef.current) return;
    const [a, b] = [...pointers.current.values()];
    const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    if (dist === 0) return;
    const z = Math.min(2, Math.max(0.5, (start.zoom * dist) / start.dist));
    const m = start.mid;
    setZoom(z);
    setPan({
      x: m.x - (m.x - start.pan.x) * (z / start.zoom),
      y: m.y - (m.y - start.pan.y) * (z / start.zoom),
    });
  };

  if (narrow) {
    return (
      <HopListView
        {...props}
        bands={bands}
        edges={edges}
        sweep={sweep}
        sweepCount={sweepCount}
        summary={summary}
        lineageStatus={lineageStatus}
        selected={selected}
        onChoose={chooseNode}
        onOpen={openColumn}
        railOpen={railOpen}
        setRailOpen={setRailOpen}
        onTrace={startTrace}
      />
    );
  }

  const groupAttrs = {
    'data-sweep': sweep,
    'data-layout': layout,
    'data-zoom': zoom.toFixed(2),
    'data-pan-x': String(Math.ceil(pan.x - 0.5)),
    'data-pan-y': String(Math.ceil(pan.y - 0.5)),
  };

  return (
    <div className="canvas-pane">
      <div ref={groupRef} className="canvas-group" role="group" aria-label="Lineage canvas" {...groupAttrs}>
        <div className="canvas-header" data-canvas-header="">
          <span className="canvas-focus mono">{columnId ?? ''}</span>
          {mayTrace && traceable && (
            <button type="button" className="btn" onClick={startTrace} onKeyDown={(e) => (e.key === 't' || e.key === 'T') && startTrace()}>
              Trace impact
            </button>
          )}
          <span data-sweep-count="" className="mono sweep-count">
            {sweepCount}
          </span>
          <button type="button" className="btn" onClick={() => zoomBy(0.25)} onKeyDown={(e) => (e.key === '+' || e.key === '=') && zoomBy(0.25)}>
            Zoom in
          </button>
          <button type="button" className="btn" onClick={() => zoomBy(-0.25)} onKeyDown={(e) => e.key === '-' && zoomBy(-0.25)}>
            Zoom out
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          >
            Reset view
          </button>
          <p role="status" aria-label="Trace summary" aria-live="polite" className="status trace-summary">
            {summary}
          </p>
          <p role="status" aria-label="Lineage status" aria-live="polite" className="status lineage-status">
            {lineageStatus}
          </p>
        </div>
        <div
          ref={contentRef}
          className="canvas-content"
          data-canvas-content=""
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
        >
          {!columnId ? (
            <p className="muted canvas-empty">{COPY.noAsset}</p>
          ) : (
            <div
              className="canvas-inner"
              style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}
            >
              {bands.map(([hop, list]) => (
                <div key={hop} className="hop-band" data-band={hop}>
                  <div data-hop-label={hop} className="hop-label mono">
                    {Math.abs(hop)}
                  </div>
                  {list.map((node) => (
                    <div key={node.column} className="node-wrap">
                      <button
                        type="button"
                        className={`node ${node.lit ? 'lit' : 'unlit'} ${node.deprecated ? 'deprecated' : ''}`}
                        data-column={node.column}
                        data-hop={node.hop}
                        data-lit={node.lit ? 'true' : 'false'}
                        data-tags={node.tags.join(' ')}
                        data-deprecated={node.deprecated ? 'true' : 'false'}
                        data-deprecated-upstream={node.deprecatedUpstream ?? ''}
                        data-selected={selected === node.column ? 'true' : 'false'}
                        tabIndex={rovingRef.current === node.column || (focusNode === null && node.hop === 0) ? 0 : -1}
                        onClick={() => chooseNode(node.column)}
                        onKeyDown={(e) => onNodeKeyDown(e, node.column)}
                      >
                        <span className="node-label">{node.column}</span>
                        <TagGlyphs tags={node.tags} />
                        {node.sealed.length > 0 && <span data-seal="suppression" className="seal-mark" />}
                        {(node.deprecated || node.deprecatedUpstream) && (
                          <span data-deprecation-flag="" className="deprecation-flag mono">
                            D
                          </span>
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              ))}
              {edges
                .filter((e) => nodes.has(e.from) && nodes.has(e.to))
                .map((e) => (
                  <div
                    key={e.id}
                    data-edge={e.id}
                    data-from={e.from}
                    data-to={e.to}
                    data-kind={e.kind}
                    data-drawn={e.drawn ? 'true' : 'false'}
                    data-edge-state={e.state}
                    className={`edge ${e.kind} ${e.drawn ? 'drawn' : 'undrawn'} ${e.state}`}
                  />
                ))}
            </div>
          )}
        </div>
        <div className="canvas-strip" data-canvas-strip="" />
      </div>
    </div>
  );
}

function assetOf(columnId: string): string {
  const idx = columnId.lastIndexOf('.');
  return idx > 0 ? columnId.slice(0, idx) : columnId;
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

/** The hop-stacked list shown below 768 pixels. */
function HopListView(
  props: LineageViewProps & {
    bands: Array<[number, NodeState[]]>;
    edges: EdgeState[];
    sweep: 'idle' | 'running' | 'done';
    sweepCount: number;
    summary: string;
    lineageStatus: string;
    selected: string | null;
    onChoose: (id: string) => void;
    onOpen: (id: string) => void;
    railOpen: boolean;
    setRailOpen: (open: boolean) => void;
    onTrace: () => void;
  }
): ReactNode {
  const { user, columnId, bands, sweep, sweepCount, summary, lineageStatus, selected, onChoose, onOpen, railOpen, setRailOpen, onTrace } = props;
  const closeRef = useRef<HTMLButtonElement>(null);
  if (!railOpen) return null;
  const mayTrace = canTrace(user.role);
  return (
    <aside
      className="lineage-rail"
      role="complementary"
      aria-label="Lineage"
      data-sweep={sweep}
      data-layout="settled"
      data-transition="open"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          setRailOpen(false);
        }
      }}
    >
      <button ref={closeRef} type="button" className="btn rail-close" onClick={() => setRailOpen(false)}>
        Close lineage
      </button>
      <div className="rail-controls">
        {mayTrace && (
          <button type="button" className="btn" onClick={onTrace}>
            Trace impact
          </button>
        )}
        <span data-sweep-count="" className="mono">
          {sweepCount}
        </span>
      </div>
      <p role="status" aria-label="Trace summary" aria-live="polite" className="status">
        {summary}
      </p>
      <p role="status" aria-live="polite" className="status">
        {lineageStatus}
      </p>
      <div className="hop-list">
        {!columnId && <p className="muted">{COPY.noAsset}</p>}
        {bands.map(([hop, list]) => (
          <section key={hop} className="hop-section">
            <h4 className="hop-heading">{hop < 0 ? `Upstream hop ${-hop}` : hop === 0 ? 'Focus' : `Hop ${hop}`}</h4>
            {list.map((node) => (
              <div
                key={node.column}
                className="hop-item"
                data-column={node.column}
                data-hop={node.hop}
                data-lit={node.lit ? 'true' : 'false'}
                data-tags={node.tags.join(' ')}
                data-deprecated={node.deprecated ? 'true' : 'false'}
                data-deprecated-upstream={node.deprecatedUpstream ?? ''}
                data-selected={selected === node.column ? 'true' : 'false'}
              >
                <button
                  type="button"
                  className="node hop-node-btn"
                  onClick={() => onChoose(node.column)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      onChoose(node.column);
                      onOpen(node.column);
                    } else if (e.key === ' ') {
                      e.preventDefault();
                      onChoose(node.column);
                    }
                  }}
                >
                  <span className="node-label">{node.column}</span>
                  <TagGlyphs tags={node.tags} />
                  {node.sealed.length > 0 && <span data-seal="suppression" />}
                  {(node.deprecated || node.deprecatedUpstream) && <span data-deprecation-flag="">D</span>}
                </button>
                {node.tags.map((t) => (
                  <div key={t} data-source-line={t} className="source-line mono">
                    {COPY.hopListSource(t, node.sources[t] ?? [])}
                  </div>
                ))}
              </div>
            ))}
          </section>
        ))}
      </div>
    </aside>
  );
}
