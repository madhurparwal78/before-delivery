// Replay and the Wake dial. The browser re-runs the shared battle simulation on the raid's published
// seed, layout, deploy list and resolution lootable amounts, then scrubs it tick by tick.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { simulateBattle, type BattleFrame } from '../shared/battle';
import { api } from './api';
import { Icon } from './icons';
import { useStage } from './island';
import { layoutScene, unitScene } from './raid';
import type { IslandController } from './scene/controller';
import { notify, query, reducedMotion, warn } from './store';
import type { Raid } from './types';
import { Num, perform } from './ui';

const NOTCH = 10;
const FRAME_MS = 1000 / 60;
const FRICTION = 0.92;
const COAST_STOP = 0.5 / FRAME_MS;
const RELEASE_WINDOW_MS = 100;
const STILL_MS = 50;
const SPRING_K = 900;
const SPRING_C = 60;
const SPRING_MAX_MS = 450;
const PLAY_TICKS_PER_MS = 10 / 1000;

type Phase = 'rest' | 'drag' | 'coast' | 'spring' | 'play';

interface DialHooks {
  draw(tick: number): void;
  settle(tick: number): void;
  moving(position: number): void;
}

/** The dial's motion: drag by pointer angle, coast with friction, spring onto a whole tick, play. */
class WakeDial {
  position = 0;
  private phase: Phase = 'rest';
  private velocity = 0;
  private samples: { t: number; p: number }[] = [];
  private lastAngle = 0;
  private frame = 0;
  private lastFrame = 0;
  private springStart = 0;
  private springTarget = 0;

  constructor(private final: number, private readonly hooks: DialHooks) {}

  get resting(): boolean {
    return this.phase === 'rest';
  }

  get playing(): boolean {
    return this.phase === 'play';
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
  }

  /** Every notch crossed between two positions redraws the scene at that notch. */
  private cross(from: number, to: number): void {
    if (to > from) for (let n = Math.floor(from / NOTCH) + 1; n * NOTCH <= to; n += 1) this.hooks.draw(n * NOTCH);
    else for (let n = Math.ceil(from / NOTCH) - 1; n * NOTCH >= to; n -= 1) this.hooks.draw(n * NOTCH);
  }

  private moveTo(next: number): void {
    const clamped = Math.min(this.final, Math.max(0, next));
    this.cross(this.position, clamped);
    this.position = clamped;
    this.hooks.moving(clamped);
  }

  private loop(): void {
    cancelAnimationFrame(this.frame);
    this.lastFrame = performance.now();
    this.frame = requestAnimationFrame(this.step);
  }

  private stop(): void {
    cancelAnimationFrame(this.frame);
    this.phase = 'rest';
  }

  settleAt(tick: number): void {
    this.stop();
    this.velocity = 0;
    this.position = Math.min(this.final, Math.max(0, Math.round(tick)));
    this.hooks.settle(this.position);
  }

  /** Keys and buttons land on their tick at once, with no coasting. */
  stepBy(delta: number): void {
    this.settleAt(Math.round(this.position) + delta);
  }

  grab(angle: number): void {
    this.stop();
    this.phase = 'drag';
    this.lastAngle = angle;
    this.samples = [{ t: performance.now(), p: this.position }];
    this.hooks.moving(this.position);
  }

  drag(angle: number): void {
    if (this.phase !== 'drag') return;
    let delta = angle - this.lastAngle;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    this.lastAngle = angle;
    this.moveTo(this.position + delta);
    const now = performance.now();
    this.samples.push({ t: now, p: this.position });
    this.samples = this.samples.filter((s) => now - s.t <= RELEASE_WINDOW_MS);
  }

  release(): void {
    if (this.phase !== 'drag') return;
    const now = performance.now();
    const recent = this.samples.filter((s) => now - s.t <= RELEASE_WINDOW_MS);
    const first = recent[0];
    const last = recent[recent.length - 1];
    const still = !last || now - last.t > STILL_MS;
    this.velocity = still || !first || last.t === first.t ? 0 : (last.p - first.p) / (last.t - first.t);
    if (Math.abs(this.velocity) >= COAST_STOP && this.position > 0 && this.position < this.final) {
      this.phase = 'coast';
      this.loop();
    } else this.spring();
  }

