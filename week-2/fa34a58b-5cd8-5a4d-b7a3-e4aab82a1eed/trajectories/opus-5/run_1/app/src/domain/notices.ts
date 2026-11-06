/**
 * Schedule-change notice timing and every notice's subject and body
 * are decided here and nowhere else.
 */

import {
  formatHhMm,
  formatHhMmSs,
  householdDayOf,
  longDate,
  resolveWallInstant,
  type HouseholdDay,
} from './time';

/** A saved version takes effect at 05:00:00 household time on its from date. */
const EFFECT_WALL_TIME = '05:00';

export function scheduleEffectInstant(from: HouseholdDay): Date {
  const instant = resolveWallInstant(from, EFFECT_WALL_TIME);
  if (!instant) throw new Error(`No ${EFFECT_WALL_TIME} on ${from}`);
  return instant;
}

/** A version's schedule-change notice is due once the hub clock is at or past its effect instant. */
export function scheduleChangeNoticeIsDue(from: HouseholdDay, now: Date): boolean {
  return now.getTime() >= scheduleEffectInstant(from).getTime();
}

export interface NoticeMessage {
  subject: string;
  body: string;
}

export function guestSceneEndedMessage(input: {
  roomName: string;
  sceneName: string;
  endsAt: Date;
  scheduledSceneName: string;
}): NoticeMessage {
  return {
    subject: `Guest scene ended: ${input.roomName}`,
    body:
      `The guest scene ${input.sceneName} in ${input.roomName} ended at ` +
      `${formatHhMm(input.endsAt)} on ${longDate(householdDayOf(input.endsAt))}. ` +
      `${input.roomName} is back on ${input.scheduledSceneName}.`,
  };
}

export function scheduleChangeMessage(input: {
  scheduleName: string;
  from: HouseholdDay;
  slots: { time: string; sceneName: string; roomNames: string[] }[];
}): NoticeMessage {
  return {
    subject: `Schedule change takes effect: ${input.scheduleName}`,
    body: [
      `From ${longDate(input.from)}, the ${input.scheduleName} schedule runs these slots:`,
      ...input.slots.map(
        (slot) => `${slot.time} ${slot.sceneName} — ${slot.roomNames.join(', ')}`,
      ),
    ].join('\n'),
  };
}

export function motionMessage(input: {
  cameraName: string;
  recordedAt: Date;
  storedSize: number;
}): NoticeMessage {
  return {
    subject: `Motion on ${input.cameraName}`,
    body:
      `${input.cameraName} recorded motion at ${formatHhMmSs(input.recordedAt)} on ` +
      `${longDate(householdDayOf(input.recordedAt))}. ` +
      `The clip is stored on the hub (${input.storedSize} bytes).`,
  };
}
