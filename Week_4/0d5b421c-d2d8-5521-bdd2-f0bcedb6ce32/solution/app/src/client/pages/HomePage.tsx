import { useCallback, useEffect, useRef, useState } from "react";
import type { TonightResponse } from "../../shared/api.js";
import { get } from "../api.js";
import { Banners, COPY } from "../components/Shell.js";
import { ROOM_PORTRAITS } from "../components/Portraits.js";
import { useLiveEvents } from "../liveEvents.js";
import { navigate } from "../router.js";
import { useDependencyStatus } from "../status.js";

function caption(room: TonightResponse["rooms"][number], tonight: TonightResponse): string {
  const seats = `${room.name} · ${room.seats} seats`;
  if (tonight.next_slot === null) return `${seats} · Online booking for tonight has closed`;
  const nextTwo = room.next_table_for_two ?? "none";
  return `${seats} · ${room.covers_free_at_next_slot} covers free at ${tonight.next_slot} · Next table for two tonight: ${nextTwo}`;
}

export function HomePage() {
  const [tonight, setTonight] = useState<TonightResponse | null>(null);
  const { checks } = useDependencyStatus();
  const wordmark = useRef<HTMLHeadingElement>(null);

  const latest = useRef(0);
  const refresh = useCallback(() => {
    latest.current += 1;
    const ticket = latest.current;
    void get<TonightResponse>("/api/tonight").then((outcome) => {
      if (outcome.ok && ticket === latest.current) setTonight(outcome.body);
    });
  }, []);
  useEffect(refresh, [refresh, checks]);
  useLiveEvents(tonight === null ? null : `/api/floor/events?date=${tonight.date}`, refresh, refresh);

  useEffect(() => {
    const element = wordmark.current;
    if (element === null) return undefined;
    const publish = (): void => document.documentElement.style.setProperty("--wordmark-height", `${element.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <Banners />
      <h1 className="wordmark" ref={wordmark}>
        SAFFRON &amp; SLATE
      </h1>
      <main className="run">
        {ROOM_PORTRAITS.map(({ roomId, name, Portrait }) => {
          const room = tonight?.rooms.find((candidate) => candidate.room_id === roomId);
          return (
            <section className="panel" key={roomId}>
              <figure className="room-figure" aria-label={name}>
                <Portrait />
                <figcaption>{tonight === null || room === undefined ? name : caption(room, tonight)}</figcaption>
              </figure>
            </section>
          );
        })}
        <div className="run-end">
          <p>Pick the table, not just the time. We hold it for five minutes while you decide.</p>
          <a
            href="/book"
            className="button button-lime book-link book-link-fixed"
            onClick={(event) => {
              event.preventDefault();
              navigate("/book");
            }}
          >
            Book a table
          </a>
        </div>
      </main>
    </>
  );
}

export function NotFoundPage() {
  return (
    <>
      <Banners />
      <h1 className="summary">{COPY.notFound}</h1>
    </>
  );
}
