import { db } from '../db';
import { formatCredits, formatWholeCredits } from '../domain/money';
import { BudgetPeriod } from '../domain/period';
import { longDateOf } from '../domain/zone';
import { Member } from '../types';
import { membersByRoles, membersOfTeam, Team } from '../store/people';
import { TopupRecord } from '../store/topups';
import { sendMail } from './mail';

async function claimNotice(teamId: string, periodStart: Date, kind: 'soft_cap' | 'hard_cap'): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO cap_notices (team_id, period_start, kind, sent_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (team_id, period_start, kind) DO NOTHING`,
    [teamId, periodStart, kind],
  );
  return rowCount > 0;
}

/** One soft cap email per team per period. */
export async function noticeSoftCap(
  team: Team,
  period: BudgetPeriod,
  spendMicro: bigint,
  softCapMicro: bigint,
): Promise<void> {
  if (!(await claimNotice(team.id, period.startsAt, 'soft_cap'))) return;
  const recipients = await membersByRoles(['admin', 'finance']);
  await sendMail({
    to: recipients.map((member) => member.email),
    subject: `Soft cap passed: ${team.name}, ${period.label}`,
    body:
      `${team.name} has spent ${formatCredits(spendMicro)} credits in ${period.label}, ` +
      `which has passed its soft cap of ${formatCredits(softCapMicro)} credits.`,
  });
}

/** One hard cap email per team per period, at the first refusal. */
export async function noticeHardCap(team: Team, period: BudgetPeriod, timezone: string): Promise<void> {
  if (!(await claimNotice(team.id, period.startsAt, 'hard_cap'))) return;
  const orgRoles = await membersByRoles(['admin', 'finance']);
  const teamMembers = await membersOfTeam(team.id);
  const recipients = [...new Set([...orgRoles, ...teamMembers].map((member) => member.email))];
  await sendMail({
    to: recipients,
    subject: `Hard cap reached: ${team.name}, ${period.label}`,
    body:
      `${team.name} has reached its hard cap for ${period.label}. ` +
      `New jobs are throttled until ${longDateOf(period.endsAt, timezone)}.`,
  });
}

export async function noticeEndpointDisabled(
  team: Team,
  url: string,
  lastStatusCode: number | null,
): Promise<void> {
  const admins = await membersByRoles(['admin']);
  await sendMail({
    to: admins.map((member) => member.email),
    subject: `Webhook endpoint disabled: ${team.name}`,
    body:
      `The webhook endpoint ${url} for ${team.name} has been disabled after six failed attempts in a row. ` +
      `The last attempt answered ${lastStatusCode === null ? 'no answer' : String(lastStatusCode)}.`,
  });
}

export async function noticeTopupReceipt(requester: Member, team: Team, topup: TopupRecord): Promise<void> {
  await sendMail({
    to: [requester.email],
    subject: `Top-up receipt: ${formatWholeCredits(topup.credits)} credits for ${team.name}`,
    body:
      `Your top-up of ${formatWholeCredits(topup.credits)} credits for ${team.name} has been paid. ` +
      `The charge was USD ${topup.amountUsd} and the Kill Bill invoice id is ${topup.kbInvoiceId ?? ''}.`,
  });
}
