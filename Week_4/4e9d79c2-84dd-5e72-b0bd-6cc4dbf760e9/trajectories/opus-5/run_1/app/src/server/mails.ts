import { config } from './config.js';
import { moneyLabel, Pennies } from '../domain/money.js';
import { Language, customerString, fill } from '../domain/strings.js';
import { LocalDateTime, formatDateForLanguage, formatUkDate } from '../domain/time.js';
import { sendMail } from './providers/mail.js';
import { ExpiringPaper, expiryMailSubject } from './data/operators.js';

function address(path: string): string {
  return `${config.publicUrl}${path}`;
}

export async function mailPriceRequest(
  to: string,
  reference: string,
  route: string[],
  departAt: LocalDateTime,
  returnAt: LocalDateTime | null,
  vehicles: number[],
  partySize: number,
  bidPath: string,
): Promise<void> {
  const lines = [
    `Route: ${route.join(' - ')}`,
    `Out: ${formatUkDate(departAt.date)}, ${departAt.time}`,
    returnAt ? `Return: ${formatUkDate(returnAt.date)}, ${returnAt.time}` : 'Return: none',
    `Vehicles: ${vehicles.map((seats) => `${seats} seats`).join(', ')}`,
    `Party size: ${partySize}`,
    `Price this hire: ${address(bidPath)}`,
  ];
  await sendMail({ to, subject: `Price request ${reference}`, text: lines.join('\n') });
}

export async function mailHireClosed(to: string, reference: string): Promise<void> {
  await sendMail({
    to,
    subject: `Hire ${reference} has closed`,
    text: `Hire ${reference} has closed.`,
  });
}

export async function mailQuote(
  to: string,
  reference: string,
  language: Language,
  total: Pennies,
  validUntil: string,
  quotePath: string,
): Promise<void> {
  const lines = [
    `${customerString('total', language)}: ${moneyLabel(total)}`,
    fill(customerString('validUntil', language), { date: formatDateForLanguage(validUntil, language) }),
    address(quotePath),
  ];
  await sendMail({
    to,
    subject: fill(customerString('yourQuote', language), { reference }),
    text: lines.join('\n'),
  });
}

export async function mailPaperExpiry(to: string, paper: ExpiringPaper): Promise<void> {
  const subject = expiryMailSubject(paper);
  await sendMail({ to, subject, text: `${subject}.` });
}

export async function mailBalanceReminder(
  to: string,
  reference: string,
  owed: Pennies,
  dueOn: string,
  quotePath: string | null,
): Promise<void> {
  const lines = [
    `Amount owed: ${moneyLabel(owed)}`,
    `Due on: ${formatUkDate(dueOn)}`,
    quotePath ? `Your quote ${reference}: ${address(quotePath)}` : `Your quote ${reference}`,
  ];
  await sendMail({ to, subject: `Balance reminder ${reference}`, text: lines.join('\n') });
}
