import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Eye } from "lucide-react";
import { api, apiMessage, serverNow } from "../api";
import { MessageText } from "../components/MessageText";
import { useLiveEvent, useReducedMotion, useTick } from "../hooks";
import { useMe } from "../store";
import { formatWhen } from "../../shared/when";
import type { Receipts } from "../types";

// The read-by-version scrubber: a live time track from the send time to now, edit ticks and
// reader dots, and a handle whose instant drives the version text, lanes, numeral and chips.

const TRAVEL_MS = 300;
const COUNT_MS = 160;

type Anchor = number | "live";
type Reader = { id: string; name: string; firstRead: number | null; chip: number | null };
type TrackEvent = { at: number; label: string; key: string };

// The record as of an instant (Infinity = the live record at the right end).
function stateAt(data: Receipts, at: number) {
  const versions = data.versions.filter((v) => Date.parse(v.created_at) <= at);
  const current = versions.at(-1) ?? data.versions[0];
  const version = current?.version ?? 1;
  const readers: Reader[] = data.recipients.map((r) => {
    const reads = r.reads.filter((x) => Date.parse(x.read_at) <= at).sort((a, b) => Date.parse(a.read_at) - Date.parse(b.read_at));
    const latest = reads.at(-1);
    return {
      id: r.user.id,
      name: r.user.name,
      firstRead: reads[0] ? Date.parse(reads[0].read_at) : null,
      chip: latest && latest.version < version ? latest.version : null,
    };
  });
  const read = readers.filter((r) => r.firstRead !== null).sort((a, b) => (a.firstRead ?? 0) - (b.firstRead ?? 0) || a.name.localeCompare(b.name));
  const waiting = readers.filter((r) => r.firstRead === null).sort((a, b) => a.name.localeCompare(b.name));
  return { version, text: current?.text ?? "", read, waiting };
}

function trackEvents(data: Receipts, zone: string): TrackEvent[] {
  const events: TrackEvent[] = data.versions.slice(1).map((v) => ({
    at: Date.parse(v.created_at),
    label: `${formatWhen(zone, v.created_at)} · v${v.version} edit by ${v.edited_by.name}`,
    key: `edit-${v.version}`,
  }));
  for (const r of data.recipients) {
    for (const read of r.reads) {
      events.push({ at: Date.parse(read.read_at), label: `${formatWhen(zone, read.read_at)} · ${r.user.name} read v${read.version}`, key: `read-${r.user.id}-${read.version}` });
    }
  }
  return events.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
}

