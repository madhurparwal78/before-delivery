import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useSession } from "./main";
import {
  RequestKey,
  addDays,
  announce,
  api,
  clubDate,
  clubTime,
  durationPhrase,
  errorText,
  euros,
  get,
  goSignIn,
  level,
  levelOptions,
  navigate,
  syncServerClock,
  todayClub,
  useInterval,
  useReducedMotion,
  useWidth,
} from "./lib";
import { Empty } from "./ui";

export type Match = {
  id: string;
  court: number;
  start: string;
  start_utc: string;
  minutes: number;
  level_min: number;
  level_max: number;
  status: string;
  players: number;
  share_cents: number;
  cutoff_at: string;
  joined: boolean;
  booking_id: string | null;
  server_now: string;
};

function SearchPill({ initialLevel = "", initialDay = "" }: { initialLevel?: string; initialDay?: string }) {
  const [lvl, setLvl] = useState(initialLevel);
  const [day, setDay] = useState(initialDay);
  const today = todayClub();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const submit = () => {
    const q = new URLSearchParams();
    if (lvl) q.set("level", lvl);
    if (day) q.set("day", day);
    const s = q.toString();
    navigate("/matches" + (s ? "?" + s : ""));
  };
  const enter = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };
  return (
    <form
      role="search"
      aria-label="Find a match"
      class="search-pill"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <svg class="magnifier" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.4" />
        <path d="M15.5 15.5L21 21" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
      </svg>
      <label class="pill-field">
        <span>Level</span>
        <select aria-label="Level" value={lvl} onChange={(e) => setLvl((e.target as HTMLSelectElement).value)} onKeyDown={enter}>
          <option value="">Any level</option>
          {levelOptions.map((l) => (
            <option value={level(l)}>{level(l)}</option>
          ))}
        </select>
      </label>
      <label class="pill-field">
        <span>Day</span>
        <select aria-label="Day" value={day} onChange={(e) => setDay((e.target as HTMLSelectElement).value)} onKeyDown={enter}>
          <option value="">Any day</option>
          {days.map((d) => (
            <option value={d}>{d}</option>
          ))}
        </select>
      </label>
      <button type="submit" class="pill pill-cobalt">
        Find matches
      </button>
    </form>
  );
}

function CourtIllustration() {
  return (
    <svg class="court-illustration" role="img" aria-label="Court illustration" viewBox="0 0 400 500">
      <defs>
        <clipPath id="court-frame">
          <path d="M90 0H400V400A100 100 0 0 1 300 500H0V90H90Z" />
        </clipPath>
      </defs>
      <g clip-path="url(#court-frame)">
        <rect width="400" height="500" fill="#2f6bff" />
        <path d="M0 470L400 70" stroke="#ffffff" stroke-opacity="0.12" stroke-width="18" />
        <rect x="100" y="110" width="240" height="340" rx="6" fill="#1748d6" />
        <rect x="100" y="110" width="240" height="340" rx="6" fill="none" stroke="#bcd3ff" stroke-width="10" stroke-opacity="0.55" />
        <path d="M100 185V110H340V185M100 375V450H340V375" fill="none" stroke="#e6f0ff" stroke-width="6" stroke-opacity="0.85" />
        <g stroke="#ffffff" stroke-width="4" fill="none">
          <rect x="112" y="122" width="216" height="316" />
          <path d="M112 200H328M112 360H328M220 200V360" />
        </g>
        <path d="M100 280H340" stroke="#ffffff" stroke-width="7" />
        <path d="M100 280H340" stroke="#0b1533" stroke-width="2" stroke-dasharray="6 6" />
        <circle cx="168" cy="240" r="11" fill="#d4ff3a" />
        <circle cx="276" cy="330" r="11" fill="#d4ff3a" />
      </g>
    </svg>
  );
}

const steps: [string, string][] = [
  ["Hold it", "Pick a free cell and it is yours while the halo runs."],
  ["Split it", "Add three friends and each one gets their own share by email."],
  ["Play it", "Show up, check in at the desk, and play."],
];

