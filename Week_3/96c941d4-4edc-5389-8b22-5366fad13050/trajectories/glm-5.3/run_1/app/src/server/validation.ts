import { LIMITS } from '../shared/seed.js';
import {
  FieldErrors,
  FIELD_MESSAGE,
  isObject,
  isInteger,
  codePoints,
  utf8Bytes,
  hasForbiddenCharacters,
  hasUnpairedSurrogate,
  DEVICE_IDS,
  validateDefinition,
  rejectUnknownMembers,
} from '../shared/validate.js';
import { Command } from '../shared/sim.js';
import { Definition, DeviceId } from '../shared/seed.js';

export interface AccountInput {
  email: string;
  password: string;
  playerName: string;
}

export function validateAccount(value: unknown, errors: FieldErrors): AccountInput | undefined {
  if (!isObject(value)) {
    errors['email'] = FIELD_MESSAGE;
    return undefined;
  }
  rejectUnknownMembers(value, ['email', 'password', 'playerName'], '', errors);
  const before = Object.keys(errors).length;
  const email = value.email;
  const password = value.password;
  const playerName = value.playerName;
  if (typeof email !== 'string') {
    errors['email'] = FIELD_MESSAGE;
  }
  if (typeof email === 'string' && !hasUnpairedSurrogate(email)) {
    const normalized = email.trim().toLowerCase();
    if (codePoints(normalized) === 0 || codePoints(normalized) > LIMITS.maxEmailCodePoints || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      errors['email'] = FIELD_MESSAGE;
    }
  } else {
    errors['email'] = FIELD_MESSAGE;
  }
  if (typeof password !== 'string' || hasUnpairedSurrogate(password)) {
    errors['password'] = FIELD_MESSAGE;
  } else {
    const passwordBytes = utf8Bytes(password);
    if (passwordBytes < LIMITS.minPasswordBytes || passwordBytes > LIMITS.maxPasswordBytes) {
      errors['password'] = FIELD_MESSAGE;
    }
  }
  if (typeof playerName !== 'string' || hasUnpairedSurrogate(playerName) || hasForbiddenCharacters(playerName)) {
    errors['playerName'] = FIELD_MESSAGE;
  } else {
    const name = playerName.trim();
    if (codePoints(name) < LIMITS.minPlayerNameCodePoints || codePoints(name) > LIMITS.maxPlayerNameCodePoints) {
      errors['playerName'] = FIELD_MESSAGE;
    }
    if (Object.keys(errors).length === before) {
      return { email: email as string, password: password as string, playerName: name };
    }
  }
  return undefined;
}

export function validateSignIn(value: unknown, errors: FieldErrors): { email: string; password: string } | undefined {
  if (!isObject(value)) {
    errors['email'] = FIELD_MESSAGE;
    return undefined;
  }
  rejectUnknownMembers(value, ['email', 'password'], '', errors);
  if (typeof value.email !== 'string' || typeof value.password !== 'string') {
    errors['email'] = FIELD_MESSAGE;
    return undefined;
  }
  return { email: value.email, password: value.password };
}

export type RunMode = 'campaign' | 'playtest' | 'challenge';

export function validateRunCreate(value: unknown, errors: FieldErrors): { mode: RunMode; sourceId: string; revision: number | null; loadout: DeviceId[] } | undefined {
  if (!isObject(value)) {
    errors['mode'] = FIELD_MESSAGE;
    return undefined;
  }
  rejectUnknownMembers(value, ['mode', 'sourceId', 'revision', 'loadout'], '', errors);
  const before = Object.keys(errors).length;
  const mode = value.mode;
  if (mode !== 'campaign' && mode !== 'playtest' && mode !== 'challenge') {
    errors['mode'] = FIELD_MESSAGE;
  }
  const sourceId = value.sourceId;
  if (typeof sourceId !== 'string' || sourceId === '') {
    errors['sourceId'] = FIELD_MESSAGE;
  }
  const revision = value.revision;
  if (revision !== null && !isInteger(revision)) {
    errors['revision'] = FIELD_MESSAGE;
  }
  // Cross-field rule: playtests require the current saved revision; other
  // modes require null revision.
  if (mode === 'playtest' && revision === null) {
    errors['revision'] = FIELD_MESSAGE;
  }
  if ((mode === 'campaign' || mode === 'challenge') && revision !== null) {
    errors['revision'] = FIELD_MESSAGE;
  }
  const loadout = value.loadout;
  const devices: DeviceId[] = [];
  if (!Array.isArray(loadout) || loadout.length < LIMITS.minLoadout || loadout.length > LIMITS.maxLoadout) {
    errors['loadout'] = FIELD_MESSAGE;
  } else {
    for (const item of loadout) {
      if (typeof item !== 'string' || !DEVICE_IDS.includes(item as DeviceId) || devices.includes(item as DeviceId)) {
        errors['loadout'] = FIELD_MESSAGE;
        break;
      }
      devices.push(item as DeviceId);
    }
  }
  if (Object.keys(errors).length > before) {
    return undefined;
  }
  return { mode: mode as RunMode, sourceId: sourceId as string, revision: revision as number | null, loadout: devices };
}

