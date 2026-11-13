import { limits } from '../config';
import { sanitiserVerdict, type SanitiserResult } from '../../shared/sanitiser';
import type { ForensicsLine, ForensicsStage } from '../../shared/types';
import type { LinkStage } from './unfurl';

/** The one place a message's four verdicts are shaped. */

export const STAGE_ORDER: ForensicsStage[] = ['signature', 'bucket', 'sanitiser', 'link'];

export function checkingLine(stage: ForensicsStage): ForensicsLine {
  const line: ForensicsLine = { stage, state: 'checking', verdict: 'checking' };
  if (stage === 'bucket') return { ...line, previous: null, level: null, capacity: null };
  if (stage === 'sanitiser') return { ...line, before: null, after: null, removed: [] };
  if (stage === 'link') return { ...line, url: null, address: null };
  return line;
}

export function signatureLine(verdict: string): ForensicsLine {
  return { stage: 'signature', state: 'settled', verdict };
}

export function bucketLine(previous: number, level: number): ForensicsLine {
  return {
    stage: 'bucket',
    state: 'settled',
    verdict: `${level} of ${limits.bucketCapacity}`,
    previous,
    level,
    capacity: limits.bucketCapacity,
  };
}

export function notMeteredLine(): ForensicsLine {
  return { stage: 'bucket', state: 'settled', verdict: 'not metered', previous: null, level: null, capacity: null };
}

export function sanitiserLine(result: SanitiserResult): ForensicsLine {
  return {
    stage: 'sanitiser',
    state: 'settled',
    verdict: sanitiserVerdict(result.removed.length),
    before: result.before,
    after: result.after,
    removed: result.removed,
  };
}

export function noPlayerTextLine(): ForensicsLine {
  return {
    stage: 'sanitiser',
    state: 'settled',
    verdict: 'no player text',
    before: null,
    after: null,
    removed: [],
  };
}

export function linkLine(stage: LinkStage): ForensicsLine {
  return {
    stage: 'link',
    state: 'settled',
    verdict: stage.verdict,
    url: stage.url,
    address: stage.address,
  };
}

export function noLinkLine(): ForensicsLine {
  return { stage: 'link', state: 'settled', verdict: 'no link', url: null, address: null };
}

export function playerMessageForensics(
  sanitised: SanitiserResult,
  bucket: { previous: number; level: number },
  link: LinkStage | null,
): ForensicsLine[] {
  return [
    signatureLine('signature valid'),
    bucketLine(bucket.previous, bucket.level),
    sanitiserLine(sanitised),
    link === null ? checkingLine('link') : linkLine(link),
  ];
}

export function eventForensics(signatureVerdict: string): ForensicsLine[] {
  return [signatureLine(signatureVerdict), notMeteredLine(), noPlayerTextLine(), noLinkLine()];
}

export function isSettled(lines: readonly ForensicsLine[]): boolean {
  return lines.every((line) => line.state === 'settled');
}