  private spring(): void {
    this.springTarget = Math.min(this.final, Math.max(0, Math.round(this.position)));
    if (Math.abs(this.position - this.springTarget) < 0.02 && Math.abs(this.velocity) < 0.0005) {
      this.settleAt(this.springTarget);
      return;
    }
    this.phase = 'spring';
    this.springStart = performance.now();
    this.loop();
  }

  play(): void {
    if (Math.round(this.position) >= this.final) this.settleAt(0);
    this.phase = 'play';
    this.loop();
  }

  pause(): void {
    if (this.phase === 'play') this.settleAt(this.position);
  }

  private step = (): void => {
    const now = performance.now();
    const dt = Math.min(64, now - this.lastFrame);
    this.lastFrame = now;
    if (this.phase === 'coast') {
      this.velocity *= Math.pow(FRICTION, dt / FRAME_MS);
      const next = this.position + this.velocity * dt;
      if (next <= 0 || next >= this.final) {
        this.moveTo(next);
        this.settleAt(this.position);
        return;
      }
      this.moveTo(next);
      if (Math.abs(this.velocity) < COAST_STOP) {
        this.spring();
        return;
      }
    } else if (this.phase === 'spring') {
      // A stiff, critically damped spring in ticks and seconds, integrated in small steps.
      let x = this.position - this.springTarget;
      let v = this.velocity * 1000;
      for (let left = dt / 1000; left > 0; left -= 0.004) {
        const h = Math.min(0.004, left);
        v += (-SPRING_K * x - SPRING_C * v) * h;
        x += v * h;
      }
      this.velocity = v / 1000;
      this.moveTo(this.springTarget + x);
      if ((Math.abs(x) < 0.02 && Math.abs(v) < 0.5) || now - this.springStart > SPRING_MAX_MS) {
        this.settleAt(this.springTarget);
        return;
      }
    } else if (this.phase === 'play') {
      const from = this.position;
      const next = Math.min(this.final, from + PLAY_TICKS_PER_MS * dt);
      this.position = next;
      this.hooks.moving(next);
      for (let t = Math.floor(from) + 1; t <= Math.floor(next); t += 1) {
        if (t % NOTCH === 0 || t === this.final) {
          this.hooks.settle(t);
          if (t === this.final) {
            this.settleAt(t);
            return;
          }
        } else this.hooks.draw(t);
      }
    } else return;
    this.frame = requestAnimationFrame(this.step);
  };
}

/** Angle in degrees of a point around a centre, 0 at the top and increasing clockwise. */
function angleOf(e: PointerEvent, el: HTMLElement): number {
  const r = el.getBoundingClientRect();
  const dx = e.clientX - (r.left + r.width / 2);
  const dy = e.clientY - (r.top + r.height / 2);
  return ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
}

const REPLAY_ATTRS = ['tick', 'destruction', 'stars', 'lootBrine', 'lootPeat', 'lootCopper', 'stateHash', 'settled', 'drawnTick'];

export function ReplayScreen({ raidId }: { raidId: string }) {
  const stage = useStage();
  const [raid, setRaid] = useState<Raid | null>(null);
  useEffect(() => {
    setRaid(null);
    void perform({
      pending: 'Loading replay…',
      run: () => api.get<Raid>(`/api/raids/${raidId}`),
    }).then((r) => {
      if (!r) return;
      if (r.state !== 'resolved' || !r.result) warn('This raid has no replay yet.');
      else {
        setRaid(r);
        notify(`Replay ready: ${r.result.finalTick} ticks.`);
      }
    });
  }, [raidId]);
  const frames = useMemo(
    () => (raid?.result ? simulateBattle({ seed: raid.seed, layout: raid.layout, deploys: raid.deploys, lootable: raid.result.lootable }) : null),
    [raid],
  );
  if (!stage || !raid || !frames) return null;
  return <WakeDialView key={raid.id} raid={raid} frames={frames} stage={stage} />;
}

