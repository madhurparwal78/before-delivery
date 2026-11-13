import { createHash } from 'node:crypto';
import { canonicalize } from '../shared/canonical.js';
import type { JsonValue } from '../shared/canonical.js';
import type { Command, Definition } from '../shared/types.js';

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function definitionJson(definition: Definition): JsonValue {
  return {
    title: definition.title,
    description: definition.description,
    difficulty: definition.difficulty,
    seed: definition.seed,
    buildable: definition.buildable.map((cell) => ({ lane: cell.lane, cell: cell.cell })),
    waves: definition.waves.map((wave) => ({
      tick: wave.tick,
      creature: wave.creature,
      count: wave.count,
      interval: wave.interval,
      lane: wave.lane,
    })),
  };
}

export function evidenceJson(commands: Command[], endTick: number): JsonValue {
  return {
    commands: commands.map((command) => ({
      seq: command.seq,
      tick: command.tick,
      type: command.type,
      lane: command.lane,
      cell: command.cell,
      device: command.device,
    })),
    endTick,
  };
}

export function canonicalDefinitionText(definition: Definition): string {
  return canonicalize(definitionJson(definition));
}

export function canonicalEvidenceText(commands: Command[], endTick: number): string {
  return canonicalize(evidenceJson(commands, endTick));
}

export function definitionDigest(definition: Definition): string {
  return sha256(canonicalDefinitionText(definition));
}

export function evidenceDigest(commands: Command[], endTick: number): string {
  return sha256(canonicalEvidenceText(commands, endTick));
}

export function challengeDigestOf(levelDigest: string, ruleset: string): string {
  return sha256(canonicalize({ levelDigest, ruleset }));
}

export function digestOfText(text: string): string {
  return sha256(text);
}
