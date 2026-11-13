// The Shot Rig's behaviour outside Preact: quote changes (per-shot queue, newest revision wins, rebuild from the
// reply), the selection sequence (flying, focusing, cut, counting), numerals, orbit, and every data-* instrument.
import { api, type Quote } from "../api";
import { flagOutage, clearOutage } from "../components/Shell";
import { easeOutLong } from "../motion";
import { formatMoney } from "../../shared/money";
import type { RigScene } from "../three/rigScene";

export type Shot = { code: string; title: string; azimuth: number; elevation: number; listPrice: number };
export type QuoteView = { quote: Quote; desired: ReadonlyMap<string, number | null>; busy: boolean };
type Phase = "flying" | "focusing" | "cut" | "counting" | "idle";
type Frustum = { position: number; ember: number };
type Sequence = { code: string; kind: "select" | "deselect"; start: number; needsReply: boolean; step: Phase; stepAt: number; emberFrom: number };
type Figure = "total" | "deposit" | "look_dev" | "final";

const FLY_MS = 600;
const FOCUS_MS = 320;
const COUNT_MS = 500;
const ORBIT_RESET_MS = 600;

type Bindings = {
  group: HTMLElement;
  pip: HTMLElement;
  pipLabel: HTMLElement;
  rigFocus: HTMLElement;
  numerals: Record<Figure, HTMLElement>;
  barTotal: HTMLElement;
  scene: RigScene;
};

export class RigController {
  private shown: Quote;
  private readonly desired = new Map<string, number | null>();
  private readonly queues = new Map<string, { inflight: boolean; waiting: number | null | undefined }>();
  private readonly frustums = new Map<string, Frustum>();
  private order: string[];
  private pip = "overview";
  private focused: string;
  private sequence: Sequence | null = null;
  private appliedAt = -Infinity;
  private numeralFrom: Record<Figure, number>;
  private numeralShown: Record<Figure, number>;
  private numeralTo: Record<Figure, number>;
  private numeralAt = -Infinity;
  private orbit = 0;
  private orbitReset: { from: number; at: number } | null = null;
  private bindings: Bindings | null = null;
  private frame = 0;
  private phaseShown: Phase | null = null;

  constructor(
    private readonly engagementId: string,
    private readonly shots: Shot[],
    initial: Quote,
    private readonly reduced: boolean,
    private readonly onView: (view: QuoteView) => void,
    private readonly announce: (text: string) => void,
  ) {
    this.shown = initial;
    this.order = shots.map((s) => s.code).filter((code) => initial.lines.some((line) => line.shot_code === code));
    this.pip = this.order.at(-1) ?? "overview";
    this.focused = shots[0]?.code ?? "hero_front";
    for (const code of this.order) this.frustums.set(code, { position: 1, ember: 0 });
    const figures = this.figuresOf(initial);
    this.numeralFrom = { ...figures };
    this.numeralShown = { ...figures };
    this.numeralTo = { ...figures };
  }

  private figuresOf(quote: Quote): Record<Figure, number> {
    return { total: quote.total_minor, deposit: quote.milestones.deposit_minor, look_dev: quote.milestones.look_dev_minor, final: quote.milestones.final_delivery_minor };
  }

  attach(bindings: Bindings): void {
    this.bindings = bindings;
    bindings.group.dataset.webgl = bindings.scene.webgl ? "on" : "off";
    this.writePhase("idle");
    const tick = (now: number): void => {
      this.frame = requestAnimationFrame(tick);
      this.step(now);
    };
    this.frame = requestAnimationFrame(tick);
    this.step(performance.now());
  }

  detach(): void {
    cancelAnimationFrame(this.frame);
    this.bindings = null;
  }

  // ---------- selection and quantities ----------

  isSelected(code: string): boolean {
    const want = this.desired.get(code);
    if (want !== undefined) return want !== null;
    return this.shown.lines.some((line) => line.shot_code === code);
  }

