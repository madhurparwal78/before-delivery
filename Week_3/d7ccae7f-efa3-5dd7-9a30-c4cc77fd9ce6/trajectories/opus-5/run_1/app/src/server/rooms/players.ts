import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { MAX_SEATS } from '../../shared/protocol.js';
import type { AnswerAccepted, JoinResult, RejoinResult } from '../../shared/protocol.js';
import { query, uniqueViolationOn, type Tx } from '../db/pool.js';
import {
  alreadyAnswered,
  clientSuperseded,
  invalidClient,
  invalidRejoinToken,
  nicknameTaken,
  questionNotOpen,
  roomClosed,
  roomEnded,
  roomFull,
  roomNotFound,
  validationFailed,
  windowClosed,
} from '../errors.js';
import type { Submission } from '../domain/scoring.js';
import { FieldErrors, readInteger, readNumber, readString, readStringArray, type Json } from '../parse.js';
import { supersedeClient } from '../live/streams.js';
import { addLiveClient } from '../live/valkey.js';
import { currentQuestion, syncPresence, answeredCount, type Room } from './store.js';
import { withRoomLock } from './lifecycle.js';

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function freshToken(): string {
  return randomBytes(32).toString('base64url');
}

function validateJoinFields(pin: string | null, nickname: string | null): string {
  const errors = new FieldErrors();
  if (pin === null || !/^\d{6}$/.test(pin)) {
    errors.add('pin', 'Enter the six-digit PIN.');
  }
  const trimmed = (nickname ?? '').trim();
  if (trimmed.length < 1 || trimmed.length > 20 || CONTROL_CHARACTERS.test(trimmed)) {
    errors.add('nickname', 'Use a nickname of 1 to 20 characters.');
  }
  errors.throwIfAny();
  return trimmed;
}

async function registerClient(
  tx: Tx,
  roomId: string,
  seatId: string | null,
  role: 'phone' | 'stage',
): Promise<string> {
  const clientId = freshToken();
  await tx.query(
    `INSERT INTO room_clients (client_id, room_id, seat_id, role) VALUES ($1, $2, $3, $4)`,
    [clientId, roomId, seatId, role],
  );
  return clientId;
}

