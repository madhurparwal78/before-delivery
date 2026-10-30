/**
 * The Frame Odometer: average-frames digits roll column by column, the tier
 * pattern and label swap after they settle, and the payable total rolls the
 * same way. With reduced motion everything changes at once and the change is
 * logged instead.
 */

import { addStrengthChangeNote, announceStrength, h, reducedMotion } from "./ui.ts";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

export const TIER_LABELS: Record<string, string> = {
  none: "None",
  reduced: "Reduced",
  standard: "Standard",
  bonus: "Bonus",
};

export function tierPattern(tier: string | null): string {
  if (tier === null) return "pattern-uninspected";
  if (tier === "none") return "pattern-none";
  if (tier === "reduced") return "pattern-reduced";
  if (tier === "standard") return "pattern-standard";
  return "pattern-bonus";
}

export function tierLabel(tier: string | null): string {
  return tier === null ? "Not inspected" : TIER_LABELS[tier] ?? String(tier);
}

interface Column {
  wrap: HTMLElement;
  strip: HTMLElement;
  digit: number;
}

type Cell = number | string;

function makeColumn(): Column {
  const strip = h("span", { class: "digit-strip" });
  DIGITS.forEach((digit, index) => {
    strip.append(h("span", { text: digit, class: index === 0 ? "current" : "" }));
  });
  const wrap = h("span", { class: "digit-column" }, strip);
  return { wrap, strip, digit: 0 };
}

function place(strip: HTMLElement, digit: number): void {
  strip.style.transform = `translateY(${-digit}em)`;
  for (const span of strip.children) {
    (span as HTMLElement).classList.remove("current");
  }
  (strip.children[digit] as HTMLElement | undefined)?.classList.add("current");
}

/** Digits become numbers, every other character stays as literal text. */
function structureOf(text: string): Cell[] {
  return text.split("").map((char) => (/[0-9]/.test(char) ? Number(char) : char));
}

export interface OdometerHandle {
  element: HTMLElement;
  /** Settles on a server value, rolling from whatever is showing. */
  settle(value: number | null): void;
  /** Starts a provisional roll toward a local prediction and dims. */
  rollProvisional(predicted: number | null): void;
  /** Rolls back to the value shown before the provisional roll. */
  rollback(): void;
  readonly showing: number | null;
}

/**
 * Builds a rolling figure, e.g. "7.6" or "$1,234.50". The rightmost column
 * starts first, each column to its left follows ~40ms later, a one-digit step
 * takes ~0.3s and the longest travel ~0.8s. The whole sequence ends well
 * within two seconds.
 */
export function makeOdometer(initial: number | null, format: (value: number) => string): OdometerHandle {
  const element = h("span", { class: "readout" });
  let columns: Column[] = [];
  let cells: Cell[] = [];
  let settled: number | null = initial;
  let beforeProvisional: number | null = initial;

  const rebuild = (value: number | null): void => {
    element.textContent = "";
    columns = [];
    if (value === null) {
      element.textContent = "—";
      cells = [];
      return;
    }
    cells = structureOf(format(value));
    for (const cell of cells) {
      if (typeof cell === "number") {
        const column = makeColumn();
        columns.push(column);
        place(column.strip, cell);
        column.digit = cell;
        element.append(column.wrap);
      } else {
        element.append(document.createTextNode(String(cell)));
      }
    }
  };

  const roll = (from: number | null, to: number | null): void => {
    if (to === null || from === null) {
      rebuild(to);
      return;
    }
    const fromText = format(from);
    const toText = format(to);
    // A different shape (digit count or separators) cannot roll; it settles.
    if (fromText.replace(/[0-9]/g, "d") !== toText.replace(/[0-9]/g, "d")) {
      rebuild(to);
      return;
    }
    const target = structureOf(toText);
    let columnIndex = -1;
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index]!;
      if (typeof cell !== "number") continue;
      columnIndex += 1;
      const column = columns[columnIndex]!;
      const targetDigit = target[index] as number;
      if (column.digit === targetDigit) continue;
      const distance = Math.abs(targetDigit - column.digit);
      place(column.strip, column.digit);
      // Force a reflow so the reset applies before the travel starts.
      void column.strip.offsetWidth;
      const delay = (columns.length - 1 - columnIndex) * 40;
      const duration = 300 + (distance - 1) * 62.5;
      column.strip.style.transitionDelay = `${delay}ms`;
      column.strip.style.transitionDuration = `${duration}ms`;
      place(column.strip, targetDigit);
      column.digit = targetDigit;
    }
    cells = target;
  };

  rebuild(initial);

  return {
    element,
    get showing(): number | null {
      return settled;
    },
    settle(value: number | null): void {
      const from = settled;
      element.classList.remove("dim");
      settled = value;
      roll(from, value);
    },
    rollProvisional(predicted: number | null): void {
      beforeProvisional = settled;
      const from = settled;
      element.classList.add("dim");
      settled = predicted;
      roll(from, predicted);
    },
    rollback(): void {
      const from = settled;
      settled = beforeProvisional;
      element.classList.remove("dim");
      roll(from, settled);
    },
  };
}