  toggle(code: string): void {
    if (this.isSelected(code)) {
      this.change(code, null);
      this.startSequence(code, "deselect", true);
    } else {
      this.change(code, 1);
      this.startSequence(code, "select", true);
    }
  }

  setQuantity(code: string, quantity: number): void {
    if (!this.isSelected(code)) return;
    this.change(code, quantity);
  }

  private notify(): void {
    const busy = [...this.queues.values()].some((q) => q.inflight);
    this.onView({ quote: this.shown, desired: new Map(this.desired), busy });
  }

  private change(code: string, value: number | null): void {
    this.desired.set(code, value);
    const queue = this.queues.get(code) ?? { inflight: false, waiting: undefined };
    this.queues.set(code, queue);
    if (queue.inflight) queue.waiting = value;
    else void this.send(code, value);
    this.notify();
  }

  private async send(code: string, value: number | null): Promise<void> {
    const queue = this.queues.get(code);
    if (!queue) return;
    queue.inflight = true;
    const path = `/api/engagements/${this.engagementId}/quote/lines/${code}`;
    const reply = value === null ? await api<Quote>("DELETE", path) : await api<Quote>("PUT", path, { quantity: value });
    if (reply.ok) {
      clearOutage("content");
      if (reply.data.revision > this.shown.revision) this.apply(reply.data, true);
    } else {
      flagOutage(reply.failure.error);
      await this.refuse(code, reply.failure.message);
    }
    if (queue.waiting !== undefined) {
      const next = queue.waiting;
      queue.waiting = undefined;
      void this.send(code, next);
    } else {
      queue.inflight = false;
      this.desired.delete(code);
    }
    this.notify();
  }

  /** A refused change: re-read the engagement and rebuild from the server's quote even at the same revision. */
  private async refuse(code: string, message: string): Promise<void> {
    this.desired.delete(code);
    const queue = this.queues.get(code);
    if (queue) queue.waiting = undefined;
    const fresh = await api<{ quote: Quote }>("GET", `/api/engagements/${this.engagementId}`);
    if (fresh.ok) this.apply(fresh.data.quote, false);
    this.announce(message);
  }

  /** Applies a reply: every rig surface is rebuilt from its lines. */
  private apply(quote: Quote, announce: boolean): void {
    this.shown = quote;
    this.appliedAt = performance.now();
    this.numeralTo = this.figuresOf(quote);
    if (!this.held()) this.restartCount(this.appliedAt);
    this.reconcile();
    if (announce) this.announce(`Quote updated: total ${formatMoney(quote.total_minor, quote.currency)}, deposit ${formatMoney(quote.milestones.deposit_minor, quote.currency)}.`);
    this.notify();
  }

  /** Brings frustums in line with the selected shots, running sequences for any difference (e.g. lines from another tab). */
  private reconcile(): void {
    for (const shot of this.shots) {
      const wanted = this.isSelected(shot.code);
      const running = this.sequence && this.sequence.code === shot.code ? this.sequence : null;
      const present = this.frustums.has(shot.code);
      if (wanted && running?.kind === "deselect") {
        this.sequence = null;
        this.writePhase("idle");
        this.frustums.set(shot.code, { position: 1, ember: shot.code === this.focused ? 1 : 0 });
        if (!this.order.includes(shot.code)) this.order.push(shot.code);
      } else if (wanted && !present) this.startSequence(shot.code, "select", false);
      else if (!wanted && present && running?.kind !== "deselect") this.startSequence(shot.code, "deselect", false);
    }
  }

  private startSequence(code: string, kind: Sequence["kind"], needsReply: boolean): void {
    this.finishSequence();
    const now = performance.now();
    if (kind === "select") {
      this.focused = code;
      this.order = this.order.filter((c) => c !== code).concat(code);
      for (const [other, f] of this.frustums) if (other !== code) f.ember = 0;
      this.frustums.set(code, { position: this.reduced ? 1 : 0, ember: this.reduced ? 1 : 0 });
      if (this.reduced) {
        this.pip = code;
        return;
      }
    } else {
      this.order = this.order.filter((c) => c !== code);
    }
    this.sequence = { code, kind, start: now, needsReply, step: kind === "select" ? "flying" : "counting", stepAt: now, emberFrom: this.frustums.get(code)?.ember ?? 0 };
    if (!this.reduced) this.writePhase(this.sequence.step);
  }

