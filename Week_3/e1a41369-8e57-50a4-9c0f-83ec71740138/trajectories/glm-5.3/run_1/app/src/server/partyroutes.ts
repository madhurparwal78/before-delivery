import express from 'express';
import type { Request, Response } from 'express';
import type { PoolClient } from 'pg';
import bcrypt from 'bcryptjs';
import {
  config, requireAuth, q, q1, pool, live, toPlayer, toParty, toQuest, partyIdOf,
  emitPlayerLive, emitTasksLive, type UserRow, ApiError,
} from './kernel.js';
import { QUEST_FIXTURES, fixtureByName } from '../shared/rules.js';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// parties, invites, quests, chat, history

export function registerPartyRoutes(app: express.Express): void {
  app.post('/api/parties', requireAuth, async (req, res, next) => {
    try {
      const name = String((req.body as Record<string, unknown>).name ?? '');
      if (name.length < 1 || name.length > 40) {
        res.status(422).json({ errors: { name: 'Party name must be 1 to 40 characters.' } });
        return;
      }
      if (await partyIdOf(req.user!.id)) {
        res.status(409).json({ error: 'already_in_party' });
        return;
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const p = await client.query<{ id: string }>(
          `INSERT INTO parties (name, leader_id) VALUES ($1,$2) RETURNING id`,
          [name, req.user!.id]
        );
        await client.query(`INSERT INTO party_members (party_id, user_id) VALUES ($1,$2)`, [
          p.rows[0].id,
          req.user!.id,
        ]);
        await client.query('COMMIT');
        const party = await toParty(p.rows[0].id);
        live.setParty(req.user!.id, p.rows[0].id);
        res.status(201).json(party);
        emitPartyLive(p.rows[0].id);
        emitPlayerLive(req.user!.id);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/party', requireAuth, async (req, res) => {
    const partyId = await partyIdOf(req.user!.id);
    res.json({ party: partyId ? await toParty(partyId) : null });
  });

  app.get('/api/parties/:id', requireAuth, async (req, res) => {
    const partyId = await partyIdOf(req.user!.id);
    if (partyId !== req.params.id) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const party = await toParty(req.params.id);
    if (!party) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(party);
  });

  app.post('/api/parties/:id/invites', requireAuth, async (req, res, next) => {
    try {
      const partyId = await partyIdOf(req.user!.id);
      if (partyId !== req.params.id) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const party = await toParty(partyId!);
      if (!party) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (party.leader !== req.user!.username) {
        res.status(403).json({ error: 'leader_only' });
        return;
      }
      const username = String((req.body as Record<string, unknown>).username ?? '');
      const target = await q1<UserRow>(`SELECT * FROM users WHERE username=$1`, [username]);
      if (!target) {
        res.status(422).json({ errors: { username: 'No player with that username.' } });
        return;
      }
      if (await partyIdOf(target.id)) {
        res.status(409).json({ error: 'already_in_party' });
        return;
      }
      if (party.pendingInvites.includes(username)) {
        res.status(409).json({ error: 'already_invited' });
        return;
      }
      if (party.members.length + party.pendingInvites.length + 1 > config.partyMaxMembers) {
        res.status(409).json({ error: 'party_full' });
        return;
      }
      const invite = await q1<{ id: string }>(
        `INSERT INTO party_invites (party_id, user_id) VALUES ($1,$2) ON CONFLICT (party_id, user_id) DO NOTHING RETURNING id`,
        [partyId, target.id]
      );
      res.status(201).json({ id: invite?.id ?? crypto.randomUUID(), party, username });
      emitInviteLive(target.id);
      emitPartyLive(partyId!);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/invites', requireAuth, async (req, res) => {
    const invites = await q<{ id: string; party_id: string; name: string; leader: string }>(
      `SELECT i.id, i.party_id, p.name, u.username AS leader
       FROM party_invites i JOIN parties p ON p.id=i.party_id JOIN users u ON u.id=p.leader_id
       WHERE i.user_id=$1 ORDER BY i.created_at`,
      [req.user!.id]
    );
    res.json({
      invites: invites.rows.map((i) => ({
        id: i.id,
        partyId: i.party_id,
        partyName: i.name,
        from: i.leader,
      })),
    });
  });

  app.post('/api/invites/:id/accept', requireAuth, async (req, res, next) => {
    try {
      const invite = await q1<{ id: string; party_id: string; user_id: string }>(
        `SELECT * FROM party_invites WHERE id=$1 AND user_id=$2`,
        [req.params.id, req.user!.id]
      );
      if (!invite) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (await partyIdOf(req.user!.id)) {
        res.status(409).json({ error: 'already_in_party' });
        return;
      }
      const party = await toParty(invite.party_id);
      if (!party) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (party.members.length + party.pendingInvites.length + 1 > config.partyMaxMembers) {
        res.status(409).json({ error: 'party_full' });
        return;
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM party_invites WHERE user_id=$1`, [req.user!.id]);
        await client.query(`INSERT INTO party_members (party_id, user_id) VALUES ($1,$2)`, [
          invite.party_id,
          req.user!.id,
        ]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      live.setParty(req.user!.id, invite.party_id);
      res.json(await toParty(invite.party_id));
      emitPartyLive(invite.party_id);
      emitPlayerLive(req.user!.id);
      emitInviteLive(req.user!.id);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/invites/:id/decline', requireAuth, async (req, res) => {
    const r = await q(`DELETE FROM party_invites WHERE id=$1 AND user_id=$2 RETURNING party_id`, [
      req.params.id,
      req.user!.id,
    ]);
    if (r.rows.length === 0) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    emitInviteLive(req.user!.id);
    emitPartyLive(r.rows[0].party_id);
    res.status(204).end();
  });

  app.post('/api/parties/:id/leave', requireAuth, async (req, res) => {
    const partyId = await partyIdOf(req.user!.id);
    if (partyId !== req.params.id) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM party_members WHERE party_id=$1 AND user_id=$2`, [
        partyId,
        req.user!.id,
      ]);
      const remaining = await client.query<{ user_id: string; joined_at: Date }>(
        `SELECT user_id, joined_at FROM party_members WHERE party_id=$1 ORDER BY joined_at`,
        [partyId]
      );
      if (remaining.rows.length === 0) {
        await client.query(`DELETE FROM parties WHERE id=$1`, [partyId]);
      } else {
        const party = await q1<{ leader_id: string }>(`SELECT leader_id FROM parties WHERE id=$1`, [partyId]);
        if (party && party.leader_id === req.user!.id) {
          await client.query(`UPDATE parties SET leader_id=$2 WHERE id=$1`, [
            partyId,
            remaining.rows[0].user_id,
          ]);
        }
      }
      await client.query('COMMIT');
      live.setParty(req.user!.id, null);
      res.status(204).end();
      emitPartyLive(partyId!);
      emitPlayerLive(req.user!.id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  app.get('/api/quest-fixtures', requireAuth, (_req, res) => {
    res.json({
      quests: QUEST_FIXTURES.map((fx) => ({
        name: fx.name,
        boss: fx.boss,
        maxHealth: fx.maxHealth,
        power: fx.power,
        rewardGold: fx.rewardGold,
        rewardExperience: fx.rewardExperience,
      })),
    });
  });

  app.post('/api/parties/:id/quests', requireAuth, async (req, res, next) => {
    try {
      const partyId = await partyIdOf(req.user!.id);
      if (partyId !== req.params.id) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const party = await toParty(partyId!);
      if (party?.leader !== req.user!.username) {
        res.status(403).json({ error: 'leader_only' });
        return;
      }
      const questName = String((req.body as Record<string, unknown>).quest ?? '');
      const fx = fixtureByName(questName);
      if (!fx) {
        res.status(422).json({ errors: { quest: 'Unknown quest.' } });
        return;
      }
      if (await currentQuestId(partyId!)) {
        res.status(409).json({ error: 'quest_in_progress' });
        return;
      }
      const now = new Date();
      const expires = new Date(now.getTime() + config.questInviteSeconds * 1000);
      const client = await pool.connect();
      let questId = '';
      try {
        await client.query('BEGIN');
        const ins = await client.query<{ id: string }>(
          `INSERT INTO quests (party_id, name, boss, max_health, boss_health, power, reward_gold_cents, reward_experience, state, invited_at, expires_at)
           VALUES ($1,$2,$3,$4,$4,$5,$6,$7,'invited',$8,$9) RETURNING id`,
          [
            partyId,
            fx.name,
            fx.boss,
            fx.maxHealth.toFixed(1),
            fx.power.toFixed(1),
            Math.round(fx.rewardGold * 100),
            fx.rewardExperience,
            now.toISOString(),
            expires.toISOString(),
          ]
        );
        questId = ins.rows[0].id;
        await client.query(`INSERT INTO quest_accepts (quest_id, username) VALUES ($1,$2)`, [
          questId,
          req.user!.username,
        ]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      res.status(201).json(await toQuest(questId, req.user!.username));
      emitQuestLive(partyId!, questId);
      emitPartyLive(partyId!);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/quests/:id', requireAuth, async (req, res) => {
    const quest = await toQuest(String(req.params.id), req.user!.username);
    if (!canSeeQuest(quest, req.user!.username, await partyIdOf(req.user!.id))) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(quest);
  });

  app.post('/api/quests/:id/accept', requireAuth, async (req, res, next) => {
    try {
      const client = await pool.connect();
      let status = 0;
      let body: unknown = null;
      let questPartyId: string | null = null;
      try {
        await client.query('BEGIN');
        const quest = (
          await client.query<{ id: string; party_id: string; state: string; expires_at: Date }>(
            `SELECT * FROM quests WHERE id=$1 FOR UPDATE`,
            [String(req.params.id)]
          )
        ).rows[0];
        const partyId = await partyIdOf(req.user!.id);
        if (!quest || quest.party_id !== partyId) {
          status = 404;
          body = { error: 'not_found' };
        } else if (quest.state !== 'invited') {
          status = 409;
          body = { error: 'quest_not_active' };
        } else if (Date.now() >= new Date(quest.expires_at).getTime()) {
          status = 409;
          body = { error: 'invite_expired' };
        } else {
          await client.query(
            `INSERT INTO quest_accepts (quest_id, username) VALUES ($1,$2) ON CONFLICT (quest_id, username) DO NOTHING`,
            [quest.id, req.user!.username]
          );
          status = 200;
          questPartyId = quest.party_id;
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      if (questPartyId && status === 200) {
        body = await toQuest(String(req.params.id), req.user!.username);
      }
      if (status && body) {
        res.status(status).json(body as Record<string, unknown>);
        if (status === 200 && questPartyId) {
          emitQuestLive(questPartyId, String(req.params.id));
          emitPartyLive(questPartyId);
        }
      }
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/quests/:id/decline', requireAuth, async (req, res, next) => {
    try {
      const partyId = await partyIdOf(req.user!.id);
      const quest = await toQuest(String(req.params.id), req.user!.username);
      if (!quest || quest.partyId !== partyId) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (quest.state !== 'invited') {
        res.status(409).json({ error: 'quest_not_active' });
        return;
      }
      res.json(quest);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/quests/:id/begin', requireAuth, async (req, res, next) => {
    try {
      const partyId = await partyIdOf(req.user!.id);
      const client = await pool.connect();
      let status = 0;
      let body: unknown = null;
      let questPartyId: string | null = null;
      try {
        await client.query('BEGIN');
        const quest = (
          await client.query<{
            id: string;
            party_id: string;
            state: string;
            expires_at: Date;
            name: string;
          }>(`SELECT * FROM quests WHERE id=$1 FOR UPDATE`, [req.params.id])
        ).rows[0];
        if (!quest || quest.party_id !== partyId) {
          status = 404;
          body = { error: 'not_found' };
        } else {
          const party = await toParty(quest.party_id);
          if (party?.leader !== req.user!.username) {
            status = 403;
            body = { error: 'leader_only' };
          } else if (quest.state !== 'invited') {
            status = 409;
            body = { error: 'quest_not_active' };
          } else if (Date.now() >= new Date(quest.expires_at).getTime()) {
            status = 409;
            body = { error: 'invite_expired' };
          } else {
            const accepts = await client.query<{ username: string }>(
              `SELECT username FROM quest_accepts WHERE quest_id=$1`,
              [quest.id]
            );
            if (accepts.rows.length < 2) {
              status = 409;
              body = { error: 'not_enough_accepted' };
            } else {
              await client.query(`UPDATE quests SET state='active', started_at=now() WHERE id=$1`, [quest.id]);
              const members = await client.query<{ username: string }>(
                `SELECT u.username FROM party_members m JOIN users u ON u.id=m.user_id WHERE m.party_id=$1`,
                [quest.party_id]
              );
              for (const m of members.rows) {
                await client.query(
                  `INSERT INTO quest_participants (quest_id, username) VALUES ($1,$2) ON CONFLICT (quest_id, username) DO NOTHING`,
                  [quest.id, m.username]
                );
              }
              status = 200;
              questPartyId = quest.party_id;
            }
          }
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      if (questPartyId && status === 200) {
        body = await toQuest(String(req.params.id), req.user!.username);
      }
      res.status(status).json(body as Record<string, unknown>);
      if (questPartyId) {
        emitQuestLive(questPartyId, String(req.params.id));
        emitPartyLive(questPartyId);
      }
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/quests/:id/abandon', requireAuth, async (req, res, next) => {
    try {
      const partyId = await partyIdOf(req.user!.id);
      const client = await pool.connect();
      let status = 0;
      let body: unknown = null;
      let questPartyId: string | null = null;
      try {
        await client.query('BEGIN');
        const quest = (
          await client.query<{ id: string; party_id: string; state: string }>(
            `SELECT * FROM quests WHERE id=$1 FOR UPDATE`,
            [String(req.params.id)]
          )
        ).rows[0];
        if (!quest || quest.party_id !== partyId) {
          status = 404;
          body = { error: 'not_found' };
        } else {
          const party = await toParty(quest.party_id);
          if (party?.leader !== req.user!.username) {
            status = 403;
            body = { error: 'leader_only' };
          } else if (quest.state !== 'invited' && quest.state !== 'active') {
            status = 409;
            body = { error: 'quest_not_active' };
          } else {
            await client.query(`UPDATE quests SET state='abandoned', ended_at=now() WHERE id=$1`, [quest.id]);
            status = 200;
            questPartyId = quest.party_id;
          }
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      if (questPartyId && status === 200) {
        body = await toQuest(String(req.params.id), req.user!.username);
      }
      res.status(status).json(body as Record<string, unknown>);
      if (questPartyId) {
        emitQuestLive(questPartyId, String(req.params.id));
        emitPartyLive(questPartyId);
      }
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/parties/:id/chat', requireAuth, async (req, res) => {
    const partyId = await partyIdOf(req.user!.id);
    if (partyId !== req.params.id) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const messages = await q<{ id: string; username: string; text: string; created_at: Date }>(
      `SELECT * FROM (SELECT * FROM chat_messages WHERE party_id=$1 ORDER BY created_at DESC LIMIT 100) t ORDER BY created_at`,
      [req.params.id]
    );
    res.json({
      messages: messages.rows.map((m) => ({
        id: m.id,
        username: m.username,
        text: m.text,
        createdAt: m.created_at.toISOString(),
      })),
    });
  });

  app.post('/api/parties/:id/chat', requireAuth, async (req, res, next) => {
    try {
      const partyId = await partyIdOf(req.user!.id);
      if (partyId !== req.params.id) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const raw = String((req.body as Record<string, unknown>).text ?? '');
      const text = raw.trim();
      if (text.length < 1 || text.length > 500) {
        res.status(422).json({ errors: { text: 'Message must be 1 to 500 characters.' } });
        return;
      }
      const recent = await q<{ n: number }>(
        `SELECT count(*)::int AS n FROM chat_messages WHERE username=$1 AND created_at > now() - interval '60 seconds'`,
        [req.user!.username]
      );
      if (recent.rows[0].n >= config.chatMaxPerMinute) {
        res.status(429).json({ error: 'chat_rate_limited' });
        return;
      }
      const ins = await q1<{ id: string; created_at: Date }>(
        `INSERT INTO chat_messages (party_id, username, text) VALUES ($1,$2,$3) RETURNING id, created_at`,
        [String(req.params.id), req.user!.username, text]
      );
      const message = {
        id: ins!.id,
        username: req.user!.username,
        text,
        createdAt: ins!.created_at.toISOString(),
      };
      res.status(201).json(message);
      live.toParty(partyId!, 'chat', { ...message, partyId });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/history', requireAuth, async (req, res) => {
    const quests = await q<{ id: string }>(
      `SELECT DISTINCT q.id FROM quests q
       JOIN quest_participants qp ON qp.quest_id = q.id
       WHERE qp.username=$1 AND q.state IN ('defeated','abandoned')
       ORDER BY q.id`,
      [req.user!.username]
    );
    const out = [];
    for (const row of quests.rows) {
      const quest = await toQuest(row.id, req.user!.username);
      if (quest) out.push(quest);
    }
    out.sort((a, b) => (a.endedAt! < b.endedAt! ? 1 : -1));
    res.json({ quests: out });
  });
}

function canSeeQuest(quest: unknown, username: string, partyId: string | null): boolean {
  if (!quest) return false;
  const q = quest as { partyId: string; state: string; members: { username: string }[] };
  if (q.partyId === partyId) return true;
  if (q.state === 'defeated' || q.state === 'abandoned') {
    return q.members.some((m) => m.username === username);
  }
  return false;
}

async function currentQuestId(partyId: string): Promise<string | null> {
  const r = await q1<{ id: string }>(
    `SELECT id FROM quests WHERE party_id=$1 AND state IN ('invited','active') ORDER BY invited_at DESC`,
    [partyId]
  );
  return r?.id ?? null;
}

function emitPartyLive(partyId: string): void {
  void (async () => {
    const party = await toParty(partyId);
    if (party) live.toParty(partyId, 'party', { party });
  })();
}

function emitQuestLive(partyId: string, questId: string): void {
  void (async () => {
    const quest = await toQuest(questId, null);
    if (quest) live.toParty(partyId, 'quest', quest);
  })();
}

function emitInviteLive(userId: string): void {
  void (async () => {
    const invites = await q<{ id: string; party_id: string; name: string; leader: string }>(
      `SELECT i.id, i.party_id, p.name, u.username AS leader
       FROM party_invites i JOIN parties p ON p.id=i.party_id JOIN users u ON u.id=p.leader_id
       WHERE i.user_id=$1 ORDER BY i.created_at`,
      [userId]
    );
    live.toUser(userId, 'invite', {
      invites: invites.rows.map((i) => ({ id: i.id, partyId: i.party_id, partyName: i.name, from: i.leader })),
    });
  })();
}
