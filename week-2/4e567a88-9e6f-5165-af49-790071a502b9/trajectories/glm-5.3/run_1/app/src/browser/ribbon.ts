// The Reservation ribbon: drawn segments, notch tabs, announcements and motion.
import type { Meter } from "./types.js";
import { h, clear, fmtCredits } from "./lib.js";

type Announce = (text: string) => void;

const RIBBON_MS = 420;

export class Ribbon {
  private root: HTMLElement | null = null;
  private barEl!: HTMLElement;
  private settledEl!: HTMLElement;
  private reservedEl!: HTMLElement;
  private availableEl!: HTMLElement;
  private softCapEl!: HTMLElement;
  private tabsEl!: HTMLElement;
  private numsEl!: HTMLElement;
  private announceEl!: HTMLElement;
  private throttledNote!: HTMLElement;
  private periodEl!: HTMLElement;
  private last: Meter | null = null;
  private announce: Announce;
  private numeralState = new Map<string, { el: HTMLElement; value: number }>();

  constructor(announce: Announce) {
    this.announce = announce;
  }

  build(): HTMLElement {
    this.root = h("section", { class: "credit-meter", role: "region", "aria-label": "Credit meter" });
    const head = h("div", { class: "meter-head" },
      h("h2", { text: "Reservation ribbon" }),
      this.periodEl = h("span", { class: "meter-period" }),
    );

    this.numsEl = h("div", { class: "meter-nums" });
    this.barEl = h("div", { class: "meter-bar" });
    this.settledEl = h("div", { class: "meter-seg settled", role: "meter", "aria-label": "Settled", "aria-valuemin": "0" });
    this.reservedEl = h("div", { class: "meter-seg reserved", role: "meter", "aria-label": "Reserved", "aria-valuemin": "0" });
    this.availableEl = h("div", { class: "meter-seg available", role: "meter", "aria-label": "Available", "aria-valuemin": "0" });
    this.softCapEl = h("div", { class: "soft-cap-marker", role: "img", "aria-label": "Soft cap marker" });
    this.barEl.append(this.settledEl, this.reservedEl, this.availableEl, this.softCapEl);
    this.tabsEl = h("div", { class: "meter-tabs", role: "list", "aria-label": "In-flight jobs" });
    this.throttledNote = h("div", { class: "meter-throttled-note" });
    this.announceEl = h("div", { class: "visually-hidden", role: "status", "aria-label": "Meter announcements" });
    this.root.append(head, this.numsEl, this.barEl, this.tabsEl, this.throttledNote, this.announceEl);
    return this.root;
  }

