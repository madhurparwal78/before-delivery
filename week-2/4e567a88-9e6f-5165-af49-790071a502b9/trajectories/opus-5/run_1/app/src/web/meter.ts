import { JobView, MeterView } from './api';
import { animateNumber, el, prefersReducedMotion, wait } from './dom';
import { credits, periodEndDate, units } from './format';
import { teamName, unitLabel } from './state';

const WIDTH_MS = 420;
const SHORT_MS = 220;

interface Notch {
  jobId: string;
  micro: bigint;
  status: string;
  units: string;
  unit: string;
}

interface Snapshot {
  granted: bigint;
  settled: bigint;
  reserved: bigint;
  available: bigint;
  notches: Notch[];
}

type Step =
  | { kind: 'reserve'; notch: Notch }
  | { kind: 'settle'; jobId: string; charged: bigint }
  | { kind: 'release'; jobId: string; released: bigint }
  | { kind: 'replay'; jobId: string }
  | { kind: 'adjust' };

function snapshotOf(meter: MeterView): Snapshot {
  return {
    granted: BigInt(meter.granted_micro),
    settled: BigInt(meter.settled_micro),
    reserved: BigInt(meter.reserved_micro),
    available: BigInt(meter.available_micro),
    notches: meter.in_flight.map((entry) => ({
      jobId: entry.job_id,
      micro: BigInt(entry.reserved_micro),
      status: entry.status,
      units: entry.estimated_units,
      unit: entry.unit,
    })),
  };
}

function percent(part: bigint, whole: bigint): string {
  if (whole <= 0n) return '0%';
  return `${(Number(part) / Number(whole)) * 100}%`;
}

export class Ribbon {
  readonly root: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly settledSegment: HTMLElement;
  private readonly reservedSegment: HTMLElement;
  private readonly availableSegment: HTMLElement;
  private readonly softCapMarker: HTMLElement;
  private readonly numerals: { settled: HTMLElement; reserved: HTMLElement; available: HTMLElement };
  private readonly numeralBoxes: { settled: HTMLElement; reserved: HTMLElement; available: HTMLElement };
  private readonly tabs: HTMLElement;
  private readonly announcer: HTMLElement;
  private readonly throttle: HTMLElement;
  private current: Snapshot | null = null;
  private lastMeter: MeterView | null = null;
  private queue: Promise<void> = Promise.resolve();
  private openJob: (jobId: string) => void = () => {};

  constructor() {
    this.settledSegment = el('div', {
      class: 'seg seg-settled',
      role: 'meter',
      'aria-label': 'Settled',
      'aria-valuemin': '0',
    });
    this.reservedSegment = el('div', {
      class: 'seg seg-reserved',
      role: 'meter',
      'aria-label': 'Reserved',
      'aria-valuemin': '0',
    });
    this.availableSegment = el('div', {
      class: 'seg seg-available',
      role: 'meter',
      'aria-label': 'Available',
      'aria-valuemin': '0',
    });
    this.softCapMarker = el('span', { class: 'soft-cap', role: 'img', 'aria-label': 'Soft cap marker' });
    this.softCapMarker.hidden = true;
    this.bar = el('div', { class: 'ribbon' }, [
      this.settledSegment,
      this.reservedSegment,
      this.availableSegment,
      this.softCapMarker,
    ]);
    this.numerals = {
      settled: el('span', { class: 'num' }),
      reserved: el('span', { class: 'num' }),
      available: el('span', { class: 'num' }),
    };
    this.numeralBoxes = {
      settled: el('span', { class: 'numeral numeral-settled' }, ['Settled ', this.numerals.settled]),
      reserved: el('span', { class: 'numeral numeral-reserved' }, ['Reserved ', this.numerals.reserved]),
      available: el('span', { class: 'numeral numeral-available' }, ['Available ', this.numerals.available]),
    };
    this.tabs = el('ul', { class: 'notch-tabs', role: 'list', 'aria-label': 'In-flight jobs' });
    this.announcer = el('div', {
      class: 'visually-hidden',
      role: 'status',
      'aria-live': 'polite',
      'aria-label': 'Meter announcements',
    });
    this.throttle = el('p', { class: 'throttle-message' });
    this.throttle.hidden = true;
    this.root = el('section', { class: 'meter', role: 'region', 'aria-label': 'Credit meter' }, [
      el('div', { class: 'meter-numerals' }, [
        this.numeralBoxes.settled,
        this.numeralBoxes.reserved,
        this.numeralBoxes.available,
      ]),
      this.bar,
      this.tabs,
      this.throttle,
      this.announcer,
    ]);
  }