export function validateCommandLog(value: unknown, errors: FieldErrors): Command[] | undefined {
  if (!Array.isArray(value)) {
    errors['commands'] = FIELD_MESSAGE;
    return undefined;
  }
  if (value.length > LIMITS.maxCommands) {
    errors['commands'] = FIELD_MESSAGE;
    return undefined;
  }
  const commands: Command[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (!isObject(item)) {
      errors[`commands[${i}]`] = FIELD_MESSAGE;
      return undefined;
    }
    if (!isInteger(item.seq) || item.seq < 1) {
      errors[`commands[${i}].seq`] = FIELD_MESSAGE;
      return undefined;
    }
    if (!isInteger(item.tick) || item.tick < LIMITS.minCommandTick || item.tick > LIMITS.maxCommandTick) {
      errors[`commands[${i}].tick`] = FIELD_MESSAGE;
      return undefined;
    }
    if (typeof item.type !== 'string') {
      errors[`commands[${i}].type`] = FIELD_MESSAGE;
      return undefined;
    }
    if (!isInteger(item.lane)) {
      errors[`commands[${i}].lane`] = FIELD_MESSAGE;
      return undefined;
    }
    if (!isInteger(item.cell)) {
      errors[`commands[${i}].cell`] = FIELD_MESSAGE;
      return undefined;
    }
    const device = item.device;
    if (device !== null && typeof device !== 'string') {
      errors[`commands[${i}].device`] = FIELD_MESSAGE;
      return undefined;
    }
    commands.push({
      seq: item.seq,
      tick: item.tick,
      type: item.type,
      lane: item.lane,
      cell: item.cell,
      device: device as string | null,
    });
  }
  return commands;
}

export function validateSubmission(value: unknown, errors: FieldErrors): { commands: Command[]; endTick: number } | undefined {
  if (!isObject(value)) {
    errors['commands'] = FIELD_MESSAGE;
    return undefined;
  }
  rejectUnknownMembers(value, ['commands', 'endTick', 'claims'], '', errors);
  const commands = validateCommandLog(value.commands, errors);
  if (!commands) return undefined;
  const endTick = value.endTick;
  if (!isInteger(endTick) || endTick < LIMITS.minEndTick || endTick > LIMITS.maxEndTick) {
    errors['endTick'] = FIELD_MESSAGE;
    return undefined;
  }
  const maxCommandTick = commands.reduce((max, cmd) => Math.max(max, cmd.tick), -1);
  if (endTick < maxCommandTick) {
    errors['endTick'] = FIELD_MESSAGE;
    return undefined;
  }
  return { commands, endTick };
}

