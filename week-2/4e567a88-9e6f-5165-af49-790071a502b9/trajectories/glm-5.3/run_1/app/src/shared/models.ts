// The catalogue: published unit rules and input schemas.
// This module is the single place that decides estimated and billed units.

export type Modality = "image" | "video" | "audio";
export type UnitKind = "image" | "megapixel" | "video_second" | "audio_second";

export interface SchemaField {
  name: string;
  type: "string" | "integer" | "enum" | "media";
  title: string;
  description: string;
  required: boolean;
  default: string | number | null;
  min_length?: number;
  max_length?: number;
  minimum?: number;
  maximum?: number;
  enum?: (string | number)[];
  media_type?: "image";
}

export interface ModelDef {
  slug: string;
  name: string;
  modality: Modality;
  unit: UnitKind;
  unit_label: string;
  fields: SchemaField[];
}

/** An exact rational unit count, as numerator/denominator over a power of ten. */
export interface UnitCount {
  num: bigint;
  den: bigint;
}

export interface InputValue {
  [key: string]: unknown;
}

function fieldInput(input: InputValue, name: string): number {
  const v = input[name];
  return typeof v === "number" && Number.isInteger(v) ? v : Number(v) || 0;
}

/** Estimated units of a submission, exact as a rational. */
export function estimatedUnits(model: ModelDef, input: InputValue): UnitCount {
  switch (model.slug) {
    case "quill-still":
      return { num: BigInt(fieldInput(input, "num_images")), den: 1n };
    case "halftone-xl":
      return {
        num:
          BigInt(fieldInput(input, "width")) *
          BigInt(fieldInput(input, "height")) *
          BigInt(fieldInput(input, "num_images")),
        den: 1_000_000n,
      };
    case "reel-10":
      return { num: BigInt(fieldInput(input, "duration_seconds")), den: 1n };
    case "murmur-voice":
      return { num: BigInt(fieldInput(input, "max_seconds")), den: 1n };
    default:
      throw new Error(`unknown model ${model.slug}`);
  }
}

/** Billed units of a finished run, exact as a rational. */
export function billedUnits(model: ModelDef, input: InputValue): UnitCount {
  if (model.slug === "murmur-voice") {
    const max = BigInt(fieldInput(input, "max_seconds"));
    const text = typeof input.text === "string" ? input.text : "";
    const chars = BigInt([...text].length);
    const speech = chars <= 0n ? 0n : (chars + 14n) / 15n;
    return { num: max < speech ? max : speech, den: 1n };
  }
  return estimatedUnits(model, input);
}

/** Units as an exact decimal string with no exponent and no trailing zeros. */
export function unitString(u: UnitCount): string {
  let num = u.num;
  const den = u.den;
  let digits = (num / den).toString();
  let rem = num % den;
  if (rem !== 0n) {
    digits += ".";
    let guard = 0;
    while (rem !== 0n && guard < 64) {
      rem *= 10n;
      digits += (rem / den).toString();
      rem %= den;
      guard++;
    }
  }
  return digits;
}

/** Units for display: whole for images, two decimals for megapixels, one for seconds. */
export function formatUnits(kind: UnitKind, u: UnitCount): string {
  switch (kind) {
    case "image":
      return (u.num / u.den).toString();
    case "megapixel":
      return (Number((u.num * 100n) / u.den) / 100).toFixed(2);
    case "video_second":
    case "audio_second":
      return (Number((u.num * 10n) / u.den) / 10).toFixed(1);
  }
}

export const CATALOGUE: ModelDef[] = [
  {
    slug: "quill-still",
    name: "Quill Still",
    modality: "image",
    unit: "image",
    unit_label: "images",
    fields: [
      { name: "prompt", type: "string", title: "Prompt", description: "What the image should show.", required: true, default: "", min_length: 1, max_length: 2000 },
      { name: "style", type: "enum", title: "Style", description: "Rendering style.", required: false, default: "photo", enum: ["photo", "illustration", "line art"] },
      { name: "num_images", type: "integer", title: "Number of images", description: "How many images to produce.", required: false, default: 1, minimum: 1, maximum: 8 },
    ],
  },
  {
    slug: "halftone-xl",
    name: "Halftone XL",
    modality: "image",
    unit: "megapixel",
    unit_label: "megapixels",
    fields: [
      { name: "prompt", type: "string", title: "Prompt", description: "What the image should show.", required: true, default: "", min_length: 1, max_length: 2000 },
      { name: "width", type: "enum", title: "Width", description: "Output width in pixels.", required: false, default: 1024, enum: [512, 768, 1024, 1536, 2048] },
      { name: "height", type: "enum", title: "Height", description: "Output height in pixels.", required: false, default: 1024, enum: [512, 768, 1024, 1536, 2048] },
      { name: "num_images", type: "integer", title: "Number of images", description: "How many images to produce.", required: false, default: 1, minimum: 1, maximum: 4 },
      { name: "init_image", type: "media", title: "Starting image", description: "Optional image to start from.", required: false, default: null, media_type: "image" },
    ],
  },
  {
    slug: "reel-10",
    name: "Reel 10",
    modality: "video",
    unit: "video_second",
    unit_label: "video-seconds",
    fields: [
      { name: "prompt", type: "string", title: "Prompt", description: "What the video should show.", required: true, default: "", min_length: 1, max_length: 2000 },
      { name: "duration_seconds", type: "enum", title: "Duration (seconds)", description: "Length of the video.", required: false, default: 5, enum: [5, 10] },
      { name: "start_image", type: "media", title: "Start frame", description: "Optional first frame.", required: false, default: null, media_type: "image" },
    ],
  },
  {
    slug: "murmur-voice",
    name: "Murmur Voice",
    modality: "audio",
    unit: "audio_second",
    unit_label: "audio-seconds",
    fields: [
      { name: "text", type: "string", title: "Script", description: "Text to speak.", required: true, default: "", min_length: 1, max_length: 2000 },
      { name: "voice", type: "enum", title: "Voice", description: "Voice to use.", required: false, default: "ash", enum: ["ash", "brook", "cove"] },
      { name: "max_seconds", type: "integer", title: "Maximum length (seconds)", description: "Longest audio to produce.", required: false, default: 30, minimum: 1, maximum: 120 },
    ],
  },
];

export function modelBySlug(slug: string): ModelDef | undefined {
  return CATALOGUE.find((m) => m.slug === slug);
}
