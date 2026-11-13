import { pool, query, readDeploymentState, writeDeploymentStateOnce } from '../db/index.js';
import { instantToWall, lisbonWallToInstant } from '../../shared/lisbon.js';
import { encodeNarration } from '../media/wav.js';
import { plateCaption, renderPlate } from '../media/plates.js';
import { putObject } from '../services/storage.js';
import { createUser, findUserByEmail } from '../services/pocketbase.js';
import {
  SEED_ACCOUNTS,
  SEED_CHAPTERS,
  SEED_EVENTS,
  SEED_PASSWORD,
  SEED_SESSIONS,
  SEED_SOURCES,
  type SeedSessionOffset,
} from './archive.js';

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

function sessionStart(firstRunMs: number, offset: SeedSessionOffset): number {
  if (offset.kind === 'minutes') {
    const target = firstRunMs + offset.minutes * MINUTE_MS;
    return Math.ceil(target / MINUTE_MS) * MINUTE_MS;
  }
  const wall = instantToWall(firstRunMs + offset.days * DAY_MS);
  const resolved = lisbonWallToInstant({
    year: wall.year,
    month: wall.month,
    day: wall.day,
    hour: offset.hour,
    minute: offset.minute,
    second: 0,
  });
  return resolved.kind === 'ok' ? resolved.instantMs : firstRunMs + offset.days * DAY_MS;
}

/** Creates whatever is missing and leaves whatever is there, on every start. */
export async function applyArchiveSeed(nowMs: number): Promise<void> {
  for (const chapter of SEED_CHAPTERS) {
    await pool.query(
      `INSERT INTO archive_chapters (number, numeral, title, era, body, sightline_deg, exhibit, status, owner_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'published', $8)
       ON CONFLICT (number) DO NOTHING`,
      [
        chapter.number,
        chapter.numeral,
        chapter.title,
        chapter.era,
        chapter.body,
        chapter.sightlineDeg,
        chapter.exhibit,
        chapter.ownerEmail,
      ],
    );
  }
  for (const source of SEED_SOURCES) {
    await pool.query(
      `INSERT INTO sources (id, ordinal, citation) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [source.id, source.ordinal, source.citation],
    );
  }
  for (const event of SEED_EVENTS) {
    const owner = SEED_CHAPTERS.find((chapter) => chapter.number === event.chapter)?.ownerEmail;
    await pool.query(
      `INSERT INTO timeline_events (id, chapter, year, title, summary, source_ids, status, owner_email)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'published', $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        event.id,
        event.chapter,
        event.year,
        event.title,
        event.summary,
        JSON.stringify(event.sourceIds),
        owner ?? SEED_CHAPTERS[0]?.ownerEmail ?? '',
      ],
    );
  }
  const firstRun = await writeDeploymentStateOnce('seed_first_run', { atMs: nowMs });
  for (const session of SEED_SESSIONS) {
    await pool.query(
      `INSERT INTO guided_sessions (id, title, starts_at, duration_minutes, capacity)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [
        session.id,
        session.title,
        new Date(sessionStart(firstRun.atMs, session.offset)),
        session.durationMinutes,
        session.capacity,
      ],
    );
  }
}

/** The six seeded people. Staff never self-register, so these are the only staff accounts. */
export async function applyAccountSeed(): Promise<void> {
  for (const account of SEED_ACCOUNTS) {
    const existing = await findUserByEmail(account.email);
    if (existing) continue;
    await createUser({ name: account.name, email: account.email, password: SEED_PASSWORD, role: account.role });
  }
}

/** Plates and narration for every chapter, stored in MinIO once it can be reached. */
export async function applyMediaSeed(): Promise<void> {
  const seeded = await readDeploymentState<{ done: boolean }>('seed_media');
  if (seeded?.done) return;
  for (const chapter of SEED_CHAPTERS) {
    const itemId = `chapter-${chapter.number}`;
    const existing = await query<{ id: string }>(
      `SELECT id FROM media WHERE item_id = $1 AND kind IN ('image', 'narration')`,
      [itemId],
    );
    if (existing.length >= 4) continue;
    for (let plateIndex = 0; plateIndex < 3; plateIndex += 1) {
      const id = `media-chapter-${chapter.number}-plate-${plateIndex + 1}`;
      const filename = `chapter-${chapter.number}-plate-${plateIndex + 1}.png`;
      const body = renderPlate(chapter.number, plateIndex);
      const objectKey = `media/${id}/${filename}`;
      await putObject(objectKey, body, 'image/png');
      await pool.query(
        `INSERT INTO media (id, kind, item_type, item_id, filename, bytes, content_type, object_key, caption, ordinal)
         VALUES ($1, 'image', 'chapter', $2, $3, $4, 'image/png', $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [id, itemId, filename, body.length, objectKey, plateCaption(chapter.number, plateIndex), plateIndex],
      );
    }
    const narrationId = `media-chapter-${chapter.number}-narration`;
    const narrationName = `chapter-${chapter.number}-narration.wav`;
    const audio = encodeNarration(chapter.number, 6);
    const narrationKey = `media/${narrationId}/${narrationName}`;
    await putObject(narrationKey, audio, 'audio/wav');
    await pool.query(
      `INSERT INTO media (id, kind, item_type, item_id, filename, bytes, content_type, object_key, transcript, ordinal)
       VALUES ($1, 'narration', 'chapter', $2, $3, $4, 'audio/wav', $5, $6, 0)
       ON CONFLICT (id) DO NOTHING`,
      [narrationId, itemId, narrationName, audio.length, narrationKey, chapter.transcript],
    );
  }
  await writeDeploymentStateOnce('seed_media', { done: true });
}
