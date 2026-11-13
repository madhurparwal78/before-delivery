import type { PostgresService } from './postgres.js';
import { hashPassword, newId, newToken, verifyPassword } from './auth.js';
import type { Player } from '../shared/api.js';

// Accounts: sign-up, verification, sign-in, reset. The account counts as
// verified only when a confirmation link from a message Mailpit accepted is
// opened.

export interface PlayerRow {
  player_id: string;
  email: string;
  display_name: string;
  verified: boolean;
}

export interface PlayerServiceDeps {
  db: PostgresService;
  mail: {
    send(to: string, subject: string, body: string): Promise<boolean>;
  };
  verifyTtlMinutes: number;
  resetTtlMinutes: number;
}

export class PlayerService {
  constructor(private readonly deps: PlayerServiceDeps) {}

  async createPlayer(email: string, displayName: string, password: string, origin: string, mailUp: boolean): Promise<{ player: PlayerRow; token: string | null }> {
    const emailLower = email.toLowerCase();
    const nameLower = displayName.toLowerCase();
    const { hash, salt } = await hashPassword(password);
    const playerId = newId('pl');
    const rows = await this.deps.db.query<{ email_lower: string; display_lower: string }>(
      `SELECT email_lower, display_lower FROM players WHERE email_lower = $1 OR display_lower = $2`,
      [emailLower, nameLower],
    );
    const taken = new Map(rows.map((r) => [r.email_lower === emailLower ? 'email' : 'name', true]));
    if (taken.has('email')) throw new Error('EMAIL_TAKEN');
    if (taken.has('name')) throw new Error('NAME_TAKEN');

    await this.deps.db.query(
      `INSERT INTO players (player_id, email, email_lower, display_name, display_lower, password_hash, password_salt, verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)`,
      [playerId, email, emailLower, displayName, nameLower, hash, salt],
    );
    const token = mailUp ? await this.sendVerification(playerId, email, origin) : null;
    const player = { player_id: playerId, email, display_name: displayName, verified: false };
    return { player, token };
  }

  async sendVerification(playerId: string, email: string, origin: string): Promise<string | null> {
    const token = newToken();
    const expires = new Date(Date.now() + this.deps.verifyTtlMinutes * 60000);
    await this.deps.db.query(
      `INSERT INTO tokens (token, player_id, kind, used_at, expires_at) VALUES ($1, $2, 'verify', NULL, $3)`,
      [token, playerId, expires],
    );
    const link = `${origin}/verify/${token}`;
    const sent = await this.deps.mail.send(email, 'Confirm your email for Seam', link);
    if (!sent) {
      // A token is valid only after Mailpit has accepted its message.
      await this.deps.db.query(`DELETE FROM tokens WHERE token = $1`, [token]);
      return null;
    }
    return token;
  }

  async verifyToken(token: string): Promise<'ok' | 'used' | 'expired' | 'not_found'> {
    const rows = await this.deps.db.query<{ player_id: string; used_at: string | null; expires_at: Date }>(
      `SELECT player_id, used_at, expires_at FROM tokens WHERE token = $1 AND kind = 'verify'`,
      [token],
    );
    if (rows.length === 0) return 'not_found';
    const row = rows[0];
    if (row.used_at) return 'used';
    if (new Date(row.expires_at).getTime() < Date.now()) return 'expired';
    await this.deps.db.transaction(async (tx) => {
      await tx.query(`UPDATE tokens SET used_at = now() WHERE token = $1`, [token]);
      await tx.query(`UPDATE players SET verified = TRUE WHERE player_id = $1`, [row.player_id]);
    });
    return 'ok';
  }

  async signIn(email: string, password: string): Promise<{ player: PlayerRow; session: string }> {
    const rows = await this.deps.db.query<{
      player_id: string; email: string; display_name: string; verified: boolean;
      password_hash: string; password_salt: string;
    }>(
      `SELECT player_id, email, display_name, verified, password_hash, password_salt FROM players WHERE email_lower = $1`,
      [email.toLowerCase()],
    );
    if (rows.length === 0) throw new Error('BAD_CREDENTIALS');
    const row = rows[0];
    const ok = await verifyPassword(password, row.password_hash, row.password_salt);
    if (!ok) throw new Error('BAD_CREDENTIALS');
    const session = newToken();
    await this.deps.db.query(`INSERT INTO sessions (token, player_id) VALUES ($1, $2)`, [session, row.player_id]);
    return {
      player: { player_id: row.player_id, email: row.email, display_name: row.display_name, verified: row.verified },
      session,
    };
  }

