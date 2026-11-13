import type { PostgresService } from './postgres.js';
import { rankRows, type RankInput } from '../shared/ranking.js';
import type { LeaderboardRow } from '../shared/api.js';

// The daily leaderboard. Only solved (on-day) results of verified players are
// listed, one per player, up to LEADERBOARD_SIZE rows. Rows contain only the
// published fields; no email or other private field ever appears.

export interface LeaderboardDeps {
  db: PostgresService;
  leaderboardSize: number;
}

export class LeaderboardService {
  constructor(private readonly deps: LeaderboardDeps) {}

  async rows(date: string): Promise<LeaderboardRow[]> {
    const rows = await this.deps.db.query<{
      player_id: string; display_name: string; seconds: number; score: number;
      mistakes: number; hints: number; finished_seq: string;
    }>(
      `SELECT f.player_id, p.display_name, f.seconds, f.score, f.mistakes, f.hints, f.finished_seq
       FROM finished_games f JOIN players p ON p.player_id = f.player_id
       WHERE f.mode = 'daily' AND f.daily_date = $1 AND f.daily_state = 'solved' AND p.verified = TRUE
       ORDER BY f.finished_seq`,
      [date],
    );
    // One per player: keep the earliest finish.
    const seen = new Set<string>();
    const inputs: RankInput[] = [];
    for (const r of rows) {
      if (seen.has(r.player_id)) continue;
      seen.add(r.player_id);
      inputs.push({
        display_name: r.display_name,
        seconds: r.seconds,
        score: r.score,
        mistakes: r.mistakes,
        hints: r.hints,
        finished_seq: Number(r.finished_seq),
      });
    }
    const ranked = rankRows(inputs);
    return ranked.slice(0, this.deps.leaderboardSize);
  }

  async latestRank(date: string, playerId: string): Promise<{ rank: number; display_name: string } | null> {
    const name = await this.deps.db.query<{ display_name: string }>(
      `SELECT display_name FROM players WHERE player_id = $1`,
      [playerId],
    );
    if (name.length === 0) return null;
    // The player's own row, when listed.
    let seq: number | null = null;
    const finished = await this.deps.db.query<{ finished_seq: string }>(
      `SELECT finished_seq FROM finished_games
       WHERE player_id = $1 AND mode = 'daily' AND daily_date = $2 AND daily_state = 'solved'
       ORDER BY finished_seq LIMIT 1`,
      [playerId, date],
    );
    if (finished.length > 0) seq = Number(finished[0].finished_seq);
    if (seq === null) return null;
    // Find the rank in the listed rows.
    const all = await this.rowsForRank(date);
    const mine = all.find((r) => r.player_id === playerId);
    if (!mine) return null;
    const ranked = rankRows(all.map((r) => ({
      display_name: r.display_name,
      seconds: r.seconds,
      score: r.score,
      mistakes: r.mistakes,
      hints: r.hints,
      finished_seq: Number(r.finished_seq),
    })));
    const idx = all.findIndex((r) => r.player_id === playerId);
    const rank = ranked[idx]?.rank ?? null;
    if (rank === null) return null;
    return { rank, display_name: name[0].display_name };
  }

  private async rowsForRank(date: string): Promise<Array<{
    player_id: string; display_name: string; seconds: number; score: number;
    mistakes: number; hints: number; finished_seq: string;
  }>> {
    return this.deps.db.query<{
      player_id: string; display_name: string; seconds: number; score: number;
      mistakes: number; hints: number; finished_seq: string;
    }>(
      `SELECT f.player_id, p.display_name, f.seconds, f.score, f.mistakes, f.hints, f.finished_seq
       FROM finished_games f JOIN players p ON p.player_id = f.player_id
       WHERE f.mode = 'daily' AND f.daily_date = $1 AND f.daily_state = 'solved' AND p.verified = TRUE
       ORDER BY f.finished_seq`,
      [date],
    );
  }
}
