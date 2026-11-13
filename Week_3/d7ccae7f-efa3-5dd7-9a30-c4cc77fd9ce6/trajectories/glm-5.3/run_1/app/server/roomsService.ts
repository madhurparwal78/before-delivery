import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { HostCommand, RoomSnapshot, Standing, RevealPayload } from './domain.ts';
import { errors } from './errors.ts';
import { loadDeck, loadSeats, roomFromRow } from './db.ts';
import { transitionFor, noMoreQuestions } from './projection.ts';
import { appendEvent, publishEvent, writeLeaderboard, isLiveUp, type RoomEvent } from './live.ts';
import { computeReveal, presignedQuestionImage, rankSeats, newRejoinToken, newClientId, tokenHash, MAX_SEATS, itemIdFor } from './roomEngine.ts';

export interface JoinResult {
  roomId: string;
  seatId: string;
  nickname: string;
  rejoinToken: string;
  clientId: string;
}

export interface RejoinResult {
  roomId: string;
  seatId: string;
  nickname: string;
  score: number;
  streak: number;
  clientId: string;
}

export interface AnswerReceipt {
  latencyMs: number;
  remainingMs: number;
}

export async function createRoom(db: Pool, quizmasterId: string, deckId: string): Promise<RoomSnapshot> {
  const client = await db.connect();
  try {
    await client.query('begin');
    const deck = await loadDeck(client, quizmasterId, deckId);
    if (deck.questions.length === 0) {
      throw errors.validationFailed({ deckId: 'Deck has no questions' });
    }
    const snapshotId = randomUUID();
    await client.query('insert into snapshots (id, content, last_event_id) values ($1, $2, 0)', [
      snapshotId,
      JSON.stringify({
        questions: deck.questions.map((q) => ({
          id: q.id,
          position: q.position,
          version: q.version,
          prompt: q.prompt,
          timeLimitSeconds: q.timeLimitSeconds,
          image: q.image,
          content: JSON.stringify(q.content),
        })),
      }),
    ]);
    let pin = '';
    for (let attempt = 0; attempt < 50; attempt += 1) {
      pin = String(Math.floor(100000 + Math.random() * 900000));
      const clash = await client.query('select 1 from rooms where pin = $1 and ended_reason is null', [pin]);
      if (clash.rowCount === 0) break;
      pin = '';
    }
    if (!pin) throw new Error('could not allocate a PIN');
    const roomId = randomUUID();
    const openedAt = Date.now();
    await client.query(
      `insert into rooms (id, quizmaster_id, deck_id, snapshot_id, deck_title, pin, state, opened_at, empty_since)
       values ($1, $2, $3, $4, $5, $6, 'lobby', $7, $8)`,
      [roomId, quizmasterId, deckId, snapshotId, deck.title, pin, openedAt, openedAt],
    );
    await client.query('commit');
    return loadRoomById(db, roomId);
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

export async function loadRoomById(db: Pool, roomId: string): Promise<RoomSnapshot> {
  const result = await db.query(
    `select r.*, rqs.content as snapshot, rqs.last_event_id
     from rooms r join snapshots rqs on rqs.id = r.snapshot_id where r.id = $1`,
    [roomId],
  );
  if (result.rowCount === 0) throw errors.notFound();
  return roomFromRow(result.rows[0]);
}

export async function loadRoomForQuizmaster(db: Pool, quizmasterId: string, roomId: string): Promise<RoomSnapshot> {
  const room = await loadRoomById(db, roomId);
  if (room.quizmasterId !== quizmasterId) throw errors.notFound();
  return room;
}

export interface NicknameRule {
  ok: boolean;
  message?: string;
}

export function nicknameRule(nickname: unknown): NicknameRule {
  if (typeof nickname !== 'string') return { ok: false, message: 'Enter a nickname' };
  const trimmed = nickname.trim();
  if (trimmed.length < 1 || trimmed.length > 20) {
    return { ok: false, message: 'A nickname is 1 to 20 characters' };
  }
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    return { ok: false, message: 'A nickname has no control characters' };
  }
  return { ok: true };
}

export async function joinRoom(db: Pool, pin: unknown, nickname: unknown): Promise<JoinResult> {
  const fields: Record<string, string> = {};
  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
    fields.pin = 'The PIN is six digits';
  }
  const nick = nicknameRule(nickname);
  if (!nick.ok && nickname !== undefined) fields.nickname = nick.message ?? 'Enter a nickname';
  if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);

  const client = await db.connect();
  try {
    await client.query('begin');
    const found = await client.query(
      `select id, state from rooms where pin = $1 and ended_reason is null for update`,
      [pin],
    );
    if (found.rowCount === 0) {
      throw errors.roomNotFound();
    }
    const row = found.rows[0];
    const roomId = String(row.id);
    const state = String(row.state);
    if (state === 'podium' || state === 'ended') throw errors.roomClosed();
    const seatCount = await client.query('select count(*)::int as n from seats where room_id = $1', [roomId]);
    if (Number(seatCount.rows[0].n) >= MAX_SEATS) throw errors.roomFull();
    const trimmed = (nickname as string).trim();
    try {
      await client.query(
        `insert into seats (id, room_id, nickname, nickname_lower, rejoin_token_hash, joined_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), roomId, trimmed, trimmed.toLowerCase(), tokenHash(newRejoinToken()), Date.now()],
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw errors.nicknameTaken();
      throw err;
    }
    const seatRow = await client.query('select id, rejoin_token_hash from seats where room_id = $1 and nickname_lower = $2', [roomId, trimmed.toLowerCase()]);
    const seatId = String(seatRow.rows[0].id);
    const rejoinToken = newRejoinToken();
    await client.query('update seats set rejoin_token_hash = $2 where id = $1', [seatId, tokenHash(rejoinToken)]);
    const clientId = newClientId();
    await client.query(
      `insert into clients (id, room_id, seat_id, kind, rejoin_token_hash, created_at, last_seen_at)
       values ($1, $2, $3, 'player', $4, $5, $5)`,
      [clientId, roomId, seatId, tokenHash(rejoinToken), Date.now()],
    );
    await client.query(`update rooms set empty_since = null where id = $1`, [roomId]);
    const seated = Number(seatCount.rows[0].n) + 1;
    const joinedEvent = await appendEvent(client, roomId, 'player_joined', { seatId, nickname: trimmed, seated });
    const presenceEvent = await appendEvent(client, roomId, 'presence', await presenceData(client, roomId));
    await client.query('commit');
    publishEvent(roomId, joinedEvent);
    publishEvent(roomId, presenceEvent);
    return { roomId, seatId, nickname: trimmed, rejoinToken, clientId };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

export async function presenceData(db: PoolClient, roomId: string): Promise<unknown> {
  const seats = await loadSeats(db, roomId);
  const connected = await db.query('select seat_id from clients where room_id = $1 and superseded_at is null', [roomId]);
  const connectedSeatIds = new Set((connected.rows as Record<string, unknown>[]).map((row) => String(row.seat_id)));
  return {
    seated: seats.length,
    connected: connectedSeatIds.size,
    players: seats.map((seat) => ({
      seatId: seat.seatId,
      nickname: seat.nickname,
      connected: connectedSeatIds.has(seat.seatId),
    })),
  };
}

export async function rejoinRoom(db: Pool, rejoinToken: unknown): Promise<RejoinResult> {
  if (typeof rejoinToken !== 'string' || rejoinToken.length < 32) {
    throw errors.invalidRejoinToken();
  }
  const hash = tokenHash(rejoinToken);
  const client = await db.connect();
  try {
    await client.query('begin');
    const seatRow = await client.query(
      `select s.id, s.nickname, s.score, s.streak, s.room_id, r.state, r.ended_reason
       from seats s join rooms r on r.id = s.room_id
       where s.rejoin_token_hash = $1 for update of s`,
      [hash],
    );
    if (seatRow.rowCount === 0) throw errors.invalidRejoinToken();
    const row = seatRow.rows[0];
    if (row.ended_reason !== null) throw errors.roomEnded();
    const clientId = newClientId();
    await retireSeatClients(client, String(row.id));
    await client.query(
      `insert into clients (id, room_id, seat_id, kind, rejoin_token_hash, created_at, last_seen_at)
       values ($1, $2, $3, 'player', $4, $5, $5)`,
      [clientId, String(row.room_id), String(row.id), hash, Date.now()],
    );
    await client.query(`update rooms set empty_since = null where id = $1 and empty_since is not null`, [String(row.room_id)]);
    const presenceEvent = await appendEvent(client, String(row.room_id), 'presence', await presenceData(client, String(row.room_id)));
    await client.query('commit');
    publishEvent(String(row.room_id), presenceEvent);
    return {
      roomId: String(row.room_id),
      seatId: String(row.id),
      nickname: String(row.nickname),
      score: Number(row.score),
      streak: Number(row.streak),
      clientId,
    };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

async function retireSeatClients(client: PoolClient, seatId: string): Promise<void> {
  await client.query(
    `update clients set superseded_at = $2 where seat_id = $1 and superseded_at is null`,
    [seatId, Date.now()],
  );
}

export interface AnswerBody {
  clientId: string;
  questionIndex: unknown;
  choice?: unknown;
  estimate?: unknown;
  order?: unknown;
}

export async function submitAnswer(db: Pool, body: AnswerBody): Promise<{ answer: AnswerReceipt }> {
  const client = await db.connect();
  try {
    await client.query('begin');
    const clientRow = await client.query('select * from clients where id = $1', [body.clientId]);
    if (clientRow.rowCount === 0) throw errors.invalidClient();
    const info = clientRow.rows[0];
    if (info.superseded_at !== null) throw errors.clientSuperseded();
    await client.query('update clients set last_seen_at = $2 where id = $1', [body.clientId, Date.now()]);
    const roomRow = await client.query('select state, ended_reason from rooms where id = $1', [String(info.room_id)]);
    if (roomRow.rows[0].ended_reason !== null) throw errors.roomEnded();
    const roomId = String(info.room_id);
    const seatId = String(info.seat_id);
    const room = await loadRoomById(db, roomId);
    const questionIndex = Number(body.questionIndex);
    if (!Number.isInteger(questionIndex)) {
      throw errors.validationFailed({ questionIndex: 'Which question is this for?' });
    }
    if (room.state === 'ended' || room.state === 'podium' || room.state === 'lobby') {
      throw errors.questionNotOpen(room.state);
    }
    if (room.questionIndex === null || questionIndex !== room.questionIndex) {
      throw errors.questionNotOpen(room.state);
    }
    const question = room.questions[questionIndex - 1];
    if (!question) throw errors.questionNotOpen(room.state);
    const receivedAt = Date.now();
    const deadlineAt = room.deadlineAt ?? receivedAt;
    if (room.state !== 'question_open' || receivedAt > deadlineAt) {
      // the window is closed whether by the host or by the deadline
      throw errors.windowClosed(deadlineAt - receivedAt);
    }

    const opensAt = room.opensAt ?? receivedAt;
    const latencyMs = Math.max(0, receivedAt - opensAt);
    const remainingMs = deadlineAt - receivedAt;

    let choice: number | null = null;
    let estimate: number | null = null;
    let order: string[] | null = null;
    const fields: Record<string, string> = {};
    const content = question.content;
    if (content.type === 'multiple_choice') {
      if (typeof body.choice !== 'number' || !Number.isInteger(body.choice)) {
        fields.choice = 'Pick an option';
      } else if (body.choice < 0 || body.choice >= content.options.length) {
        fields.choice = 'That option does not exist';
      } else {
        choice = body.choice;
      }
      if (body.estimate !== undefined || body.order !== undefined) {
        fields.choice = 'This question takes an option';
      }
    } else if (content.type === 'estimate') {
      const value = typeof body.estimate === 'string' ? Number(body.estimate) : body.estimate;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        fields.estimate = 'Set an estimate';
      } else if (value < content.min || value > content.max) {
        fields.estimate = 'Estimates lie within the range';
      } else if (content.step !== 0 && Math.abs(value / content.step - Math.round(value / content.step)) > 1e-9) {
        fields.estimate = 'Estimates move by the step';
      } else {
        estimate = value;
      }
      if (body.choice !== undefined || body.order !== undefined) {
        fields.estimate = 'This question takes an estimate';
      }
    } else {
      const submitted = Array.isArray(body.order) ? body.order : null;
      const expected = content.items.length;
      if (!submitted || submitted.length !== expected || !submitted.every((x) => typeof x === 'string')) {
        fields.order = 'Put the items in order';
      } else {
        const known = new Set(content.items.map((label) => itemIdFor(question.id, label)));
        const valid = submitted.every((id) => known.has(id)) && new Set(submitted).size === expected;
        if (!valid) {
          fields.order = 'Order every item exactly once';
        } else {
          order = submitted;
        }
      }
      if (body.choice !== undefined || body.estimate !== undefined) {
        fields.order = 'This question takes an order';
      }
    }
    if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);

    try {
      await client.query(
        `insert into answers (room_id, seat_id, question_index, latency_ms, received_at, choice, estimate, "order")
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [roomId, seatId, questionIndex, latencyMs, receivedAt, choice, estimate, order],
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw errors.alreadyAnswered();
      throw err;
    }
    const counted = await client.query(
      'select count(*)::int as n from answers where room_id = $1 and question_index = $2',
      [roomId, questionIndex],
    );
    const countEvent = await appendEvent(client, roomId, 'answer_count', {
      questionIndex,
      answered: Number(counted.rows[0].n),
      seated: (await loadSeats(client, roomId)).length,
    });
    await client.query('commit');
    publishEvent(roomId, countEvent);
    return { answer: { latencyMs, remainingMs } };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

export async function applyHostCommand(
  db: Pool,
  roomId: string,
  command: HostCommand,
): Promise<{ room: RoomSnapshot; reveal: RevealPayload | null }> {
  const client = await db.connect();
  try {
    await client.query('begin');
    const roomRow = await client.query(`select r.*, rqs.content as snapshot, rqs.last_event_id from rooms r join snapshots rqs on rqs.id = r.snapshot_id where r.id = $1 for update of r`, [roomId]);
    if (roomRow.rowCount === 0) throw errors.notFound();
    const room = roomFromRow(roomRow.rows[0]);
    const target = transitionFor(room.state, command);
    if (target === null) {
      if (noMoreQuestions(room.state, command, room.questionIndex, room.questions.length)) {
        throw errors.noMoreQuestions();
      }
      throw errors.illegalTransition(room.state, command);
    }
    let reveal: RevealPayload | null = null;
    let standings: Standing[] | null = null;
    const pending: RoomEvent[] = [];
    if (command === 'open_question') {
      const nextIndex = (room.questionIndex ?? 0) + 1;
      const question = room.questions[nextIndex - 1];
      if (!question) throw errors.noMoreQuestions();
      const opensAt = Date.now();
      const deadlineAt = opensAt + question.timeLimitSeconds * 1000;
      await client.query(
        `update rooms set state = 'question_open', question_index = $2, opens_at = $3, deadline_at = $4, locked_reason = null where id = $1`,
        [roomId, nextIndex, opensAt, deadlineAt],
      );
      const imageUrl = await presignedQuestionImage(question);
      const payload = {
        index: nextIndex,
        type: question.content.type,
        prompt: question.prompt,
        timeLimitMs: question.timeLimitSeconds * 1000,
        opensAt,
        deadlineAt,
        imageUrl,
        ...(question.content.type === 'multiple_choice'
          ? { options: question.content.options }
          : question.content.type === 'estimate'
            ? { min: question.content.min, max: question.content.max, step: question.content.step, unit: question.content.unit }
            : { items: sequenceProjection(question) }),
      };
      pending.push(await appendEvent(client, roomId, 'question_open', payload));
    } else if (command === 'lock') {
      await client.query(
        `update rooms set state = 'locked', locked_reason = 'host' where id = $1`,
        [roomId],
      );
      pending.push(await appendEvent(client, roomId, 'locked', { questionIndex: room.questionIndex, reason: 'host' }));
    } else if (command === 'reveal') {
      reveal = await computeReveal(client, room, room.questionIndex ?? 1);
      await client.query(`update rooms set state = 'reveal' where id = $1`, [roomId]);
      pending.push(await appendEvent(client, roomId, 'reveal', reveal));
      const seats = await loadSeats(client, roomId);
      standings = rankSeats(seats);
      await writeLeaderboard(roomId, standings, false);
    } else if (command === 'show_leaderboard') {
      const seats = await loadSeats(client, roomId);
      standings = rankSeats(seats);
      await client.query(`update rooms set state = 'leaderboard' where id = $1`, [roomId]);
      pending.push(await appendEvent(client, roomId, 'leaderboard', { standings }));
    } else if (command === 'show_podium') {
      const seats = await loadSeats(client, roomId);
      standings = rankSeats(seats);
      await client.query(`update rooms set state = 'podium' where id = $1`, [roomId]);
      pending.push(await appendEvent(client, roomId, 'podium', { top: standings.slice(0, 3), standings }));
    } else {
      const endEvent = await appendEvent(client, roomId, 'ended', { reason: 'host' });
      pending.push(endEvent);
      await client.query(
        `update rooms set state = 'ended', ended_reason = 'host', ended_at = $2 where id = $1`,
        [roomId, Date.now()],
      );
      await client.query(
        `insert into nights (room_id, deck_title, ended_at)
         select $1, deck_title, $2 from rooms where id = $1
         on conflict (room_id) do nothing`,
        [roomId, Date.now()],
      );
    }
    await client.query('commit');
    for (const event of pending) publishEvent(roomId, event);
    const fresh = await loadRoomById(db, roomId);
    if (standings && isLiveUp()) {
      await writeLeaderboard(roomId, standings, true);
    }
    return { room: fresh, reveal };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

function sequenceProjection(question: RoomSnapshot['questions'][number]): { id: string; label: string }[] {
  const content = question.content;
  if (content.type !== 'sequence') return [];
  const pairs = content.items.map((label) => ({ id: itemIdFor(question.id, label), label }));
  // deterministic shuffle so no client learns the order from the ids
  let state = 0;
  const seed = `${question.id}`;
  for (let i = 0; i < seed.length; i += 1) state = (state * 31 + seed.charCodeAt(i)) >>> 0;
  const out = [...pairs];
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

export async function endRoomInternal(db: PoolClient, roomId: string, reason: 'host' | 'idle'): Promise<RoomEvent> {
  await db.query(
    `update rooms set state = 'ended', ended_reason = $2, ended_at = $3, opens_at = null, deadline_at = null where id = $1`,
    [roomId, reason, Date.now()],
  );
  await db.query(
    `insert into nights (room_id, deck_title, ended_at)
     select $1, deck_title, $2 from rooms where id = $1
     on conflict (room_id) do nothing`,
    [roomId, Date.now()],
  );
  return appendEvent(db, roomId, 'ended', { reason });
}

export async function maybeAutoLock(db: Pool, roomId: string): Promise<boolean> {
  const client = await db.connect();
  try {
    await client.query('begin');
    const roomRow = await client.query(`select r.*, rqs.content as snapshot, rqs.last_event_id from rooms r join snapshots rqs on rqs.id = r.snapshot_id where r.id = $1 for update of r`, [roomId]);
    if (roomRow.rowCount === 0) {
      await client.query('rollback');
      return false;
    }
    const room = roomFromRow(roomRow.rows[0]);
    if (room.state !== 'question_open' || room.deadlineAt === null) {
      await client.query('rollback');
      return false;
    }
    const late = Date.now() > room.deadlineAt;
    if (!late) {
      await client.query('rollback');
      return false;
    }
    await client.query(
      `update rooms set state = 'locked', locked_reason = 'deadline' where id = $1`,
      [roomId],
    );
    const lockEvent = await appendEvent(client, roomId, 'locked', { questionIndex: room.questionIndex, reason: 'deadline' });
    await client.query('commit');
    publishEvent(roomId, lockEvent);
    return true;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

export async function maybeIdleEnd(db: Pool, roomId: string, idleSeconds: number): Promise<boolean> {
  const client = await db.connect();
  try {
    await client.query('begin');
    const roomRow = await client.query(`select r.*, rqs.content as snapshot, rqs.last_event_id from rooms r join snapshots rqs on rqs.id = r.snapshot_id where r.id = $1 for update of r`, [roomId]);
    if (roomRow.rowCount === 0) {
      await client.query('rollback');
      return false;
    }
    const room = roomFromRow(roomRow.rows[0]);
    if (room.endedReason !== null || room.emptySince === null) {
      await client.query('rollback');
      return false;
    }
    if (Date.now() - room.emptySince < idleSeconds * 1000) {
      await client.query('rollback');
      return false;
    }
    const endEvent = await endRoomInternal(client, roomId, 'idle');
    await client.query('commit');
    publishEvent(roomId, endEvent);
    return true;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
