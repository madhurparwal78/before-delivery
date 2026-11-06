// Graph (/graph): filters in the address, share scope highlight, the WebGL link graph with one
// label button per visible node (or the still node list without WebGL), and the selected node's backlinks.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import '../styles/graph.css';
import { NetworkError, get } from '../api.ts';
import { announce, clearAlert, plural, showAlert } from '../feedback.ts';
import { Margin } from '../Frame.tsx';
import { linkHandler, navigate, useLocation } from '../router.ts';
import { useSession } from '../session.ts';
import { useSync } from '../sync.ts';
import type { BacklinkJson, CollectionJson, GraphJson, GraphNodeJson, ShareLinkJson, TypeJson } from '../types.ts';
import { GraphController } from '../graph/controller.ts';
import { GraphScene } from '../graph/scene.ts';
import { WHEEL_LINE_PX } from '../../shared/board.ts';
import { SCOPE_REFRESH_MS } from '../../shared/graph.ts';
import { compareText } from '../../shared/query.ts';

const SCOPE_GONE = 'That share link is no longer active.';

interface ScopeOption { id: string; label: string }

/** The graph address for a type and collection choice; "All" choices are left out. */
function graphAddress(type: string, collection: string): string {
  const q = new URLSearchParams();
  if (type) q.set('type', type);
  if (collection) q.set('collection', collection);
  const s = q.toString();
  return s ? `/graph?${s}` : '/graph';
}

const byTitle = (a: GraphNodeJson, b: GraphNodeJson): number => compareText(a.title, b.title) || compareText(a.id, b.id);

function nodeName(n: GraphNodeJson, outOfScope: boolean, pinned: boolean): string {
  return `${n.title}, ${plural(n.backlinks, 'backlink')}${outOfScope ? ', not shared' : ''}${pinned ? ', pinned' : ''}`;
}

