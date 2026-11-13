import type { App } from '../api/app.ts';
import { SEED_CHAPTERS, SEED_EVENTS, SEED_SOURCES, SEED_SESSIONS } from '../core/seed.ts';
import { computeWall } from '../core/time.ts';

/** Seed data: applied idempotently on every start. */

export async function seedDatabase(app: App): Promise<void> {
  await seedSources(app);
  await seedChapters(app);
  await seedEvents(app);
  await seedSessions(app);
  await seedMedia(app);
}

async function seedSources(app: App): Promise<void> {
  for (const s of SEED_SOURCES) {
    await app.pool.query(
      `INSERT INTO sources (id, citation) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`,
      [s.id, s.citation],
    );
  }
}

async function seedChapters(app: App): Promise<void> {
  for (const ch of SEED_CHAPTERS) {
    await app.pool.query(
      `INSERT INTO chapters (number, title, era, body, sightline_deg, exhibit, owner_email, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'published')
       ON CONFLICT (number) DO NOTHING`,
      [ch.number, ch.title, ch.era, ch.body, ch.sightlineDeg, ch.exhibit, ch.ownerEmail],
    );
    await app.pool.query(
      `UPDATE chapters SET status = 'published' WHERE number = $1 AND status = ''`,
      [ch.number],
    );
  }
}

async function seedEvents(app: App): Promise<void> {
  for (const ev of SEED_EVENTS) {
    const owner = SEED_CHAPTERS.find((c) => c.number === ev.chapter)?.ownerEmail ?? 'ines@halden.test';
    await app.pool.query(
      `INSERT INTO events (id, chapter, year, title, summary, owner_email, status)
       VALUES ($1,$2,$3,$4,$5,$6,'published')
       ON CONFLICT (id) DO NOTHING`,
      [ev.id, ev.chapter, ev.year, ev.title, ev.summary, owner],
    );
    for (const sid of ev.sourceIds) {
      await app.pool.query(
        `INSERT INTO event_sources (event_id, source_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [ev.id, sid],
      );
    }
  }
}

async function seedSessions(app: App): Promise<void> {
  const now = app.now();
  for (const ses of SEED_SESSIONS) {
    const exists = await app.pool.query(`SELECT id FROM sessions WHERE id = $1`, [ses.id]);
    if (exists.rows.length) continue;
    let startsAtMs: number;
    if (ses.roundedMinutes !== null) {
      // 20 minutes later, rounded up to the next whole minute
      const target = now + ses.roundedMinutes * 60_000;
      const r = computeWall(
        new Date(target).getUTCFullYear(),
        new Date(target).getUTCMonth() + 1,
        new Date(target).getUTCDate(),
        new Date(target).getUTCHours(),
        new Date(target).getUTCMinutes(),
        0,
      );
      startsAtMs = r.status === 'ok' ? r.ms : target;
    } else {
      // "plusDays later at 18:30" Lisbon
      const base = new Date(now + ses.plusDays * 86_400_000);
      const r = computeWall(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), ses.startsAtHour!, ses.startsAtMinute!, 0);
      startsAtMs = r.status === 'ok' ? r.ms : now + ses.plusDays * 86_400_000;
    }
    await app.pool.query(
      `INSERT INTO sessions (id, title, starts_at, duration_minutes, capacity) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO NOTHING`,
      [ses.id, ses.title, new Date(startsAtMs), ses.durationMinutes, ses.capacity],
    );
  }
}

async function seedMedia(app: App): Promise<void> {
  const { generatePlatePng, generateNarrationOgg } = await import('../services/media.ts');
  for (const ch of SEED_CHAPTERS) {
    // Plates: three procedural images with captions.
    for (let i = 0; i < ch.plates.length; i++) {
      const plate = ch.plates[i]!;
      const id = `plate-${ch.number}-${i + 1}`;
      const exists = await app.pool.query(`SELECT id FROM media WHERE id = $1`, [id]);
      const png = generatePlatePng(ch.number, i);
      const key = `media/${id}/plate-${ch.number}-${i + 1}.png`;
      if (!exists.rows.length) {
        try {
          await app.storage.put(key, png, 'image/png');
          await app.pool.query(
            `INSERT INTO media (id, kind, item_id, filename, bytes, content_type, storage_key, transcript)
             VALUES ($1,'image',$2,$3,$4,'image/png',$5,$6)`,
            [id, `chapter-${ch.number}`, `plate-${ch.number}-${i + 1}.png`, png.length, key, plate.caption],
          );
        } catch {
          /* storage unreachable at boot: retried on the next start */
        }
      }
    }
    // Narration: real audio with a transcript.
    const nid = `narration-${ch.number}`;
    const exists = await app.pool.query(`SELECT id FROM media WHERE id = $1`, [nid]);
    if (!exists.rows.length) {
      const ogg = generateNarrationOgg(ch.number);
      const key = `media/${nid}/narration-${ch.number}.ogg`;
      try {
        await app.storage.put(key, ogg, 'audio/ogg');
        await app.pool.query(
          `INSERT INTO media (id, kind, item_id, filename, bytes, content_type, storage_key, transcript)
           VALUES ($1,'narration',$2,$3,$4,'audio/ogg',$5,$6)`,
          [nid, `chapter-${ch.number}`, `narration-${ch.number}.ogg`, ogg.length, key, ch.narrationTranscript],
        );
      } catch {
        /* retried on the next start */
      }
    }
  }
}
