// The public drop calendar (brief: Public screens → `/`; Interactions → Calendar; Motion → Intro roll, card glide,
// swatch dots). Every control lives in the address: one history entry per change, Back and Forward restore it.
import { SlidersHorizontal } from "lucide-react";
import { type PointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { COPY } from "../../shared/copy";
import { copenhagenDateText, counted, marketTime } from "../../shared/format";
import { CITY, MARKETS, type Market, copenhagenWall, isoDate, isoWeek, parseDate } from "../../shared/time";
import { api } from "../api";
import { ENTRANCE, FEEDBACK, EASE, glide, rects, reducedMotion } from "../motion";
import { Link, useRouter } from "../router";
import { Button, Dialog, PageTitle, SelectField, StatusMark, type StatusWord, focusLater } from "../ui";

interface ListItem {
  slug: string;
  name: string;
  brand: string;
  type: "simultaneous" | "rolling";
  status: "upcoming" | "live" | "sold_out";
  goLiveAt: string;
  weekLabel: string;
  palette: string[];
  coverImageUrl: string | null;
}

interface Listing {
  items: ListItem[];
  page: number;
  pageSize: number;
  total: number;
  todayCopenhagen: string;
}

const KEYS = ["market", "status", "type", "week", "q", "sort", "page"] as const;
type Key = (typeof KEYS)[number];

const MARKET_OPTIONS: Array<[string, string]> = [["", "All markets"], ...MARKETS.map((m): [string, string] => [m, CITY[m]])];
const STATUS_OPTIONS: Array<[string, string]> = [["", "Any status"], ["upcoming", "Upcoming"], ["live", "Live"], ["sold_out", "Sold out"]];
const TYPE_OPTIONS: Array<[string, string]> = [["", "All types"], ["simultaneous", "Simultaneous"], ["rolling", "Rolling"]];
const SORT_OPTIONS: Array<[string, string]> = [["", "Soonest first"], ["latest", "Latest first"], ["name", "Name A–Z"]];

const SWATCH: Record<string, string> = {
  stone: "#E9E5DE", ink: "#16151A", vermilion: "#C43A1C", night: "#0E1420", moss: "#4B5320", sand: "#D8C3A0", rust: "#9A4A24", fog: "#C9CDD2",
};

const CITIES = ["Stockholm", "Paris", "London", "New York", "Tokyo", "Copenhagen"];

/** The tagline's city word rolls through the markets on the first visit of a browser session. */
function IntroRoll(): JSX.Element {
  const [animate] = useState(() => !sessionStorage.getItem("hourline:intro") && !reducedMotion());
  const [step, setStep] = useState(animate ? 0 : CITIES.length - 1);
  useEffect(() => {
    sessionStorage.setItem("hourline:intro", "seen");
    if (step >= CITIES.length - 1) return undefined;
    const timer = window.setTimeout(() => setStep((s) => s + 1), ENTRANCE);
    return () => clearTimeout(timer);
  }, [step]);
  return (
    <p className="tagline">
      <span aria-hidden="true">
        One drop.{" "}
        <span className="roll-window">
          <span key={CITIES[step]} className={animate ? "roll-word is-rolling" : "roll-word"}>
            {CITIES[step]}
          </span>
        </span>{" "}
        time. Every market.
      </span>
      <span className="sr-only">One drop. Copenhagen time. Every market.</span>
    </p>
  );
}

function Dots({ palette, at }: { palette: string[]; at: { x: number; y: number; id: number } }): JSX.Element {
  const refs = useRef<Array<HTMLSpanElement | null>>([]);
  useLayoutEffect(() => {
    refs.current.forEach((el, i) => {
      const angle = (i / 3) * Math.PI * 2 + at.id;
      el?.animate(
        [
          { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
          { transform: `translate(calc(-50% + ${Math.cos(angle) * 22}px), calc(-50% + ${Math.sin(angle) * 22}px)) scale(0)`, opacity: 0 },
        ],
        { duration: FEEDBACK, easing: EASE, fill: "forwards" },
      );
    });
  }, [at]);
  return (
    <span className="swatch-dots" aria-hidden="true">
      {palette.map((name, i) => (
        <span key={`${at.id}-${i}`} ref={(el) => (refs.current[i] = el)} className="swatch-dot" style={{ left: at.x, top: at.y, background: SWATCH[name] }} />
      ))}
    </span>
  );
}

function DropCard({ item, today, market, cardRef }: { item: ListItem; today: string; market: Market | null; cardRef: (el: HTMLLIElement | null) => void }): JSX.Element {
  const [dots, setDots] = useState<{ x: number; y: number; id: number } | null>(null);
  const opensToday = isoDate(copenhagenWall(Date.parse(item.goLiveAt))) === today;
  const onEnter = (event: PointerEvent<HTMLLIElement>): void => {
    if (event.pointerType !== "mouse" || reducedMotion()) return;
    const box = event.currentTarget.getBoundingClientRect();
    setDots({ x: event.clientX - box.left, y: event.clientY - box.top, id: Date.now() % 1000 });
  };
  return (
    <li className="drop-card" ref={cardRef} onPointerEnter={onEnter}>
      {item.coverImageUrl ? <img className="drop-card-cover" src={`${item.coverImageUrl}?w=160`} alt="" width={72} height={90} loading="lazy" /> : (
        <span className="drop-card-cover palette-tile" aria-hidden="true">
          {item.palette.map((name) => (
            <span key={name} style={{ background: SWATCH[name] }} />
          ))}
        </span>
      )}
      <div className="drop-card-body">
        <h3>
          <Link to={`/drops/${item.slug}`}>{item.name}</Link>
        </h3>
        <p className="drop-card-meta">
          {item.brand} · {item.type === "rolling" ? "Rolling" : "Simultaneous"}
        </p>
        <p className="mono drop-card-time">{marketTime(Date.parse(item.goLiveAt), market ?? "copenhagen")}</p>
        <p className="drop-card-status">
          <StatusMark status={item.status as StatusWord} />
          {opensToday ? <span className="tag tag-accent">Today</span> : null}
        </p>
      </div>
      {dots ? <Dots palette={item.palette} at={dots} /> : null}
    </li>
  );
}

export function CalendarScreen(): JSX.Element {
  const { search, navigate } = useRouter();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const value = (key: Key): string => params.get(key) ?? "";
  const [listing, setListing] = useState<Listing | null>(null);
  const [weeks, setWeeks] = useState<Array<[string, string]>>([]);
  const [query, setQuery] = useState(value("q"));
  const [sheetOpen, setSheetOpen] = useState(false);
  const filtersButton = useRef<HTMLButtonElement>(null);
  const cards = useRef(new Map<string, HTMLLIElement>());
  const before = useRef<Map<string, DOMRect>>(new Map());

  useEffect(() => setQuery(params.get("q") ?? ""), [params]);

  useEffect(() => {
    let live = true;
    const qs = new URLSearchParams();
    for (const key of KEYS) if (params.get(key)) qs.set(key, params.get(key) as string);
    before.current = rects(cards.current as Map<string, HTMLElement>);
    void api<Listing>("GET", `/api/public/drops${qs.size ? `?${qs}` : ""}`).then((r) => {
      if (live && r.ok) setListing(r.data);
    });
    return () => {
      live = false;
    };
  }, [params]);

  useLayoutEffect(() => {
    glide(cards.current as Map<string, HTMLElement>, before.current);
  }, [listing]);

  useEffect(() => {
    void (async () => {
      const found = new Map<string, string>();
      for (let page = 1; ; page += 1) {
        const r = await api<Listing>("GET", `/api/public/drops?page=${page}`);
        if (!r.ok) break;
        for (const item of r.data.items) {
          const { year, week } = isoWeek(copenhagenWall(Date.parse(item.goLiveAt)));
          found.set(`${year}-W${String(week).padStart(2, "0")}`, item.weekLabel);
        }
        if (page * r.data.pageSize >= r.data.total) break;
      }
      setWeeks([...found].sort(([a], [b]) => (a < b ? -1 : 1)));
    })();
  }, []);

  /** One history entry per change; anything but the page returns to page 1. */
  const change = (key: Key, next: string): void => {
    const qs = new URLSearchParams(params);
    if (next) qs.set(key, next);
    else qs.delete(key);
    if (key !== "page") qs.delete("page");
    const ordered = new URLSearchParams();
    for (const k of KEYS) if (qs.get(k)) ordered.set(k, qs.get(k) as string);
    navigate(ordered.size ? `/?${ordered}` : "/");
  };

  const changeRef = useRef(change);
  changeRef.current = change;
  useEffect(() => {
    if (query === (params.get("q") ?? "")) return undefined;
    const timer = window.setTimeout(() => changeRef.current("q", query.trim() ? query : ""), 333);
    return () => clearTimeout(timer);
  }, [query, params]);

  const market = (value("market") || null) as Market | null;
  const today = listing?.todayCopenhagen ?? "";
  const todayParts = parseDate(today);
  const thisWeek = todayParts ? isoWeek(todayParts) : null;
  const thisWeekLabel = thisWeek ? `Week ${thisWeek.week} · ${thisWeek.year}` : "";
  const groups: Array<[string, ListItem[]]> = [];
  for (const item of listing?.items ?? []) {
    const last = groups[groups.length - 1];
    if (last && last[0] === item.weekLabel) last[1].push(item);
    else groups.push([item.weekLabel, [item]]);
  }
  const total = listing?.total ?? 0;
  const page = listing?.page ?? 1;
  const pages = Math.max(1, Math.ceil(total / (listing?.pageSize ?? 12)));
  const pageHref = (n: number): string => {
    const qs = new URLSearchParams(params);
    if (n > 1) qs.set("page", String(n));
    else qs.delete("page");
    return qs.size ? `/?${qs}` : "/";
  };
  const weekOptions: Array<[string, string]> = [["", "All weeks"], ...weeks];
  const controls = (prefix: string): JSX.Element => (
    <>
      <SelectField id={`${prefix}-market`} label="Market" value={value("market")} onChange={(v) => change("market", v)} options={MARKET_OPTIONS} />
      <SelectField id={`${prefix}-status`} label="Status" value={value("status")} onChange={(v) => change("status", v)} options={STATUS_OPTIONS} />
      <SelectField id={`${prefix}-type`} label="Type" value={value("type")} onChange={(v) => change("type", v)} options={TYPE_OPTIONS} />
      <SelectField id={`${prefix}-week`} label="Week" value={value("week")} onChange={(v) => change("week", v)} options={weekOptions} />
      <SelectField id={`${prefix}-sort`} label="Sort" value={value("sort")} onChange={(v) => change("sort", v)} options={SORT_OPTIONS} />
    </>
  );
  const count = listing ? (total ? counted(total, "drop") : COPY.noResults) : "";

  return (
    <div className="calendar">
      <section className="intro-band">
        <p className="eyebrow">Hourline Launch Hub</p>
        <PageTitle>Drop calendar</PageTitle>
        <IntroRoll />
        <p className="today mono">{today ? `Today in Copenhagen: ${copenhagenDateText(today)}` : " "}</p>
      </section>
      <section className="panel calendar-tools" aria-label="Search and filters">
        <div className="field search-field">
          <label htmlFor="calendar-search">Search drops</label>
          <input id="calendar-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="calendar-filters">{controls("filter")}</div>
        <button type="button" ref={filtersButton} className="btn btn-secondary filters-button" onClick={() => setSheetOpen(true)}>
          <SlidersHorizontal size={16} aria-hidden="true" focusable="false" />
          Filters
        </button>
      </section>
      <div role="status" aria-live="polite" aria-label="Calendar results" className="status-line calendar-count">
        {count}
      </div>
      <ul aria-label="Drops" className={`week-groups${listing ? "" : " is-loading"}`}>
        {groups.map(([label, items]) => (
          <li key={label} className="week-group">
            <div className="week-head">
              <h2>{label}</h2>
              {label === thisWeekLabel ? <span className="tag tag-accent">This week</span> : null}
            </div>
            <ul aria-label={label} className="drop-cards">
              {items.map((item) => (
                <DropCard
                  key={item.slug}
                  item={item}
                  today={today}
                  market={market}
                  cardRef={(el) => {
                    if (el) cards.current.set(item.slug, el);
                    else cards.current.delete(item.slug);
                  }}
                />
              ))}
            </ul>
          </li>
        ))}
        {listing && !groups.length ? <li className="empty-list">{COPY.noResults}</li> : null}
      </ul>
      <nav aria-label="Pages" className="pager">
        <Link to={pageHref(Math.max(1, page - 1))} aria-disabled={page <= 1 ? "true" : undefined} onClick={(e) => page <= 1 && e.preventDefault()}>
          Previous page
        </Link>
        <span className="mono">
          Page {page} / {pages}
        </span>
        <Link to={pageHref(Math.min(pages, page + 1))} aria-disabled={page >= pages ? "true" : undefined} onClick={(e) => page >= pages && e.preventDefault()}>
          Next page
        </Link>
      </nav>
      {sheetOpen ? (
        <Dialog
          title="Filters"
          className="sheet"
          onClose={() => {
            setSheetOpen(false);
            focusLater(() => filtersButton.current);
          }}
        >
          <div className="sheet-fields">{controls("sheet")}</div>
          <div className="sheet-bar">
            <Button
              variant="primary"
              onClick={() => {
                setSheetOpen(false);
                focusLater(() => filtersButton.current);
              }}
            >
              {`Show ${counted(total, "drop")}`}
            </Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
