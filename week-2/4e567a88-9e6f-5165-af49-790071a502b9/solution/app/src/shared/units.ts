// The published unit rules: how each model's estimated and billed units follow from its input.
// Units are held as micro-units (units × 1,000,000) so megapixels stay exact.

import { MICRO, roundHalfUp } from "./money";

export type Unit = "image" | "megapixel" | "video_second" | "audio_second";
type RunInput = Readonly<Record<string, string | number>>;

export const UNIT_LABELS: Record<Unit, string> = {
  image: "images",
  megapixel: "megapixels",
  video_second: "video-seconds",
  audio_second: "audio-seconds",
};

interface UnitRule {
  unit: Unit;
  estimate: (input: RunInput) => bigint;
  bill: (input: RunInput) => bigint;
}

const whole = (input: RunInput, field: string): bigint => BigInt(input[field]);

function spokenSeconds(input: RunInput): bigint {
  const characters = BigInt([...String(input.text)].length);
  const needed = (characters + 14n) / 15n;
  const cap = whole(input, "max_seconds");
  return needed < cap ? needed : cap;
}

export const UNIT_RULES: Record<string, UnitRule> = {
  "quill-still": {
    unit: "image",
    estimate: (input) => whole(input, "num_images") * MICRO,
    bill: (input) => whole(input, "num_images") * MICRO,
  },
  "halftone-xl": {
    unit: "megapixel",
    // width × height × num_images ÷ 1,000,000 megapixels, i.e. exactly that many micro-units.
    estimate: (input) => whole(input, "width") * whole(input, "height") * whole(input, "num_images"),
    bill: (input) => whole(input, "width") * whole(input, "height") * whole(input, "num_images"),
  },
  "reel-10": {
    unit: "video_second",
    estimate: (input) => whole(input, "duration_seconds") * MICRO,
    bill: (input) => whole(input, "duration_seconds") * MICRO,
  },
  "murmur-voice": {
    unit: "audio_second",
    estimate: (input) => whole(input, "max_seconds") * MICRO,
    bill: (input) => spokenSeconds(input) * MICRO,
  },
};

/** Exact decimal string with no exponent and no trailing zeros: "6.291456", "2". */
export function unitsText(unitsMicro: bigint): string {
  const integer = unitsMicro / MICRO;
  const fraction = (unitsMicro % MICRO).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : `${integer}`;
}

export function parseUnitsText(text: string): bigint {
  const [integer, fraction = ""] = text.split(".");
  return BigInt(integer) * MICRO + BigInt(fraction.padEnd(6, "0"));
}

/** Display: whole images, megapixels with two decimals, seconds with one decimal (half up). */
export function formatUnits(unitsMicro: bigint, unit: Unit): string {
  if (unit === "image") return (unitsMicro / MICRO).toString();
  const decimals = unit === "megapixel" ? 2 : 1;
  const step = 10n ** BigInt(decimals);
  const scaled = roundHalfUp(unitsMicro * step, MICRO);
  return `${scaled / step}.${(scaled % step).toString().padStart(decimals, "0")}`;
}

/** "10.0 video-seconds" */
export function unitsPhrase(unitsMicro: bigint, unit: Unit): string {
  return `${formatUnits(unitsMicro, unit)} ${UNIT_LABELS[unit]}`;
}
