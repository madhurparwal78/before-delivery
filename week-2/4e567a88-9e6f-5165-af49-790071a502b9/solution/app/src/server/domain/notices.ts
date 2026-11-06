// The four emails Dispatch sends. Each carries only the facts the brief lists: never a prompt, script,
// input value, input media link or signing secret.

import { pool, rows } from "../db";
import { formatCredits, formatWholeCredits } from "../../shared/money";
import { longDate } from "../../shared/tz";
import { sendMail } from "../services/mail";
import type { BudgetPeriod } from "./period";

async function emailsOf(where: string, params: unknown[]): Promise<string[]> {
  return (await rows<{ email: string }>(pool, `SELECT email FROM members WHERE ${where} ORDER BY position`, params)).map((r) => r.email);
}

export async function mailSoftCap(team: { id: string; name: string }, period: BudgetPeriod, spend: bigint, softCap: bigint): Promise<void> {
  sendMail({
    to: await emailsOf("role IN ('admin', 'finance')", []),
    subject: `Soft cap passed: ${team.name}, ${period.label}`,
    text: [
      `${team.name} passed its soft cap for ${period.label}.`,
      "",
      `Period spend: ${formatCredits(spend)} credits`,
      `Soft cap: ${formatCredits(softCap)} credits`,
    ].join("\n"),
  });
}

export async function mailHardCap(team: { id: string; name: string }, period: BudgetPeriod, zone: string): Promise<void> {
  sendMail({
    to: await emailsOf("role IN ('admin', 'finance') OR team_id = $1", [team.id]),
    subject: `Hard cap reached: ${team.name}, ${period.label}`,
    text: [
      `${team.name} reached its hard cap for ${period.label}.`,
      "",
      `New jobs are throttled until ${longDate(period.endsAt.getTime(), zone)}.`,
    ].join("\n"),
  });
}

export async function mailEndpointDisabled(teamName: string, url: string, lastStatus: number | null): Promise<void> {
  sendMail({
    to: await emailsOf("role = 'admin'", []),
    subject: `Webhook endpoint disabled: ${teamName}`,
    text: [
      `A webhook endpoint of ${teamName} was disabled after repeated failed deliveries.`,
      "",
      `Endpoint: ${url}`,
      `Last status code: ${lastStatus === null ? "no answer" : String(lastStatus)}`,
      "",
      "An org admin can re-enable it on the Webhooks screen.",
    ].join("\n"),
  });
}

export function mailReceipt(to: string, teamName: string, credits: number, amountUsd: string, invoiceId: string): void {
  sendMail({
    to: [to],
    subject: `Top-up receipt: ${formatWholeCredits(credits)} credits for ${teamName}`,
    text: [
      `${formatWholeCredits(credits)} credits were added to ${teamName}.`,
      "",
      `Amount: ${amountUsd} USD`,
      `Kill Bill invoice: ${invoiceId}`,
    ].join("\n"),
  });
}
