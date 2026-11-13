/**
 * The export manifest: one per cut and size, with frame totals and a checksum of
 * its own canonical form.
 */
import { createHash } from 'node:crypto';
import { rateFraction, roundRational, type ExactRate } from './rate.js';
import type { TimelineSnapshot } from './timeline-state.js';
import type { AspectRatio, ExportSize, KeyframeMap, RowKind } from '../shared/types.js';

export interface ManifestItem {
  clip_id: string;
  name: string;
  kind: string;
  media_sha256: string | null;
  start_frame: number;
  end_frame: number;
  source_in: number;
  source_out: number;
  speed_percent: number;
  hidden: boolean;
  keyframes: KeyframeMap;
}

export interface Manifest {
  project: { id: string; title: string };
  cut: { id: string; name: string };
  frame_rate: string;
  size: number;
  width: number;
  height: number;
  total_frames: number;
  rows: { row_id: string; name: string; kind: RowKind; items: ManifestItem[] }[];
  captions: { row_id: string; start_frame: number; end_frame: number; text: string }[];
  checksum: string;
}

const ASPECT_PARTS: Record<AspectRatio, [number, number]> = {
  '16:9': [16, 9],
  '9:16': [9, 16],
  '1:1': [1, 1],
  '4:5': [4, 5],
};

/** The size is the short side; the long side is the short side × the aspect ratio. */
export function exportFrameSize(size: ExportSize, aspect: AspectRatio): { width: number; height: number } {
  const [wide, tall] = ASPECT_PARTS[aspect];
  if (wide >= tall) {
    return { width: roundRational(BigInt(size) * BigInt(wide), BigInt(tall)), height: size };
  }
  return { width: size, height: roundRational(BigInt(size) * BigInt(tall), BigInt(wide)) };
}

function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${sortedJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export interface ManifestInput {
  project: { id: string; title: string; aspect_ratio: AspectRatio };
  cut: { id: string; name: string; total_frames: number };
  snapshot: TimelineSnapshot;
  size: ExportSize;
  rate: ExactRate;
  checksumOf: (mediaId: string | null) => string | null;
}

export function buildManifest(input: ManifestInput): Manifest {
  const size = exportFrameSize(input.size, input.project.aspect_ratio);
  const rows = [...input.snapshot.rows]
    .sort((a, b) => a.position - b.position)
    .map((row) => ({
      row_id: row.id,
      name: row.name,
      kind: row.kind,
      items: input.snapshot.clips
        .filter((clip) => clip.row_id === row.id)
        .sort((a, b) => a.start_frame - b.start_frame || a.id.localeCompare(b.id))
        .map((clip) => ({
          clip_id: clip.id,
          name: clip.name,
          kind: clip.kind,
          media_sha256: input.checksumOf(clip.media_id),
          start_frame: clip.start_frame,
          end_frame: clip.end_frame,
          source_in: clip.source_in,
          source_out: clip.source_out,
          speed_percent: clip.speed_percent,
          hidden: clip.hidden,
          keyframes: clip.keyframes,
        })),
    }));
  const withoutChecksum = {
    project: { id: input.project.id, title: input.project.title },
    cut: { id: input.cut.id, name: input.cut.name },
    frame_rate: rateFraction(input.rate),
    size: input.size,
    width: size.width,
    height: size.height,
    total_frames: input.cut.total_frames,
    rows,
    captions: input.snapshot.captions
      .slice()
      .sort((a, b) => a.start_frame - b.start_frame)
      .map((caption) => ({
        row_id: caption.row_id,
        start_frame: caption.start_frame,
        end_frame: caption.end_frame,
        text: caption.text,
      })),
  };
  const checksum = createHash('sha256').update(sortedJson(withoutChecksum)).digest('hex');
  return { ...withoutChecksum, checksum: `sha256:${checksum}` };
}

export function manifestBytes(manifest: Manifest): Buffer {
  return Buffer.from(JSON.stringify(manifest), 'utf8');
}
