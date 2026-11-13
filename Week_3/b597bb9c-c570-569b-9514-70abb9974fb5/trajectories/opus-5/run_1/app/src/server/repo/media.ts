import { query } from '../db.js';
import { exactRate, FRAME_RATES, roundRational, type FrameRateName } from '../../domain/rate.js';
import { PNG_SOURCE_SECONDS, sourceFrames } from '../../domain/media-header.js';
import type { MediaHeader } from '../../domain/media-header.js';
import type { MediaInfo } from '../../domain/timeline-state.js';
import type { MediaKind, MediaRecord } from '../../shared/types.js';

export interface MediaRow {
  id: string;
  name: string;
  kind: MediaKind;
  folder: string;
  bytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  sample_rate: number | null;
  header: Record<string, number>;
}

function headerOf(row: MediaRow): MediaHeader {
  if (row.kind === 'mp4') {
    return {
      kind: 'mp4',
      width: row.header.width ?? row.width ?? 0,
      height: row.header.height ?? row.height ?? 0,
      timescale: row.header.timescale,
      duration: row.header.duration,
    };
  }
  if (row.kind === 'wav') {
    return {
      kind: 'wav',
      sample_rate: row.header.sample_rate,
      channels: row.header.channels,
      bits: row.header.bits,
      samples: row.header.samples,
      data_offset: row.header.data_offset,
      block_align: row.header.block_align,
    };
  }
  return { kind: 'png', width: row.header.width, height: row.header.height };
}

export function mediaInfoOf(row: MediaRow): MediaInfo {
  const header = headerOf(row);
  const frames = {} as Record<FrameRateName, number>;
  for (const name of FRAME_RATES) {
    const rate = exactRate(name);
    frames[name] =
      row.kind === 'png' ? roundRational(BigInt(PNG_SOURCE_SECONDS) * rate.num, rate.den) : sourceFrames(header, rate);
  }
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    sha256: row.sha256,
    width: row.width,
    height: row.height,
    source_frames: frames,
  };
}

export async function loadMediaRows(): Promise<MediaRow[]> {
  return query<MediaRow>(
    `select id, name, kind, folder, bytes, sha256, width, height, duration_seconds, sample_rate, header
     from media order by folder, name`,
  );
}

export async function loadMediaInfo(): Promise<Map<string, MediaInfo>> {
  const rows = await loadMediaRows();
  return new Map(rows.map((row) => [row.id, mediaInfoOf(row)]));
}

/** Which projects use each file, by clip or by cut snapshot, in title order. */
export async function usedIn(): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const add = (mediaId: string, title: string): void => {
    const list = map.get(mediaId) ?? [];
    if (!list.includes(title)) list.push(title);
    map.set(mediaId, list);
  };
  const rows = await query<{ media_id: string; title: string }>(
    `select distinct c.media_id, p.title from clips c join projects p on p.id = c.project_id
     where c.media_id is not null order by p.title`,
  );
  for (const row of rows) add(row.media_id, row.title);
  const cuts = await query<{ snapshot: { clips: { media_id: string | null }[] }; title: string }>(
    `select c.snapshot, p.title from cuts c join projects p on p.id = c.project_id order by p.title`,
  );
  for (const cut of cuts) {
    for (const clip of cut.snapshot.clips) {
      if (clip.media_id !== null) add(clip.media_id, cut.title);
    }
  }
  for (const [id, titles] of map) map.set(id, titles.sort((a, b) => a.localeCompare(b)));
  return map;
}

export function mediaRecord(row: MediaRow, used: string[]): MediaRecord {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    folder: row.folder,
    bytes: Number(row.bytes),
    sha256: row.sha256,
    width: row.width,
    height: row.height,
    duration_seconds: row.duration_seconds === null ? null : Number(Number(row.duration_seconds).toFixed(3)),
    sample_rate: row.sample_rate,
    used_in: used,
  };
}