function WakeDialView({ raid, frames, stage }: { raid: Raid; frames: BattleFrame[]; stage: IslandController }) {
  const final = frames.length - 1;
  const reduced = reducedMotion();
  const start = Math.min(final, Math.max(0, Math.floor(Number(query('tick') ?? '0')) || 0));
  const [settled, setSettled] = useState<BattleFrame>(frames[start] as BattleFrame);
  const [shown, setShown] = useState(start);
  const [playing, setPlaying] = useState(false);
  const [typed, setTyped] = useState(String(start));
  const ring = useRef<HTMLDivElement>(null);
  const bead = useRef<SVGGElement>(null);
  const counter = useRef<HTMLSpanElement>(null);
  const drawnTick = useRef(-1);

  const dial = useMemo(() => {
    const el = stage.element;
    const draw = (tick: number, animate = false): void => {
      const f = frames[tick] as BattleFrame;
      if (drawnTick.current === tick) return;
      const jump = Math.abs(tick - drawnTick.current);
      drawnTick.current = tick;
      stage.setBuildings(layoutScene(raid, f), animate && jump <= NOTCH);
      stage.setUnits(unitScene(raid.deploys, f));
      el.dataset.drawnTick = String(tick);
    };
    const place = (position: number): void => {
      if (bead.current) bead.current.setAttribute('transform', `rotate(${position % 360} 100 100)`);
      if (counter.current) counter.current.textContent = String(Math.round(position));
    };
    const w = new WakeDial(final, {
      draw: (tick) => {
        el.dataset.settled = 'false';
        draw(tick);
      },
      moving: (position) => {
        el.dataset.settled = 'false';
        place(position);
      },
      settle: (tick) => {
        const f = frames[tick] as BattleFrame;
        draw(tick, true);
        place(tick);
        const d = el.dataset;
        d.tick = String(tick);
        d.destruction = String(f.destruction);
        d.stars = String(f.stars);
        d.lootBrine = String(f.loot.brine);
        d.lootPeat = String(f.loot.peat);
        d.lootCopper = String(f.loot.copper);
        d.stateHash = f.hash;
        d.drawnTick = String(tick);
        d.settled = 'true';
        setSettled(f);
        setShown(tick);
        setTyped(String(tick));
        setPlaying(w.playing);
      },
    });
    return w;
  }, [raid, frames, stage]);

  useLayoutEffect(() => {
    dial.settleAt(start);
    return () => {
      dial.dispose();
      for (const key of REPLAY_ATTRS) delete stage.element.dataset[key];
    };
  }, [dial]);

  const key = (e: KeyboardEvent): void => {
    const steps: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 };
    const by = steps[e.key];
    if (by !== undefined) dial.stepBy(by);
    else if (e.key === 'Home') dial.settleAt(0);
    else if (e.key === 'End') dial.settleAt(final);
    else return;
    e.preventDefault();
    setPlaying(false);
  };
  const togglePlay = (): void => {
    if (dial.playing) dial.pause();
    else dial.play();
    setPlaying(dial.playing);
  };
  const jump = (e: Event): void => {
    e.preventDefault();
    const n = Math.floor(Number(typed));
    dial.settleAt(Number.isFinite(n) ? n : shown);
    setPlaying(false);
  };

  const slider = {
    role: 'slider' as const,
    tabIndex: 0,
    'aria-label': 'Wake dial',
    'aria-valuemin': 0,
    'aria-valuemax': final,
    'aria-valuenow': shown,
    'aria-valuetext': `Tick ${shown} of ${final}`,
    onKeyDown: key,
  };

  const readout = (
    <div class="tick-readout" role="group" aria-label="Tick readout">
      <span>
        <Num value={settled.destruction} />%
      </span>
      <span>
        <Num value={settled.stars} /> stars
      </span>
      <span>
        <Num value={settled.loot.brine} /> brine
      </span>
      <span>
        <Num value={settled.loot.peat} /> peat
      </span>
      <span>
        <Num value={settled.loot.copper} /> copper
      </span>
    </div>
  );

  const playButton = (
    <button type="button" class="btn" onClick={togglePlay}>
      <Icon name={playing ? 'pause' : 'play'} />
      {playing ? 'Pause replay' : 'Play replay'}
    </button>
  );

  if (reduced) {
    const ratio = final === 0 ? 0 : shown / final;
    return (
      <div class="dial-wrap stepped">
        <div class="dial-side">
          {readout}
          <div
            ref={ring}
            class="stepper"
            {...slider}
            onPointerDown={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              dial.settleAt(((e.clientX - r.left) / r.width) * final);
            }}
          >
            <svg viewBox="0 0 400 44" preserveAspectRatio="none" aria-hidden="true">
              <line x1="8" y1="22" x2="392" y2="22" stroke="var(--rule-strong)" stroke-width="2" />
              <rect x={8 + ratio * 384 - 4} y="10" width="8" height="24" fill="var(--accent)" />
            </svg>
          </div>
          <form class="tick-buttons" onSubmit={jump}>
            <button type="button" class="btn" aria-label="Back 10 ticks" onClick={() => dial.stepBy(-10)}>
              <Icon name="back10" />
            </button>
            <button type="button" class="btn" aria-label="Previous tick" onClick={() => dial.stepBy(-1)}>
              <Icon name="back" />
            </button>
            <label class="sr-only" for="tick-input">
              Tick
            </label>
            <input
              id="tick-input"
              class="num"
              type="number"
              min={0}
              max={final}
              step={1}
              value={typed}
              onInput={(e) => setTyped(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && jump(e)}
            />
            <button type="button" class="btn" aria-label="Next tick" onClick={() => dial.stepBy(1)}>
              <Icon name="next" />
            </button>
            <button type="button" class="btn" aria-label="Forward 10 ticks" onClick={() => dial.stepBy(10)}>
              <Icon name="next10" />
            </button>
            {playButton}
          </form>
          <p class="hint">
            Tick <span class="num">{shown}</span> of <span class="num">{final}</span>
          </p>
        </div>
      </div>
    );
  }

  const notches = [];
  for (let t = 0; t < 360; t += NOTCH) notches.push(t);
  return (
    <div class="dial-wrap">
      <div
        ref={ring}
        class="dial"
        {...slider}
        onPointerDown={(e) => {
          const el = e.currentTarget as HTMLElement;
          el.setPointerCapture(e.pointerId);
          dial.grab(angleOf(e, el));
          setPlaying(false);
        }}
        onPointerMove={(e) => dial.drag(angleOf(e, e.currentTarget as HTMLElement))}
        onPointerUp={() => dial.release()}
        onPointerCancel={() => dial.release()}
      >
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <circle cx="100" cy="100" r="84" fill="color-mix(in srgb, var(--panel) 92%, transparent)" stroke="var(--rule-strong)" stroke-width="22" />
          <circle cx="100" cy="100" r="95" fill="none" stroke="var(--rule)" stroke-width="1" />
          <circle cx="100" cy="100" r="73" fill="none" stroke="var(--rule)" stroke-width="1" />
          {notches.map((deg) => (
            <line
              key={deg}
              x1="100"
              y1={deg % 90 === 0 ? 6 : 10}
              x2="100"
              y2="18"
              stroke="var(--ink)"
              stroke-opacity={deg % 90 === 0 ? 0.9 : 0.45}
              stroke-width={deg % 90 === 0 ? 2 : 1}
              transform={`rotate(${deg} 100 100)`}
            />
          ))}
          <g ref={bead} transform={`rotate(${start % 360} 100 100)`}>
            <circle cx="100" cy="16" r="9" fill="var(--accent)" stroke="var(--ground)" stroke-width="2" />
          </g>
        </svg>
        <div class="counter" aria-hidden="true">
          <span ref={counter} class="num">
            {start}
          </span>
          <span class="of num">of {final}</span>
        </div>
      </div>
      <div class="dial-side">
        {readout}
        {playButton}
      </div>
    </div>
  );
}