  /** Jumps the running sequence to its end state. */
  private finishSequence(): void {
    const seq = this.sequence;
    if (!seq) return;
    this.sequence = null;
    if (seq.kind === "select") {
      const f = this.frustums.get(seq.code);
      if (f) Object.assign(f, { position: 1, ember: seq.code === this.focused ? 1 : 0 });
      this.pip = seq.code;
    } else {
      this.frustums.delete(seq.code);
      if (this.pip === seq.code) this.pip = this.order.at(-1) ?? "overview";
    }
    this.restartCount(performance.now());
    this.writePhase("idle");
  }

  /** Numerals count from the figures shown to the newest applied reply; held while a selection is still flying. */
  private held(): boolean {
    return this.sequence?.kind === "select" && this.sequence.step !== "counting";
  }

  private restartCount(now: number): void {
    this.numeralFrom = { ...this.numeralShown };
    this.numeralAt = now;
  }

  private writePhase(phase: Phase): void {
    if (this.reduced) phase = "idle";
    if (this.phaseShown === phase || !this.bindings) {
      this.phaseShown = this.bindings ? phase : this.phaseShown;
      return;
    }
    this.phaseShown = phase;
    this.bindings.group.dataset.rigPhase = phase;
  }

  private advance(now: number): void {
    const seq = this.sequence;
    if (!seq) return;
    const elapsed = now - seq.stepAt;
    const frustum = this.frustums.get(seq.code);
    const next = (step: Phase): void => {
      seq.step = step;
      seq.stepAt = now;
      this.writePhase(step);
    };
    const replied = !seq.needsReply || this.appliedAt >= seq.start;
    if (seq.kind === "select") {
      if (seq.step === "flying") {
        if (frustum) frustum.position = easeOutLong(elapsed / FLY_MS);
        if (elapsed >= FLY_MS) next("focusing");
      } else if (seq.step === "focusing") {
        if (frustum) frustum.ember = easeOutLong(elapsed / FOCUS_MS);
        if (elapsed >= FOCUS_MS) {
          this.pip = seq.code;
          next("cut");
        }
      } else if (seq.step === "cut") {
        if (replied) {
          this.restartCount(now);
          next("counting");
        }
      } else if (seq.step === "counting" && elapsed >= COUNT_MS) {
        this.sequence = null;
        this.writePhase("idle");
      }
      return;
    }
    if (seq.step === "counting") {
      if (!replied) {
        seq.stepAt = now;
        return;
      }
      if (this.reduced) {
        this.frustums.delete(seq.code);
        if (this.pip === seq.code) this.pip = this.order.at(-1) ?? "overview";
        this.sequence = null;
        return;
      }
      if (elapsed >= COUNT_MS) {
        if (this.pip === seq.code) {
          this.pip = this.order.at(-1) ?? "overview";
          next("cut");
        } else next("focusing");
        seq.emberFrom = frustum?.ember ?? 0;
      }
    } else if (seq.step === "cut") {
      next("focusing");
    } else if (seq.step === "focusing") {
      if (frustum) frustum.ember = seq.emberFrom * (1 - easeOutLong(elapsed / FOCUS_MS));
      if (elapsed >= FOCUS_MS) next("flying");
    } else if (seq.step === "flying") {
      if (frustum) frustum.position = 1 - easeOutLong(elapsed / FLY_MS);
      if (elapsed >= FLY_MS) {
        this.frustums.delete(seq.code);
        this.sequence = null;
        this.writePhase("idle");
      }
    }
  }

  /** Takes the server's quote after the deposit (same revision, now locked) without a sequence or announcement. */
  adopt(quote: Quote): void {
    this.shown = quote;
    this.numeralTo = this.figuresOf(quote);
    this.restartCount(performance.now());
    this.notify();
  }