  onOpenJob(handler: (jobId: string) => void): void {
    this.openJob = handler;
  }

  update(meter: MeterView, jobs: Map<string, JobView>): void {
    this.queue = this.queue.then(() => this.apply(meter, jobs)).catch(() => undefined);
  }

  private async apply(meter: MeterView, jobs: Map<string, JobView>): Promise<void> {
    const target = snapshotOf(meter);
    const previousMeter = this.lastMeter;
    this.lastMeter = meter;
    if (!this.current) {
      this.current = target;
      this.draw(0);
      this.drawCaps(meter, false);
      return;
    }
    const steps = this.diff(this.current, target, meter, previousMeter, jobs);
    for (const step of steps) await this.play(step, target);
    this.current = target;
    this.draw(0);
    this.drawCaps(meter, previousMeter !== null);
  }

  private diff(
    from: Snapshot,
    to: Snapshot,
    meter: MeterView,
    previousMeter: MeterView | null,
    jobs: Map<string, JobView>,
  ): Step[] {
    const steps: Step[] = [];
    const before = new Map(from.notches.map((notch) => [notch.jobId, notch]));
    const after = new Map(to.notches.map((notch) => [notch.jobId, notch]));
    const gone = [...before.keys()].filter((jobId) => !after.has(jobId));
    for (const jobId of gone.sort(byJobNumber)) {
      const job = jobs.get(jobId);
      if (job && job.status === 'succeeded' && job.charged_micro !== null) {
        steps.push({ kind: 'settle', jobId, charged: BigInt(job.charged_micro) });
      } else {
        const released = job ? BigInt(job.released_micro) : before.get(jobId)!.micro;
        steps.push({ kind: 'release', jobId, released });
      }
    }
    for (const notch of to.notches) {
      if (!before.has(notch.jobId)) steps.push({ kind: 'reserve', notch });
    }
    const seenReplays = new Set((previousMeter?.recent_replays ?? []).map((replay) => `${replay.job_id}@${replay.at}`));
    for (const replay of meter.recent_replays) {
      if (!seenReplays.has(`${replay.job_id}@${replay.at}`)) steps.push({ kind: 'replay', jobId: replay.job_id });
    }
    if (steps.length === 0 && !sameBalances(from, to)) steps.push({ kind: 'adjust' });
    return steps;
  }

  private async play(step: Step, target: Snapshot): Promise<void> {
    const instant = prefersReducedMotion();
    const snapshot = this.current!;
    if (step.kind === 'replay') {
      const notch = this.bar.querySelector<HTMLElement>(`[data-notch="${step.jobId}"]`);
      const tab = this.tabs.querySelector<HTMLElement>(`[data-tab="${step.jobId}"]`);
      notch?.classList.add('notch-replayed');
      tab?.classList.add('tab-replayed');
      this.announce(`Job ${step.jobId} already reserved; nothing added`);
      await wait(instant ? 1000 : SHORT_MS);
      notch?.classList.remove('notch-replayed');
      tab?.classList.remove('tab-replayed');
      return;
    }
    if (step.kind === 'reserve') {
      snapshot.notches = [...snapshot.notches, step.notch];
      snapshot.available -= step.notch.micro;
      snapshot.reserved += step.notch.micro;
      this.draw(instant ? 0 : WIDTH_MS, step.notch.jobId);
      this.announce(
        `Job ${step.notch.jobId} reserved ${units(step.notch.units, step.notch.unit)} ${unitLabel(step.notch.unit)}, ${credits(snapshot.available)} credits available`,
      );
      await wait(instant ? 0 : WIDTH_MS);
      return;
    }
    if (step.kind === 'release') {
      const notch = snapshot.notches.find((candidate) => candidate.jobId === step.jobId);
      const amount = notch?.micro ?? step.released;
      snapshot.notches = snapshot.notches.filter((candidate) => candidate.jobId !== step.jobId);
      snapshot.reserved -= amount;
      snapshot.available += amount;
      this.draw(instant ? 0 : WIDTH_MS);
      this.announce(
        `Job ${step.jobId} released ${credits(amount)} credits, ${credits(snapshot.available)} credits available`,
      );
      await wait(instant ? 0 : WIDTH_MS);
      return;
    }
    if (step.kind === 'settle') {
      const notch = snapshot.notches.find((candidate) => candidate.jobId === step.jobId);
      const reservedAmount = notch?.micro ?? step.charged;
      const unused = reservedAmount - step.charged;
      if (notch) notch.micro = step.charged;
      snapshot.reserved -= unused;
      snapshot.available += unused;
      this.draw(instant ? 0 : WIDTH_MS);
      await wait(instant ? 0 : WIDTH_MS);
      snapshot.notches = snapshot.notches.filter((candidate) => candidate.jobId !== step.jobId);
      snapshot.reserved -= step.charged;
      snapshot.settled += step.charged;
      this.draw(instant ? 0 : WIDTH_MS);
      this.announce(
        `Job ${step.jobId} settled ${credits(step.charged)} credits, ${credits(snapshot.available)} credits available`,
      );
      await wait(instant ? 0 : WIDTH_MS);
      return;
    }
    snapshot.granted = target.granted;
    snapshot.settled = target.settled;
    snapshot.reserved = target.reserved;
    snapshot.available = target.available;
    snapshot.notches = target.notches;
    this.draw(instant ? 0 : WIDTH_MS);
    await wait(instant ? 0 : WIDTH_MS);
  }