function HouseRules() {
  const { club } = useSession();
  return (
    <section class="band-white" id="house-rules" aria-labelledby="rules-heading">
      <div class="column rules">
        <div class="rules-art" aria-hidden="true">
          <svg viewBox="0 0 200 160">
            <rect width="200" height="160" rx="28" fill="#eef4ff" />
            <rect x="34" y="26" width="132" height="108" rx="10" fill="none" stroke="#2f6bff" stroke-width="6" />
            <path d="M34 80H166M100 26V134" stroke="#2f6bff" stroke-width="4" />
            <circle cx="132" cy="52" r="10" fill="#d4ff3a" stroke="#0b1533" stroke-width="2" />
          </svg>
        </div>
        <div>
          <h2 id="rules-heading">House rules</h2>
          <p class="rules-text">
            Holds last <mark>{durationPhrase(club.hold_seconds)}</mark>, unpaid shares go on the organiser's card{" "}
            <mark>{durationPhrase(club.share_settle_seconds)} before</mark> start, open matches close{" "}
            <mark>{durationPhrase(club.match_cutoff_seconds)} before</mark> start, and cancelling up to{" "}
            <mark>{durationPhrase(club.free_cancel_seconds)}</mark> ahead is free.
          </p>
          <p>{club.rule_description}</p>
        </div>
      </div>
    </section>
  );
}

