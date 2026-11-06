import { config } from '../config.js';
import { startsAtLocal, type PlanRitual } from '../../shared/plan.js';

export interface Letter {
  recipient: string;
  subject: string;
  body: string;
  linkToken: string | null;
}

const ritualLines = (rituals: PlanRitual[]): string =>
  rituals.map((ritual) => `- ${ritual.title} · ${ritual.minutes} min`).join('\n');

const totalMinutes = (rituals: PlanRitual[]): number =>
  rituals.reduce((sum, ritual) => sum + ritual.minutes, 0);

const linkLine = (token: string): string =>
  `${config.publicOrigin}/signin?token=${token}\n\nThis link works once, for 15 minutes.`;

export function confirmationLetter(input: {
  email: string;
  bedtime: string;
  timeZone: string;
  rituals: PlanRitual[];
  token: string;
}): Letter {
  const body = [
    'Your Stillhour is nearly ready.',
    '',
    `Bedtime: ${input.bedtime}`,
    `Time zone: ${input.timeZone}`,
    `Your hour starts at ${startsAtLocal(input.bedtime)}.`,
    '',
    'Your rituals:',
    ritualLines(input.rituals),
    `${totalMinutes(input.rituals)} minutes in all.`,
    '',
    'Confirm your hour:',
    linkLine(input.token),
  ].join('\n');
  return { recipient: input.email, subject: 'Confirm your Stillhour', body, linkToken: input.token };
}

export function signInLetter(input: { email: string; token: string }): Letter {
  const body = [
    'Here is your sign-in link for Stillhour.',
    '',
    linkLine(input.token),
    '',
    'If you did not ask for this, you can ignore it.',
  ].join('\n');
  return { recipient: input.email, subject: 'Your Stillhour sign-in link', body, linkToken: input.token };
}

export function reminderLetter(input: {
  email: string;
  bedtime: string;
  localTime: string;
  rituals: PlanRitual[];
}): Letter {
  const body = [
    `Your Stillhour starts at ${input.localTime}.`,
    '',
    `Bedtime: ${input.bedtime}`,
    '',
    'Your rituals:',
    ritualLines(input.rituals),
    `${totalMinutes(input.rituals)} minutes in all.`,
    '',
    'Change or pause reminders:',
    `${config.publicOrigin}/manage`,
  ].join('\n');
  return {
    recipient: input.email,
    subject: `Your Stillhour starts at ${input.localTime}`,
    body,
    linkToken: null,
  };
}