  /** Widths and positions animate from the stylesheet; `durationMs` of zero paints without motion. */
  private draw(durationMs: number, enteringJobId?: string): void {
    const snapshot = this.current!;
    const { granted, settled, reserved, available } = snapshot;
    this.root.classList.toggle('meter-instant', durationMs === 0);
    this.settledSegment.style.left = '0%';
    this.settledSegment.style.width = percent(settled, granted);
    this.reservedSegment.style.left = percent(settled, granted);
    this.reservedSegment.style.width = percent(reserved, granted);
    this.availableSegment.style.left = percent(settled + reserved, granted);
    this.availableSegment.style.width = percent(available, granted);

    const max = Number(granted) / 1000000;
    for (const [segment, value] of [
      [this.settledSegment, settled],
      [this.reservedSegment, reserved],
      [this.availableSegment, available],
    ] as const) {
      segment.setAttribute('aria-valuemax', String(max));
      segment.setAttribute('aria-valuenow', (Number(value) / 1000000).toFixed(2));
      segment.setAttribute('aria-valuetext', `${credits(value)} credits`);
    }

    this.drawNotches(durationMs, enteringJobId);
    this.drawNumerals(durationMs);
    this.drawTabs();

    if (durationMs === 0) {
      void this.bar.offsetWidth;
      requestAnimationFrame(() => this.root.classList.remove('meter-instant'));
    }
  }

  private drawNotches(durationMs: number, enteringJobId?: string): void {
    const snapshot = this.current!;
    const total = snapshot.reserved;
    let offset = 0n;
    const seen = new Set<string>();
    for (const notch of snapshot.notches) {
      seen.add(notch.jobId);
      let node = this.reservedSegment.querySelector<HTMLElement>(`[data-notch="${notch.jobId}"]`);
      if (!node) {
        node = el('span', { class: 'notch notch-instant', 'data-notch': notch.jobId });
        node.style.left = notch.jobId === enteringJobId ? '100%' : percent(offset, total);
        node.style.width = '0%';
        this.reservedSegment.append(node);
        void node.offsetWidth;
        node.classList.remove('notch-instant');
      }
      node.classList.toggle('notch-active', notch.status === 'leased' || notch.status === 'running');
      node.style.left = percent(offset, total);
      node.style.width = percent(notch.micro, total);
      offset += notch.micro;
    }
    for (const node of [...this.reservedSegment.querySelectorAll<HTMLElement>('[data-notch]')]) {
      const jobId = node.dataset['notch'] ?? '';
      if (seen.has(jobId)) continue;
      node.style.width = '0%';
      window.setTimeout(() => node.remove(), durationMs + 60);
    }
  }

  /** Numerals sit at the left edge of their segment, nudged right only where they would collide. */
  private placeNumerals(): void {
    const snapshot = this.current!;
    const { granted, settled, reserved } = snapshot;
    const width = this.bar.clientWidth;
    if (width === 0 || granted <= 0n) return;
    const ideal = [0, Number(settled) / Number(granted), Number(settled + reserved) / Number(granted)].map(
      (fraction) => fraction * width,
    );
    const boxes = [this.numeralBoxes.settled, this.numeralBoxes.reserved, this.numeralBoxes.available];
    let cursor = 0;
    boxes.forEach((box, index) => {
      const left = Math.max(ideal[index]!, cursor);
      box.style.left = `${Math.min(left, Math.max(0, width - box.offsetWidth))}px`;
      cursor = left + box.offsetWidth + 10;
    });
  }

