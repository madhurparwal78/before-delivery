import { randomUUID, randomInt } from 'node:crypto';
import { OPENING_BALANCE } from '../shared/catalogue.js';
import type { Queryable } from './db.js';
import { db, one, withPlayerLock } from './db.js';
import { balanceOf, writeMovement } from './ledger.js';

const GUEST_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function guestName(): string {
  let suffix = '';
  for (let index = 0; index < 4; index += 1) {
    suffix += GUEST_ALPHABET[randomInt(GUEST_ALPHABET.length)]!;
  }
  return `Guest ${suffix}`;
}

export function accountName(email: string): string {
  return email.slice(0, email.indexOf('@'));
}

export interface PlayerRow {
  player_id: string;
  name: string;
  guest: boolean;
  email: string | null;
  units: 'kmh' | 'mph';
  selected_car_id: string;
  trophy: boolean;
}

export async function playerBySession(sessionId: string): Promise<PlayerRow | null> {
  return await one<PlayerRow>(
    db,
    `select p.player_id, p.name, p.guest, p.email, p.units, p.selected_car_id, p.trophy
     from sessions s join players p on p.player_id = s.player_id
     where s.session_id = $1 and p.retired = false`,
    [sessionId],
  );
}

export async function createSession(tx: Queryable, playerId: string): Promise<string> {
  const sessionId = randomUUID();
  await tx.query('insert into sessions (session_id, player_id) values ($1, $2)', [
    sessionId,
    playerId,
  ]);
  return sessionId;
}

export interface NewPlayer {
  playerId: string;
  name: string;
  sessionId: string;
  balance: number;
}

export async function createPlayer(options: {
  guest: boolean;
  name: string;
  email: string | null;
  cars: string[];
  balance: number;
}): Promise<NewPlayer> {
  const playerId = randomUUID();
  return await withPlayerLock(playerId, async (tx) => {
    await tx.query(
      `insert into players (player_id, name, guest, email, selected_car_id)
       values ($1, $2, $3, $4, $5)`,
      [playerId, options.name, options.guest, options.email, options.cars[0] ?? 'kestrel-hatch'],
    );
    for (const carId of options.cars) {
      await tx.query(
        'insert into owned_cars (player_id, car_id) values ($1, $2) on conflict do nothing',
        [playerId, carId],
      );
    }
    if (options.balance !== 0) {
      await writeMovement(tx, { playerId, kind: 'opening', amount: options.balance });
    }
    const sessionId = await createSession(tx, playerId);
    return {
      playerId,
      name: options.name,
      sessionId,
      balance: await balanceOf(tx, playerId),
    };
  });
}

export async function createGuest(starterCarId: string): Promise<NewPlayer> {
  return await createPlayer({
    guest: true,
    name: guestName(),
    email: null,
    cars: [starterCarId],
    balance: OPENING_BALANCE,
  });
}

export async function meBody(tx: Queryable, player: PlayerRow): Promise<Record<string, unknown>> {
  return {
    playerId: player.player_id,
    name: player.name,
    guest: player.guest,
    email: player.email,
    units: player.units,
    balance: await balanceOf(tx, player.player_id),
  };
}
