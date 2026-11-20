import { useEffect, useRef, useState, type ReactElement } from "react";
import type { SearchRide } from "../../shared/api";
import { plural, euros } from "../../shared/money";
import { calendarKey, hhmm, localParts, parseDateKey, todayOf, type CalendarDay } from "../../shared/time";
import { announce } from "../lib/announce";
import { pageConfig } from "../lib/config";
import { api } from "../lib/http";
import { useMotion, isReduced } from "../lib/motion";
import { Link, replaceQuery, useLocation } from "../lib/router";
import { useSession } from "../lib/session";
import { setShutterSource } from "../lib/shutter";
import { Alert, EmptyState, PageHeading, Skeleton } from "../ui/Bits";
import { Dialog } from "../ui/Dialog";
import { Plate } from "../ui/Plate";
import { SearchForm } from "../ui/SearchForm";

type Sort = "earliest" | "price" | "shortest";

interface Query {
  from: string;
  to: string;
  date: CalendarDay;
  seats: number;
  instant: boolean;
  verified: boolean;
  sort: Sort;
}

function parseQuery(search: URLSearchParams, today: CalendarDay): Query {
  const sort = search.get("sort");
  const seats = Number(search.get("seats"));
  return {
    from: search.get("from") ?? "",
    to: search.get("to") ?? "",
    date: parseDateKey(search.get("date") ?? "") ?? today,
    seats: Number.isInteger(seats) && seats >= 1 && seats <= 4 ? seats : 1,
    instant: search.get("instant") === "1",
    verified: search.get("verified") === "1",
    sort: sort === "price" || sort === "shortest" ? sort : "earliest",
  };
}

function toParams(q: Query): URLSearchParams {
  const params = new URLSearchParams();
  if (q.from) params.set("from", q.from);
  if (q.to) params.set("to", q.to);
  params.set("date", calendarKey(q.date));
  params.set("seats", String(q.seats));
  if (q.instant) params.set("instant", "1");
  if (q.verified) params.set("verified", "1");
  if (q.sort !== "earliest") params.set("sort", q.sort);
  return params;
}

type GroupName = "Morning" | "Afternoon" | "Evening";

function groupOf(ride: SearchRide): GroupName {
  const hour = localParts(new Date(ride.boarding_time)).hour;
  return hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening";
}

const PHRASES: Record<GroupName, string> = {
  Morning: "first light on the road",
  Afternoon: "the long afternoon straight",
  Evening: "the last of the light along the coast",
};

