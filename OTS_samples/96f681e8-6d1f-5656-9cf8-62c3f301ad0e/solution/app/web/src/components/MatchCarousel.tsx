import { type FocusEvent, useLayoutEffect, useRef, useState } from "react";
import type { Match } from "../api";
import { clubDate, clubTime, euros, level, playersPerMatch } from "../format";
import type { JoinState } from "../matches";
import { ChevronLeftIcon, ChevronRightIcon, CourtPictogram, PictureIcon } from "./Icons";

const gap = 32;

const placeholder: Match = {
  id: "placeholder",
  court: 1,
  start: "2026-01-01T09:30:00+01:00",
  start_utc: "2026-01-01T08:30:00Z",
  minutes: 90,
  level_min: 3,
  level_max: 4,
  status: "open",
  players: 1,
  share_cents: 1350,
  cutoff_at: "2026-01-01T06:30:00Z",
  joined: false,
  booking_id: null,
  server_now: "2026-01-01T17:00:00Z",
};

const statusWord = { open: "Open", full: "Full", cancelled: "Cancelled" } as const;

function MatchCard({ match, join, onJoin }: { match: Match; join?: JoinState; onJoin: (match: Match) => void }) {
  const pending = Boolean(join?.pending);
  // Joined (a paid place) and the viewer's own pending join always keep their button; otherwise Join match shows only
  // while the card is open with fewer than four players.
  const showJoin = match.joined || pending || (match.status === "open" && match.players < playersPerMatch);
  const inert = match.joined || pending;
  const label = `Court ${match.court}, ${clubDate(match.start)} ${clubTime(match.start)}`;
  return (
    <article className="match-card" aria-label={label} tabIndex={-1} data-match-id={match.id}>
      <div className="match-card__top">
        <CourtPictogram />
        <span className={`status-word status-word--${match.status}`}>{statusWord[match.status]}</span>
      </div>
      <div className="match-card__body">
        <p className="match-card__title">
          Court {match.court} · {clubDate(match.start)} {clubTime(match.start)}
        </p>
        <p className="match-card__meta">
          Level {level(match.level_min)} to {level(match.level_max)}
        </p>
        <p className="match-card__meta">{match.players} of {playersPerMatch} players</p>
        <p className="match-card__meta">{euros(match.share_cents)} per player</p>
        <div className="player-dots" role="meter" aria-label="Players" aria-valuemin={0} aria-valuemax={playersPerMatch} aria-valuenow={match.players}>
          {Array.from({ length: playersPerMatch }, (_, i) => (
            <span key={i} className="player-dot" data-filled={i < match.players} />
          ))}
        </div>
        {join?.error && (
          <p role="alert" className="error-band">
            {join.error}
          </p>
        )}
        {showJoin && (
          <button
            type="button"
            className="pill pill--cobalt match-card__join"
            aria-disabled={inert ? "true" : undefined}
            onClick={() => {
              if (!inert) onJoin(match);
            }}
          >
            {match.joined ? "Joined" : pending ? "Joining..." : "Join match"}
          </button>
        )}
      </div>
    </article>
  );
}

interface Props {
  matches: Match[] | null;
  failed: string | null;
  joins: Record<string, JoinState>;
  onJoin: (match: Match) => void;
}

