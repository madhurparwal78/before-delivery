// region "Live tail": follows new events, pauses with a counted buffer, discards the oldest past it, resumes in arrival order.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useShown } from "../../lib/format";
import { announce, useAppState } from "../../lib/store";
import { Button } from "../../lib/ui";
import { cellText, type ApiEvent } from "./model";

const KEPT_LINES = 1000;

export function LiveTail({ stream }: { stream: string }) {
  const shown = useShown();
  const capacity = useAppState((s) => s.settings?.tail_buffer ?? 1000);
  const [lines, setLines] = useState<ApiEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [counts, setCounts] = useState({ arrived: 0, discarded: 0 });
  const [slowed, setSlowed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const live = useRef({ paused: false, buffer: [] as ApiEvent[], arrived: 0, discarded: 0, capacity });
  const lastTop = useRef(0);
  live.current.capacity = capacity;

  const pause = (): void => {
    if (live.current.paused) return;
    live.current.paused = true;
    setPaused(true);
    announce("Live tail paused: 0 new events");
  };

  const resume = (): void => {
    const held = live.current.buffer;
    live.current = { ...live.current, paused: false, buffer: [], arrived: 0, discarded: 0 };
    setCounts({ arrived: 0, discarded: 0 });
    setLines((current) => [...current, ...held].slice(-KEPT_LINES));
    setPaused(false);
  };

  useEffect(() => {
    const source = new EventSource(`/api/tail?stream=${encodeURIComponent(stream)}`);
    source.addEventListener("line", (message) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as ApiEvent;
      const state = live.current;
      if (!state.paused) {
        setLines((current) => [...current, event].slice(-KEPT_LINES));
        return;
      }
      state.buffer.push(event);
      state.arrived += 1;
      if (state.buffer.length > state.capacity) {
        state.buffer.shift();
        state.discarded += 1;
      }
      setCounts({ arrived: state.arrived, discarded: state.discarded });
      announce(`Live tail paused: ${state.arrived} new ${state.arrived === 1 ? "event" : "events"}`);
    });
    source.addEventListener("slowed", () => setSlowed(true));
    return () => source.close();
  }, [stream]);

  useLayoutEffect(() => {
    const element = box.current;
    if (element && !paused) {
      element.scrollTop = element.scrollHeight;
      lastTop.current = element.scrollTop;
    }
  }, [lines, paused]);

  return (
    <section role="region" aria-label="Live tail" className="live-tail">
      <div className="tail-bar">
        {paused ? <Button primary onClick={resume}>Resume</Button> : <Button onClick={pause}>Pause</Button>}
        {paused ? <span className="mono small">Live tail paused: {counts.arrived} new {counts.arrived === 1 ? "event" : "events"}</span> : null}
        {paused && counts.discarded > 0 ? <span className="mono small">Buffer full: oldest {counts.discarded} {counts.discarded === 1 ? "event" : "events"} discarded.</span> : null}
        {slowed ? <span className="mono small">Live tail slowed: rate limit reached.</span> : null}
      </div>
      <div
        ref={box}
        className="tail-lines mono"
        onScroll={(event) => {
          const element = event.currentTarget;
          if (element.scrollTop < lastTop.current - 2 && element.scrollTop + element.clientHeight < element.scrollHeight - 4) pause();
          lastTop.current = element.scrollTop;
        }}
      >
        {lines.length === 0 ? <p className="muted">Waiting for new events on {stream}.</p> : null}
        {lines.map((event) => (
          <div key={event._id}>{`${shown(event["@timestamp"])} ${cellText(event.fields.host) || "none"} ${cellText(event.fields.level) || "none"} ${cellText(event.fields.message)}`}</div>
        ))}
      </div>
    </section>
  );
}
