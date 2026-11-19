import { dayLabel, localTimeOf, localDateOf } from '../../shared/time.js';

export interface MailPayload {
  to: string;
  subject: string;
  body: string;
}

export function inviteMail(input: {
  email: string;
  ownerName: string;
  workspaceName: string;
  origin: string;
  token: string;
}): MailPayload {
  return {
    to: input.email,
    subject: `${input.ownerName} invited you to ${input.workspaceName} on Tidemark Daybook`,
    body: [
      `${input.ownerName} invited you to plan your days in ${input.workspaceName} on Tidemark Daybook.`,
      '',
      `Join here: ${input.origin}/join/${input.token}`,
      '',
      'Tidemark Daybook',
    ].join('\n'),
  };
}

export function digestMail(input: {
  email: string;
  date: string;
  tomorrow: string;
  done: string[];
  carriedOver: string[];
  tomorrowFirst: { title: string; startTime: string } | null;
}): MailPayload {
  const lines: string[] = [];
  lines.push(`Done: ${input.done.length}`);
  for (const title of input.done) lines.push(title);
  lines.push(`Carried over to ${dayLabel(input.tomorrow)}: ${input.carriedOver.length}`);
  for (const title of input.carriedOver) lines.push(title);
  lines.push(
    input.tomorrowFirst
      ? `Tomorrow starts with: ${input.tomorrowFirst.title} at ${input.tomorrowFirst.startTime}`
      : 'Tomorrow starts with: nothing scheduled',
  );
  return {
    to: input.email,
    subject: `Shutdown for ${dayLabel(input.date)}`,
    body: lines.join('\n'),
  };
}

export function trialNoticeMail(input: {
  email: string;
  workspaceName: string;
  trialEndsAt: Date;
  timeZone: string;
}): MailPayload {
  const endDate = dayLabel(localDateOf(input.trialEndsAt, input.timeZone));
  const endTime = localTimeOf(input.trialEndsAt, input.timeZone);
  return {
    to: input.email,
    subject: 'Your Tidemark Daybook trial ends soon',
    body: [
      `Your trial for ${input.workspaceName} ends on ${endDate} at ${endTime} (${input.timeZone}).`,
      '',
      'Convert your subscription to keep planning after it ends.',
      '',
      'Tidemark Daybook',
    ].join('\n'),
  };
}