/** The open match cards carousel: pages by arrow, dot or swipe. */
export function MatchCarousel({ matches, failed, joins, onJoin }: Props) {
  const [perView, setPerView] = useState(1);
  const count = matches?.length ?? 0;
  const pages = Math.max(1, Math.ceil(count / perView));
  const [requested, setRequested] = useState(0);
  const page = Math.min(requested, pages - 1);
  const viewport = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const swipe = useRef<{ x: number } | null>(null);
  const region = useRef<HTMLElement>(null);
  const nextArrow = useRef<HTMLButtonElement>(null);
  // Which card holds focus, and whether on its join button, so a refresh that hides or removes it moves focus on.
  const held = useRef<{ id: string; onButton: boolean } | null>(null);
  const order = useRef<string[]>([]);

  const track = (event: FocusEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    const card = target.closest<HTMLElement>("[data-match-id]");
    held.current = card ? { id: card.dataset.matchId as string, onButton: target.classList.contains("match-card__join") } : null;
  };

  // Cards update in place on every refresh. Focus stays where it was; when the focused Join match is hidden it moves
  // to its card, and when the focused card leaves it moves to the next card's button or to Next matches.
  useLayoutEffect(() => {
    const previous = order.current;
    const ids = matches?.map((m) => m.id) ?? [];
    order.current = ids;
    const focus = held.current;
    const root = region.current;
    if (!focus || !root) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const cardOf = (id: string) => root.querySelector<HTMLElement>(`[data-match-id="${CSS.escape(id)}"]`);
    const same = cardOf(focus.id);
    if (same) {
      same.focus({ preventScroll: true });
      return;
    }
    const following = previous.slice(previous.indexOf(focus.id) + 1).find((id) => ids.includes(id));
    const button = following ? cardOf(following)?.querySelector<HTMLElement>(".match-card__join") : null;
    (button ?? nextArrow.current)?.focus({ preventScroll: true });
    if (document.activeElement === document.body) root.focus({ preventScroll: true });
  }, [matches]);

  // Cards per view come from the stylesheet (`--per-view`, by window width); the page maths reads the same value.
  useLayoutEffect(() => {
    const element = viewport.current?.closest<HTMLElement>(".carousel");
    const track = viewport.current;
    if (!element || !track) return;
    const measure = () => {
      const perViewNow = Number(getComputedStyle(element).getPropertyValue("--per-view")) || 1;
      setPerView(perViewNow);
      const card = (track.clientWidth - gap * (perViewNow - 1)) / perViewNow;
      const first = Math.min(page * perViewNow, Math.max(count - perViewNow, 0));
      setOffset(first * (card + gap));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [page, count]);

  const go = (next: number) => setRequested(Math.min(Math.max(next, 0), pages - 1));

  return (
    <section
      className="carousel"
      aria-label="Open matches"
      ref={region}
      tabIndex={-1}
      onFocus={track}
      style={{ ["--carousel-offset" as string]: `${offset}px` }}
    >
      {matches && matches.length === 0 && (
        <div className="empty-state">
          <PictureIcon size={36} />
          <p>No open matches for this level and day.</p>
        </div>
      )}
      {!matches && !failed && (
        <>
          <p className="visually-hidden">Loading…</p>
          {/* A hidden card and controls hold the carousel's size until the matches arrive, so nothing below moves. */}
          <div aria-hidden="true" style={{ visibility: "hidden" }}>
            <div className="carousel__stage">
              <div className="carousel__viewport">
                <div className="carousel__track">
                  <div className="carousel__slide">
                    <MatchCard match={placeholder} onJoin={() => undefined} />
                  </div>
                </div>
              </div>
            </div>
            <div className="carousel__controls">
              <span className="carousel__arrow" />
              <div className="carousel__dots">
                <span className="carousel__dot" />
              </div>
              <span className="carousel__arrow" />
            </div>
          </div>
        </>
      )}
      {failed && !matches && (
        <p role="alert" className="error-band">
          {failed}
        </p>
      )}
      {matches && matches.length > 0 && (
        <>
          <div className="carousel__stage">
          <div
            className="carousel__viewport"
            ref={viewport}
            onPointerDown={(event) => {
              if (event.pointerType === "touch") swipe.current = { x: event.clientX };
            }}
            onPointerUp={(event) => {
              if (!swipe.current) return;
              const dx = event.clientX - swipe.current.x;
              swipe.current = null;
              if (Math.abs(dx) > 40) go(page + (dx < 0 ? 1 : -1));
            }}
            onPointerCancel={() => {
              swipe.current = null;
            }}
          >
            <div className="carousel__track">
              {matches.map((match, index) => (
                <div
                  key={match.id}
                  className="carousel__slide"
                  onFocus={() => go(Math.floor(index / perView))}
                >
                  <MatchCard match={match} join={joins[match.id]} onJoin={onJoin} />
                </div>
              ))}
            </div>
          </div>
          </div>
          <div className="carousel__controls">
            <button type="button" className="carousel__arrow carousel__arrow--prev" aria-label="Previous matches" disabled={page === 0} onClick={() => go(page - 1)}>
              <ChevronLeftIcon size={16} />
            </button>
            <div className="carousel__dots">
              {Array.from({ length: pages }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  className="carousel__dot"
                  aria-label={`Page ${i + 1}`}
                  aria-current={i === page ? "true" : undefined}
                  onClick={() => go(i)}
                />
              ))}
            </div>
            <button type="button" ref={nextArrow} className="carousel__arrow carousel__arrow--next" aria-label="Next matches" disabled={page >= pages - 1} onClick={() => go(page + 1)}>
              <ChevronRightIcon size={16} />
            </button>
          </div>
        </>
      )}
    </section>
  );
}
