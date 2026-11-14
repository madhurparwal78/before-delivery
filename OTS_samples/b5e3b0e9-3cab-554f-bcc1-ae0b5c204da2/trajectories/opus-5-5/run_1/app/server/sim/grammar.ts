import type { Position } from '../../shared/types.js';

export type Command =
  | { verb: 'PUSH' }
  | { verb: 'TAXI'; point: string; via: string[] }
  | { verb: 'HOLD' }
  | { verb: 'CONTINUE' }
  | { verb: 'CONTACT' }
  | { verb: 'LINEUP'; runway: string }
  | { verb: 'TAKEOFF'; runway: string }
  | { verb: 'LAND'; runway: string }
  | { verb: 'CROSS'; runway: string; point: string }
  | { verb: 'GOAROUND' }
  | { verb: 'NEGATIVE'; what: 'RUNWAY' | 'HP'; value: string };

/** The spoken first word of each instruction and the position that owns it, `null` for both. */
const OWNERS: Record<string, Position | null> = {
  PUSH: 'GND',
  TAXI: 'GND',
  CONTACT: 'GND',
  HOLD: null,
  CONTINUE: null,
  LINEUP: 'TWR',
  CLEARED: 'TWR',
  CROSS: 'TWR',
  GO: 'TWR',
  NEGATIVE: null,
};

const USAGE: Record<string, string> = {
  PUSH: '<CS> PUSH APPROVED',
  TAXI: '<CS> TAXI HP <point> VIA <taxiways>',
  HOLD: '<CS> HOLD POSITION',
  CONTINUE: '<CS> CONTINUE TAXI',
  CONTACT: '<CS> CONTACT TOWER',
  LINEUP: '<CS> LINEUP <rwy>',
  TAKEOFF: '<CS> CLEARED TAKEOFF <rwy>',
  LAND: '<CS> CLEARED LAND <rwy>',
  CLEARED: '<CS> CLEARED TAKEOFF <rwy> or <CS> CLEARED LAND <rwy>',
  CROSS: '<CS> CROSS <rwy> AT <point>',
  GO: '<CS> GO AROUND',
  NEGATIVE: '<CS> NEGATIVE RUNWAY <rwy> or <CS> NEGATIVE HP <point>',
};

export const GENERAL_USAGE = 'Usage: <CALLSIGN> <VERB> <ARGS>.';

export function normalise(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toUpperCase();
}

export type Grammar =
  | { ok: true; command: Command }
  | { ok: false; message: string };

const usage = (key: string): Grammar => ({ ok: false, message: `Usage: ${USAGE[key]}.` });

/** Checks 4 to 6 of the refusal order, on the words after the callsign. */
export function parseInstruction(words: string[], position: Position): Grammar {
  const verb = words[0];
  if (verb === undefined) return { ok: false, message: GENERAL_USAGE };
  if (!(verb in OWNERS)) return { ok: false, message: `Unknown command ${verb}.` };
  const owner = OWNERS[verb];
  if (owner && owner !== position) {
    return { ok: false, message: `${verb} is a ${owner === 'GND' ? 'Ground' : 'Tower'} instruction.` };
  }
  const args = words.slice(1);
  const exactly = (expected: string[]) => args.length === expected.length && expected.every((word, i) => args[i] === word);
  switch (verb) {
    case 'PUSH':
      return exactly(['APPROVED']) ? { ok: true, command: { verb: 'PUSH' } } : usage('PUSH');
    case 'HOLD':
      return exactly(['POSITION']) ? { ok: true, command: { verb: 'HOLD' } } : usage('HOLD');
    case 'CONTINUE':
      return exactly(['TAXI']) ? { ok: true, command: { verb: 'CONTINUE' } } : usage('CONTINUE');
    case 'CONTACT':
      return exactly(['TOWER']) ? { ok: true, command: { verb: 'CONTACT' } } : usage('CONTACT');
    case 'GO':
      return exactly(['AROUND']) ? { ok: true, command: { verb: 'GOAROUND' } } : usage('GO');
    case 'LINEUP':
      return args.length === 1 ? { ok: true, command: { verb: 'LINEUP', runway: args[0]! } } : usage('LINEUP');
    case 'TAXI': {
      if (args[0] !== 'HP' || args.length < 2) return usage('TAXI');
      const rest = args.slice(2);
      if (rest.length > 0 && rest[0] !== 'VIA') return usage('TAXI');
      return { ok: true, command: { verb: 'TAXI', point: args[1]!, via: rest.slice(1) } };
    }
    case 'CLEARED': {
      const kind = args[0];
      if (kind === 'TAKEOFF' || kind === 'LAND') {
        if (args.length !== 2) return usage(kind);
        return { ok: true, command: { verb: kind, runway: args[1]! } };
      }
      return usage('CLEARED');
    }
    case 'CROSS':
      return args.length === 3 && args[1] === 'AT'
        ? { ok: true, command: { verb: 'CROSS', runway: args[0]!, point: args[2]! } }
        : usage('CROSS');
    default: {
      const what = args[0];
      return args.length === 2 && (what === 'RUNWAY' || what === 'HP')
        ? { ok: true, command: { verb: 'NEGATIVE', what, value: args[1]! } }
        : usage('NEGATIVE');
    }
  }
}