  async sessionPlayer(token: string): Promise<PlayerRow | null> {
    const rows = await this.deps.db.query<{ player_id: string; email: string; display_name: string; verified: boolean }>(
      `SELECT p.player_id, p.email, p.display_name, p.verified FROM sessions s
       JOIN players p ON p.player_id = s.player_id WHERE s.token = $1`,
      [token],
    );
    if (rows.length === 0) return null;
    return rows[0];
  }

  // The verify route answers with the display name of the token's player.
  async playerOfToken(token: string): Promise<PlayerRow | null> {
    const rows = await this.deps.db.query<{ player_id: string; email: string; display_name: string; verified: boolean }>(
      `SELECT p.player_id, p.email, p.display_name, p.verified FROM tokens t
       JOIN players p ON p.player_id = t.player_id WHERE t.token = $1`,
      [token],
    );
    if (rows.length === 0) return null;
    return rows[0];
  }

  async createGradedPlayer(email: string, displayName: string, password: string, verified: boolean): Promise<PlayerRow> {
    const { hash, salt } = await hashPassword(password);
    const playerId = newId('pl');
    await this.deps.db.query(
      `INSERT INTO players (player_id, email, email_lower, display_name, display_lower, password_hash, password_salt, verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (email_lower) DO UPDATE SET verified = $8`,
      [playerId, email, email.toLowerCase(), displayName, displayName.toLowerCase(), hash, salt, verified],
    );
    const rows = await this.deps.db.query<{ player_id: string; email: string; display_name: string; verified: boolean }>(
      `SELECT player_id, email, display_name, verified FROM players WHERE email_lower = $1`,
      [email.toLowerCase()],
    );
    return rows[0];
  }

  async createSession(playerId: string): Promise<string> {
    const session = newToken();
    await this.deps.db.query(`INSERT INTO sessions (token, player_id) VALUES ($1, $2)`, [session, playerId]);
    return session;
  }

  async endSession(token: string): Promise<void> {
    await this.deps.db.query(`DELETE FROM sessions WHERE token = $1`, [token]);
  }

  async endAllSessions(playerId: string): Promise<void> {
    await this.deps.db.query(`DELETE FROM sessions WHERE player_id = $1`, [playerId]);
  }

  async requestReset(email: string, origin: string): Promise<string | null> {
    const rows = await this.deps.db.query<{ player_id: string }>(
      `SELECT player_id FROM players WHERE email_lower = $1`,
      [email.toLowerCase()],
    );
    if (rows.length === 0) return null;
    const token = newToken();
    const expires = new Date(Date.now() + this.deps.resetTtlMinutes * 60000);
    await this.deps.db.query(
      `INSERT INTO tokens (token, player_id, kind, used_at, expires_at) VALUES ($1, $2, 'reset', NULL, $3)`,
      [token, rows[0].player_id, expires],
    );
    const link = `${origin}/reset/${token}`;
    const sent = await this.deps.mail.send(email, 'Reset your Seam password', link);
    if (!sent) {
      await this.deps.db.query(`DELETE FROM tokens WHERE token = $1`, [token]);
      throw new Error('MAIL_UNAVAILABLE');
    }
    return token;
  }

  async resetPassword(token: string, password: string): Promise<{ player: PlayerRow; session: string } | 'used' | 'expired' | 'not_found'> {
    const rows = await this.deps.db.query<{ player_id: string; used_at: string | null; expires_at: Date }>(
      `SELECT player_id, used_at, expires_at FROM tokens WHERE token = $1 AND kind = 'reset'`,
      [token],
    );
    if (rows.length === 0) return 'not_found';
    const row = rows[0];
    if (row.used_at) return 'used';
    if (new Date(row.expires_at).getTime() < Date.now()) return 'expired';
    const { hash, salt } = await hashPassword(password);
    const session = newToken();
    await this.deps.db.transaction(async (tx) => {
      await tx.query(`UPDATE tokens SET used_at = now() WHERE token = $1`, [token]);
      await tx.query(`UPDATE players SET password_hash = $2, password_salt = $3 WHERE player_id = $1`, [row.player_id, hash, salt]);
      // Saving a new password ends every existing session of that player and
      // signs in the browser that saved it.
      await tx.query(`DELETE FROM sessions WHERE player_id = $1`, [row.player_id]);
      await tx.query(`INSERT INTO sessions (token, player_id) VALUES ($1, $2)`, [session, row.player_id]);
    });
    const playerRows = await this.deps.db.query<{ player_id: string; email: string; display_name: string; verified: boolean }>(
      `SELECT player_id, email, display_name, verified FROM players WHERE player_id = $1`,
      [row.player_id],
    );
    return { player: playerRows[0], session };
  }

  toPlayerShape(row: PlayerRow): Player {
    return { player_id: row.player_id, email: row.email, display_name: row.display_name, verified: row.verified };
  }
}
