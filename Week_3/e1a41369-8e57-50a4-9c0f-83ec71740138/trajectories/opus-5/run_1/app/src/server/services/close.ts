import type { StrikeEvent, Weekday } from '../../shared/types.js';
import { query, transaction, type Client } from '../db.js';
import { clampValue, healthLossTenths, strikeBackTenths } from '../domain/rewards.js';
import { addDays, weekdayOf } from '../time.js';
import { activeQuest, memberIds } from './party.js';
import { faintIfDown, loadAllUsers, loadUser, loseHealth, nextCloseInstant, partyIdOf, type UserRow } from './player.js';
import {
  noticeWatermark,
  publishNoticesSince,
  publishParty,
  publishPlayer,
  publishQuest,
  publishStrike,
  publishTasks,
} from './notify.js';
import { recordStrikeBack } from './quest.js';
import type { TaskRow } from './tasks.js';

export interface CloseOutcome {
  username: string;
  date: string;
  missed: number;
  healthLost: number;
  strikeBack: number;
}

interface CloseEffects {
  outcome: CloseOutcome;
  closedUserId: string;
  partyId: string | null;
  questId: string | null;
  strike: StrikeEvent | null;
  watermarks: [string, string][];
}

/** The close of one local date for one Player, in the published order of steps. */
async function closeOneDay(user: UserRow): Promise<CloseEffects | null> {
  return transaction(async (client) => {
    const locked = await client.query<{ open_date: string; resting: boolean }>(
      'select open_date::text as open_date, resting from users where id = $1 for update',
      [user.id],
    );
    const current = locked.rows[0];
    if (!current || current.open_date !== user.open_date) return null;

    const date = current.open_date;
    const claimed = await client.query(
      'insert into closed_days (user_id, local_date) values ($1, $2) on conflict do nothing',
      [user.id, date],
    );
    if (claimed.rowCount === 0) return null;

    const resting = current.resting;
    const weekday: Weekday = weekdayOf(date);
    const dailies = await client.query<TaskRow>(
      `select id, user_id, type, title, difficulty, value, streak, done, weekdays, price_cents, position, updated_at
       from tasks where user_id = $1 and type = 'daily' order by position`,
      [user.id],
    );

    let missed = 0;
    let lostTenths = 0;
    for (const daily of dailies.rows) {
      if (!(daily.weekdays ?? []).includes(weekday)) continue;
      if (daily.done) {
        await client.query(
          `update tasks set streak = streak + 1, updated_at = date_trunc('milliseconds', now()) where id = $1`,
          [daily.id],
        );
        continue;
      }
      missed += 1;
      if (resting) continue;
      lostTenths += healthLossTenths(daily.difficulty ?? 'easy', daily.value ?? 0);
      await client.query(
        `update tasks set value = $2, streak = 0, updated_at = date_trunc('milliseconds', now()) where id = $1`,
        [daily.id, clampValue((daily.value ?? 0) - 2)],
      );
    }
    if (lostTenths > 0) await loseHealth(client, user.id, lostTenths);

    const partyId = await partyIdOf(client, user.id);
    const quest = partyId ? await activeQuest(client, partyId) : null;
    const hurt = new Set<string>();
    if (lostTenths > 0) hurt.add(user.id);

    let strike: StrikeEvent | null = null;
    let strikeBackAmountTenths = 0;
    if (!resting && missed >= 1 && partyId && quest) {
      strikeBackAmountTenths = strikeBackTenths(quest.power_tenths, missed);
      for (const memberId of await memberIds(client, partyId)) {
        const member = await loadUser(client, memberId);
        if (!member || member.resting) continue;
        await loseHealth(client, memberId, strikeBackAmountTenths);
        hurt.add(memberId);
      }
      strike = await recordStrikeBack(client, quest.id, user.id, strikeBackAmountTenths, missed);
    }

    const watermarks = new Map<string, string>();
    const hurtUsers: UserRow[] = [];
    for (const userId of hurt) {
      const row = await loadUser(client, userId);
      if (row) hurtUsers.push(row);
    }
    hurtUsers.sort((left, right) => (left.username < right.username ? -1 : 1));
    for (const member of hurtUsers) {
      watermarks.set(member.id, await noticeWatermark(client, member.id));
      await faintIfDown(client, member.id);
    }

    await client.query(`update tasks set done = false where user_id = $1 and type = 'daily'`, [user.id]);
    await client.query('update users set open_date = $2 where id = $1', [user.id, addDays(date, 1)]);

    return {
      outcome: {
        username: user.username,
        date,
        missed,
        healthLost: lostTenths / 10,
        strikeBack: strikeBackAmountTenths / 10,
      },
      closedUserId: user.id,
      partyId,
      questId: quest ? quest.id : null,
      strike,
      watermarks: [...watermarks.entries()],
    };
  });
}

async function announceClose(effects: CloseEffects): Promise<void> {
  const client: Client = { query };
  await publishTasks(client, effects.closedUserId);
  const touched = new Set<string>([effects.closedUserId, ...effects.watermarks.map(([userId]) => userId)]);
  for (const userId of touched) await publishPlayer(client, userId);
  for (const [userId, watermark] of effects.watermarks) await publishNoticesSince(client, userId, watermark);
  if (effects.partyId) await publishParty(client, effects.partyId);
  if (effects.questId && effects.strike) {
    await publishQuest(client, effects.questId);
    await publishStrike(client, effects.questId, effects.strike);
  }
}

/** Runs every close due at or before `at`, in order of close instant and then username. */
export async function runDueCloses(at: number): Promise<CloseOutcome[]> {
  const outcomes: CloseOutcome[] = [];
  for (;;) {
    const users = await loadAllUsers({ query });
    const due = users
      .map((user) => ({ user, closeAt: nextCloseInstant(user) }))
      .filter((entry) => entry.closeAt <= at)
      .sort((left, right) =>
        left.closeAt === right.closeAt
          ? left.user.username < right.user.username
            ? -1
            : 1
          : left.closeAt - right.closeAt,
      );
    const next = due[0];
    if (!next) return outcomes;
    const effects = await closeOneDay(next.user);
    if (!effects) return outcomes;
    await announceClose(effects);
    outcomes.push(effects.outcome);
  }
}
