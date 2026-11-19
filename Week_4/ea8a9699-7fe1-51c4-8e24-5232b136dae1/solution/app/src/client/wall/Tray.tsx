// The cluster tray: the cut order down the right edge, or a bottom bar on phones (brief: Screens > Wall;
// Interactions > Keyboard reorder, Drag reorder, Refused moves, Tray switcher, Collapsed tray).
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { ChevronUp, GripVertical, Settings2 } from "lucide-react";
import type { Cluster, ClusterSummary, MoveResult } from "../../shared/api.js";
import { api } from "../lib/api.js";
import type { Live } from "../lib/live.js";
import { LiveRegion } from "../lib/live.js";
import { flip, layoutTops, panel, settle, slideIn, slidesDone } from "../lib/motion.js";
import { linkClick } from "../lib/router.js";
import { Empty, Pending, RollingNumber, STATUS_LABEL, StillSource, Thumb } from "../components/bits.js";
import { ClusterSwitcher } from "./ClusterSwitcher.js";

export interface Arriving {
  key: string;
  title: string;
  sourceClipTitle: string;
  timecode: string;
  thumb: string;
}

interface Props {
  slug: string;
  cluster: Cluster | null;
  activeId: string | null;
  clusters: ClusterSummary[];
  narrow: boolean;
  expanded: boolean;
  setExpanded: (open: boolean) => void;
  live: Live;
  arriving: Arriving | null;
  arrivingThumb: RefObject<HTMLImageElement | null>;
  bar: RefObject<HTMLButtonElement | null>;
  thumbs: Map<string, string>;
  enteringId: string | null;
  /** The sprocket strip is docked: the order scrolls to its end, where a plucked still lands. */
  docked: boolean;
  onChoose: (id: string) => void;
  onNew: (opener: HTMLButtonElement) => void;
  setCluster: (cluster: Cluster) => void;
  reload: () => Promise<Cluster | null>;
}

const moved = (ids: string[], from: number, to: number): string[] => {
  const next = [...ids];
  const [id] = next.splice(from, 1);
  if (id !== undefined) next.splice(to, 0, id);
  return next;
};

interface Lift {
  id: string;
  from: number;
  at: number;
}

interface Drag extends Lift {
  pointerId: number;
  startY: number;
  y: number;
  slots: Array<{ top: number; bottom: number }>;
  active: boolean;
}

