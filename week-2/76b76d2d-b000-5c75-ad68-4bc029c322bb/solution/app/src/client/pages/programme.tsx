import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { SeasonDetail, SeasonSummary } from "../../shared/api.ts";
import type { Locale } from "../../shared/domain.ts";
import { api } from "../api.ts";
import { reducedMotion, useApp } from "../context.tsx";
import { localDate, localTime, STRINGS, type Strings } from "../i18n.ts";
import { deepLinkY, groundColour, irisFrame, openFrame, SEGMENT_PX, viewportDiagonal, type IrisFrame } from "../stage/iris.ts";
import { IrisRenderer, type RendererState } from "../stage/renderer.ts";
import { Num, withNum } from "../ui.tsx";

function seasonTitle(season: SeasonSummary, locale: Locale): string {
  return locale === "fr" ? season.title_fr : season.title_en;
}

function SeatsLeft({ n, t }: { n: number; t: Strings }) {
  return n === 0 ? <span class="seats-left">{t.soldOut}</span> : <span class="seats-left"><Num>{n}</Num> {t.left}</span>;
}

function Rail({ season, detail, locale, t, active, onRailFocus }: {
  season: SeasonSummary; detail: SeasonDetail | undefined; locale: Locale; t: Strings; active: boolean; onRailFocus: () => void;
}) {
  const title = seasonTitle(season, locale);
  return (
    <ul class={season.state === "on-sale" ? "rail is-on-sale" : "rail"} aria-label={t.schedule(title)}>
      {/* Placeholder rows hold the rail's height until the screenings load, so the season title above never jumps. */}
      {detail === undefined ? Array.from({ length: season.screening_count }, (_, i) => (
        <li key={i} class="rail-row is-placeholder" aria-hidden="true">
          <span class="rail-film">{" "}</span><span class="rail-date">{" "}</span><span class="rail-time">{" "}</span>
          <span class="rail-code">{" "}</span><span class="rail-seats">{" "}</span>
        </li>
      )) : detail.screenings.map((s) => {
        const date = localDate(s.starts_at);
        const time = localTime(s.starts_at);
        return (
          <li key={s.id} class="rail-row">
            {/* Seats left sits beside the link and the cells are space-separated, so the link's visible text reads as its published name. */}
            <a class="rail-link" href={`/${locale}/screenings/${encodeURIComponent(s.id)}`} tabIndex={active ? 0 : -1}
              aria-label={`${s.film_title} — ${date} ${time} — ${s.auditorium}`} aria-describedby={`seats-${s.id}`} onFocus={onRailFocus}>
              <span class="rail-film">{s.film_title}</span>{" "}
              <span class="rail-date"><Num>{date}</Num></span>{" "}
              <span class="rail-time"><Num>{time}</Num></span>{" "}
              <span class="rail-code"><Num>{s.auditorium}</Num></span>
            </a>
            <span class="rail-seats" id={`seats-${s.id}`} aria-hidden="true"><SeatsLeft n={s.seats_remaining} t={t} /></span>
          </li>
        );
      })}
    </ul>
  );
}

