import { CheckCircle2, Clock, Inbox } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Figure, FigureStack } from "../components/Figures.tsx";
import { GateGlyph, paintSweep } from "../components/GateGlyph.tsx";
import { Page } from "../components/Shell.tsx";
import { WINDOW_STATUS_LABEL, api, districtTime, useLayout, usePoll, useReducedMotion } from "../lib.ts";
import type { DeliveryWindow, GateCard, Order } from "../types.ts";

const DWELL_MS = 1000;
const DRAIN_MS = 200;

const STATE_ORDER = { open: 0, "waiting-for-store": 1, spent: 2 } as const;

/** Orders window reads against confirmed strokes, so an older poll never undoes a newer figure. */
let sequence = 0;

/** The headgate dwell, timed by the page's own timers: progress follows the time held, the stroke is
 * sent at one second, and an early release resets to 0 and sends nothing. Progress and sweep are
 * written straight to the DOM on each frame so they follow the clock exactly. */
function useDwell(onCommit: () => void, onEarly: () => void) {
  const reduced = useReducedMotion();
  const barRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const sweepRef = useRef<SVGRectElement>(null);
  const holding = useRef(false);
  const started = useRef(0);
  const frame = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sweep = useRef(0);

  const paint = (progress: number, fill: number) => {
    barRef.current?.setAttribute("aria-valuenow", String(progress));
    sweep.current = fill;
    const drawn = reduced ? Math.floor(fill * 4 + 1e-9) / 4 : fill;
    paintSweep(sweepRef.current, drawn);
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${drawn})`;
  };

  const stopTimers = () => {
    cancelAnimationFrame(frame.current);
    clearTimeout(timer.current);
  };

  const start = () => {
    if (holding.current) return;
    stopTimers();
    holding.current = true;
    started.current = performance.now();
    const tick = () => {
      const held = Math.min(1, (performance.now() - started.current) / DWELL_MS);
      paint(Math.round(held * 100), held);
      if (held < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    timer.current = setTimeout(() => {
      holding.current = false;
      stopTimers();
      paint(100, 1);
      onCommit();
    }, DWELL_MS);
  };

  const release = () => {
    if (!holding.current) return;
    holding.current = false;
    stopTimers();
    const from = sweep.current;
    paint(0, reduced ? 0 : from);
    onEarly();
    if (reduced) return;
    const drainStart = performance.now();
    const drain = () => {
      const t = Math.min(1, (performance.now() - drainStart) / DRAIN_MS);
      paint(0, from * Math.pow(1 - t, 3));
      if (t < 1) frame.current = requestAnimationFrame(drain);
    };
    frame.current = requestAnimationFrame(drain);
  };

  // The page becoming hidden (the phone locks, the tab is switched) cancels a hold like a release.
  const releaseRef = useRef(release);
  releaseRef.current = release;
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) releaseRef.current();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stopTimers();
    };
  }, []);
  return { barRef, fillRef, sweepRef, start, release };
}

interface CardProps {
  card: GateCard;
  window: DeliveryWindow | undefined;
  onStroke: (card: GateCard) => void;
  announce: (text: string) => void;
  outage: boolean;
}

function DwellControl({ card, onStroke, announce }: Pick<CardProps, "card" | "onStroke" | "announce">) {
  const dwell = useDwell(() => onStroke(card), () => announce("Released early. Stroke not sent."));
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === " ") {
      event.preventDefault();
      if (!event.repeat) dwell.start();
    } else if (event.key === "Enter") {
      event.preventDefault();
    }
  };
  const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === " ") {
      event.preventDefault();
      dwell.release();
    }
  };
  return (
    <div className="dwell">
      <button
        type="button"
        className="dwell-control"
        aria-label={`Hold to stroke ${card.turnout}`}
        onPointerDown={(event) => {
          if (event.button === 0) dwell.start();
        }}
        onPointerUp={dwell.release}
        onPointerLeave={dwell.release}
        onPointerCancel={dwell.release}
        onLostPointerCapture={dwell.release}
        onPointerMove={(event) => {
          // A touch keeps its target while the finger slides, so leaving the control is judged here.
          const box = event.currentTarget.getBoundingClientRect();
          const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
          if (!inside) dwell.release();
        }}
        onBlur={dwell.release}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
      >
        <GateGlyph sweepRef={dwell.sweepRef} />
        <span className="dwell-hint" aria-hidden="true">Hold</span>
      </button>
      <div
        ref={dwell.barRef}
        role="progressbar"
        aria-label={`Dwell progress ${card.turnout}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={0}
        className="dwell-bar"
      >
        <span ref={dwell.fillRef} className="dwell-bar-fill" />
      </div>
    </div>
  );
}