  private reducedMotion(): boolean {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /** Apply a new meter reading: animate widths, count numerals, announce changes. */
  update(meter: Meter, onOpenJob: (jobId: string) => void): void {
    if (!this.root) return;
    const granted = Math.max(1, meter.granted_micro);
    const pct = (v: number) => `${(v / granted) * 100}%`;

    // Announce reserve / settle / release / replay / cap changes.
    if (this.last) {
      const before = new Map(this.last.in_flight.map((j) => [j.job_id, j]));
      const after = new Map(meter.in_flight.map((j) => [j.job_id, j]));
      for (const r of meter.recent_replays) {
        if (!this.last.recent_replays.some((o) => o.job_id === r.job_id)) {
          this.announce(`Job ${r.job_id} already reserved; nothing added`);
          this.flashReplay(r.job_id);
        }
      }
      for (const [id, job] of after) {
        if (!before.has(id)) {
          this.announce(`Job ${id} reserved ${job.estimated_units} ${unitLabelFor(job.unit)}, ${fmtCredits(meter.available_micro)} credits available`);
        }
      }
      for (const [id, job] of before) {
        if (!after.has(id)) {
          const settled = meter.settled_micro - this.last.settled_micro;
          if (settled > 0) {
            this.announce(`Job ${id} settled ${fmtCredits(settled)} credits, ${fmtCredits(meter.available_micro)} credits available`);
          } else {
            this.announce(`Job ${id} released ${fmtCredits(job.reserved_micro)} credits, ${fmtCredits(meter.available_micro)} credits available`);
          }
        }
      }
      if (this.last.cap_state === "under" && meter.cap_state === "soft_cap_passed") {
        this.announce(`${teamLabel()} passed its soft cap`);
      }
      if (meter.cap_state === "hard_cap_reached" && this.last.cap_state !== "hard_cap_reached") {
        this.announce(`${teamLabel()} is throttled at its hard cap`);
      }
    }

    // Segment widths with the published transition; numerals count with them.
    const transition = this.reducedMotion() ? "none" : `width ${RIBBON_MS}ms cubic-bezier(0.2, 0.6, 0.2, 1)`;
    this.applySeg(this.settledEl, pct(meter.settled_micro), meter.settled_micro, granted, transition, "Settled", "0%");
    this.applySeg(this.reservedEl, pct(meter.reserved_micro), meter.reserved_micro, granted, transition, "Reserved", pct(meter.settled_micro));
    this.applySeg(this.availableEl, pct(meter.available_micro), meter.available_micro, granted, transition, "Available", pct(meter.settled_micro + meter.reserved_micro));

    // Notches inside the reserved segment, in submission order.
    for (const notch of Array.from(this.reservedEl.querySelectorAll(".notch"))) notch.remove();
    let offset = 0;
    for (const job of meter.in_flight) {
      const notch = h("div", {
        class: `notch ${job.status === "queued" ? "queued" : ""}`,
        dataset: { jobId: job.job_id },
        style: `left:${(offset / granted) * 100}%; width:${(job.reserved_micro / granted) * 100}%;`,
      });
      offset += job.reserved_micro;
      this.reservedEl.appendChild(notch);
    }

    // Notch tabs, one per in-flight job in reserved order.
    clear(this.tabsEl);
    for (const job of meter.in_flight) {
      this.tabsEl.appendChild(h("button", {
        class: `notch-tab ${job.status === "queued" ? "queued" : "live"}`,
        role: "listitem",
        "aria-label": `Job ${job.job_id}, ${job.estimated_units} ${unitLabelFor(job.unit)} reserved`,
        text: job.job_id,
        dataset: { jobId: job.job_id },
        onclick: () => onOpenJob(job.job_id),
      }));
    }

    // Soft cap marker over the bar; hatching and note when throttled.
    const softShown = meter.cap_state !== "under" && meter.period.soft_cap_offset_micro >= 0 && meter.period.soft_cap_offset_micro <= meter.granted_micro;
    this.softCapEl.classList.toggle("shown", softShown);
    if (softShown) this.softCapEl.style.left = `${(meter.period.soft_cap_offset_micro / granted) * 100}%`;
    this.barEl.classList.toggle("throttled", meter.cap_state === "hard_cap_reached");
    if (meter.cap_state === "hard_cap_reached") {
      this.throttledNote.textContent = `Hard cap reached — new jobs are throttled until ${formatDateLong(new Date(meter.period.ends_at))}`;
      this.throttledNote.classList.add("shown");
    } else {
      this.throttledNote.classList.remove("shown");
    }
    this.periodEl.textContent = meter.period.label;

    this.last = meter;
  }

  private applySeg(seg: HTMLElement, width: string, value: number, granted: number, transition: string, label: string, left: string): void {
    seg.style.transition = transition;
    seg.style.width = width;
    seg.setAttribute("aria-valuenow", String(value));
    seg.setAttribute("aria-valuemax", String(granted));

    // A numeral sits above the bar, aligned to its segment's left edge.
    let entry = this.numeralState.get(label);
    if (!entry || !this.numsEl.contains(entry.el)) {
      const el = h("span", { class: "meter-num", text: `${label} ${fmtCredits(value)}` });
      el.style.position = "absolute";
      el.style.transition = this.reducedMotion() ? "none" : `left ${RIBBON_MS}ms cubic-bezier(0.2, 0.6, 0.2, 1)`;
      this.numsEl.appendChild(el);
      entry = { el, value };
      this.numeralState.set(label, entry);
    }
    entry.el.style.left = left;
    if (entry.value !== value) {
      if (this.reducedMotion()) {
        entry.el.textContent = `${label} ${fmtCredits(value)}`;
        entry.value = value;
      } else {
        this.countNumeral(entry.el, entry.value, value, label, RIBBON_MS);
        entry.value = value;
      }
    }
  }

  private countNumeral(el: HTMLElement, from: number, to: number, label: string, durationMs: number): void {
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = `${label} ${fmtCredits(Math.round(from + (to - from) * eased))}`;
      if (t < 1) requestAnimationFrame(step);
      else el.textContent = `${label} ${fmtCredits(to)}`;
    };
    requestAnimationFrame(step);
  }

  private flashReplay(jobId: string): void {
    window.setTimeout(() => {
      this.root?.querySelectorAll(`.notch[data-job-id="${jobId}"], .notch-tab[data-job-id="${jobId}"]`).forEach((el) => {
        el.classList.add("replay-flash");
        window.setTimeout(() => el.classList.remove("replay-flash"), 1000);
      });
    }, 30);
  }
}

export function unitLabelFor(unit: string): string {
  switch (unit) {
    case "image": return "images";
    case "megapixel": return "megapixels";
    case "video_second": return "video-seconds";
    case "audio_second": return "audio-seconds";
    default: return unit;
  }
}

function teamLabel(): string {
  const el = document.getElementById("member-team");
  return el && el.textContent ? el.textContent : "The team";
}

export function formatDateLong(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(d);
}