export function Tray(props: Props) {
  const { cluster, live, narrow, expanded } = props;
  const entries = cluster ? [...cluster.entries].sort((a, b) => a.position - b.position) : [];
  const ids = entries.map((e) => e.id);
  const [view, setView] = useState<string[] | null>(null);
  const [lift, setLift] = useState<Lift | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const rows = useRef(new Map<string, HTMLElement>());
  const tops = useRef(new Map<string, number>());
  const list = useRef<HTMLOListElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const focusId = useRef<string | null>(null);
  const order = view ?? ids;
  const byId = new Map(entries.map((e) => [e.id, e]));
  const collapsed = narrow && !expanded;

  // Slide moved rows from where they were, then keep focus on the moved item's handle.
  useLayoutEffect(() => {
    flip(rows.current, tops.current, drag?.active ? drag.id : null);
    tops.current = layoutTops(rows.current);
    const id = focusId.current;
    const target = id ? handles.current.get(id) : null;
    if (target && document.activeElement !== target && (document.activeElement === document.body || document.activeElement?.closest(".tray__order"))) target.focus();
  }, [order.join(","), drag?.at]);

  // The entering row may arrive with a later tray load: retry when the order changes, and slide each row once.
  const slid = useRef<string | null>(null);
  useLayoutEffect(() => {
    const id = props.enteringId;
    if (!id || slid.current === id) return;
    const el = rows.current.get(id);
    if (el) {
      slid.current = id;
      slideIn(el);
    }
  }, [props.enteringId, order.join(",")]);

  useLayoutEffect(() => {
    if (narrow && expanded && panelRef.current) panel(panelRef.current, true, 12);
  }, [narrow, expanded]);

  useLayoutEffect(() => {
    const el = list.current;
    if (props.docked && el) el.scrollTop = el.scrollHeight;
  }, [props.docked]);

  // A fade at the bottom edge shows the order scrolls on while rows remain below it; an order the user left at its
  // end stays at its end while rows grow or the list shrinks, so a landed still never slips out of view.
  const pinnedFor = useRef<string | null>(null);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const atEnd = (): boolean => el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    const mark = (): void => {
      el.dataset.more = String(!atEnd());
    };
    const scrolled = (): void => {
      el.dataset.pinned = String(atEnd());
      mark();
    };
    if (pinnedFor.current !== (cluster?.id ?? null)) {
      pinnedFor.current = cluster?.id ?? null;
      el.dataset.pinned = String(atEnd());
    }
    mark();
    el.addEventListener("scroll", scrolled, { passive: true });
    const observer = new ResizeObserver(() => {
      if (el.dataset.pinned === "true") el.scrollTop = el.scrollHeight;
      mark();
    });
    observer.observe(el);
    for (const row of el.children) observer.observe(row);
    return () => {
      el.removeEventListener("scroll", scrolled);
      observer.disconnect();
    };
  }, [order.length, props.arriving, collapsed, cluster?.id]);

  useEffect(() => {
    setView(null);
    setLift(null);
    setDrag(null);
  }, [cluster?.id]);

  const collapse = (): void => {
    const el = panelRef.current;
    const animation = el ? panel(el, false, 12) : null;
    props.bar.current?.focus();
    props.setExpanded(false);
    if (animation) {
      setClosing(true);
      animation.onfinish = () => setClosing(false);
    }
  };

  const title = (id: string): string => byId.get(id)?.reference.title ?? "";
  const n = ids.length;

  const save = async (id: string, to: number): Promise<void> => {
    if (!cluster) return;
    focusId.current = id;
    setSaving(id);
    const result = await api<MoveResult>("POST", `/api/clusters/${cluster.id}/entries/${id}/move`, { body: { toPosition: to + 1, version: cluster.version } });
    // The tray shows the answer's order and takes the next press before the answer is announced.
    const settled = (shown?: Cluster): void =>
      flushSync(() => {
        setSaving(null);
        setView(null);
        if (shown) props.setCluster(shown);
      });
    if (result.ok) {
      settled(reordered(cluster, result.data.entryIds, result.data.version));
      // Announced once the rows rest in their slots, so the saved order is where it reads.
      await slidesDone(rows.current);
      live.say(`Moved ${title(id)} to position ${to + 1} of ${n}. Order saved.`);
    } else if (result.error?.error === "stale_order" && result.error.entryIds && result.error.version !== undefined) {
      const latest = result.error.entryIds;
      if (latest.length === n && latest.every((e) => byId.has(e))) settled(reordered(cluster, latest, result.error.version));
      else {
        await props.reload();
        settled();
      }
      live.say("The order changed elsewhere. Showing the latest order.", true);
    } else if (result.error?.error === "cluster_locked") {
      settled();
      const fresh = await props.reload();
      live.say(`${cluster.title} is locked while ${STATUS_LABEL[fresh?.status ?? cluster.status]}. The order is unchanged.`, true);
    } else {
      settled();
      live.say("The order could not be saved. Try again.", true);
    }
    handles.current.get(id)?.focus();
  };

  const onHandleKey = (event: React.KeyboardEvent<HTMLButtonElement>, id: string): void => {
    const index = order.indexOf(id);
    if (!lift) {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        if (saving) return;
        focusId.current = id;
        setLift({ id, from: index, at: index });
        live.say(`Lifted ${title(id)}, position ${index + 1} of ${n}. Use arrow keys to move, Space to drop, Escape to cancel.`);
      }
      return;
    }
    if (lift.id !== id) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const at = Math.max(0, Math.min(n - 1, lift.at + (event.key === "ArrowUp" ? -1 : 1)));
      setLift({ ...lift, at });
      setView(moved(ids, lift.from, at));
      live.say(`${title(id)}, position ${at + 1} of ${n}.`);
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      setLift(null);
      if (lift.at === lift.from) {
        setView(null);
        live.say(`Move cancelled. ${title(id)} is back at position ${lift.from + 1} of ${n}.`);
      } else void save(id, lift.at);
    } else if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      setLift(null);
      setView(null);
      live.say(`Move cancelled. ${title(id)} is back at position ${lift.from + 1} of ${n}.`);
    }
  };

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>, id: string): void => {
    if (lift || saving || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    settle(rows.current);
    const slots = ids.map((e) => {
      const box = rows.current.get(e)?.getBoundingClientRect();
      return { top: box?.top ?? 0, bottom: box?.bottom ?? 0 };
    });
    const index = ids.indexOf(id);
    setDrag({ id, from: index, at: index, pointerId: event.pointerId, startY: event.clientY, y: event.clientY, slots, active: false });
  };

  const slotAt = (d: Drag, y: number): number => {
    const found = d.slots.findIndex((s) => y >= s.top && y < s.bottom);
    if (found >= 0) return found;
    return y < (d.slots[0]?.top ?? 0) ? 0 : d.slots.length - 1;
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const active = drag.active || Math.abs(event.clientY - drag.startY) > 3;
    if (!active) return;
    const at = slotAt(drag, event.clientY);
    focusId.current = drag.id;
    setDrag({ ...drag, at, y: event.clientY, active });
    setView(moved(ids, drag.from, at));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const box = list.current?.getBoundingClientRect();
    const inside = box && event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top - 4 && event.clientY <= box.bottom + 4;
    setDrag(null);
    if (!drag.active || !inside || drag.at === drag.from) {
      setView(null);
      if (drag.active && !inside) live.say(`Move cancelled. ${title(drag.id)} is back at position ${drag.from + 1} of ${n}.`);
      return;
    }
    void save(drag.id, drag.at);
  };

  const dragShift = (id: string, index: number): number => {
    if (!drag?.active || drag.id !== id) return 0;
    return drag.y - drag.startY - ((drag.slots[index]?.top ?? 0) - (drag.slots[drag.from]?.top ?? 0));
  };

  const count = cluster?.itemCount ?? 0;
  const options = cluster && !props.clusters.some((c) => c.id === cluster.id) ? [{ id: cluster.id, title: cluster.title, status: cluster.status, itemCount: cluster.itemCount }, ...props.clusters] : props.clusters;

  return (
    <aside
      className="tray"
      aria-label="Cluster tray"
      data-narrow={narrow ? "true" : "false"}
      onKeyDown={(event) => {
        if (narrow && expanded && event.key === "Escape" && !lift) {
          event.preventDefault();
          collapse();
        }
      }}
    >
      {narrow && <LiveRegion live={live} name="Tray announcements" className="tray__status" />}
      {narrow && (
        <button
          ref={props.bar}
          type="button"
          className="tray__bar"
          aria-expanded={expanded}
          aria-controls="tray-panel"
          onClick={() => {
            if (expanded) collapse();
            else {
              setClosing(false);
              props.setExpanded(true);
            }
          }}
        >
          <span className="visually-hidden">Cluster tray: </span>
          <span className="tray__bar-title">{cluster ? cluster.title : "No cluster chosen"}</span>
          <span className="tray__bar-count">
            {" · "}
            <RollingNumber value={count} /> items
          </span>
          <ChevronUp size={18} aria-hidden="true" className="tray__bar-chevron" />
        </button>
      )}
      <div
        id="tray-panel"
        ref={panelRef}
        className="tray__panel"
        hidden={collapsed && !closing}
        inert={collapsed && closing}
      >
        <div className="tray__head">
          <h2 className="tray__title">{cluster ? cluster.title : "No cluster chosen"}</h2>
          <div className="tray__controls">
            <ClusterSwitcher
              options={options}
              activeId={props.activeId}
              activeTitle={options.find((c) => c.id === props.activeId)?.title ?? cluster?.title ?? null}
              onChoose={props.onChoose}
            />
            <button type="button" className="btn" onClick={(e) => props.onNew(e.currentTarget)}>
              New cluster
            </button>
          </div>
          <p className="tray__count mono" role="group" aria-label="Item count">
            <RollingNumber value={count} /> items
          </p>
        </div>
        {!narrow && <LiveRegion live={live} name="Tray announcements" className="tray__status" />}
        <ol ref={list} className="tray__order" aria-label="Cluster order">
          {order.map((id, index) => {
            const entry = byId.get(id);
            if (!entry) return null;
            const r = entry.reference;
            const lifted = lift?.id === id || (drag?.active && drag.id === id);
            return (
              <li
                key={id}
                ref={(el) => {
                  if (el) rows.current.set(id, el);
                  else rows.current.delete(id);
                }}
                className="tray__row"
                data-active={lifted ? "true" : undefined}
                style={dragShift(id, index) ? { transform: `translateY(${dragShift(id, index)}px)` } : undefined}
              >
                <span className="tray__slot mono">{index + 1}</span>
                <Thumb src={props.thumbs.get(r.id) ?? r.mediaUrl} kind={r.kind} alt="" className="tray__thumb" />
                <span className="tray__text">
                  <span className="tray__name" title={r.title}>
                    {r.title}
                  </span>
                  {r.kind === "still" && (
                    <StillSource clipTitle={r.sourceClipTitle ?? ""} timecode={r.timecode ?? ""} className="tray__meta" />
                  )}
                  {entry.isPrivate && <span className="tag tag--small">Private</span>}
                  {saving === id && (
                    <span className="tray__saving">
                      Saving <Pending />
                    </span>
                  )}
                </span>
                <button
                  ref={(el) => {
                    if (el) handles.current.set(id, el);
                    else handles.current.delete(id);
                  }}
                  type="button"
                  className="tray__handle"
                  aria-label={`Reorder ${r.title}`}
                  aria-pressed={lift?.id === id ? true : undefined}
                  onKeyDown={(e) => onHandleKey(e, id)}
                  onKeyUp={(e) => e.key === " " && e.preventDefault()}
                  onPointerDown={(e) => onPointerDown(e, id)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={() => {
                    setDrag(null);
                    setView(null);
                  }}
                >
                  <GripVertical size={18} aria-hidden="true" />
                </button>
              </li>
            );
          })}
          {props.arriving && (
            <li key={props.arriving.key} className="tray__row tray__row--arriving" data-active="true">
              <span className="tray__slot mono">{order.length + 1}</span>
              <img ref={props.arrivingThumb} className="thumb tray__thumb" src={props.arriving.thumb} alt="" />
              <span className="tray__text">
                <span className="tray__name">{props.arriving.title}</span>
                <StillSource clipTitle={props.arriving.sourceClipTitle} timecode={props.arriving.timecode} className="tray__meta" />
                <span className="tray__saving">
                  Saving <Pending />
                </span>
              </span>
            </li>
          )}
        </ol>
        {cluster && !order.length && !props.arriving && <Empty>No items yet. Add references or pluck a frame.</Empty>}
        {cluster && (
          <a className="tray__settings" href={`/w/${props.slug}/clusters/${cluster.id}`} onClick={(e) => linkClick(e, `/w/${props.slug}/clusters/${cluster.id}`)}>
            <Settings2 size={16} aria-hidden="true" />
            Cluster settings
          </a>
        )}
      </div>
    </aside>
  );
}

function reordered(cluster: Cluster, entryIds: string[], version: number): Cluster {
  const byId = new Map(cluster.entries.map((e) => [e.id, e]));
  const entries = entryIds.flatMap((id, i) => {
    const entry = byId.get(id);
    return entry ? [{ ...entry, position: i + 1 }] : [];
  });
  return { ...cluster, version, entries };
}
