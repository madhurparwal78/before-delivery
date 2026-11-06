import { formatMoney, money, parseAmount, sharePercent, type Currency } from "../shared/money.js";
import { prefersReducedMotion, qsa } from "./dom.js";

export interface SheetFigures {
  currency: Currency;
  leftLabel: string;
  rightLabel: string;
  leftMinor: bigint;
  rightMinor: bigint;
  creaseShare: string;
}

const CREASE_MS = 330;
const COUNT_MS = 670;
const FLATTEN_MS = 200;
const MAX_TILT = 18;

function easeOut(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

function setText(region: HTMLElement, selector: string, text: string): void {
  for (const node of qsa<HTMLElement>(selector, region)) node.textContent = text;
}

function currentMinor(region: HTMLElement, selector: string, currency: Currency): bigint {
  const node = region.querySelector<HTMLElement>(selector);
  const text = node?.textContent?.trim() ?? "";
  if (!text) return 0n;
  const negative = text.startsWith("-");
  const digits = text.replace(/^-/, "").replace(/^[A-Z]{3}\s*/, "");
  const normalized =
    currency === "ARS" ? digits.replace(/\./g, "").replace(",", ".") : digits.replace(/,/g, "");
  const parsed = parseAmount(currency, normalized);
  if (!parsed) return 0n;
  return negative && parsed.minor > 0n ? -parsed.minor : parsed.minor;
}

export class QuoteSheet {
  private readonly region: HTMLElement;
  private frame = 0;
  private currency: Currency = "USD";

  constructor(region: HTMLElement) {
    this.region = region;
  }

  element(): HTMLElement {
    return this.region;
  }

  private stop(): void {
    if (this.frame) {
      window.cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
  }

  private setCrease(share: string): void {
    this.region.dataset.crease = share;
    const sheet = this.region.querySelector<HTMLElement>("[data-sheet]");
    sheet?.style.setProperty("--crease", `${share}%`);
  }

  private setTilt(degrees: number): void {
    this.region.dataset.tilt = degrees.toFixed(0);
    const sheet = this.region.querySelector<HTMLElement>("[data-sheet]");
    sheet?.style.setProperty("--tilt", `${degrees}deg`);
  }

  /** Step 1: the sheet lies flat with the quoting label while a request is in flight. */
  quoting(): void {
    this.stop();
    this.region.dataset.state = "quoting";
    if (prefersReducedMotion()) {
      this.setTilt(0);
      return;
    }
    const startTilt = Number(this.region.dataset.tilt ?? "0");
    const started = performance.now();
    const step = (now: number): void => {
      const progress = Math.min(1, (now - started) / FLATTEN_MS);
      this.setTilt(startTilt * (1 - progress));
      if (progress < 1) this.frame = window.requestAnimationFrame(step);
      else this.frame = 0;
    };
    this.frame = window.requestAnimationFrame(step);
  }

  outage(text: string): void {
    this.stop();
    this.region.dataset.state = "outage";
    this.setTilt(0);
    setText(this.region, "[data-quote-flag]", text);
  }

  labels(leftLabel: string, rightLabel: string): void {
    for (const node of qsa<HTMLElement>("[aria-label]", this.region)) {
      if (node.getAttribute("role") === "group") {
        if (node.classList.contains("sheet-panel-left")) node.setAttribute("aria-label", leftLabel);
        if (node.classList.contains("sheet-panel-right")) node.setAttribute("aria-label", rightLabel);
      }
    }
    const panelLabels = qsa<HTMLElement>(".panel-label", this.region);
    if (panelLabels[0]) panelLabels[0].textContent = leftLabel;
    if (panelLabels[1]) panelLabels[1].textContent = rightLabel;
    const headers = qsa<HTMLElement>(".quote-table thead th", this.region);
    if (headers[0]) headers[0].textContent = leftLabel;
    if (headers[1]) headers[1].textContent = rightLabel;
  }

  /** Steps 2 and 3: the crease slides, the panels tilt open and the numerals count up. */
  show(figures: SheetFigures): void {
    this.stop();
    this.currency = figures.currency;
    this.labels(figures.leftLabel, figures.rightLabel);
    this.region.dataset.state = "ready";
    const fromLeft = currentMinor(this.region, "[data-quote-left]", figures.currency);
    const fromRight = currentMinor(this.region, "[data-quote-right]", figures.currency);
    const fromCrease = Number(this.region.dataset.crease ?? "0");
    const targetCrease = Number(figures.creaseShare);

    const paint = (leftMinor: bigint, rightMinor: bigint): void => {
      setText(this.region, "[data-quote-left]", formatMoney(money(figures.currency, leftMinor)));
      setText(this.region, "[data-quote-right]", formatMoney(money(figures.currency, rightMinor)));
      setText(
        this.region,
        "[data-quote-total]",
        formatMoney(money(figures.currency, leftMinor + rightMinor)),
      );
    };

    if (prefersReducedMotion()) {
      this.setCrease(figures.creaseShare);
      this.setTilt(0);
      paint(figures.leftMinor, figures.rightMinor);
      return;
    }

    const started = performance.now();
    const step = (now: number): void => {
      const elapsed = now - started;
      const creaseProgress = easeOut(Math.min(1, elapsed / CREASE_MS));
      const crease = fromCrease + (targetCrease - fromCrease) * creaseProgress;
      this.setCrease(crease.toFixed(1));
      this.setTilt(MAX_TILT * creaseProgress);
      const countProgress = easeOut(Math.min(1, elapsed / COUNT_MS));
      const scale = BigInt(Math.round(countProgress * 10000));
      const leftMinor = fromLeft + ((figures.leftMinor - fromLeft) * scale) / 10000n;
      const rightMinor = fromRight + ((figures.rightMinor - fromRight) * scale) / 10000n;
      paint(leftMinor, rightMinor);
      if (elapsed < COUNT_MS) {
        this.frame = window.requestAnimationFrame(step);
      } else {
        this.setCrease(figures.creaseShare);
        this.setTilt(MAX_TILT);
        paint(figures.leftMinor, figures.rightMinor);
        this.frame = 0;
      }
    };
    this.frame = window.requestAnimationFrame(step);
  }
}

export function purchaseFigures(input: {
  currency: Currency;
  dueNow: string;
  dueAtLaunch: string;
  total: string;
}): SheetFigures {
  const dueNow = parseAmount(input.currency, input.dueNow);
  const dueAtLaunch = parseAmount(input.currency, input.dueAtLaunch);
  const total = parseAmount(input.currency, input.total);
  return {
    currency: input.currency,
    leftLabel: "Due now",
    rightLabel: "Due at launch",
    leftMinor: dueNow?.minor ?? 0n,
    rightMinor: dueAtLaunch?.minor ?? 0n,
    creaseShare: sharePercent(dueNow?.minor ?? 0n, total?.minor ?? 0n),
  };
}

export function changeFigures(input: {
  currency: Currency;
  credit: string;
  charge: string;
  creditShare: string;
}): SheetFigures {
  const credit = parseAmount(input.currency, input.credit);
  const charge = parseAmount(input.currency, input.charge);
  return {
    currency: input.currency,
    leftLabel: "Credit",
    rightLabel: "New plan charge",
    leftMinor: credit?.minor ?? 0n,
    rightMinor: charge?.minor ?? 0n,
    creaseShare: input.creditShare,
  };
}