export async function joinRoom(pin: string, rawNickname: string): Promise<JoinResult> {
  const nickname = validateJoinFields(pin, rawNickname);
  const rooms = await query<{ id: string }>(
    'SELECT id FROM rooms WHERE pin = $1 AND ended_at IS NULL',
    [pin],
  );
  const target = rooms[0];
  if (!target) throw roomNotFound();
  const rejoinToken = freshToken();
  return withRoomLock(target.id, async (tx, room) => {
    if (room.row.ended_at !== null) throw roomNotFound();
    if (room.row.state === 'podium' || room.row.state === 'ended') throw roomClosed();
    const seated = await tx.queryOne<{ total: number }>(
      'SELECT count(*)::int AS total FROM seats WHERE room_id = $1',
      [room.row.id],
    );
    if ((seated?.total ?? 0) >= MAX_SEATS) throw roomFull();

    const seatId = randomUUID();
    try {
      await tx.query(
        `INSERT INTO seats (id, room_id, nickname, nickname_lower, rejoin_token_hash, joined_after_index)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          seatId,
          room.row.id,
          nickname,
          nickname.toLowerCase(),
          hashToken(rejoinToken),
          room.row.question_index ?? 0,
        ],
      );
    } catch (error) {
      if (uniqueViolationOn(error, 'seats_room_nickname_key')) throw nicknameTaken();
      throw error;
    }
    const clientId = await registerClient(tx, room.row.id, seatId, 'phone');
    await tx.query('UPDATE seats SET client_id = $2 WHERE id = $1', [seatId, clientId]);
    const total = (seated?.total ?? 0) + 1;
    const drafts = [
      { type: 'player_joined' as const, data: { seatId, nickname, seated: total } },
      ...(await syncPresence(tx, room)),
    ];
    return {
      value: { roomId: room.row.id, seatId, nickname, rejoinToken, clientId },
      drafts,
    };
  });
}

export async function rejoinRoom(rejoinToken: string): Promise<RejoinResult> {
  if (typeof rejoinToken !== 'string' || rejoinToken.length === 0) throw invalidRejoinToken();
  const seats = await query<{
    id: string;
    room_id: string;
    nickname: string;
    ended_at: Date | null;
  }>(
    `SELECT s.id, s.room_id, s.nickname, r.ended_at
     FROM seats s JOIN rooms r ON r.id = s.room_id
     WHERE s.rejoin_token_hash = $1`,
    [hashToken(rejoinToken)],
  );
  const seat = seats[0];
  if (!seat) throw invalidRejoinToken();
  if (seat.ended_at !== null) throw roomEnded();

  return withRoomLock(seat.room_id, async (tx, room) => {
    if (room.row.ended_at !== null) throw roomEnded();
    const current = await tx.queryOne<{
      client_id: string | null;
      score: number;
      streak: number;
    }>('SELECT client_id, score, streak FROM seats WHERE id = $1 FOR UPDATE', [seat.id]);
    if (!current) throw invalidRejoinToken();
    if (current.client_id !== null) {
      await tx.query(
        'UPDATE room_clients SET retired = true, stream_open = false WHERE client_id = $1',
        [current.client_id],
      );
    }
    const clientId = await registerClient(tx, room.row.id, seat.id, 'phone');
    await tx.query('UPDATE seats SET client_id = $2 WHERE id = $1', [seat.id, clientId]);
    const retired = current.client_id;
    return {
      value: {
        roomId: room.row.id,
        seatId: seat.id,
        nickname: seat.nickname,
        score: current.score,
        streak: current.streak,
        clientId,
      },
      drafts: await syncPresence(tx, room),
      afterCommit: async () => {
        if (retired) supersedeClient(retired);
      },
    };
  });
}

export interface ClientIdentity {
  clientId: string;
  roomId: string;
  seatId: string;
}

export async function requireSeatClient(roomId: string, clientId: unknown): Promise<ClientIdentity> {
  if (typeof clientId !== 'string' || clientId.length === 0) throw invalidClient();
  const rows = await query<{
    client_id: string;
    room_id: string;
    seat_id: string | null;
    retired: boolean;
    ended_at: Date | null;
  }>(
    `SELECT c.client_id, c.room_id, c.seat_id, c.retired, r.ended_at
     FROM room_clients c JOIN rooms r ON r.id = c.room_id
     WHERE c.client_id = $1`,
    [clientId],
  );
  const row = rows[0];
  if (!row || row.room_id !== roomId || row.seat_id === null) throw invalidClient();
  if (row.ended_at !== null) throw roomEnded();
  if (row.retired) throw clientSuperseded();
  return { clientId: row.client_id, roomId: row.room_id, seatId: row.seat_id };
}

export async function markStreamOpen(clientId: string, roomId: string): Promise<void> {
  await query(
    'UPDATE room_clients SET stream_open = true, stream_seen_at = now() WHERE client_id = $1',
    [clientId],
  );
  await addLiveClient(roomId, clientId);
}

export async function markStreamAlive(clientId: string): Promise<void> {
  await query('UPDATE room_clients SET stream_seen_at = now() WHERE client_id = $1', [clientId]);
}

export async function markPolled(clientId: string): Promise<void> {
  await query('UPDATE room_clients SET last_poll_at = now() WHERE client_id = $1', [clientId]);
}

export async function registerStageClient(roomId: string, clientId: string): Promise<void> {
  await query(
    `INSERT INTO room_clients (client_id, room_id, seat_id, role) VALUES ($1, $2, NULL, 'stage')
     ON CONFLICT (client_id) DO NOTHING`,
    [clientId, roomId],
  );
}

export async function recordAnswer(
  receivedAt: number,
  roomId: string,
  seatId: string,
  body: Json,
): Promise<AnswerAccepted> {
  const requestedIndex = readInteger(body, 'questionIndex');
  if (requestedIndex === null) {
    throw validationFailed({ questionIndex: 'Name the question being answered.' });
  }
  return withRoomLock(roomId, async (tx, room) => {
    if (room.row.question_index !== requestedIndex) throw questionNotOpen(room.row.state);
    const deadlineAt = room.deadlineAt ?? receivedAt;
    const remainingMs = deadlineAt - receivedAt;
    if (room.row.state !== 'question_open' || receivedAt > deadlineAt) throw windowClosed(remainingMs);

    const existing = await tx.queryOne<{ seat_id: string }>(
      'SELECT seat_id FROM answers WHERE room_id = $1 AND seat_id = $2 AND question_index = $3',
      [room.row.id, seatId, requestedIndex],
    );
    if (existing) throw alreadyAnswered();

    const submission = parseSubmission(body, room);
    const latencyMs = receivedAt - (room.opensAt ?? receivedAt);
    const inserted = await tx.query<{ seat_id: string }>(
      `INSERT INTO answers (room_id, seat_id, question_index, latency_ms, submission, received_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (room_id, seat_id, question_index) DO NOTHING
       RETURNING seat_id`,
      [room.row.id, seatId, requestedIndex, latencyMs, JSON.stringify(submission)],
    );
    if (inserted.length === 0) throw alreadyAnswered();

    const answered = await answeredCount(room.row.id, requestedIndex, tx);
    const seated = await tx.queryOne<{ total: number }>(
      'SELECT count(*)::int AS total FROM seats WHERE room_id = $1',
      [room.row.id],
    );
    return {
      value: { questionIndex: requestedIndex, latencyMs, remainingMs },
      drafts: [
        {
          type: 'answer_count' as const,
          data: { questionIndex: requestedIndex, answered, seated: seated?.total ?? 0 },
        },
      ],
    };
  });
}

function parseSubmission(body: Json, room: Room): Submission {
  const question = currentQuestion(room);
  const spec = question?.spec;
  if (!spec) throw questionNotOpen(room.row.state);
  const given = ['choice', 'estimate', 'order'].filter((field) => body[field] !== undefined);
  if (given.length !== 1) {
    throw validationFailed({ answer: 'Send exactly one answer for this question.' });
  }
  if (spec.type === 'multiple_choice') {
    const choice = readInteger(body, 'choice');
    if (choice === null || choice < 0 || choice >= spec.options.length) {
      throw validationFailed({ choice: 'Pick one of the options.' });
    }
    return { choice };
  }
  if (spec.type === 'estimate') {
    const estimate = readNumber(body, 'estimate');
    if (estimate === null || estimate < spec.min || estimate > spec.max) {
      throw validationFailed({ estimate: 'Send an estimate inside the range.' });
    }
    return { estimate };
  }
  const order = readStringArray(body, 'order');
  const expected = (question as { itemIds: string[] }).itemIds;
  if (order === null || order.length !== expected.length || new Set(order).size !== order.length) {
    throw validationFailed({ order: 'Send every item exactly once.' });
  }
  for (const id of order) {
    if (!expected.includes(id)) throw validationFailed({ order: 'Send every item exactly once.' });
  }
  return { order };
}
