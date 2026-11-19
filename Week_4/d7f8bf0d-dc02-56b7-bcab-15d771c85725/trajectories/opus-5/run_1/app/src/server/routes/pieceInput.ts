import type { PieceInput } from '../../shared/protocol.js';
import { errors } from '../errors.js';

function whole(value: unknown, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw errors.invalidFields();
  }
  return value as number;
}

function hand(value: unknown): 'left' | 'right' {
  if (value !== 'left' && value !== 'right') throw errors.invalidFields();
  return value;
}

export function parsePieceInput(raw: unknown): PieceInput {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw errors.invalidFields();
  const body = raw as Record<string, unknown>;
  const rise = body['rise_mm'] === undefined ? 0 : whole(body['rise_mm'], -2000, 2000);
  const mainline = body['mainline'] === undefined ? true : body['mainline'];
  if (typeof mainline !== 'boolean') throw errors.invalidFields();

  switch (body['kind']) {
    case 'straight':
      return {
        kind: 'straight',
        length_mm: whole(body['length_mm'], 1, 100_000),
        rise_mm: rise,
        mainline,
      };
    case 'curve':
      return {
        kind: 'curve',
        radius_mm: whole(body['radius_mm'], 1, 100_000),
        angle_deg: whole(body['angle_deg'], 1, 180),
        hand: hand(body['hand']),
        rise_mm: rise,
        mainline,
      };
    case 'turnout':
      return {
        kind: 'turnout',
        frog_number: whole(body['frog_number'], 1, 40),
        hand: hand(body['hand']),
        length_mm: whole(body['length_mm'], 1, 100_000),
        rise_mm: rise,
        mainline,
      };
    default:
      throw errors.invalidFields();
  }
}