  // ---------- orbit, focus, keyboard ----------

  orbitBy(degrees: number): void {
    this.orbitReset = null;
    this.orbit = (((this.orbit + degrees) % 360) + 360) % 360;
  }

  resetOrbit(): void {
    if (this.reduced) this.orbit = 0;
    else this.orbitReset = { from: this.orbit > 180 ? this.orbit - 360 : this.orbit, at: performance.now() };
  }

  moveFocus(delta: number): void {
    const index = this.shots.findIndex((s) => s.code === this.focused);
    const next = this.shots[(index + delta + this.shots.length) % this.shots.length];
    if (!next) return;
    this.focused = next.code;
    for (const [code, f] of this.frustums) f.ember = code === next.code ? 1 : 0;
    if (this.bindings) {
      this.bindings.group.dataset.focusedShot = next.code;
      this.bindings.rigFocus.textContent = `${this.titleOf(next.code)}, azimuth ${next.azimuth}°, elevation ${next.elevation}°, ${this.isSelected(next.code) ? "selected" : "not selected"}`;
    }
  }

  focusedShot(): string {
    return this.focused;
  }

  titleOf(code: string): string {
    return this.shown.lines.find((line) => line.shot_code === code)?.title ?? this.shots.find((s) => s.code === code)?.title ?? code;
  }

  // ---------- every frame ----------

  private step(now: number): void {
    this.advance(now);
    const b = this.bindings;
    if (!b) return;
    if (this.orbitReset) {
      const t = (now - this.orbitReset.at) / ORBIT_RESET_MS;
      this.orbit = t >= 1 ? 0 : ((this.orbitReset.from * (1 - easeOutLong(t)) % 360) + 360) % 360;
      if (t >= 1) this.orbitReset = null;
    }
    if (!this.held()) {
      const e = this.reduced ? 1 : easeOutLong(Math.min(1, (now - this.numeralAt) / COUNT_MS));
      for (const key of Object.keys(this.numeralTo) as Figure[]) this.numeralShown[key] = this.numeralFrom[key] + (this.numeralTo[key] - this.numeralFrom[key]) * e;
    }
    for (const key of Object.keys(this.numeralTo) as Figure[]) {
      const text = formatMoney(Math.round(this.numeralShown[key]), this.shown.currency);
      if (b.numerals[key].textContent !== text) b.numerals[key].textContent = text;
    }
    const total = formatMoney(Math.round(this.numeralShown.total), this.shown.currency);
    if (b.barTotal.textContent !== total) b.barTotal.textContent = total;
    const inPlace = [...this.frustums.entries()].filter(([code, f]) => !(this.sequence?.code === code && this.sequence.kind === "select" && this.sequence.step === "flying") && f.position > 0).length;
    const attrs: Record<string, string> = {
      frustumCount: String(inPlace),
      focusedShot: this.focused,
      orbitAzimuth: String(Math.round(this.orbit) % 360),
    };
    for (const [key, value] of Object.entries(attrs)) if (b.group.dataset[key] !== value) b.group.dataset[key] = value;
    if (b.pip.dataset.pipShot !== this.pip) {
      b.pip.dataset.pipShot = this.pip;
      b.pipLabel.textContent = this.pip === "overview" ? "Overview" : this.titleOf(this.pip);
    }
    const pipShot = this.shots.find((s) => s.code === this.pip);
    b.scene.render({
      orbit: this.orbit,
      frustums: [...this.frustums.entries()].map(([code, f]) => {
        const shot = this.shots.find((s) => s.code === code);
        return { code, azimuth: shot?.azimuth ?? 0, elevation: shot?.elevation ?? 0, position: f.position, ember: code === this.focused || this.sequence?.code === code ? f.ember : 0 };
      }),
      stations: this.shots.map((s) => ({ azimuth: s.azimuth, selected: this.frustums.has(s.code), focused: s.code === this.focused })),
      pip: pipShot ? { azimuth: pipShot.azimuth, elevation: pipShot.elevation } : null,
    });
  }
}