  private drawNumerals(durationMs: number): void {
    const snapshot = this.current!;
    this.placeNumerals();
    window.setTimeout(() => this.placeNumerals(), durationMs + 20);
    const pairs = [
      [this.numerals.settled, snapshot.settled],
      [this.numerals.reserved, snapshot.reserved],
      [this.numerals.available, snapshot.available],
    ] as const;
    for (const [node, value] of pairs) {
      const from = BigInt(node.dataset['micro'] ?? '0');
      node.dataset['micro'] = String(value);
      if (durationMs > 0 && !prefersReducedMotion()) {
        animateNumber(node, from, value, durationMs, (current) => credits(current));
      } else {
        node.textContent = credits(value);
      }
    }
  }

  /** Rebuilds the tab row in place, so a tab that opened a dialog still exists to take focus back. */
  private drawTabs(): void {
    const snapshot = this.current!;
    const existing = new Map(
      [...this.tabs.querySelectorAll<HTMLElement>('[data-tab]')].map((node) => [node.dataset['tab'] ?? '', node]),
    );
    for (const [jobId, node] of existing) {
      if (!snapshot.notches.some((notch) => notch.jobId === jobId)) node.closest('li')?.remove();
    }
    for (const notch of snapshot.notches) {
      const label = `Job ${notch.jobId}, ${units(notch.units, notch.unit)} ${unitLabel(notch.unit)} reserved`;
      const active = notch.status === 'leased' || notch.status === 'running';
      const found = existing.get(notch.jobId);
      if (found) {
        found.setAttribute('aria-label', label);
        found.classList.toggle('notch-tab-active', active);
        this.tabs.append(found.closest('li')!);
        continue;
      }
      const button = el(
        'button',
        { type: 'button', class: `notch-tab${active ? ' notch-tab-active' : ''}`, 'data-tab': notch.jobId, 'aria-label': label },
        [notch.jobId],
      );
      const outline = (on: boolean) => {
        const target = this.reservedSegment.querySelector<HTMLElement>(`[data-notch="${notch.jobId}"]`);
        target?.classList.toggle('notch-outlined', on);
      };
      button.addEventListener('mouseenter', () => outline(true));
      button.addEventListener('mouseleave', () => outline(false));
      button.addEventListener('focus', () => outline(true));
      button.addEventListener('blur', () => outline(false));
      button.addEventListener('click', () => this.openJob(notch.jobId));
      this.tabs.append(el('li', {}, [button]));
    }
  }

  private drawCaps(meter: MeterView, animate: boolean): void {
    const granted = BigInt(meter.granted_micro);
    const offset = BigInt(meter.period.soft_cap_offset_micro);
    const show = meter.cap_state !== 'under' && offset >= 0n && offset <= granted;
    if (show) {
      this.softCapMarker.style.left = percent(offset, granted);
      if (this.softCapMarker.hidden) {
        this.softCapMarker.hidden = false;
        if (animate && !prefersReducedMotion()) {
          this.softCapMarker.classList.add('fade-in');
          window.setTimeout(() => this.softCapMarker.classList.remove('fade-in'), SHORT_MS);
        }
        this.announce(`${teamName(meter.team_id)} passed its soft cap`);
      }
    } else {
      this.softCapMarker.hidden = true;
    }
    const throttled = meter.cap_state === 'hard_cap_reached';
    this.availableSegment.classList.toggle('seg-throttled', throttled);
    if (throttled && this.throttle.hidden) {
      this.announce(`${teamName(meter.team_id)} is throttled at its hard cap`);
    }
    this.throttle.hidden = !throttled;
    if (throttled) {
      this.throttle.textContent = `Hard cap reached — new jobs are throttled until ${periodEndDate(
        meter.period.label,
        meter.period.ends_at,
      )}`;
    }
  }

  private announce(message: string): void {
    this.announcer.textContent = message;
  }
}

function byJobNumber(a: string, b: string): number {
  return Number.parseInt(a.replace('j_', ''), 10) - Number.parseInt(b.replace('j_', ''), 10);
}

function sameBalances(a: Snapshot, b: Snapshot): boolean {
  return (
    a.granted === b.granted && a.settled === b.settled && a.reserved === b.reserved && a.available === b.available
  );
}