function Coaches() {
  const { club } = useSession();
  return (
    <section class="band-white" id="coaches" aria-labelledby="coaches-heading">
      <div class="column">
        <h2 id="coaches-heading">Coaches</h2>
        <div class="coach-cards">
          {club.coaches.map((c) => (
            <article class="coach-card" aria-label={c.name}>
              <span class="avatar" aria-hidden="true">
                {c.name
                  .split(" ")
                  .map((w) => w[0])
                  .join("")}
              </span>
              <div>
                <h3>{c.name}</h3>
                <p class="coach-levels">
                  Coach, levels {level(c.level_min)} to {level(c.level_max)}
                </p>
                <p>{c.line}</p>
                <span class="balls" aria-hidden="true">
                  {[0, 1, 2, 3, 4].map(() => (
                    <svg viewBox="0 0 16 16">
                      <circle cx="8" cy="8" r="7" fill="#d4ff3a" />
                      <path d="M3 4c3 2 3 6 0 8M13 4c-3 2-3 6 0 8" fill="none" stroke="#1748d6" stroke-width="1.2" />
                    </svg>
                  ))}
                </span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function HomePage() {
  return (
    <>
      <section class="hero">
        <div class="column hero-inner">
          <div class="hero-copy">
            <h1>
              Hold your court. <em>Split the bill.</em> Be on time.
            </h1>
            <p class="subhead">
              Seven courts at Marlowe Yard. Hold a slot, send each friend their share, and find a match at your level.
            </p>
            <SearchPill />
          </div>
          <CourtIllustration />
        </div>
      </section>
      <section class="steps" aria-labelledby="steps-heading">
        <div class="column">
          <h2 id="steps-heading">How a hold works</h2>
          <div class="step-cards">
            {steps.map(([title, body], i) => (
              <article class="step-card" aria-labelledby={`step-${i}`}>
                <span class="step-badge" aria-hidden="true">
                  {i + 1}
                </span>
                <h3 id={`step-${i}`}>{title}</h3>
                <hr />
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section class="band-white">
        <div class="column">
          <h2>Open matches</h2>
          <Carousel />
        </div>
      </section>
      <HouseRules />
      <Coaches />
    </>
  );
}

export function MatchesPage({ query }: { query: URLSearchParams }) {
  const lvl = query.get("level") ?? "";
  const day = query.get("day") ?? "";
  return (
    <div class="column page">
      <h1>Matches</h1>
      <SearchPill key={lvl + day} initialLevel={lvl} initialDay={day} />
      <Carousel key={lvl + "|" + day} levelFilter={lvl} dayFilter={day} />
    </div>
  );
}

type FocusMemo = { id: string; control: string; index: number } | null;

export function Carousel({ levelFilter = "", dayFilter = "" }: { levelFilter?: string; dayFilter?: string }) {
  const { me } = useSession();
  const width = useWidth();
  const reduced = useReducedMotion();
  const perView = width >= 1024 ? 3 : width >= 600 ? 2 : 1;
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [keepJoin, setKeepJoin] = useState<Record<string, number>>({});
  const refreshes = useRef(0);
  const prevStatus = useRef(new Map<string, string>());
  const cancelSaid = useRef(new Set<string>());
  const fullSaid = useRef(new Set<string>());
  const keys = useRef(new Map<string, RequestKey>());
  const region = useRef<HTMLDivElement>(null);
  const focusMemo = useRef<FocusMemo>(null);
  const touchX = useRef<number | null>(null);

  const query = () => {
    const q = new URLSearchParams();
    if (levelFilter) q.set("level", levelFilter);
    if (dayFilter) q.set("day", dayFilter);
    const s = q.toString();
    return "/api/matches" + (s ? "?" + s : "");
  };

  const rememberFocus = () => {
    const el = document.activeElement as HTMLElement | null;
    const card = el?.closest<HTMLElement>("[data-match]");
    if (!card || !region.current?.contains(card)) {
      focusMemo.current = null;
      return;
    }
    const cards = Array.from(region.current.querySelectorAll<HTMLElement>("[data-match]"));
    focusMemo.current = { id: card.dataset.match!, control: el?.dataset.control ?? "card", index: cards.indexOf(card) };
  };

  const load = useCallback(async () => {
    const a = await get<{ items: Match[] }>(query());
    if (a.status !== 200) {
      if (a.status === 422) setError(Object.values(a.error?.errors ?? {})[0] ?? errorText(a));
      return;
    }
    refreshes.current++;
    const items = a.data.items;
    if (items[0]) syncServerClock(items[0].server_now);
    for (const m of items) {
      const prev = prevStatus.current.get(m.id);
      if (m.joined && prev === "open" && m.status === "cancelled" && !cancelSaid.current.has(m.id)) {
        cancelSaid.current.add(m.id);
        announce("Match cancelled.");
      }
      if (m.joined && prev === "open" && m.status === "full" && !fullSaid.current.has(m.id)) {
        fullSaid.current.add(m.id);
        announce("Match is full.");
      }
      prevStatus.current.set(m.id, m.status);
    }
    rememberFocus();
    setError("");
    setMatches(items);
  }, [levelFilter, dayFilter]);

  useEffect(() => {
    load();
  }, [load]);
  useInterval(load, 10000);

  const pages = Math.max(1, Math.ceil((matches?.length ?? 0) / perView));
  const current = Math.min(page, pages - 1);

  const showJoin = (m: Match) => {
    if (m.joined || pendingId === m.id) return true;
    if (keepJoin[m.id] !== undefined && refreshes.current <= keepJoin[m.id] + 1) return true;
    return m.players < 4 && m.status === "open";
  };

  // Keep focus on the same control of the same card through refreshes.
  useLayoutEffect(() => {
    const memo = focusMemo.current;
    focusMemo.current = null;
    const root = region.current;
    if (!memo || !root || !matches) return;
    const active = document.activeElement;
    if (active && active !== document.body && root.contains(active)) return;
    const card = root.querySelector<HTMLElement>(`[data-match="${memo.id}"]`);
    if (card) {
      card.focus({ preventScroll: true });
      return;
    }
    const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-match]"));
    const next = cards[memo.index];
    const button = next?.querySelector<HTMLElement>('[data-control="join"]');
    if (button) {
      setPage(Math.floor(memo.index / perView));
      button.focus({ preventScroll: true });
    } else {
      root.querySelector<HTMLElement>('[data-control="next"]')?.focus();
    }
  }, [matches]);

  const join = async (m: Match) => {
    if (pendingId || m.joined) return;
    if (!me) return goSignIn();
    let rk = keys.current.get(m.id);
    if (!rk) {
      rk = new RequestKey();
      keys.current.set(m.id, rk);
    }
    const key = rk.next({});
    setCardErrors((e) => ({ ...e, [m.id]: "" }));
    setPendingId(m.id);
    const a = await api<Match>("POST", `/api/matches/${m.id}/join`, {}, key);
    rk.settle(a.status);
    setPendingId(null);
    if (a.status === 401) return goSignIn();
    if (a.status === 200) {
      setMatches((list) => list?.map((x) => (x.id === m.id ? a.data : x)) ?? null);
      announce("You joined the match.");
      if (a.data.status === "full") {
        fullSaid.current.add(m.id);
        announce("Match is full.");
      }
      prevStatus.current.set(m.id, a.data.status);
      load();
      return;
    }
    const msg = a.error?.errors?.level ?? errorText(a);
    setCardErrors((e) => ({ ...e, [m.id]: msg }));
    setKeepJoin((k) => ({ ...k, [m.id]: refreshes.current }));
    if (a.error?.code === "MATCH_FULL" || a.error?.code === "MATCH_CLOSED") load();
  };

  const go = (p: number) => setPage(Math.max(0, Math.min(pages - 1, p)));

  if (error) return <p class="band" role="alert">{error}</p>;
  if (!matches) return <p class="loading">Loading matches…</p>;
  return (
    <div class="carousel" role="region" aria-label="Open matches" ref={region}>
      {matches.length === 0 ? (
        <Empty>No open matches for this level and day.</Empty>
      ) : (
        <div
          class="viewport"
          onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
          onTouchEnd={(e) => {
            if (touchX.current === null) return;
            const dx = e.changedTouches[0].clientX - touchX.current;
            touchX.current = null;
            if (dx < -40) go(current + 1);
            if (dx > 40) go(current - 1);
          }}
        >
          <div
            class="track"
            style={{
              transform: `translateX(-${current * 100}%)`,
              transition: reduced ? "none" : undefined,
            }}
          >
            {matches.map((m, i) => (
              <div
                class="slide"
                key={m.id}
                style={{ flexBasis: `${100 / perView}%` }}
                onFocusIn={() => {
                  const p = Math.floor(i / perView);
                  if (p !== current) setPage(p);
                }}
              >
                <MatchCard
                  m={m}
                  pending={pendingId === m.id}
                  showJoin={showJoin(m)}
                  error={cardErrors[m.id] ?? ""}
                  onJoin={() => join(m)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
      <div class="carousel-controls">
        <button
          type="button"
          class="arrow"
          data-control="prev"
          aria-label="Previous matches"
          disabled={current === 0}
          onClick={() => go(current - 1)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" stroke-width="2" />
          </svg>
        </button>
        <div class="dots-nav">
          {Array.from({ length: pages }, (_, k) => (
            <button
              type="button"
              class={"page-dot" + (k === current ? " active" : "")}
              aria-label={`Page ${k + 1}`}
              aria-current={k === current ? "true" : undefined}
              onClick={() => go(k)}
            />
          ))}
        </div>
        <button
          type="button"
          class="arrow"
          data-control="next"
          aria-label="Next matches"
          disabled={current >= pages - 1}
          onClick={() => go(current + 1)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

const matchWords: Record<string, string> = { open: "Open", full: "Full", cancelled: "Cancelled" };

function MatchCard({ m, pending, showJoin, error, onJoin }: { m: Match; pending: boolean; showJoin: boolean; error: string; onJoin: () => void }) {
  const label = `Court ${m.court}, ${clubDate(m.start)} ${clubTime(m.start)}`;
  const text = m.joined ? "Joined" : pending ? "Joining..." : "Join match";
  return (
    <article class="match-card" aria-label={label} data-match={m.id} tabIndex={-1}>
      <div class="card-top" aria-hidden="true">
        <svg viewBox="0 0 120 60">
          <rect x="10" y="6" width="100" height="48" rx="4" fill="none" stroke="#8fa9d9" stroke-width="3" />
          <path d="M60 6V54M10 30H110" stroke="#8fa9d9" stroke-width="2" />
        </svg>
      </div>
      <div class="card-body">
        <p class="card-title">
          Court {m.court} · {clubDate(m.start)} {clubTime(m.start)}
        </p>
        <p class="card-meta">
          Level {level(m.level_min)} to {level(m.level_max)} · {m.players} of 4 players
        </p>
        <p class="card-status">
          <span class={"status-word status-" + m.status}>{matchWords[m.status] ?? m.status}</span>
          <span class="card-price">{euros(m.share_cents)} per player</span>
        </p>
        <div role="meter" aria-label="Players" aria-valuemin={0} aria-valuemax={4} aria-valuenow={m.players} class="player-dots">
          {[0, 1, 2, 3].map((i) => (
            <span class={"player-dot" + (i < m.players ? " on" : "")} aria-hidden="true" />
          ))}
        </div>
        {error && (
          <p role="alert" class="band">
            {error}
          </p>
        )}
        <div class="card-action">
          {showJoin && (
            <button
              type="button"
              class="pill pill-cobalt join"
              data-control="join"
              aria-disabled={m.joined || pending ? "true" : undefined}
              onClick={onJoin}
            >
              {text}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