export function ReceiptsPanel({ messageId }: { messageId: string }) {
  const zone = useMe().workspace.time_zone;
  const reduced = useReducedMotion();
  const [data, setData] = useState<Receipts | "loading" | string>("loading");
  const [anchor, setAnchor] = useState<Anchor>("live");
  const [showList, setShowList] = useState(reduced);
  const [active, setActive] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const positions = useRef<Positions>(new Map());
  useTick(1_000);

  const load = useCallback(() => {
    api<Receipts>("GET", `/api/messages/${messageId}/receipts`).then(setData, (error: unknown) => setData(apiMessage(error)));
  }, [messageId]);
  useEffect(load, [load]);
  useEffect(() => setShowList(reduced), [reduced]);
  useLiveEvent((event) => {
    const payload = event.data as { message?: { id: string }; message_id?: string };
    if (event.name === "stream.reset" || payload.message?.id === messageId || payload.message_id === messageId) load();
  });

  if (data === "loading" || typeof data === "string") {
    return (
      <section className="panel" aria-labelledby="panel-receipts">
        <h2 id="panel-receipts" className="panel-title">
          Receipts
        </h2>
        <p className="panel-note">{data === "loading" ? "Loading receipts…" : data}</p>
      </section>
    );
  }

  const sent = Date.parse(data.sent_at);
  const events = trackEvents(data, zone);
  const latest = Math.max(Date.parse(data.as_of), ...events.map((e) => e.at));
  const now = serverNow();
  const end = Math.max(Number.isNaN(now) ? latest : now, latest, sent + 1_000);
  const span = end - sent;
  const instant = anchor === "live" ? end : Math.min(Math.max(anchor, sent), end);
  const position = anchor === "live" ? 100 : ((instant - sent) / span) * 100;
  const view = stateAt(data, anchor === "live" ? Number.POSITIVE_INFINITY : instant);
  const total = data.recipients.length;
  const valueText = `${formatWhen(zone, instant)} — ${view.read.length} of ${total} read, version ${view.version}`;

  const moveTo = (at: number) => setAnchor(at >= end ? "live" : Math.max(at, sent));
  const fromPointer = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const fraction = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    setAnchor(fraction >= 1 ? "live" : sent + fraction * span);
  };

  const onKey = (event: React.KeyboardEvent) => {
    const step = span * (event.shiftKey ? 0.1 : 0.01);
    const keys: Record<string, () => void> = {
      ArrowLeft: () => moveTo(instant - step),
      ArrowDown: () => moveTo(instant - step),
      ArrowRight: () => moveTo(instant + step),
      ArrowUp: () => moveTo(instant + step),
      Home: () => setAnchor(sent),
      End: () => setAnchor("live"),
    };
    const run = keys[event.key];
    if (run) {
      event.preventDefault();
      run();
    }
  };

  const onListKey = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.min(Math.max(i + (event.key === "ArrowDown" ? 1 : -1), 0), events.length - 1));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : events.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const chosen = events[active];
      if (chosen) moveTo(chosen.at);
    }
  };

  const pct = (at: number) => `${((at - sent) / span) * 100}%`;
  const firstReads = data.recipients
    .map((r) => ({ id: r.user.id, name: r.user.name, at: Math.min(...r.reads.map((x) => Date.parse(x.read_at))) }))
    .filter((r) => Number.isFinite(r.at));

  return (
    <section className="panel receipts" aria-labelledby="panel-receipts">
      <h2 id="panel-receipts" className="panel-title">
        Receipts
      </h2>
      <VersionText version={view.version} text={view.text} reduced={reduced} />
      <div
        ref={trackRef}
        className="track"
        onPointerDown={(event) => {
          event.preventDefault();
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          sliderRef.current?.focus({ preventScroll: true });
          fromPointer(event.clientX);
        }}
        onPointerMove={(event) => {
          if (dragging.current) fromPointer(event.clientX);
        }}
        onPointerUp={(event) => {
          dragging.current = false;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
      >
        <span className="track-line" aria-hidden="true" />
        <span className="track-fill" aria-hidden="true" style={{ width: `${position}%` }} />
        {data.versions.slice(1).map((v) => (
          <span key={v.version} className="tick" aria-hidden="true" style={{ left: pct(Date.parse(v.created_at)) }}>
            <span className="tick-label">v{v.version}</span>
          </span>
        ))}
        {firstReads.map((r) => (
          <span key={r.id} className="dot" aria-hidden="true" title={r.name} style={{ left: pct(r.at) }} />
        ))}
        <div
          ref={sliderRef}
          className="handle"
          role="slider"
          tabIndex={0}
          aria-label="Receipts time"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={position}
          aria-valuetext={valueText}
          style={{ left: `${position}%` }}
          onKeyDown={onKey}
        >
          <span className="handle-grip" aria-hidden="true" />
        </div>
      </div>
      <div className="track-ends" aria-hidden="true">
        <span>{formatWhen(zone, sent)}</span>
        <span>Now</span>
      </div>
      <Numeral read={view.read.length} total={total} reduced={reduced} />
      <div className="lanes">
        <Lane title="Read" readers={view.read} reduced={reduced} positions={positions.current} />
        <Lane title="Not yet" readers={view.waiting} reduced={reduced} positions={positions.current} />
      </div>
      <button className="button button-quiet" type="button" aria-expanded={showList} onClick={() => setShowList((v) => !v)}>
        {showList ? "Hide event list" : "Show event list"}
      </button>
      {showList ? (
        <ul
          className="event-list"
          role="listbox"
          aria-label="Edit and read events"
          tabIndex={0}
          aria-activedescendant={events[active] ? `event-${events[active].key}` : undefined}
          onKeyDown={onListKey}
        >
          {events.map((event, i) => (
            <li
              key={event.key}
              id={`event-${event.key}`}
              role="option"
              aria-selected={i === active}
              className="event-option"
              onClick={() => {
                setActive(i);
                moveTo(event.at);
              }}
            >
              {event.label}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function VersionText({ version, text, reduced }: { version: number; text: string; reduced: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRef(version);
  useLayoutEffect(() => {
    if (shown.current === version) return;
    shown.current = version;
    if (!reduced) ref.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: TRAVEL_MS, easing: "ease-in-out" });
  }, [version, reduced]);
  return (
    <section className="version-now" aria-label="Version at selected time">
      <span className="version-tag">v{version}</span>
      <div ref={ref}>
        <MessageText text={text} />
      </div>
    </section>
  );
}

function Numeral({ read, total, reduced }: { read: number; total: number; reduced: boolean }) {
  const [shown, setShown] = useState(read);
  const from = useRef(read);
  useEffect(() => {
    if (reduced || from.current === read) {
      from.current = read;
      setShown(read);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    from.current = read;
    let frame = 0;
    const step = () => {
      const t = Math.min((performance.now() - start) / COUNT_MS, 1);
      setShown(Math.round(origin + (read - origin) * t));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [read, reduced]);
  return (
    <p className="numeral">
      {shown} of {total} read
    </p>
  );
}

// Readers travel between lanes in read order (FLIP over just under a third of a second). The
// traveller is a stand-in on the page layer, so the panel's own boxes never grow mid-flight.
type Positions = Map<string, DOMRect>;

function Lane({ title, readers, reduced, positions }: { title: string; readers: Reader[]; reduced: boolean; positions: Positions }) {
  const ref = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>("[data-reader]") ?? [])];
    items.forEach((item, rank) => {
      const id = item.dataset.reader ?? "";
      const now = item.getBoundingClientRect();
      const before = positions.get(id);
      positions.set(id, now);
      if (reduced || !before) return;
      const dx = before.left - now.left;
      const dy = before.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      const delay = Math.min(rank * 16, 80);
      const ghost = item.cloneNode(true) as HTMLElement;
      ghost.removeAttribute("data-reader");
      ghost.setAttribute("aria-hidden", "true");
      ghost.classList.add("reader-ghost");
      Object.assign(ghost.style, { left: `${now.left}px`, top: `${now.top}px`, width: `${now.width}px`, height: `${now.height}px` });
      document.body.append(ghost);
      item.style.visibility = "hidden";
      const flight = ghost.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], {
        duration: TRAVEL_MS - delay,
        delay,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "backwards",
      });
      void flight.finished.catch(() => undefined).finally(() => {
        ghost.remove();
        item.style.visibility = "";
      });
    });
  });
  return (
    <div className="lane">
      <h3 className="lane-title">{title}</h3>
      <ul ref={ref} aria-label={title} className="lane-list">
        {readers.length === 0 ? <li className="lane-empty">{title === "Read" ? "Nobody yet" : "Everyone has read it"}</li> : null}
        {readers.map((reader) => (
          <li key={reader.id} data-reader={reader.id} className="reader">
            <span className="reader-dot" aria-hidden="true" />
            <span>{reader.name}</span>
            {reader.chip !== null ? (
              <span className="chip chip-read-version" key={reader.chip}>
                <Eye aria-hidden="true" size={16} />
                read v{reader.chip}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
