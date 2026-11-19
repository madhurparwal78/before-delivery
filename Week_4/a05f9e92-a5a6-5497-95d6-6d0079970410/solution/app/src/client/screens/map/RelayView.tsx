import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import { Portrait } from "../../components/Portrait.js";
import { animate } from "../../lib/ui.js";
import { pathText, type RelayPanel } from "./relayPanels.js";

const TITLE_LINE = 1.05;

/** A portrait ground that differs from the panel it sits on: orange on ink, white on brown, ink on the light orange. */
const PORTRAIT_PALETTE: Record<number, number> = { 1: 4, 2: 3, 3: 0 };

function PanelCard({ panel, cardRef }: { panel: RelayPanel; cardRef?: (element: HTMLElement | null) => void }): JSX.Element {
  return (
    <article ref={cardRef} className={`relay-panel tier-${panel.tier}`} aria-label={panel.name}>
      <div className="panel-portrait">
        <Portrait name={panel.name} palette={PORTRAIT_PALETTE[panel.tier]} />
      </div>
      <div className="panel-body">
        <div className="panel-top">
          <p className="panel-tier">Tier {panel.tier}</p>
          <h2 className="panel-name">{panel.name}</h2>
          <p className="panel-detail">{panel.detail}</p>
        </div>
        <div className="panel-bottom">
          {panel.rest.length > 0 ? (
            <ul className="panel-rest">
              {panel.rest.map((item) => (
                <li key={item.ci.name}>
                  <span>{item.ci.name}</span>
                  <span className="panel-rest-tier">Tier {item.tier}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="panel-path">{pathText(panel.path)}</p>
          )}
          <p className="panel-people">+{panel.added} people</p>
        </div>
      </div>
    </article>
  );
}

function Counter({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div role="group" aria-label={label} className="relay-counter">
      {children}
      <span className="counter-word">people</span>
    </div>
  );
}

/** Sets the pinned title as large as fits: up to one tenth of the screen width, on one line (two on a phone), never wider than the screen. */
function fitTitle(title: HTMLElement): void {
  const lines = window.innerWidth < 768 ? 2 : 1;
  let size = window.innerWidth / 10;
  title.style.whiteSpace = lines === 1 ? "nowrap" : "normal";
  title.style.fontSize = `${size}px`;
  while (size > 14 && (title.scrollWidth > title.clientWidth + 1 || title.offsetHeight > size * TITLE_LINE * lines + 2)) {
    size *= 0.94;
    title.style.fontSize = `${size}px`;
  }
}

export function PinnedRelay({ failed, meta, panels, base }: { failed: string; meta: ReactNode; panels: RelayPanel[]; base: number }): JSX.Element {
  const section = useRef<HTMLElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const group = useRef<HTMLDivElement>(null);
  const digits = useRef<HTMLSpanElement>(null);
  const cards = useRef<(HTMLElement | null)[]>([]);
  const shown = useRef(base);
  const target = useRef(base);
  const token = useRef(0);

  const show = useCallback((value: number) => {
    shown.current = value;
    if (digits.current) digits.current.textContent = String(value);
  }, []);

  const countTo = useCallback(
    (next: number) => {
      const from = shown.current;
      const mine = ++token.current;
      target.current = next;
      const run = animate(group.current, { "--count": [String(from), String(next)] }, 420);
      if (!run) {
        show(next);
        return;
      }
      const tick = (): void => {
        if (token.current !== mine) return;
        const progress = run.effect?.getComputedTiming().progress ?? 0;
        show(Math.round(from + (next - from) * Number(progress)));
        if (run.playState === "running") requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      const settle = (): void => {
        if (token.current === mine) show(next);
      };
      run.finished.then(settle, settle);
    },
    [show],
  );

  const passed = useCallback(
    (animated: boolean) => {
      const middle = window.innerHeight / 2;
      let count = 0;
      cards.current.slice(0, panels.length).forEach((card, index) => {
        if (card && card.getBoundingClientRect().top < middle) count = index + 1;
      });
      const next = count === 0 ? base : panels[count - 1]!.running;
      if (animated) {
        if (next !== target.current) countTo(next);
      } else {
        token.current++;
        target.current = next;
        show(next);
      }
    },
    [base, countTo, panels, show],
  );

  useLayoutEffect(() => {
    passed(false);
    const onScroll = (): void => passed(true);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [passed]);

  useLayoutEffect(() => {
    const refit = (): void => fitTitle(title.current!);
    refit();
    const measure = new ResizeObserver(() => section.current?.style.setProperty("--relay-top", `${head.current!.offsetHeight}px`));
    measure.observe(head.current!);
    window.addEventListener("resize", refit);
    void document.fonts.load(`900 16px "Unbounded"`).then(refit);
    return () => {
      measure.disconnect();
      window.removeEventListener("resize", refit);
    };
  }, [failed]);

  return (
    <section ref={section} className="relay" aria-label="Outage relay">
      <div className="relay-pin">
        <div ref={head} className="relay-head">
          <h1 ref={title} className="relay-title">
            {failed}
          </h1>
          <div className="relay-meta">{meta}</div>
        </div>
        <Counter label="Affected people">
          <span ref={digits} className="counter-digits" />
        </Counter>
      </div>
      <div className="relay-panels">
        {panels.map((panel, index) => (
          <PanelCard key={panel.key} panel={panel} cardRef={(element) => void (cards.current[index] = element)} />
        ))}
      </div>
    </section>
  );
}

export function StaticRelay({ failed, meta, panels, total }: { failed: string; meta: ReactNode; panels: RelayPanel[]; total: number }): JSX.Element {
  return (
    <section className="relay-static" aria-label="Outage relay">
      <h1 className="static-title">{failed}</h1>
      <div className="relay-meta">{meta}</div>
      <Counter label="Affected people">
        <span className="counter-digits">{total}</span>
      </Counter>
      <ol className="static-panels">
        {panels.map((panel) => (
          <li key={panel.key}>
            <PanelCard panel={panel} />
          </li>
        ))}
      </ol>
    </section>
  );
}
