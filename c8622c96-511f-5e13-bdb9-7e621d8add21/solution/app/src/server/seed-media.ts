// Seeded frames are halftones drawn at first serve and written to storage with their derivatives.
// The covers of essays on the contact sheet are drawn first, and a media request for a seeded frame that is
// not drawn yet draws it at once, so a freshly seeded sheet shows its imagery without waiting for the rest.
import { query } from "./db.js";
import { drawSeedFrame } from "./images.js";
import { ON_SHEET } from "./lifecycle.js";
import { keys, objectExists, putObject, VARIANTS } from "./s3.js";
import { SEED_ESSAYS, SEED_FRAME_SIZE } from "./schema.js";

interface SeedFrame {
  id: string;
  essay_id: string;
  /** The frame's seeded position, which decides what is drawn. */
  n: number;
}

/** A frame the seed created (`<essay id>-f<n>` within the seeded frame count), as opposed to an upload. */
export function seedFrameOf(frame: { id: string; essay_id: string }): SeedFrame | null {
  const seed = SEED_ESSAYS.find((e) => e.id === frame.essay_id);
  const n = Number(/-f(\d+)$/.exec(frame.id)?.[1]);
  return seed && frame.id === `${seed.id}-f${n}` && n >= 1 && n <= seed.frames ? { ...frame, n } : null;
}

const drawing = new Map<string, Promise<void>>();

/** Draws one seeded frame into storage; concurrent callers in this process share the draw. */
export function drawSeededFrame(frame: SeedFrame): Promise<void> {
  const known = drawing.get(frame.id);
  if (known) return known;
  const draw = (async () => {
    const drawn = await drawSeedFrame(frame.essay_id, frame.n, SEED_FRAME_SIZE.width, SEED_FRAME_SIZE.height);
    if (!drawn) return;
    await putObject(keys.original(frame.essay_id, frame.id), Buffer.from(drawn.original), "image/jpeg");
    for (const variant of VARIANTS) {
      await putObject(keys.derivative(frame.essay_id, frame.id, variant), Buffer.from(drawn.derivatives[variant]), "image/jpeg");
    }
    await query("UPDATE frames SET bytes = $2 WHERE id = $1", [frame.id, drawn.original.length]);
  })();
  drawing.set(frame.id, draw);
  draw.catch(() => drawing.delete(frame.id));
  return draw;
}

let complete = false;

/** Re-run until every seeded frame of an essay that still shows imagery is in the bucket. */
export async function seedMedia(): Promise<void> {
  if (complete) return;
  const frames = await query<{ id: string; essay_id: string; position: number }>(
    `SELECT f.id, f.essay_id, f.position FROM frames f JOIN essays e ON e.id = f.essay_id
     WHERE f.essay_id = ANY($1) AND e.state <> 'taken_down'
     ORDER BY e.state = ANY($2) DESC, f.position, f.essay_id`, [SEED_ESSAYS.map((e) => e.id), ON_SHEET]);
  const missing: SeedFrame[] = [];
  for (const frame of frames) {
    const seeded = seedFrameOf(frame);
    if (seeded && !(await objectExists(keys.derivative(frame.essay_id, frame.id, "preview")))) missing.push(seeded);
  }
  await Promise.all(missing.map(drawSeededFrame));
  complete = true;
}