export function GraphPage() {
  const { search } = useLocation();
  const typeFilter = search.get('type') ?? '';
  const collectionFilter = search.get('collection') ?? '';
  const { theme } = useSession();
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const [types, setTypes] = useState<TypeJson[]>([]);
  const [collections, setCollections] = useState<CollectionJson[]>([]);
  const [graph, setGraph] = useState<GraphJson | null>(null);
  const [scopeOptions, setScopeOptions] = useState<ScopeOption[]>([]);
  const [scope, setScopeState] = useState('');
  const scopeRef = useRef('');
  const [scoped, setScoped] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [pins, setPins] = useState<ReadonlySet<string>>(() => new Set());
  const [fallback, setFallback] = useState(false);
  const [linksLoaded, setLinksLoaded] = useState(false);
  // The shown filter choice; a change keeps it while the new address loads.
  const [typeChoice, setTypeChoice] = useState(typeFilter);
  const [collectionChoice, setCollectionChoice] = useState(collectionFilter);
  useEffect(() => setTypeChoice(typeFilter), [typeFilter]);
  useEffect(() => setCollectionChoice(collectionFilter), [collectionFilter]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLButtonElement>());
  const shellsRef = useRef<SVGSVGElement>(null);

  const ctlRef = useRef<GraphController | null>(null);
  if (!ctlRef.current) {
    ctlRef.current = new GraphController({
      label: (id) => labels.current.get(id) ?? null,
      shells: () => shellsRef.current,
      focusLabel: (id) => labels.current.get(id)?.focus({ preventScroll: true }),
      selectionChanged: (id) => setSelected(id),
      pinsChanged: (p) => setPins(p),
      announce,
      theme: () => themeRef.current,
    });
  }
  const ctl = ctlRef.current;
  ctl.filter = { type: typeFilter, collection: collectionFilter };

  // ---- data ----
  const loading = useRef(false);
  const again = useRef(false);
  const loadGraph = useCallback(async (): Promise<void> => {
    if (loading.current) {
      again.current = true;
      return;
    }
    loading.current = true;
    try {
      const chosen = scopeRef.current;
      const path = chosen ? `/api/graph?share_link_id=${encodeURIComponent(chosen)}` : '/api/graph';
      const [t, g] = await Promise.all([get<{ types: TypeJson[] }>('/api/types'), get<GraphJson>(path)]);
      if (chosen !== scopeRef.current) {
        again.current = true;
      } else if (g.status === 422 && chosen) {
        scopeRef.current = '';
        setScopeState('');
        setScoped(false);
        ctl.clearScope(true);
        showAlert(SCOPE_GONE);
      } else if (g.status === 200 && t.status === 200) {
        ctl.setData(g.data, t.data.types.map((x) => x.id), chosen !== '');
        setTypes(t.data.types);
        setScoped(chosen !== '');
        setGraph(g.data);
      }
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
    } finally {
      loading.current = false;
      if (again.current) {
        again.current = false;
        void loadGraph();
      }
    }
  }, [ctl]);

  const loadLinks = useCallback(async (): Promise<void> => {
    try {
      const c = await get<{ collections: CollectionJson[] }>('/api/collections');
      if (c.status !== 200) return;
      setCollections(c.data.collections);
      const lists = await Promise.all(c.data.collections.map((col) => get<{ share_links: ShareLinkJson[] }>(`/api/collections/${col.id}/share-links`)));
      const options: ScopeOption[] = [];
      c.data.collections.forEach((col, i) => {
        const r = lists[i];
        if (r?.status !== 200) return;
        for (const l of r.data.share_links) if (l.status === 'active') options.push({ id: l.id, label: `${col.name}, until ${l.expires_at_display}` });
      });
      setScopeOptions((old) => {
        const chosen = scopeRef.current;
        if (!chosen || options.some((o) => o.id === chosen)) return options;
        const kept = old.find((o) => o.id === chosen);
        return kept ? [...options, kept] : options;
      });
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
    } finally {
      setLinksLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadGraph();
    void loadLinks();
  }, [loadGraph, loadLinks]);

  useSync((event) => {
    if (event === 'backlinks.changed' || event === 'object.saved' || event === 'object.removed') void loadGraph();
    else if (event === 'share_link.changed') {
      void loadLinks();
      if (scopeRef.current) void loadGraph();
    } else if (event === 'sync.reset') {
      void loadGraph();
      void loadLinks();
    }
  });

  useEffect(() => {
    if (!scope) return;
    const timer = setInterval(() => void loadGraph(), SCOPE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [scope, loadGraph]);

  const chooseScope = (id: string) => {
    ctl.input();
    scopeRef.current = id;
    setScopeState(id);
    clearAlert();
    if (id) void loadGraph();
    else {
      setScoped(false);
      ctl.clearScope(false);
    }
  };

  // ---- the scene: the first frame is drawn in the commit that shows the labels ----
  const ready = graph !== null && linksLoaded;
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!ready || fallback) return;
    if (!ctl.scene && canvas) {
      const scene = GraphScene.create(canvas);
      if (!scene) {
        setFallback(true);
        return;
      }
      ctl.scene = scene;
      ctl.canvas = canvas;
    }
    ctl.start();
  }, [ctl, ready, fallback, graph]);

  useEffect(() => () => ctl.stop(), [ctl]);

  // Wheel zoom never scrolls the page.
  useEffect(() => {
    const group = groupRef.current;
    if (!group || fallback) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const h = canvasRef.current?.clientHeight ?? 0;
      const unit = e.deltaMode === 1 ? WHEEL_LINE_PX : e.deltaMode === 2 ? h : 1;
      ctl.wheel(e.deltaY * unit);
    };
    group.addEventListener('wheel', onWheel, { passive: false });
    return () => group.removeEventListener('wheel', onWheel);
  }, [ctl, fallback, ready]);

  // ---- nodes in title order ----
  const visible = useMemo(() => (graph ? graph.nodes.filter((n) => ctl.isVisible(n.id)).sort(byTitle) : []), [ctl, graph, typeFilter, collectionFilter]);
  const titles = useMemo(() => new Map(graph?.nodes.map((n) => [n.id, n.title]) ?? []), [graph]);
  const visibleIds = new Set(visible.map((n) => n.id));
  const tabStop = (focused && visibleIds.has(focused) ? focused : null) ?? (selected && visibleIds.has(selected) ? selected : null) ?? visible[0]?.id ?? null;

  const focusAt = (index: number) => {
    const n = visible[(index + visible.length) % visible.length];
    if (n) labels.current.get(n.id)?.focus({ preventScroll: true });
  };

  const onNodeKey = (e: KeyboardEvent<HTMLButtonElement>, id: string) => {
    ctl.input();
    const plain = !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
    const i = visible.findIndex((n) => n.id === id);
    if (plain && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) focusAt(i + 1);
    else if (plain && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) focusAt(i - 1);
    else if (plain && e.key === 'Home') focusAt(0);
    else if (plain && e.key === 'End') focusAt(visible.length - 1);
    else if (plain && e.key === 'Enter') navigate(`/o/${id}`);
    else if (plain && e.key === 'Escape') ctl.home();
    else if (!e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'p' || e.key === 'P')) ctl.togglePin(id);
    else if (!e.altKey && !e.ctrlKey && !e.metaKey && ctl.cameraKey(e.key, e.shiftKey)) { /* camera moved */ }
    else return;
    e.preventDefault();
  };

  const labelRef = (id: string) => (el: HTMLButtonElement | null) => {
    if (el) labels.current.set(id, el);
    else labels.current.delete(id);
  };

  const nodeButton = (n: GraphNodeJson) => {
    const out = scoped && n.in_scope === false;
    return (
      <button
        key={n.id} ref={labelRef(n.id)} type="button" className={`graph-label${n.id === selected ? ' graph-label-selected' : ''}`}
        tabIndex={n.id === tabStop ? 0 : -1} aria-label={nodeName(n, out, pins.has(n.id))}
        onFocus={() => {
          setFocused(n.id);
          ctl.focusNode(n.id);
        }}
        onBlur={() => {
          setFocused((f) => (f === n.id ? null : f));
          ctl.blurNode(n.id);
        }}
        onKeyDown={(e) => onNodeKey(e, n.id)}
      >
        <span className="graph-label-text">{n.title}{out ? ' · not shared' : ''}</span>
      </button>
    );
  };

  // ---- pointer ----
  const local = (e: PointerEvent<HTMLDivElement>): [number, number] => {
    const r = canvasRef.current?.getBoundingClientRect();
    return r ? [e.clientX - r.left, e.clientY - r.top] : [0, 0];
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const label = (e.target as HTMLElement).closest('.graph-label');
    let labelId: string | null = null;
    for (const [id, el] of labels.current) if (el === label) labelId = id;
    const [x, y] = local(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    ctl.pointerDown(e.pointerId, x, y, labelId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const [x, y] = local(e);
    ctl.pointerMove(e.pointerId, x, y);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => ctl.pointerUp(e.pointerId, e.altKey);
  const onPointerCancel = (e: PointerEvent<HTMLDivElement>) => ctl.pointerCancel(e.pointerId);

  const linksText = (n: GraphNodeJson): string => {
    const targets = (graph?.edges ?? []).filter((e) => e.from === n.id && visibleIds.has(e.to)).map((e) => e.to);
    const names = [...new Set(targets)].map((id) => titles.get(id) ?? '').sort(compareText);
    return names.length ? `links to ${names.join(', ')}` : 'links to nothing';
  };

  if (!ready) return <p className="muted graph-loading" aria-busy="true">Drawing the graph</p>;

  return (
    <>
      <div className="graph-toolbar">
        <label>
          <span>Show type</span>
          <select
            value={typeChoice}
            onChange={(e) => {
              setTypeChoice(e.target.value);
              window.location.assign(graphAddress(e.target.value, collectionFilter));
            }}
          >
            <option value="">All types</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label>
          <span>Show collection</span>
          <select
            value={collectionChoice}
            onChange={(e) => {
              setCollectionChoice(e.target.value);
              window.location.assign(graphAddress(typeFilter, e.target.value));
            }}
          >
            <option value="">All collections</option>
            {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>
          <span>Share scope</span>
          <select value={scope} onChange={(e) => chooseScope(e.target.value)}>
            <option value="">None</option>
            {scopeOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
      </div>
      {fallback ? (
        <div role="group" aria-label="Link graph" className="graph-fallback">
          <ul aria-label="Graph nodes" className="graph-list">
            {visible.map((n) => <li key={n.id}>{nodeButton(n)} <span className="graph-links">{linksText(n)}</span></li>)}
          </ul>
        </div>
      ) : (
        <div
          role="group" aria-label="Link graph" className="graph-scene bleed" ref={groupRef}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}
          onMouseDown={(e) => e.preventDefault()}
        >
          <canvas ref={canvasRef} aria-hidden="true" />
          <svg ref={shellsRef} className="graph-shells" aria-hidden="true" focusable="false" />
          {visible.map(nodeButton)}
        </div>
      )}
      <Margin><GraphBacklinks id={selected} /></Margin>
    </>
  );
}

/** The margin's backlinks of the selected node. */
function GraphBacklinks({ id }: { id: string | null }) {
  const [data, setData] = useState<{ id: string; count: number; backlinks: BacklinkJson[] } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const load = useCallback(async (target: string | null) => {
    if (!target) {
      setData(null);
      return;
    }
    try {
      const r = await get<{ count: number; backlinks: BacklinkJson[] }>(`/api/objects/${target}/backlinks`);
      if (r.status === 200) setData({ id: target, ...r.data });
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
    }
  }, []);
  const idRef = useRef(id);
  idRef.current = id;
  useEffect(() => {
    void load(id);
  }, [id, load]);
  useSync((event) => {
    if (event === 'backlinks.changed' || event === 'object.saved' || event === 'object.removed' || event === 'sync.reset') void load(idRef.current);
  });
  const shown = data && data.id === id ? data : null;
  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const links = [...(listRef.current?.querySelectorAll('a') ?? [])];
    const i = links.findIndex((a) => a === document.activeElement);
    if (i === -1) return;
    e.preventDefault();
    links[Math.max(0, Math.min(links.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };
  return (
    <section role="region" aria-label="Backlinks" className="graph-backlinks">
      <h2 className="margin-head small-caps">Backlinks{shown ? <span className="mono graph-backlink-count"> {shown.count}</span> : null}</h2>
      {shown ? (
        <ul aria-label="Backlinks list" ref={listRef} onKeyDown={onKey}>
          {shown.backlinks.map((b) => (
            <li key={b.edge_id}>
              <a href={`/o/${b.from_object_id}`} onClick={linkHandler(`/o/${b.from_object_id}`)}>{b.from_title}</a>{' '}
              <span className="muted">{b.kind === 'quote' ? 'quoted' : (b.field_name ?? '')}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Select a node to see what links to it.</p>
      )}
    </section>
  );
}
