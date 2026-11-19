import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { LiveRegion, PendingDot, RollingCount } from './Bits.js';
import { trayCopy } from '../lib/copy.js';
import type { Cluster, ClusterEntry, ClusterSummary } from '../../shared/types.js';

export type MoveOutcome =
  | { kind: 'saved' }
  | { kind: 'stale'; entryIds: string[] }
  | { kind: 'locked' }
  | { kind: 'failed' };

export interface TrayHandle {
  /** The rectangle a plucked tile should fly to. */
  landingRect: () => DOMRect | null;
}

interface TrayProps {
  inline: boolean;
  cluster: Cluster | null;
  clusters: ClusterSummary[];
  activeEntryId: string | null;
  message: string;
  announce: (message: string) => void;
  onSelect: (clusterId: string) => void;
  onNewCluster: () => void;
  onMove: (entryId: string, toPosition: number) => Promise<MoveOutcome>;
  pendingSlot: number | null;
}

function entryTitle(entry: ClusterEntry): string {
  return entry.reference.title;
}

export const Tray = forwardRef<TrayHandle, TrayProps>(function Tray(props, ref): JSX.Element {
  const {
    inline,
    cluster,
    clusters,
    activeEntryId,
    message,
    announce,
    onSelect,
    onNewCluster,
    onMove,
    pendingSlot,
  } = props;

  const [expanded, setExpanded] = useState(false);
  const [order, setOrder] = useState<ClusterEntry[]>([]);
  const [liftedId, setLiftedId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const liftOrigin = useRef<ClusterEntry[]>([]);
  const barButton = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const dragState = useRef<{ entryId: string; pointerId: number } | null>(null);

  useEffect(() => {
    setOrder(cluster === null ? [] : cluster.entries);
    setLiftedId(null);
    setSavingId(null);
  }, [cluster]);

  useImperativeHandle(ref, () => ({
    landingRect: () => {
      if (!inline && !expanded) {
        return barButton.current?.getBoundingClientRect() ?? null;
      }
      const items = listRef.current?.querySelectorAll('li');
      if (items === undefined || items.length === 0) {
        return listRef.current?.getBoundingClientRect() ?? null;
      }
      return items[items.length - 1].getBoundingClientRect();
    },
  }));

  const title = cluster?.title ?? 'No cluster';
  const count = order.length;

  const commit = async (entryId: string, toPosition: number): Promise<void> => {
    setSavingId(entryId);
    const outcome = await onMove(entryId, toPosition);
    setSavingId(null);
    if (outcome.kind === 'saved') {
      announce(trayCopy.moveSaved(entryTitle(order.find((entry) => entry.id === entryId) ?? order[0]), toPosition, count));
      return;
    }
    if (outcome.kind === 'stale') {
      setOrder((current) => {
        const byId = new Map(current.map((entry) => [entry.id, entry]));
        return outcome.entryIds
          .map((id, index) => {
            const found = byId.get(id);
            return found === undefined ? null : { ...found, position: index + 1 };
          })
          .filter((entry): entry is ClusterEntry => entry !== null);
      });
      announce(trayCopy.moveStale());
      return;
    }
    setOrder(liftOrigin.current.length > 0 ? liftOrigin.current : (cluster?.entries ?? []));
    announce(
      outcome.kind === 'locked' && cluster !== null
        ? trayCopy.moveLocked(cluster.title, cluster.status)
        : trayCopy.moveFailed(),
    );
  };

  const step = (entryId: string, delta: number): void => {
    setOrder((current) => {
      const index = current.findIndex((entry) => entry.id === entryId);
      const next = index + delta;
      if (index === -1 || next < 0 || next >= current.length) {
        return current;
      }
      const reordered = [...current];
      reordered.splice(index, 1);
      reordered.splice(next, 0, current[index]);
      announce(trayCopy.step(entryTitle(current[index]), next + 1, current.length));
      return reordered.map((entry, position) => ({ ...entry, position: position + 1 }));
    });
  };

  const onGripKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, entry: ClusterEntry): void => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (liftedId === entry.id) {
        const position = order.findIndex((candidate) => candidate.id === entry.id) + 1;
        setLiftedId(null);
        void commit(entry.id, position);
      } else {
        liftOrigin.current = order;
        setLiftedId(entry.id);
        announce(
          trayCopy.lifted(
            entryTitle(entry),
            order.findIndex((candidate) => candidate.id === entry.id) + 1,
            order.length,
          ),
        );
      }
      return;
    }
    if (liftedId !== entry.id) {
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      step(entry.id, event.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      const restored = liftOrigin.current;
      setOrder(restored);
      setLiftedId(null);
      announce(
        trayCopy.moveCancelled(
          entryTitle(entry),
          restored.findIndex((candidate) => candidate.id === entry.id) + 1,
          restored.length,
        ),
      );
    }
  };

  const onGripPointerDown = (event: React.PointerEvent<HTMLButtonElement>, entry: ClusterEntry): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    dragState.current = { entryId: entry.id, pointerId: event.pointerId };
    liftOrigin.current = order;
    setLiftedId(entry.id);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onGripPointerMove = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const drag = dragState.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    const items = Array.from(listRef.current?.querySelectorAll('li') ?? []);
    const target = items.findIndex((item) => {
      const rect = item.getBoundingClientRect();
      return event.clientY >= rect.top && event.clientY <= rect.bottom;
    });
    if (target === -1) {
      return;
    }
    setOrder((current) => {
      const index = current.findIndex((candidate) => candidate.id === drag.entryId);
      if (index === -1 || index === target) {
        return current;
      }
      const reordered = [...current];
      reordered.splice(index, 1);
      reordered.splice(target, 0, current[index]);
      return reordered.map((entry, position) => ({ ...entry, position: position + 1 }));
    });
  };

  const onGripPointerUp = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const drag = dragState.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    dragState.current = null;
    setLiftedId(null);
    const listRect = listRef.current?.getBoundingClientRect();
    const inside =
      listRect !== undefined && event.clientY >= listRect.top - 24 && event.clientY <= listRect.bottom + 24;
    const position = order.findIndex((candidate) => candidate.id === drag.entryId) + 1;
    if (!inside || position === 0) {
      const restored = liftOrigin.current;
      setOrder(restored);
      const entry = restored.find((candidate) => candidate.id === drag.entryId);
      if (entry !== undefined) {
        announce(trayCopy.moveCancelled(entryTitle(entry), entry.position, restored.length));
      }
      return;
    }
    const originalPosition = liftOrigin.current.findIndex((candidate) => candidate.id === drag.entryId) + 1;
    if (originalPosition === position) {
      return;
    }
    void commit(drag.entryId, position);
  };

  const body = (
    <>
      <h2>{title}</h2>
      <div className="tray-switcher">
        <select
          aria-label="Tray cluster"
          value={cluster?.id ?? ''}
          onChange={(event) => onSelect(event.target.value)}
        >
          {cluster === null ? <option value="">No cluster</option> : null}
          {clusters.map((option) => (
            <option key={option.id} value={option.id}>
              {option.title}
            </option>
          ))}
        </select>
        <button type="button" onClick={onNewCluster}>
          New cluster
        </button>
      </div>
      <div className="tray-count" aria-label="Item count">
        <RollingCount value={count} /> items
      </div>
      <ul className="order-list" aria-label="Cluster order" ref={listRef}>
        {order.map((entry) => (
          <li
            key={entry.id}
            className={`order-item${liftedId === entry.id ? ' lifted' : ''}${
              activeEntryId === entry.id ? ' active' : ''
            }`}
          >
            <span className="slot">{entry.position}</span>
            <img src={entry.reference.mediaUrl} alt="" />
            <span className="order-title">
              {entryTitle(entry)}
              {entry.reference.kind === 'still' ? (
                <span className="order-sub">
                  {entry.reference.sourceClipTitle} · {entry.reference.timecode}
                </span>
              ) : null}
              {entry.isPrivate ? <span className="tag">Private</span> : null}
            </span>
            {savingId === entry.id ? (
              <span className="saving-note">
                <PendingDot /> Saving
              </span>
            ) : null}
            <button
              type="button"
              className="grip"
              aria-label={`Reorder ${entryTitle(entry)}`}
              onKeyDown={(event) => onGripKeyDown(event, entry)}
              onPointerDown={(event) => onGripPointerDown(event, entry)}
              onPointerMove={onGripPointerMove}
              onPointerUp={onGripPointerUp}
            >
              <span aria-hidden="true">⣿</span>
            </button>
          </li>
        ))}
        {pendingSlot !== null ? (
          <li className="order-item active">
            <span className="slot">{pendingSlot}</span>
            <span className="order-title">Plucked frame</span>
            <span className="saving-note">
              <PendingDot /> Saving
            </span>
          </li>
        ) : null}
      </ul>
      <LiveRegion name="Tray announcements" message={message} />
    </>
  );

  if (inline) {
    return (
      <aside className="tray" aria-label="Cluster tray">
        {body}
      </aside>
    );
  }

  return (
    <aside
      className="tray-bar"
      aria-label="Cluster tray"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && expanded && liftedId === null) {
          setExpanded(false);
          barButton.current?.focus();
        }
      }}
    >
      <button
        type="button"
        ref={barButton}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="visually-hidden">Cluster tray: </span>
        <span>
          {title} · <span className="count">{count}</span> items
        </span>
      </button>
      {expanded ? <div className="tray-panel">{body}</div> : <LiveRegion name="Tray announcements" message={message} />}
    </aside>
  );
});