function GateCardView({ card, window: w, onStroke, announce, outage }: CardProps) {
  return (
    <article className={`gate-card gate-card-${card.state}`} aria-label={`Gate card ${card.turnout}`}>
      <header className="gate-card-head">
        <h2 className="gate-card-title">{card.turnout}</h2>
        <span className={`badge badge-kind-${card.kind}`}>{card.kind === "start" ? "Start" : "Finish"}</span>
      </header>
      <p className="gate-card-meta">
        {card.grower_name} · {w?.channel_name ?? card.channel_id}
      </p>
      <p className="gate-card-meta">{w?.label ?? card.window_id}</p>
      <div role="group" aria-label={`Window status ${card.turnout}`} className="gate-card-status">
        <span className={`badge badge-window-${card.window_status}`}>{WINDOW_STATUS_LABEL[card.window_status]}</span>
      </div>
      <p className="gate-card-stroke num">{`${card.from_ml_day} → ${card.to_ml_day} ML/day`}</p>
      <div className="gate-card-action">
        {card.state === "open" && <DwellControl card={card} onStroke={onStroke} announce={announce} />}
        {card.state === "waiting-for-store" && (
          <div className={`gate-wait${outage ? " is-outage" : ""}`}>
            <Clock size={18} aria-hidden="true" />
            <span>Waiting for the store</span>
          </div>
        )}
        {card.state === "spent" && card.stroke && (
          <section className="stroke-record" aria-label={`Stroke record ${card.turnout}`}>
            <p className="stroke-record-title"><CheckCircle2 size={16} aria-hidden="true" /> Stroke stored</p>
            <dl className="facts facts-tight">
              <div><dt>Record</dt><dd>{card.stroke.key}</dd></div>
              <div><dt>Operator</dt><dd>{card.stroke.operator_code}</dd></div>
              <div><dt>Committed</dt><dd>{districtTime(card.stroke.committed_at)}</dd></div>
              {card.stroke.confirmed_at && <div><dt>Stored</dt><dd>{districtTime(card.stroke.confirmed_at)}</dd></div>}
            </dl>
          </section>
        )}
      </div>
      <FigureStack>
        <Figure label="Channel flow" value={w?.channel_flow_ml_day ?? "0.000"} unit="ML/day" size="lg" animate />
        <Figure label="Delivered" value={w?.delivered_ml ?? "0.000"} unit="ML" size="lg" animate />
      </FigureStack>
    </article>
  );
}

export function Field() {
  const layout = useLayout();
  const [status, setStatus] = useState("");
  const [local, setLocal] = useState<Map<number, GateCard>>(new Map());
  const [fresh, setFresh] = useState<Map<string, { window: DeliveryWindow; seq: number }>>(new Map());
  const [slow, setSlow] = useState<Set<number>>(new Set());
  const cards = usePoll(() => api<{ cards: GateCard[] }>("/api/gate-cards"), []);
  const windows = usePoll(async () => {
    const seq = ++sequence;
    const reply = await api<{ windows: DeliveryWindow[] }>("/api/windows");
    return reply.ok ? { ...reply, data: { ...reply.data, seq } } : reply;
  }, []);

  const byWindow = new Map((windows.data?.windows ?? []).map((w) => [w.id, w]));
  for (const [id, entry] of fresh) if (entry.seq > (windows.data?.seq ?? 0)) byWindow.set(id, entry.window);
  const list = (cards.data?.cards ?? [])
    .map((card) => {
      const mine = local.get(card.id);
      return mine && STATE_ORDER[mine.state] > STATE_ORDER[card.state] ? mine : card;
    })
    .sort((a, b) => b.id - a.id);

  // Handovers reaching this view: a card handed to this operator appears with its announcement, and
  // an open card that leaves the list has moved to another operator (its dwell, if any, unmounts
  // with it, so nothing is sent).
  const lastOpen = useRef<Map<number, GateCard> | null>(null);
  useEffect(() => {
    if (!cards.data) return;
    const open = new Map(cards.data.cards.filter((c) => c.state === "open").map((c) => [c.id, c]));
    const before = lastOpen.current;
    lastOpen.current = open;
    if (before === null) return;
    const listed = new Set(cards.data.cards.map((c) => c.id));
    const gained = [...open.values()].filter((c) => c.handed_over && !before.has(c.id));
    const lost = [...before.values()].filter((c) => !listed.has(c.id) && !local.has(c.id));
    if (lost.length) setStatus("This gate card has moved to another operator.");
    if (gained.length) setStatus(gained.map((c) => `Gate card for ${c.turnout} is now yours.`).join(" "));
  }, [cards.data]);

  const stroke = async (card: GateCard) => {
    setStatus("Stroke sent. Waiting for the store.");
    setLocal((m) => new Map(m).set(card.id, { ...card, state: "waiting-for-store" }));
    const reply = await api<{ card: GateCard; order?: Order; window?: DeliveryWindow }>(`/api/gate-cards/${card.id}/stroke`, { method: "POST" });
    if (reply.ok && reply.status === 200 && reply.data.window) {
      const w = reply.data.window;
      setLocal((m) => new Map(m).set(card.id, reply.data.card));
      setFresh((m) => new Map(m).set(w.id, { window: w, seq: ++sequence }));
      setStatus(`Stroke stored for ${card.turnout}. Flow now ${w.channel_flow_ml_day} ML/day.`);
    } else if (reply.ok) {
      setLocal((m) => new Map(m).set(card.id, reply.data.card));
      setSlow((s) => new Set(s).add(card.id));
      setStatus("The evidence store is not answering. The stroke will count once it is stored.");
    } else {
      setLocal((m) => {
        const next = new Map(m);
        next.delete(card.id);
        return next;
      });
      setStatus(reply.error.message ?? "");
    }
    cards.reload();
  };

  return (
    <Page title="Gate cards" wide>
      <p role="status" aria-label="Gate dwell status" className={`status-line status-banner${list.length ? " status-reserved" : ""}`}>{status}</p>
      {cards.data === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <ul className={`card-grid card-grid-${layout}`} aria-label="Gate cards">
          {list.length === 0 && (
            <li className="empty card-grid-empty"><Inbox size={18} aria-hidden="true" /> No gate cards held. New cards appear here as orders are scheduled.</li>
          )}
          {list.map((card) => (
            <li key={card.id}>
              <GateCardView
                card={card}
                window={byWindow.get(card.window_id)}
                onStroke={stroke}
                announce={setStatus}
                outage={slow.has(card.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
