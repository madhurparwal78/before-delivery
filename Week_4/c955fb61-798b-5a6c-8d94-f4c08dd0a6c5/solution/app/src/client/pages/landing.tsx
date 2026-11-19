import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AppConfig } from "../../shared/types";
import { DAY_PX, ROW_PX } from "../chart";
import { ease } from "../knock-on";
import { navigate } from "../router";

const ORDER_DAYS = 3;
const LAY_DAYS = 2;

export function Landing({ config }: { config: AppConfig }) {
  const demo = useRef<HTMLElement>(null);
  const lay = useRef<HTMLDivElement>(null);
  const connector = useRef<SVGPathElement>(null);
  const [played, setPlayed] = useState(false);
  const frame = useRef(0);

  useEffect(() => {
    const target = demo.current;
    if (!target) return;
    const watcher = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setPlayed(true);
          watcher.disconnect();
        }
      },
      { threshold: 0.6 },
    );
    watcher.observe(target);
    return () => watcher.disconnect();
  }, []);

  const orderColumn = played ? 1 : 0;
  const layColumn = orderColumn + ORDER_DAYS;

  const draw = (layShift: number) => {
    const startX = (orderColumn + ORDER_DAYS) * DAY_PX;
    const endX = layColumn * DAY_PX + layShift;
    const startY = ROW_PX / 2;
    const endY = ROW_PX + ROW_PX / 2;
    const turnX = Math.min(startX + 10, endX - 8);
    connector.current?.setAttribute("d", `M${startX} ${startY} H${turnX} V${endY} H${endX} m-5 -3 l5 3 l-5 3`);
  };

  useLayoutEffect(() => {
    cancelAnimationFrame(frame.current);
    const element = lay.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!played || reduced || !element) {
      draw(0);
      return;
    }
    const startedAt = performance.now();
    const tick = () => {
      const elapsed = performance.now() - startedAt;
      const progress = Math.min(1, Math.max(0, (elapsed - config.knockOnStaggerMs) / config.knockOnMs));
      const shift = -DAY_PX * (1 - ease(progress));
      element.style.transform = progress >= 1 ? "" : `translateX(${shift}px)`;
      draw(progress >= 1 ? 0 : shift);
      if (progress < 1) frame.current = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame.current);
  }, [played]);

  return (
    <main className="landing">
      <nav className="landing-nav">
        <a href="/signin" onClick={(event) => { event.preventDefault(); navigate("/signin"); }}>
          Sign in
        </a>
      </nav>
      <section className="hero">
        <svg className="mark" width="48" height="12" viewBox="0 0 48 12" aria-hidden="true">
          <rect x="0" y="2" width="28" height="8" fill="var(--ink)" />
          <rect x="28" y="4" width="20" height="4" fill="var(--muted)" />
        </svg>
        <h1>
          <span className="line-one">Move one task.</span>
          <span className="line-two">The rest of the plan follows.</span>
        </h1>
        <p className="lede">Slackwater Plan counts working days, skips weekends and your holidays, and shows the critical path the moment a date moves.</p>
        <div className="hero-actions">
          <a href="/signup" className="button" onClick={(event) => { event.preventDefault(); navigate("/signup"); }}>
            Start a plan
          </a>
          <a href="#demo" onClick={(event) => { event.preventDefault(); document.getElementById("demo")?.scrollIntoView({ behavior: "instant", block: "end" }); }}>
            See a plan move →
          </a>
        </div>
      </section>
      <section id="demo" ref={demo} className="demo" aria-label="Demo plan">
        <div className="demo-names">
          <div className="name-row">Order tiles</div>
          <div className="name-row">Lay floor</div>
        </div>
        <div className="demo-chart">
          <div className="demo-bars" style={{ height: ROW_PX * 2 }}>
            <div className="bar" data-critical="true" style={{ left: orderColumn * DAY_PX, width: ORDER_DAYS * DAY_PX, top: 11 }} />
            <div className="bar" data-critical="true" ref={lay} style={{ left: layColumn * DAY_PX, width: LAY_DAYS * DAY_PX, top: ROW_PX + 11 }} />
            <svg className="links" width="400" height={ROW_PX * 2} aria-hidden="true">
              <path ref={connector} data-critical="true" />
            </svg>
            <svg className="pointer" style={{ left: orderColumn * DAY_PX + 40, top: 26 }} width="22" height="28" viewBox="0 0 22 28" aria-hidden="true">
              <path d="M2 2 L2 22 L7 17 L11 26 L14 24.5 L10 16 L17 16 Z" fill="var(--ground)" stroke="var(--ink)" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      </section>
    </main>
  );
}
