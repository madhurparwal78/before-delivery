import { useEffect, useState } from "preact/hooks";
import { COPY } from "../../shared/copy";
import { formatDay, formatFigure } from "../../shared/format";
import { formatMoney } from "../../shared/money";
import { api, sharedCopy } from "../lib/api";
import { useLoad, useWide } from "../lib/hooks";
import { navigate, useLocation } from "../lib/nav";
import { bad, Button, Field, Link, NoteLine, SelectField, useAction } from "../ui/Controls";
import { Dialog, useDialog } from "../ui/Dialog";
import { GonePage, NotFoundPage } from "../ui/Shell";
import { Hairline, StripFrame, useStrip } from "../ui/Strip";
import { HullDrawing, Loader, SunBadge } from "../ui/Visuals";
import { BASE_LABEL, centimetres, SEASON_LABEL, WEEK_STATUS } from "./common";

export function SignIn({ returnTo }: { returnTo: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const action = useAction();
  const submit = (event: Event) => {
    event.preventDefault();
    void action.run("Signing in", async () => {
      const result = await api<{ homePath: string }>("POST", "/api/session", { email, password });
      if (result.ok) {
        navigate(returnTo && /^\/w\/[^/]/.test(returnTo) ? returnTo : result.data.homePath);
        return null;
      }
      return bad(result.status === 401 ? COPY.signInRefused : sharedCopy(result));
    });
  };
  return (
    <section class="signin">
      <h1 class="rise">Sign in to Tidewright</h1>
      <p class="lede">Holds, passages, rotas and berths for your solar-electric fleet.</p>
      <form class="card form" onSubmit={submit} noValidate>
        <Field id="signin-email" label="Email" type="email" autoComplete="username" value={email} onInput={setEmail} />
        <Field id="signin-password" label="Password" type="password" autoComplete="current-password" value={password} onInput={setPassword} />
        <Button type="submit" pending={action.pending} pendingLabel="Signing in">
          Sign in
        </Button>
        <NoteLine note={action.note} />
      </form>
    </section>
  );
}

interface PublicYacht {
  slug: string;
  name: string;
  base: "split" | "lavrio";
  cabins: number;
  lengthM: number;
  beamM: number;
  draftM: number;
  rates: { lowMinor: number; shoulderMinor: number; highMinor: number };
  currency: string;
}

interface PublicWeek {
  weekStart: string;
  weekEnd: string;
  status: "free" | "held" | "booked";
  season: "low" | "shoulder" | "high";
  weeklyRateMinor: number;
  currency: string;
}

const FILTERS = ["base", "cabins", "season", "week"] as const;

export function PublicFleet({ workspace }: { workspace: string }) {
  const here = useLocation();
  const wide = useWide();
  const filters = useDialog();
  const params = new URLSearchParams();
  for (const key of [...FILTERS, "q"]) {
    const value = here.search.get(key);
    if (value) params.set(key, value);
  }
  const query = params.toString();
  const fleet = useLoad<{ workspace: { name: string }; yachts: PublicYacht[] }>(`/api/public/fleets/${workspace}${query ? `?${query}` : ""}`);
  const all = useLoad<{ yachts: PublicYacht[] }>(`/api/public/fleets/${workspace}`);
  const first = all.data?.yachts[0]?.slug;
  const weeks = useLoad<{ weeks: PublicWeek[] }>(first ? `/api/public/fleets/${workspace}/yachts/${first}` : null);
  const [name, setName] = useState<string | null>(null);
  const yachts = fleet.data?.yachts ?? [];
  const strip = useStrip(yachts.length, wide, ".fleet-card");

  useEffect(() => {
    if (fleet.data) setName(fleet.data.workspace.name);
  }, [fleet.data]);
  useEffect(() => strip.setIndex(0), [query]);

  if (fleet.result && !fleet.result.ok && fleet.result.status === 404) return <NotFoundPage />;

  const value = (key: string) => here.search.get(key) ?? "";
  const setFilter = (key: string, next: string) => {
    const nextParams = new URLSearchParams(location.search);
    if (next) nextParams.set(key, next);
    else nextParams.delete(key);
    const text = nextParams.toString();
    navigate(`/fleet/${workspace}${text ? `?${text}` : ""}`);
  };
  const clearFilters = () => {
    const nextParams = new URLSearchParams(location.search);
    for (const key of FILTERS) nextParams.delete(key);
    const text = nextParams.toString();
    navigate(`/fleet/${workspace}${text ? `?${text}` : ""}`);
  };
  const season = value("season") as "" | "low" | "shoulder" | "high";
  const rateText = (y: PublicYacht) =>
    season ? `${formatMoney(y.currency, y.rates[`${season}Minor`])} a week` : `From ${formatMoney(y.currency, y.rates.lowMinor)} a week`;

  return (
    <section class="fleet">
      <div class="page-head page-head--fleet">
        <SunBadge />
        <div>
          {name ? <h1 class="rise">{name} fleet</h1> : null}
          <p class="lede">Crewed solar-electric catamarans, week by week from Split and Lavrio.</p>
        </div>
      </div>
      <div class="toolbar">
        <div class="field field--search">
          <label for="fleet-search">Search yachts</label>
          <input
            id="fleet-search"
            type="search"
            value={value("q")}
            autoComplete="off"
            onInput={(event) => {
              const nextParams = new URLSearchParams(location.search);
              const text = (event.currentTarget as HTMLInputElement).value;
              if (text) nextParams.set("q", text);
              else nextParams.delete("q");
              const qs = nextParams.toString();
              navigate(`/fleet/${workspace}${qs ? `?${qs}` : ""}`, { replace: true });
            }}
          />
        </div>
        <Button variant="quiet" onClick={filters.show} aria-haspopup="dialog">
          Filters
        </Button>
      </div>
      <Dialog
        handle={filters}
        title="Filters"
        variant="sheet"
        footer={
          <>
            <Button onClick={filters.hide}>Show yachts</Button>
            <Button variant="quiet" onClick={clearFilters}>
              Clear filters
            </Button>
          </>
        }
      >
        <SelectField
          id="filter-base"
          label="Base"
          value={value("base")}
          onChange={(v) => setFilter("base", v)}
          options={[{ value: "", label: "Any base" }, { value: "split", label: "Split" }, { value: "lavrio", label: "Lavrio" }]}
        />
        <SelectField
          id="filter-cabins"
          label="Cabins"
          value={value("cabins")}
          onChange={(v) => setFilter("cabins", v)}
          options={[
            { value: "", label: "Any cabins" },
            { value: "3", label: "3 or more" },
            { value: "4", label: "4 or more" },
            { value: "5", label: "5 or more" },
            { value: "6", label: "6" },
          ]}
        />
        <SelectField
          id="filter-season"
          label="Season"
          value={value("season")}
          onChange={(v) => setFilter("season", v)}
          options={[
            { value: "", label: "Any season" },
            { value: "low", label: "Low season" },
            { value: "shoulder", label: "Shoulder season" },
            { value: "high", label: "High season" },
          ]}
        />
        <SelectField
          id="filter-week"
          label="Week"
          value={value("week")}
          onChange={(v) => setFilter("week", v)}
          options={[{ value: "", label: "Any week" }, ...(weeks.data?.weeks ?? []).map((w) => ({ value: w.weekStart, label: `Week of ${formatDay(w.weekStart)}` }))]}
        />
      </Dialog>
      <Loader active={fleet.loading && !fleet.data} />
      <StripFrame strip={strip} wide={wide}>
        <ul class="cards" aria-label="Yachts">
          {yachts.map((y, i) => (
            <li key={y.slug} class={`card fleet-card${wide && i === strip.index ? " is-current" : ""}`}>
              <HullDrawing name={y.name} lengthM={y.lengthM} beamM={y.beamM} />
              <h2 class="fleet-card__name">
                <Link href={`/fleet/${workspace}/${y.slug}`} class="card-link">
                  {y.name}
                </Link>
              </h2>
              <dl class="facts">
                <div><dt>Base</dt><dd>{BASE_LABEL[y.base]}</dd></div>
                <div><dt>Cabins</dt><dd class="fig">{y.cabins}</dd></div>
                <div><dt>Length</dt><dd class="fig">{formatFigure(centimetres(y.lengthM))}</dd></div>
              </dl>
              <p class="fleet-card__rate fig">{rateText(y)}</p>
            </li>
          ))}
        </ul>
      </StripFrame>
      {fleet.data && !yachts.length ? <p class="empty">No yachts match.</p> : null}
      {wide ? <Hairline label="Fleet position" index={strip.index} count={yachts.length} /> : null}
    </section>
  );
}

export function PublicYacht({ workspace, slug }: { workspace: string; slug: string }) {
  const wide = useWide();
  const yacht = useLoad<PublicYacht & { weeks: PublicWeek[] }>(`/api/public/fleets/${workspace}/yachts/${slug}`);
  if (yacht.result && !yacht.result.ok) return yacht.result.status === 410 ? <GonePage workspace={workspace} /> : <NotFoundPage />;
  const y = yacht.data;
  return (
    <section class="yacht">
      <Loader active={!y} />
      {y ? (
        <>
          <p class="crumbs">
            <Link href={`/fleet/${workspace}`}>Back to the fleet</Link>
          </p>
          <div class="yacht-hero">
            <div>
              <h1 class="rise">{y.name}</h1>
              <p class="lede">
                {BASE_LABEL[y.base]} base · <span class="fig">{y.cabins}</span> cabins
              </p>
              <dl class="facts facts--wide">
                <div><dt>Length</dt><dd class="fig">{formatFigure(centimetres(y.lengthM))}</dd></div>
                <div><dt>Beam</dt><dd class="fig">{formatFigure(centimetres(y.beamM))}</dd></div>
                <div><dt>Draft</dt><dd class="fig">{formatFigure(centimetres(y.draftM))}</dd></div>
              </dl>
              <h2>Season rates</h2>
              <dl class="facts facts--wide">
                {(["low", "shoulder", "high"] as const).map((s) => (
                  <div key={s}><dt>{SEASON_LABEL[s]}</dt><dd class="fig">{formatMoney(y.currency, y.rates[`${s}Minor`])}</dd></div>
                ))}
              </dl>
            </div>
            <HullDrawing name={y.name} lengthM={y.lengthM} beamM={y.beamM} size="hero" />
          </div>
          <h2>Availability</h2>
          <div class={wide ? "week-strip" : "week-stack"} tabIndex={wide ? 0 : undefined} role={wide ? "region" : undefined} aria-label={wide ? "Weeks, scroll sideways" : undefined}>
            <ul class="weeks" aria-label="Weeks">
              {y.weeks.map((w) => (
                <li key={w.weekStart} class={`week week--${w.status}`}>
                  <span class="week__date">Week of {formatDay(w.weekStart)}</span>
                  <span class={`pill pill--${w.status}`}>{WEEK_STATUS[w.status]}</span>
                  <span class="week__rate fig">{formatMoney(w.currency, w.weeklyRateMinor)}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </section>
  );
}
