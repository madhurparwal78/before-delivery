import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { dayRead, newDay } from "../../shared/copy";
import type { Catalogue, PackFacts, SearchResult } from "../../shared/types";
import { useEvery, useReducedMotion } from "../lib/hooks";
import { useSignedLinks } from "../lib/links";
import { get } from "../lib/net";
import { saveScroll } from "../lib/router";
import { StageController, type Still } from "../stage/controller";
import { Credits } from "./Credits";
import { Hero } from "./Hero";
import { Lineup } from "./Lineup";
import { Marquee, marqueeEntries, placeBar } from "./Marquee";
import { Mirror } from "./Mirror";
import { linkKey, linkPath, PriceNotices, type NoticeSummary } from "./Notices";
import { PackReader, requestFromAddress, type Source } from "./pack";
import { PackSearch } from "./Search";
import { ReelsNav } from "./ReelsNav";
import { Reader } from "./Reader";
import { Stage, Stills, TurnSlider } from "./Stage";

const DAY_CHECK_MS = 30_000;
const LAYER_GAP = 12;

function keepClearOfLayers(el: HTMLElement): void {
  if (document.activeElement !== el) return;
  for (let tries = 0; tries < 4; tries++) {
    placeBar();
    const box = el.getBoundingClientRect();
    let move = box.bottom > innerHeight ? box.bottom - innerHeight + LAYER_GAP : box.top < 0 ? box.top - LAYER_GAP : 0;
    for (const layer of document.querySelectorAll<HTMLElement>(".marquee-bar:not(.marquee-static), .slip, .reels, .reels-button")) {
      const r = layer.getBoundingClientRect();
      if (r.width === 0 || box.bottom <= r.top || box.top >= r.bottom || box.right <= r.left || box.left >= r.right) continue;
      move = r.top <= 0 ? box.top - r.bottom - LAYER_GAP : box.bottom - r.top + LAYER_GAP;
      break;
    }
    if (move === 0) return;
    window.scrollBy({ top: move, behavior: "instant" });
  }
}