export interface BlockReadout {
  blockId: string;
  blockName: string;
  container: HTMLElement;
  chip: HTMLElement;
  meter: HTMLElement;
  average: OdometerHandle;
  currentAverage: number | null;
  currentTier: string | null;
  update(data: { average_frames: number | null; tier: string | null }, options: {
    provisional?: boolean;
    announce?: boolean;
    payableText?: string;
    onTierSettled?: (tier: string | null) => void;
  }): void;
}

/**
 * One block's readout: the rolling average digits, the tier label chip and the
 * meter that takes the server value as soon as the roll begins.
 */
export function makeBlockReadout(block: { id: string; name: string }, initial: {
  average_frames: number | null;
  tier: string | null;
}): BlockReadout {
  const average = makeOdometer(initial.average_frames, (value) => value.toFixed(1));
  const chip = h("span", { class: "tier-chip", text: tierLabel(initial.tier) });
  const meterValueText = initial.average_frames === null
    ? "Not inspected"
    : `${initial.average_frames.toFixed(1)} frames, ${tierLabel(initial.tier)}`;
  const meter = h("div", {
    role: "meter",
    "aria-label": `Average frames, ${block.name}`,
    "aria-valuemin": "0",
    "aria-valuemax": "20",
    "aria-valuenow": initial.average_frames === null ? "" : String(initial.average_frames),
    "aria-valuetext": meterValueText,
  }, average.element);
  const container = h("div", {}, meter, chip);
  const readout: BlockReadout = {
    blockId: block.id,
    blockName: block.name,
    container,
    chip,
    meter,
    average,
    currentAverage: initial.average_frames,
    currentTier: initial.tier,
    update(data, options) {
      const oldAverage = readout.currentAverage;
      const oldTier = readout.currentTier;
      if (options.provisional) {
        average.rollProvisional(data.average_frames);
      } else {
        average.settle(data.average_frames);
      }
      readout.meter.setAttribute("aria-valuenow", data.average_frames === null ? "" : String(data.average_frames));
      readout.meter.setAttribute(
        "aria-valuetext",
        data.average_frames === null
          ? "Not inspected"
          : `${data.average_frames.toFixed(1)} frames, ${tierLabel(data.tier)}`,
      );
      const applyTier = () => {
        readout.chip.textContent = tierLabel(data.tier);
        options.onTierSettled?.(data.tier);
      };
      if (oldTier !== data.tier) {
        if (reducedMotion()) {
          applyTier();
        } else {
          // About 0.3s after the digits settle the pattern cross-fades.
          window.setTimeout(applyTier, 1100);
        }
      }
      readout.currentAverage = data.average_frames;
      readout.currentTier = data.tier;
      if (reducedMotion()) {
        addStrengthChangeNote({
          blockName: readout.blockName,
          oldAverage: oldAverage === null ? "no samples" : oldAverage.toFixed(1),
          newAverage: data.average_frames === null ? "no samples" : data.average_frames.toFixed(1),
          oldTier: tierLabel(oldTier),
          newTier: tierLabel(data.tier),
        });
      }
      if (options.announce) {
        const text = data.average_frames === null
          ? `${readout.blockName}: no samples, Not inspected. Orchard payable ${options.payableText ?? ""}.`
          : `${readout.blockName}: ${data.average_frames.toFixed(1)} frames, ${tierLabel(data.tier)}. Orchard payable ${options.payableText ?? ""}.`;
        window.setTimeout(() => {
          announceStrength(text);
        }, reducedMotion() ? 50 : 1300);
      }
    },
  };
  return readout;
}
