import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { Receipts } from '../shared/api';
import { apiGet, serverNow } from './api';
import { when } from './format';
import { MessageText } from './MessageText';

interface TrackEvent {
  at: number;
  kind: 'edit' | 'read';
  label: string;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function ReceiptsPanel({ messageId, refreshKey }: { messageId: string; refreshKey: number }): ReactElement {
  const [data, setData] = useState<Receipts | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [showEvents, setShowEvents] = useState(prefersReducedMotion());
  const [, setTick] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiGet<Receipts>(`/api/messages/${messageId}/receipts`).then((result) => {
      if (!cancelled) setData(result);
    });
    return () => {
      cancelled = true;
    };
  }, [messageId, refreshKey]);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const startMs = data === null ? 0 : new Date(data.sent_at).getTime();
  const endMs = Math.max(startMs + 1000, serverNow());
  const instant = anchor === null ? endMs : Math.min(anchor, endMs);
  const span = Math.max(1, endMs - startMs);
  const percent = Math.min(100, Math.max(0, ((instant - startMs) / span) * 100));

  const moveToPercent = useCallback(
    (value: number) => {
      const clamped = Math.min(100, Math.max(0, value));
      if (clamped >= 100) {
        setAnchor(null);
        return;
      }
      setAnchor(startMs + (span * clamped) / 100);
    },
    [startMs, span],
  );

  const moveToClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (track === null) return;
      const rect = track.getBoundingClientRect();
      moveToPercent(((clientX - rect.left) / Math.max(1, rect.width)) * 100);
    },
    [moveToPercent],
  );

  if (data === null) return <p>Loading receipts…</p>;

  const versionsByTime = [...data.versions].sort(
    (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
  );
  const currentVersion =
    versionsByTime.filter((version) => new Date(version.created_at).getTime() <= instant).slice(-1)[0] ??
    versionsByTime[0]!;

  const readers = data.recipients.map((recipient) => {
    const reads = [...recipient.reads].sort(
      (left, right) => new Date(left.read_at).getTime() - new Date(right.read_at).getTime(),
    );
    const byInstant = reads.filter((read) => new Date(read.read_at).getTime() <= instant);
    const latest = byInstant[byInstant.length - 1] ?? null;
    return { recipient, hasRead: byInstant.length > 0, latest };
  });
  const readLane = readers.filter((entry) => entry.hasRead);
  const notYetLane = readers.filter((entry) => !entry.hasRead);

  const events: TrackEvent[] = [
    ...versionsByTime
      .filter((version) => version.version > 1)
      .map((version) => ({
        at: new Date(version.created_at).getTime(),
        kind: 'edit' as const,
        label: `${when(version.created_at)} · v${version.version} edit by ${version.edited_by.name}`,
      })),
    ...data.recipients.flatMap((recipient) =>
      recipient.reads.map((read) => ({
        at: new Date(read.read_at).getTime(),
        kind: 'read' as const,
        label: `${when(read.read_at)} · ${recipient.user.name} read v${read.version}`,
      })),
    ),
  ].sort((left, right) => left.at - right.at);

  const positionOf = (at: number): number => Math.min(100, Math.max(0, ((at - startMs) / span) * 100));
  const valueText = `${when(instant)} — ${readLane.length} of ${data.recipients.length} read, version ${currentVersion.version}`;

  return (
    <div className="receipts">
      <div
        className="track"
        ref={trackRef}
        onPointerDown={(event) => {
          event.preventDefault();
          trackRef.current?.setPointerCapture(event.pointerId);
          dragging.current = event.pointerId;
          moveToClientX(event.clientX);
        }}
        onPointerMove={(event) => {
          if (dragging.current !== event.pointerId) return;
          moveToClientX(event.clientX);
        }}
        onPointerUp={(event) => {
          dragging.current = null;
          trackRef.current?.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          dragging.current = null;
        }}
      >
        {versionsByTime
          .filter((version) => version.version > 1)
          .map((version) => (
            <span key={version.version} className="tick" style={{ left: `${positionOf(new Date(version.created_at).getTime())}%` }}>
              <span className="mono tick-label">{`v${version.version}`}</span>
            </span>
          ))}
        {data.recipients.map((recipient) => {
          const first = recipient.reads[0];
          if (first === undefined) return null;
          return (
            <span
              key={recipient.user.id}
              className="dot"
              style={{ left: `${positionOf(new Date(first.read_at).getTime())}%` }}
            />
          );
        })}
        <div
          role="slider"
          aria-label="Receipts time"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={valueText}
          tabIndex={0}
          className="handle"
          style={{ left: `calc((100% - 44px) * ${percent / 100})` }}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 10 : 1;
            if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') moveToPercent(percent - step);
            else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') moveToPercent(percent + step);
            else if (event.key === 'Home') moveToPercent(0);
            else if (event.key === 'End') moveToPercent(100);
            else return;
            event.preventDefault();
          }}
        />
      </div>

      <p className="mono read-total">{`${readLane.length} of ${data.recipients.length} read`}</p>

      <section aria-label="Version at selected time" className="version-at" key={currentVersion.version}>
        <span className="mono chip chip-version">{`v${currentVersion.version}`}</span>
        <p className="message-text">
          <MessageText text={currentVersion.text} />
        </p>
      </section>

      <div className="lanes">
        <div>
          <h3>Read</h3>
          <ul aria-label="Read">
            {readLane.map((entry) => (
              <li key={entry.recipient.user.id}>
                <span>{entry.recipient.user.name}</span>
                {entry.latest !== null && entry.latest.version < currentVersion.version ? (
                  <span className="chip chip-oldversion mono">{`read v${entry.latest.version}`}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Not yet</h3>
          <ul aria-label="Not yet">
            {notYetLane.map((entry) => (
              <li key={entry.recipient.user.id}>
                <span>{entry.recipient.user.name}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <button type="button" onClick={() => setShowEvents((value) => !value)}>
        {showEvents ? 'Hide event list' : 'Show event list'}
      </button>
      {showEvents ? (
        <ul role="listbox" aria-label="Edit and read events" className="event-list" tabIndex={0}>
          {events.map((event, index) => (
            <li
              key={`${event.at}-${index}`}
              role="option"
              aria-selected={false}
              tabIndex={0}
              onClick={() => moveToPercent(positionOf(event.at))}
              onKeyDown={(keyEvent) => {
                if (keyEvent.key === 'Enter') moveToPercent(positionOf(event.at));
              }}
            >
              {event.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