export function Home() {
  const reduced = useReducedMotion();
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [notices, setNotices] = useState<NoticeSummary[]>([]);
  const [facts, setFacts] = useState<PackFacts | null>(null);
  const [readerStatus, setReaderStatus] = useState("");
  const [still, setStill] = useState<Still>("front");
  const [wait, setWait] = useState<{ until: number; message: string } | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [drawnToday, setDrawnToday] = useState<string | null>(null);
  const [slip, setSlip] = useState<string | null>(null);
  const [dayStatus, setDayStatus] = useState("");
  const [dayPending, setDayPending] = useState(false);

  const heroRef = useRef<HTMLElement>(null);
  const archRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mirrorRef = useRef<HTMLElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const dayStatusRef = useRef<HTMLDivElement>(null);
  const controller = useRef<StageController | null>(null);
  const factsRef = useRef<PackFacts | null>(null);
  const waitRef = useRef(wait);
  waitRef.current = wait;
  const epoch = useRef(0);
  const dayBusy = useRef(false);
  const slipRef = useRef<string | null>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const drawnRef = useRef<string | null>(null);
  drawnRef.current = drawnToday;

  // ---- the reader ---------------------------------------------------------------------------------------------------
  const reader = useRef<PackReader | null>(null);
  if (!reader.current) {
    reader.current = new PackReader({
      apply: (next) => {
        const first = factsRef.current === null;
        factsRef.current = next;
        setFacts(next);
        controller.current?.setFacts(next, !first && !matchMedia("(prefers-reduced-motion: reduce)").matches);
      },
      status: (_source: Source, message: string) => setReaderStatus(message),
      limited: (retryAfter, message) => {
        setWait({ until: performance.now() + retryAfter * 1000, message });
        setReaderStatus(message);
      },
      isLimited: () => !!waitRef.current && waitRef.current.until > performance.now(),
      waitMessage: () => waitRef.current?.message ?? null,
    });
  }
  const choose = reader.current;

  // ---- data ---------------------------------------------------------------------------------------------------------
  const loadShelf = useCallback(async () => {
    const [cat, list] = await Promise.all([get<Catalogue>("/api/catalogue"), get<{ notices: NoticeSummary[] }>("/api/notices")]);
    return { cat, list: list.notices };
  }, []);

  useEffect(() => {
    history.scrollRestoration = "manual";
    let cancelled = false;
    void loadShelf().then(({ cat, list }) => {
      if (cancelled) return;
      setCatalogue(cat);
      setNotices(list);
      setDrawnToday(cat.today);
    });
    void choose.choose(requestFromAddress(location.search), "load", "none");
    const onPop = () => {
      if (location.pathname !== "/") return;
      void choose.choose(requestFromAddress(location.search), "history", "none");
    };
    addEventListener("popstate", onPop);
    return () => {
      cancelled = true;
      choose.cancel();
      removeEventListener("popstate", onPop);
    };
  }, []);

  // ---- scroll memory ------------------------------------------------------------------------------------------------
  useLayoutEffect(() => {
    const saved = (history.state as { scrollY?: number } | null)?.scrollY;
    if (typeof saved === "number" && saved > 0) {
      window.scrollTo(0, saved);
      let tries = 0;
      const again = () => {
        if (Math.abs(scrollY - saved) > 2 && tries++ < 20) {
          window.scrollTo(0, saved);
          setTimeout(again, 100);
        }
      };
      setTimeout(again, 100);
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(saveScroll, 120);
    };
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("pagehide", saveScroll);
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("pagehide", saveScroll);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // ---- the stage ----------------------------------------------------------------------------------------------------
  useEffect(() => {
    const c = new StageController(
      { stage: stageRef.current!, canvas: canvasRef.current!, hero: heroRef.current!, arch: archRef.current!, section: sectionRef.current!, mirror: mirrorRef.current! },
      true,
    );
    controller.current = c;
    if (factsRef.current) c.setFacts(factsRef.current, false);
    c.setMotion(matchMedia("(prefers-reduced-motion: reduce)").matches, "front");
    c.start();
    const onResize = () => {
      document.documentElement.style.setProperty("--vh", `${innerHeight}px`);
      c.resize();
    };
    addEventListener("resize", onResize);
    return () => {
      removeEventListener("resize", onResize);
      c.stop();
      controller.current = null;
    };
  }, []);

  useEffect(() => {
    controller.current?.setMotion(reduced, still);
  }, [reduced, still]);

  useLayoutEffect(placeBar, [slip]);

  // ---- a control taking focus ends wholly on screen, clear of the fixed layers ---------------------------------------
  useEffect(() => {
    const clear = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest(".marquee-bar, .reels, .reels-button, .slip, .day-status")) return;
      requestAnimationFrame(() => keepClearOfLayers(el));
    };
    document.addEventListener("focusin", clear);
    return () => document.removeEventListener("focusin", clear);
  }, []);

  const moveProgress = useCallback((value: number) => {
    const section = sectionRef.current;
    if (!section) return;
    const top = section.getBoundingClientRect().top + scrollY;
    controller.current?.snapProgress();
    window.scrollTo(0, Math.round(top + value * 4 * innerHeight));
  }, []);
  const readProgress = useCallback(() => controller.current?.progress() ?? 0, []);

  // ---- the wait timer -----------------------------------------------------------------------------------------------
  useEvery(wait ? 200 : null, () => {
    const w = waitRef.current;
    if (!w) return;
    const left = Math.ceil((w.until - performance.now()) / 1000);
    if (left > 0) {
      setRemaining(left);
      return;
    }
    setRemaining(0);
    setWait(null);
    setReaderStatus((s) => (s === w.message ? "" : s));
  });
  useEffect(() => {
    if (wait) setRemaining(Math.max(1, Math.ceil((wait.until - performance.now()) / 1000)));
    else setRemaining(0);
  }, [wait]);

  // ---- the new day slip ---------------------------------------------------------------------------------------------
  useEvery(DAY_CHECK_MS, () => {
    if (dayBusy.current || !drawnRef.current) return;
    const mine = epoch.current;
    void get<Catalogue>("/api/catalogue")
      .then((cat) => {
        if (mine !== epoch.current || dayBusy.current) return;
        if (cat.today !== drawnRef.current) {
          if (slipRef.current !== cat.today) {
            slipRef.current = cat.today;
            setSlip(cat.today);
            setDayStatus(newDay(cat.today));
          }
        } else if (slipRef.current !== null) {
          slipRef.current = null;
          setSlip(null);
          setDayStatus("");
        }
      })
      .catch(() => undefined);
  });

  const readToday = async () => {
    if (dayBusy.current) return;
    dayBusy.current = true;
    epoch.current++;
    setDayPending(true);
    try {
      const shelf = loadShelf();
      const pack = choose.choose(requestFromAddress(location.search), "day", "none");
      const [{ cat, list }, outcome] = await Promise.all([shelf, pack]);
      if (outcome === "limited" || outcome === "failed") return;
      setCatalogue(cat);
      setNotices(list);
      setDrawnToday(cat.today);
      slipRef.current = null;
      setSlip(null);
      setDayStatus(dayRead(cat.today));
      if (outcome === "applied") requestAnimationFrame(() => dayStatusRef.current?.focus({ preventScroll: true }));
    } catch {
      /* the slip stays; the button works again */
    } finally {
      dayBusy.current = false;
      setDayPending(false);
    }
  };

  // ---- links --------------------------------------------------------------------------------------------------------
  const targets = notices.filter((n) => n.currentVersion.printState === "printable").map((n) => ({ key: linkKey(n.number, n.currentVersion.version), path: linkPath(n.number, n.currentVersion.version) }));
  const links = useSignedLinks(targets);

  // ---- choices ------------------------------------------------------------------------------------------------------
  const pickSku = (code: string, source: Source) => void choose.choose({ kind: "sku", code }, source, "push");
  const onDrink = (drinkId: string) => {
    const first = catalogue?.drinks.find((d) => d.id === drinkId)?.skus[0];
    if (first) pickSku(first.code, "lineup");
  };
  const onSearchChoice = (r: SearchResult) => {
    if (r.kind === "batch" && r.batchCode) void choose.choose({ kind: "batch", code: r.batchCode }, "search", "push");
    else pickSku(r.skuCode, "search");
  };
  const limited = (retryAfter: number, message: string) => setWait({ until: performance.now() + retryAfter * 1000, message });
  const readYourPack = () => {
    fieldRef.current?.focus();
  };

  const entries = marqueeEntries(catalogue, notices);

  return (
    <>
      <ReelsNav />
      <main>
        <Hero heroRef={heroRef} archRef={archRef} onRead={readYourPack} />
        <section id="the-pack" class={`reel pack-reel${reduced ? " still" : ""}`} aria-label="The Pack" ref={sectionRef}>
          <div class="pack-scroll">
            <div class="pin">
              <div class="pin-stage">
                <Stage stageRef={stageRef} canvasRef={canvasRef} facts={facts} />
                {reduced ? <Stills still={still} onStill={setStill} /> : <TurnSlider read={readProgress} onMove={moveProgress} />}
              </div>
              <Mirror mirrorRef={mirrorRef} facts={facts} />
            </div>
          </div>
          <div class="pack-forms">
            <PackSearch onChoose={onSearchChoice} onLimited={limited} waitMessage={wait?.message ?? null} boxRef={searchBox} />
            <Reader fieldRef={fieldRef} status={readerStatus} remaining={remaining} onRead={(code) => {
              fieldRef.current?.focus({ preventScroll: true });
              void choose.choose({ kind: "batch", code }, "reader", "push");
            }} />
          </div>
        </section>
        <Lineup catalogue={catalogue} sku={facts?.skuCode ?? ""} onDrink={onDrink} onSku={(code) => pickSku(code, "lineup")} />
        <PriceNotices catalogue={catalogue} notices={notices} links={links} />
        <Credits counts={catalogue?.counts ?? null} />
      </main>
      <Marquee entries={entries} reduced={reduced} />
      {slip && (
        <div class="slip" role="region" aria-label="New day">
          <p>{newDay(slip)}</p>
          <button type="button" class="rect-button inverse" aria-disabled={dayPending ? "true" : undefined} onClick={() => void readToday()}>
            Read today's prices
          </button>
        </div>
      )}
      <div class="day-status" role="status" aria-label="Day status" tabIndex={-1} ref={dayStatusRef}>
        {dayStatus}
      </div>
    </>
  );
}