export function SearchPage(): ReactElement {
  const { search } = useLocation();
  const session = useSession();
  const today = todayOf(session.serverNow);
  const query = parseQuery(search, today);
  const key = toParams(query).toString();
  const [draft, setDraft] = useState<Query>(query);
  const written = useRef(key);
  const [rides, setRides] = useState<SearchRide[] | null>(null);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState(false);
  const reveal = useMotion("result-reveal");
  const sequence = useRef(0);

  useEffect(() => {
    if (key !== written.current) {
      written.current = key;
      setDraft(parseQuery(new URLSearchParams(key), today));
    }
  }, [key, today]);

  useEffect(() => {
    const draftKey = toParams(draft).toString();
    if (draftKey === written.current) return undefined;
    const timer = window.setTimeout(() => {
      written.current = draftKey;
      replaceQuery(toParams(draft));
    }, pageConfig.searchDebounceMs);
    return () => window.clearTimeout(timer);
  }, [draft]);

  const { play } = reveal;
  useEffect(() => {
    if (!query.from || !query.to) {
      setRides(null);
      return;
    }
    const mine = ++sequence.current;
    const params = new URLSearchParams({ from: query.from, to: query.to, date: calendarKey(query.date), seats: String(query.seats) });
    if (query.instant) params.set("instant", "1");
    if (query.verified) params.set("verified", "1");
    params.set("sort", query.sort);
    api<{ rides: SearchRide[] }>("GET", `/api/rides/search?${params}`)
      .then((reply) => {
        if (mine !== sequence.current) return;
        setError("");
        setRides(reply.rides);
        announce(reply.rides.length === 0 ? "No rides match. Try another date." : `${plural(reply.rides.length, "ride")} found`);
        play();
      })
      .catch((e: unknown) => {
        if (mine === sequence.current) setError(e instanceof Error ? e.message : "");
      });
  }, [key, play]);

  const groups: { name: GroupName; rides: SearchRide[] }[] = [];
  for (const name of ["Morning", "Afternoon", "Evening"] as const) {
    const inGroup = (rides ?? []).filter((r) => groupOf(r) === name);
    if (inGroup.length > 0) groups.push({ name, rides: inGroup });
  }

  const open = (event: React.MouseEvent<HTMLAnchorElement>): void => {
    const figure = event.currentTarget.closest(".group")?.querySelector("figure");
    const canvas = figure?.querySelector("canvas") ?? null;
    const box = canvas?.getBoundingClientRect();
    setShutterSource(box ? { rect: { left: box.left, top: box.top, width: box.width, height: box.height }, canvas } : null);
  };

  const showCount = rides?.length ?? 0;

  return (
    <div className="search-page">
      <PageHeading>Rides</PageHeading>
      <div className="search-bar">
        <SearchForm
          values={{ from: draft.from, to: draft.to, date: draft.date, seats: draft.seats }}
          today={today}
          onChange={(v) => setDraft({ ...draft, ...v })}
        >
          <button type="button" className="filters-open" onClick={() => setFilters(true)}>
            Filters
          </button>
        </SearchForm>
      </div>
      <Alert>{error}</Alert>

      {rides === null && query.from && query.to && !error ? <Skeleton rows={3} /> : null}
      {rides && rides.length === 0 ? (
        <EmptyState sentence="No rides match. Try another date." seed={`empty-${query.from}-${query.to}`} />
      ) : null}

      <div className="groups">
        {groups.map((group, index) => {
          const wide = index % 2 === 1;
          const [first] = group.rides;
          return (
            <section key={group.name} className={`group ${wide ? "group-wide" : "group-tall"} cycle-${index % 3}`} aria-label={group.name}>
              <h2 className="group-title">{group.name}</h2>
              <Plate
                seed={`${group.name}-${query.from}-${query.to}-${first?.id ?? ""}`}
                ratio={wide ? 2.6 : 0.78}
                className="group-plate"
                caption={`${query.from} to ${query.to}, ${PHRASES[group.name]}`}
              />
              <ul
                className="ride-list"
                aria-label={`${group.name} rides`}
                data-motion="result-reveal"
                data-motion-ms={reveal.ms}
                data-state={reveal.state}
              >
                {group.rides.map((ride) => {
                  const name = `${hhmm(new Date(ride.boarding_time))} ${ride.from} to ${ride.to}, ${plural(ride.seats_left, "seat")} left, ${euros(ride.segment_price_cents)}`;
                  const target = new URLSearchParams({ from: ride.from, to: ride.to, seats: String(query.seats) });
                  return (
                    <li key={ride.id} data-id={ride.id} className={reveal.state === "running" && !isReduced() ? "is-entering" : undefined}>
                      <Link href={`/rides/${ride.id}?${target}`} aria-label={name} onClick={open}>
                        {name}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <Dialog open={filters} title="Filters" sheet onClose={() => setFilters(false)}>
        <div className="filter-list">
          <label className="check">
            <input type="checkbox" checked={draft.instant} onChange={(e) => setDraft({ ...draft, instant: e.target.checked })} />
            <span>Instant booking only</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={draft.verified} onChange={(e) => setDraft({ ...draft, verified: e.target.checked })} />
            <span>Verified drivers only</span>
          </label>
          <div role="radiogroup" aria-label="Sort by" className="radios">
            <p className="field-label">Sort by</p>
            {([["earliest", "Earliest departure"], ["price", "Lowest price"], ["shortest", "Shortest trip"]] as const).map(([value, label]) => (
              <label className="check" key={value}>
                <input type="radio" name="sort" checked={draft.sort === value} onChange={() => setDraft({ ...draft, sort: value })} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
        <button type="button" onClick={() => setFilters(false)}>
          {`Show ${plural(showCount, "ride")}`}
        </button>
      </Dialog>
    </div>
  );
}