export function validateCommandCheck(value: unknown, errors: FieldErrors): { commands: Command[]; atTick: number; proposal: Command } | undefined {
  if (!isObject(value)) {
    errors['commands'] = FIELD_MESSAGE;
    return undefined;
  }
  rejectUnknownMembers(value, ['commands', 'atTick', 'proposal'], '', errors);
  const commands = validateCommandLog(value.commands, errors);
  if (!commands) return undefined;
  const atTick = value.atTick;
  if (!isInteger(atTick) || atTick < 0 || atTick > LIMITS.maxCommandTick) {
    errors['atTick'] = FIELD_MESSAGE;
    return undefined;
  }
  const proposal = value.proposal;
  if (!isObject(proposal)) {
    errors['proposal'] = FIELD_MESSAGE;
    return undefined;
  }
  if (!isInteger(proposal.seq) || proposal.seq < 1) {
    errors['proposal.seq'] = FIELD_MESSAGE;
    return undefined;
  }
  if (!isInteger(proposal.tick)) {
    errors['proposal.tick'] = FIELD_MESSAGE;
    return undefined;
  }
  if (typeof proposal.type !== 'string') {
    errors['proposal.type'] = FIELD_MESSAGE;
    return undefined;
  }
  if (!isInteger(proposal.lane) || !isInteger(proposal.cell)) {
    errors['proposal.lane'] = FIELD_MESSAGE;
    return undefined;
  }
  if (proposal.device !== null && typeof proposal.device !== 'string') {
    errors['proposal.device'] = FIELD_MESSAGE;
    return undefined;
  }
  const combined = commands.length + 1;
  if (combined > LIMITS.maxCommands) {
    errors['commands'] = FIELD_MESSAGE;
    return undefined;
  }
  const laterThanAt = commands.some((cmd) => cmd.tick > atTick);
  if (laterThanAt) {
    errors['commands'] = FIELD_MESSAGE;
    return undefined;
  }
  return {
    commands,
    atTick,
    proposal: {
      seq: proposal.seq,
      tick: proposal.tick,
      type: proposal.type,
      lane: proposal.lane,
      cell: proposal.cell,
      device: proposal.device as string | null,
    },
  };
}

export function validateLevelSave(value: unknown, errors: FieldErrors): { expectedRevision: number; definition: Definition } | undefined {
  if (!isObject(value)) {
    errors['expectedRevision'] = FIELD_MESSAGE;
    return undefined;
  }
  rejectUnknownMembers(value, ['expectedRevision', 'definition'], '', errors);
  if (!isInteger(value.expectedRevision) || value.expectedRevision < 1) {
    errors['expectedRevision'] = FIELD_MESSAGE;
    return undefined;
  }
  const definition = validateDefinition(value.definition, 'definition', errors);
  if (!definition) return undefined;
  return { expectedRevision: value.expectedRevision, definition: definition as Definition };
}

export function validateLevelCreate(value: unknown, errors: FieldErrors): Definition | undefined {
  if (!isObject(value)) {
    errors['definition'] = FIELD_MESSAGE;
    return undefined;
  }
  const before = Object.keys(errors).length;
  rejectUnknownMembers(value, ['definition'], '', errors);
  const definition = validateDefinition(value.definition, 'definition', errors);
  if (!definition || Object.keys(errors).length > before) return undefined;
  return definition as Definition;
}

export function validatePublish(value: unknown, errors: FieldErrors): { expectedRevision: number; proofRunId: string } | undefined {
  if (!isObject(value)) {
    errors['expectedRevision'] = FIELD_MESSAGE;
    return undefined;
  }
  rejectUnknownMembers(value, ['expectedRevision', 'proofRunId'], '', errors);
  if (!isInteger(value.expectedRevision) || value.expectedRevision < 1) {
    errors['expectedRevision'] = FIELD_MESSAGE;
    return undefined;
  }
  if (typeof value.proofRunId !== 'string' || value.proofRunId === '') {
    errors['proofRunId'] = FIELD_MESSAGE;
    return undefined;
  }
  return { expectedRevision: value.expectedRevision, proofRunId: value.proofRunId };
}

export function validateWithdraw(value: unknown, errors: FieldErrors): number | undefined {
  if (!isObject(value)) {
    errors['expectedRevision'] = FIELD_MESSAGE;
    return undefined;
  }
  rejectUnknownMembers(value, ['expectedRevision'], '', errors);
  if (!isInteger(value.expectedRevision) || value.expectedRevision < 1) {
    errors['expectedRevision'] = FIELD_MESSAGE;
    return undefined;
  }
  return value.expectedRevision;
}

export function validatePlayback(value: unknown, errors: FieldErrors): { expectedVersion: number; tick: number; playing: boolean } | undefined {
  if (!isObject(value)) {
    errors['expectedVersion'] = FIELD_MESSAGE;
    return undefined;
  }
  rejectUnknownMembers(value, ['expectedVersion', 'tick', 'playing'], '', errors);
  if (!isInteger(value.expectedVersion) || value.expectedVersion < 0) {
    errors['expectedVersion'] = FIELD_MESSAGE;
    return undefined;
  }
  if (!isInteger(value.tick) || value.tick < 0) {
    errors['tick'] = FIELD_MESSAGE;
    return undefined;
  }
  if (typeof value.playing !== 'boolean') {
    errors['playing'] = FIELD_MESSAGE;
    return undefined;
  }
  return { expectedVersion: value.expectedVersion, tick: value.tick, playing: value.playing };
}
