import { config } from '../config.js';
import { figureStrings, mmss, mss, outcomeLine, utcStamp } from '../../shared/format.js';
import type { Debrief } from '../../shared/types.js';

export function inviteMessage(roomName: string, startsAt: Date, token: string): { subject: string; body: string } {
  return {
    subject: `Playtest invite: ${roomName}`,
    body: [`You are invited to a remote playtest of ${roomName}.`, '', `Starts ${utcStamp(startsAt.toISOString())} UTC`, '', `Join: ${config.publicOrigin}/play/${token}`].join('\n'),
  };
}

export function debriefMessage(roomName: string, debrief: Omit<Debrief, 'emailStatus'>): { subject: string; body: string } {
  const lines = [
    outcomeLine(debrief.outcome, debrief.elapsedSeconds),
    ...figureStrings(debrief.stats),
    '',
    ...debrief.puzzles.map((p) => `${p.title} — ${p.solvedAtSeconds === null ? 'not solved' : mmss(p.solvedAtSeconds)}`),
    '',
    `Hints used: ${debrief.hintsUsed}`,
    debrief.chokePoint ? `Choke point: ${debrief.chokePoint.title} (${mss(debrief.chokePoint.waitSeconds)} waiting)` : 'Choke point: none',
  ];
  return { subject: `Playtest debrief: ${roomName}`, body: lines.join('\n') };
}
