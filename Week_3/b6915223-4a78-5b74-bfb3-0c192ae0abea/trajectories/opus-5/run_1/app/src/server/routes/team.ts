import type { Handler } from '../http/server.ts';
import type { ApiErrorBody } from '../../shared/types.ts';
import { noticeMessage } from '../../shared/copy.ts';
import { transaction } from '../db.ts';
import { TOTAL_GAMEWEEKS } from '../domain/seed.ts';
import { cancelChip, parseChip, playChip } from '../game/chips.ts';
import {
  assertOpenForManager,
  currentGameweek,
  gameweekByNumber,
  type GameweekRecord,
} from '../game/gameweeks.ts';
import { queueNotice } from '../game/notices.ts';
import { createSquad, savePicks, squadView } from '../game/squad.ts';
import {
  clearDraft,
  confirmTransfers,
  draftView,
  parseBatch,
  previewTransfers,
  saveDraft,
  writeDraft,
} from '../game/transfers.ts';
import { ApiError, apiError, notFound, validation } from '../http/errors.ts';
import { KEY_PATTERN, stableHash, storeResponse, storedResponse } from '../http/idempotency.ts';
import { sendTo } from '../services/realtime.ts';

const namedGameweek = async (value: unknown): Promise<GameweekRecord> => {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw validation({ gameweek: 'Give a gameweek number.' });
  }
  if (value < 1 || value > TOTAL_GAMEWEEKS) throw notFound();
  return (await gameweekByNumber(value))!;
};

/** A late manager write is refused and leaves one refusal notice behind. */
const assertOpenWithNotice = async (
  gameweek: GameweekRecord,
  managerId: string,
): Promise<void> => {
  try {
    assertOpenForManager(gameweek, new Date());
  } catch (error) {
    if (error instanceof ApiError && error.body.error === 'gameweek_locked') {
      await transaction((client) =>
        queueNotice(client, {
          managerId,
          kind: 'transfer_refused',
          gameweek: gameweek.number,
          message: noticeMessage.transferRefused(gameweek.number),
          dedupeKey: null,
        }),
      );
    }
    throw error;
  }
};

const openNamedGameweek = async (
  value: unknown,
  managerId: string,
): Promise<GameweekRecord> => {
  const gameweek = await namedGameweek(value);
  await assertOpenWithNotice(gameweek, managerId);
  return gameweek;
};

export const postSquad: Handler = async (context) => {
  await assertOpenWithNotice(await currentGameweek(), context.manager.id);
  const view = await createSquad(context.manager.id, context.body.players);
  sendTo(context.manager.id, { type: 'squad' });
  return { status: 201, body: view };
};

export const getSquad: Handler = async (context) => ({
  status: 200,
  body: await squadView(context.manager.id),
});

export const putPicks: Handler = async (context) => {
  await openNamedGameweek(context.body.gameweek, context.manager.id);
  const starting = context.body.starting;
  const bench = context.body.bench;
  const captain = context.body.captain;
  const viceCaptain = context.body.vice_captain;
  if (
    !Array.isArray(starting) ||
    !Array.isArray(bench) ||
    starting.some((id) => typeof id !== 'string') ||
    bench.some((id) => typeof id !== 'string') ||
    typeof captain !== 'string' ||
    typeof viceCaptain !== 'string'
  ) {
    throw validation({ starting: 'Send your eleven, bench, captain and vice-captain.' });
  }
  const view = await savePicks(context.manager.id, {
    starting: starting as string[],
    bench: bench as string[],
    captain,
    vice_captain: viceCaptain,
  });
  sendTo(context.manager.id, { type: 'squad' });
  return { status: 200, body: view };
};

export const postChip: Handler = async (context) => {
  const gameweek = await openNamedGameweek(context.body.gameweek, context.manager.id);
  const chip = parseChip(context.body.chip);
  const view = await playChip(context.manager.id, gameweek.number, chip);
  sendTo(context.manager.id, { type: 'squad' });
  return { status: 201, body: view };
};

export const deleteChip: Handler = async (context) => {
  const number = Number(context.params.gameweek);
  if (!Number.isInteger(number)) throw notFound();
  const gameweek = await openNamedGameweek(number, context.manager.id);
  const view = await cancelChip(context.manager.id, gameweek.number);
  sendTo(context.manager.id, { type: 'squad' });
  return { status: 200, body: view };
};

export const postTransferPreview: Handler = async (context) => {
  const gameweek = await openNamedGameweek(context.body.gameweek, context.manager.id);
  const batch = parseBatch(context.body.out, context.body.in);
  return {
    status: 200,
    body: await previewTransfers(context.manager.id, gameweek.number, batch),
  };
};

export const postTransfers: Handler = async (context) => {
  const header = context.headers['idempotency-key'];
  const key = typeof header === 'string' ? header : '';
  const hash = stableHash(context.body);

  if (KEY_PATTERN.test(key)) {
    const stored = await storedResponse(context.manager.id, key);
    if (stored !== undefined) {
      if (stored.body_hash !== hash) {
        throw apiError(
          422,
          'idempotency_key_reused',
          'That idempotency key was used for a different request.',
        );
      }
      return {
        status: stored.response_status,
        body: stored.response_body,
        headers: { 'Idempotent-Replayed': 'true' },
      };
    }
  }

  const gameweek = await namedGameweek(context.body.gameweek);
  const batch = parseBatch(context.body.out, context.body.in);
  const shownHit = context.body.hit_points;

  try {
    await assertOpenWithNotice(gameweek, context.manager.id);
    if (!KEY_PATTERN.test(key)) {
      throw validation({
        'Idempotency-Key': 'Send 1 to 64 letters, digits, hyphens or underscores.',
      });
    }
    if (typeof shownHit !== 'number' || !Number.isInteger(shownHit)) {
      throw validation({ hit_points: 'Send the hit you were shown.' });
    }
    const result = await confirmTransfers(
      context.manager.id,
      gameweek.number,
      batch,
      shownHit,
    );
    await storeResponse(context.manager.id, key, hash, 201, result);
    await writeDraft(context.manager.id, gameweek.number, 'confirmed', { out: [], in: [] }, null);
    sendTo(context.manager.id, { type: 'squad' });
    return { status: 201, body: result };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.body.error === 'gameweek_locked' || error.body.error === 'gameweek_not_open') {
        await writeDraft(context.manager.id, gameweek.number, 'clean', { out: [], in: [] }, null);
      } else {
        await writeDraft(
          context.manager.id,
          gameweek.number,
          'refused',
          batch,
          error.body as ApiErrorBody,
        );
      }
      sendTo(context.manager.id, { type: 'squad' });
    }
    throw error;
  }
};

export const getDraft: Handler = async (context) => {
  const gameweek = await currentGameweek();
  return { status: 200, body: await draftView(context.manager.id, gameweek.number) };
};

export const putDraft: Handler = async (context) => {
  const gameweek = await openNamedGameweek(context.body.gameweek, context.manager.id);
  const batch = parseBatch(context.body.out, context.body.in);
  const view = await saveDraft(context.manager.id, gameweek.number, batch);
  sendTo(context.manager.id, { type: 'squad' });
  return { status: 200, body: view };
};

export const deleteDraft: Handler = async (context) => {
  const gameweek = await currentGameweek();
  const view = await clearDraft(context.manager.id, gameweek.number);
  sendTo(context.manager.id, { type: 'squad' });
  return { status: 200, body: view };
};
