import type { NightDetail, NightSummary } from '../shared/protocol.js';
import { query } from './db/pool.js';
import { notFound } from './errors.js';

interface StandingRow {
  rank: number;
  nickname: string;
  score: number;
}

export async function listNights(quizmasterId: string): Promise<NightSummary[]> {
  const rooms = await query<{ id: string; deck_title: string; ended_at: Date }>(
    `SELECT id, deck_title, ended_at FROM rooms
     WHERE quizmaster_id = $1 AND ended_at IS NOT NULL
     ORDER BY ended_at DESC, id`,
    [quizmasterId],
  );
  const nights: NightSummary[] = [];
  for (const room of rooms) {
    const standings = await query<StandingRow>(
      'SELECT rank, nickname, score FROM standings WHERE room_id = $1 ORDER BY rank',
      [room.id],
    );
    nights.push({
      roomId: room.id,
      deckTitle: room.deck_title,
      endedAt: room.ended_at.getTime(),
      seated: standings.length,
      podium: standings.slice(0, 3),
    });
  }
  return nights;
}

export async function readNight(quizmasterId: string, roomId: string): Promise<NightDetail> {
  const rooms = await query<{ id: string; deck_title: string; ended_at: Date | null }>(
    'SELECT id, deck_title, ended_at FROM rooms WHERE id = $1 AND quizmaster_id = $2',
    [roomId, quizmasterId],
  );
  const room = rooms[0];
  if (!room || room.ended_at === null) throw notFound();
  const standings = await query<StandingRow>(
    'SELECT rank, nickname, score FROM standings WHERE room_id = $1 ORDER BY rank',
    [roomId],
  );
  return {
    roomId: room.id,
    deckTitle: room.deck_title,
    endedAt: room.ended_at.getTime(),
    standings,
  };
}