export function ProgrammePage() {
  const { locale, t } = useApp();
  const [seasons, setSeasons] = useState<SeasonSummary[] | null>(null);
  const [details, setDetails] = useState<Record<string, SeasonDetail>>({});
  const [active, setActive] = useState(0);
  const [focusedTab, setFocusedTab] = useState(0);
  const [renderer, setRenderer] = useState<RendererState | null>(null);
  const reduced = useRef(reducedMotion()).current;
  const stageRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const fstopRef = useRef<HTMLSpanElement>(null);
  const announcerRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<(HTMLDivElement | null)[]>([]);
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const irisRef = useRef<IrisRenderer | null>(null);
  const activeRef = useRef(-1);
  const selectedRef = useRef(0);
  const frameStateRef = useRef<IrisFrame | null>(null);
  const seasonsRef = useRef<SeasonSummary[]>([]);
  const localeRef = useRef(locale);
  localeRef.current = locale;

  /** Activation (brief: Activation): URL, root attribute, tab state and one polite announcement. */
  const activate = (index: number, announce: boolean) => {
    const season = seasonsRef.current[index];
    if (!season || activeRef.current === index) return;
    activeRef.current = index;
    const url = new URL(location.href);
    url.searchParams.set("season", season.slug);
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    document.documentElement.dataset["activeSeason"] = season.slug;
    if (announce && announcerRef.current) {
      const current = localeRef.current;
      announcerRef.current.textContent = STRINGS[current].announce(seasonTitle(season, current), season.screening_count);
    }
    const tab = tabsRef.current[index];
    const list = tab?.parentElement;
    if (tab && list) {
      // A tab not wholly clear of the strip's faded end (its scroll padding) is brought to the start, where the tabs snap.
      const edge = parseFloat(getComputedStyle(list).scrollPaddingRight) || 0;
      if (tab.offsetLeft < list.scrollLeft || tab.offsetLeft + tab.offsetWidth > list.scrollLeft + list.clientWidth - edge) list.scrollLeft = tab.offsetLeft;
    }
    setActive(index);
    setFocusedTab(index);
  };

  /** Applies a frame to the published attributes, the iris, the layers and the readout, synchronously. */
  const apply = (frame: IrisFrame) => {
    frameStateRef.current = frame;
    const stage = stageRef.current;
    if (!stage) return;
    stage.setAttribute("data-segment", String(frame.segment));
    stage.setAttribute("data-iris-open", frame.open.toFixed(3));
    stage.setAttribute("data-iris-rotation", frame.rotation.toFixed(1));
    stage.setAttribute("data-iris-radius", String(Math.round(frame.radius)));
    stage.setAttribute("data-fstop", frame.fstop);
    stage.setAttribute("data-rail-visible", frame.rail.toFixed(3));
    stage.setAttribute("data-tint-mix", frame.tint.toFixed(3));
    if (fstopRef.current) fstopRef.current.textContent = `f/${frame.fstop}`;
    const ground = groundColour(frame.segment, frame.tint);
    if (frameRef.current) frameRef.current.style.backgroundColor = ground;
    document.documentElement.style.backgroundColor = ground;
    layersRef.current.forEach((layer, i) => {
      if (!layer) return;
      const current = i === frame.segment;
      layer.toggleAttribute("data-shown", current || i === frame.active);
      layer.style.setProperty("--title-opacity", current ? "1" : "0");
      layer.style.setProperty("--rail-opacity", current ? String(frame.rail) : "0");
      layer.toggleAttribute("data-rail-live", current && frame.rail > 0);
    });
    irisRef.current?.draw(frame);
  };

  const onScroll = () => {
    const count = seasonsRef.current.length;
    if (!count) return;
    const frame = reduced ? openFrame(selectedRef.current, viewportDiagonal()) : irisFrame(window.scrollY, count, viewportDiagonal());
    apply(frame);
    activate(frame.active, true);
  };

  const sizeStage = () => {
    const stage = stageRef.current;
    if (stage && !reduced) stage.style.height = `${SEGMENT_PX * seasonsRef.current.length + window.innerHeight}px`;
  };

  useLayoutEffect(() => {
    history.scrollRestoration = "manual";
    if (canvasRef.current && svgRef.current) {
      irisRef.current = new IrisRenderer(canvasRef.current, svgRef.current, (state) => {
        setRenderer(state);
        stageRef.current?.setAttribute("data-renderer", state.renderer);
        stageRef.current?.setAttribute("data-context", state.context);
      });
      const state = irisRef.current.state;
      setRenderer(state);
      stageRef.current?.setAttribute("data-renderer", state.renderer);
      stageRef.current?.setAttribute("data-context", state.context);
    }
    const onResize = () => {
      sizeStage();
      onScroll();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    void api<{ seasons: SeasonSummary[] }>("GET", "/api/seasons").then((r) => {
      if (!r.ok) return;
      const list = r.data.seasons;
      seasonsRef.current = list;
      setSeasons(list);
      for (const season of list) loadDetail(season.slug);
    });
    const refresh = setInterval(() => {
      const season = seasonsRef.current[activeRef.current];
      if (season) loadDetail(season.slug);
    }, 15000);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      clearInterval(refresh);
      document.documentElement.style.removeProperty("background-color");
    };
  }, []);

  /** First load: a deep link lands on its published position; URL and attribute take the initial active season, without an announcement. */
  useLayoutEffect(() => {
    const count = seasons?.length ?? 0;
    if (!seasons || !count) return;
    const index = seasons.findIndex((s) => s.slug === new URLSearchParams(location.search).get("season"));
    sizeStage();
    if (reduced) selectedRef.current = Math.max(0, index);
    else window.scrollTo({ top: index >= 0 ? deepLinkY(index) : 0, behavior: "instant" });
    const frame = reduced ? openFrame(selectedRef.current, viewportDiagonal()) : irisFrame(window.scrollY, count, viewportDiagonal());
    apply(frame);
    activate(frame.active, false);
  }, [seasons]);

  const loadDetail = (slug: string) => {
    void api<{ season: SeasonDetail }>("GET", `/api/seasons/${encodeURIComponent(slug)}`).then((r) => {
      if (r.ok) setDetails((d) => ({ ...d, [slug]: r.data.season }));
    });
  };

  /** Tab activation behaves like a deep link (brief: Deep link and tab activation). */
  const choose = (index: number) => {
    if (reduced) {
      selectedRef.current = index;
      onScroll();
      return;
    }
    window.scrollTo({ top: deepLinkY(index), behavior: "instant" });
    onScroll();
  };

  const onTabKey = (event: KeyboardEvent, index: number) => {
    const count = seasons?.length ?? 0;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % count;
    else if (event.key === "ArrowLeft") next = (index - 1 + count) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(index);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    setFocusedTab(next);
    tabsRef.current[next]?.focus();
  };

  const onRailFocus = (index: number) => {
    const frame = frameStateRef.current;
    if (reduced || !frame) return;
    if (frame.segment !== index || frame.rail < 1) choose(index);
  };

  return (
    <section ref={stageRef} class={reduced ? "stage is-still" : "stage"} aria-label={t.stage} data-renderer={renderer?.renderer} data-context={renderer?.context}>
      <div ref={frameRef} class="stage-frame">
        <div class="iris-layer" aria-hidden="true">
          <canvas ref={canvasRef} class="iris-canvas" />
          <svg ref={svgRef} class="iris-svg" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" />
        </div>
        <div class="stage-chrome">
          <h1 tabIndex={-1} class="stage-heading">{t.programmeHeading}</h1>
          <div role="tablist" aria-label={t.seasons} class="season-tabs">
            {(seasons ?? []).map((season, i) => (
              <button key={season.slug} ref={(el) => { tabsRef.current[i] = el; }} type="button" role="tab" class="season-tab"
                aria-selected={i === active ? "true" : "false"} aria-current={i === active ? "true" : undefined}
                tabIndex={i === focusedTab ? 0 : -1} onKeyDown={(e) => onTabKey(e, i)} onClick={() => choose(i)}
                onFocus={() => setFocusedTab(i)}>
                {seasonTitle(season, locale)}
              </button>
            ))}
          </div>
          <span ref={fstopRef} class="fstop num">f/22</span>
        </div>
        {(seasons ?? []).map((season, i) => {
          const title = seasonTitle(season, locale);
          const showSale = season.state === "scheduled" || season.state === "member-priority";
          return (
            <div key={season.slug} ref={(el) => { layersRef.current[i] = el; }} class="season-layer">
              <div class="season-copy">
                <h2 class="season-title">{title}</h2>
                <p class="season-dates">
                  <Num>{season.first_date ?? ""}</Num>{season.last_date && season.last_date !== season.first_date ? <> – <Num>{season.last_date}</Num></> : null}
                </p>
                {showSale ? (
                  <p class="sale-times">{withNum(t.saleTimes(localDate(season.priority_opens_at), localDate(season.public_opens_at)),
                    [localDate(season.priority_opens_at), localDate(season.public_opens_at), "10:00", "10 h"])}</p>
                ) : null}
              </div>
              <div class="rail-wrap">
                <Rail season={season} detail={details[season.slug]} locale={locale} t={t} active={i === active} onRailFocus={() => onRailFocus(i)} />
              </div>
            </div>
          );
        })}
        {seasons && seasons.length === 0 ? <p class="stage-empty">{t.noSeasons}</p> : null}
      </div>
      <div ref={announcerRef} role="status" aria-live="polite" aria-label={t.announcer} class="visually-hidden" />
    </section>
  );
}
