import { DEFAULT_SETTINGS, formatDate } from '../shared/format.js';
import type { NumberFormat, TimeZone } from '../shared/types.js';
import { now } from './clock.js';
import { query } from './db.js';
import { closeShareStreams, publishShare } from './live.js';
import { enqueueMail } from './mail.js';
import { activeRooms, publishPresence } from './presence.js';

interface EndingLink {
  id: number;
  token: string;
  label: string;
  expires_at: Date;
  sprite_name: string;
  owner_email: string;
  owner_format: NumberFormat;
  owner_zone: TimeZone;
}

/** The server clock alone ends a link, and its owner hears about it once. */
async function endDueLinks(at: Date): Promise<void> {
  const due = await query<EndingLink>(
    `SELECT l.id, l.token, l.label, l.expires_at, s.name AS sprite_name,
            u.email AS owner_email, u.number_format AS owner_format, u.time_zone AS owner_zone
       FROM share_links l
       JOIN sprites s ON s.id = l.sprite_id
       JOIN projects p ON p.id = s.project_id
       JOIN users u ON u.id = p.owner_id
      WHERE l.state = 'active' AND l.expires_at IS NOT NULL AND l.expires_at <= $1`,
    [at],
  );
  for (const link of due) {
    const claimed = await query<{ id: number }>(
      `UPDATE share_links SET state = 'ended', end_notified = true
        WHERE id = $1 AND state = 'active' RETURNING id`,
      [link.id],
    );
    if (claimed.length === 0) continue;
    publishShare(link.token, { type: 'ended' });
    closeShareStreams(link.token);
    await enqueueMail(link.owner_email, `Read-only link ended: ${link.sprite_name}`, [
      `Link: ${link.label}`,
      `Ended: ${formatDate(link.expires_at, {
        number_format: link.owner_format ?? DEFAULT_SETTINGS.number_format,
        time_zone: link.owner_zone ?? DEFAULT_SETTINGS.time_zone,
      })}`,
    ]);
  }
}

export function startClockWork(): void {
  const tick = async (): Promise<void> => {
    try {
      const at = await now();
      await endDueLinks(at);
      for (const spriteId of activeRooms()) publishPresence(spriteId, at.getTime());
    } catch {
      /* the clock work waits while a service is away */
    }
    setTimeout(() => void tick(), 500);
  };
  setTimeout(() => void tick(), 400);
}
