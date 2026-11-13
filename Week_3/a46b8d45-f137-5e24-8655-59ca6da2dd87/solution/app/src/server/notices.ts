import { config } from "./config";
import { iso, now } from "./clock";
import { one, rows, transaction, type Db } from "./db";
import { sendMail } from "./mailer";
import type { LiveClaimRow, QuoteRow } from "./claims";
import { carriageLine, lifetimeLine, partAmountLine, paidLine, promiseLine, totalLine } from "../shared/copy";
import { money } from "../shared/format";
import type { Lang } from "../shared/types";

interface Notice {
  subject: string;
  body: string;
}

const linkTo = (path: string): string => `${config.appPublicUrl}${path}`;
const polish = (lang: Lang): boolean => lang === "pl-PL";

export function confirmationNotice(reference: string, lang: Lang, token: string, confirmBy: Date): Notice {
  return polish(lang)
    ? {
        subject: `Potwierdź zgłoszenie Holmgarth ${reference}`,
        body: `Otwórz ten link, aby potwierdzić zgłoszenie ${reference}:\n${linkTo(`/confirm/${token}`)}\n\n${lifetimeLine(iso(confirmBy), lang)}\n`,
      }
    : {
        subject: `Confirm your Holmgarth claim ${reference}`,
        body: `Open this link to confirm claim ${reference}:\n${linkTo(`/confirm/${token}`)}\n\n${lifetimeLine(iso(confirmBy), lang)}\n`,
      };
}

export function quotedNotice(reference: string, lang: Lang, quote: QuoteRow, shareToken: string): Notice {
  const figures = [partAmountLine(quote.part_line_minor, lang), carriageLine(quote.band, quote.carriage_minor, lang), totalLine(quote.total_minor, lang)].join("\n");
  const promise = promiseLine({ kind: quote.promise_kind, date: quote.promise_date }, lang);
  const link = linkTo(`/s/${shareToken}`);
  return polish(lang)
    ? { subject: `Wycena zgłoszenia ${reference}: ${money(quote.total_minor, lang)}`, body: `${figures}\n\n${promise}\n\nŚledź zgłoszenie: ${link}\n` }
    : { subject: `Quote for claim ${reference}: ${money(quote.total_minor, lang)}`, body: `${figures}\n\n${promise}\n\nFollow your claim: ${link}\n` };
}

export function declinedNotice(reference: string, lang: Lang, refundedMinor: number, shareToken: string): Notice {
  const link = linkTo(`/s/${shareToken}`);
  if (polish(lang)) {
    const outcome = refundedMinor > 0 ? `zwrot ${money(refundedMinor, lang)}` : "bez opłat";
    return { subject: `Zgłoszenie ${reference} odrzucone — ${outcome}`, body: `Zgłoszenie ${reference} zostało odrzucone (${outcome}).\n\nŚledź zgłoszenie: ${link}\n` };
  }
  const outcome = refundedMinor > 0 ? `${money(refundedMinor, lang)} refunded` : "nothing charged";
  return { subject: `Claim ${reference} declined — ${outcome}`, body: `Claim ${reference} was declined (${outcome}).\n\nFollow your claim: ${link}\n` };
}

export function dispatchedNotice(reference: string, lang: Lang, paidMinor: number, shareToken: string): Notice {
  const link = linkTo(`/s/${shareToken}`);
  return polish(lang)
    ? { subject: `Część w drodze — zgłoszenie ${reference}`, body: `Twoja część jest w drodze.\n${paidLine(paidMinor, lang)}\n\nŚledź zgłoszenie: ${link}\n` }
    : { subject: `Part on its way for claim ${reference}`, body: `Your part is on its way.\n${paidLine(paidMinor, lang)}\n\nFollow your claim: ${link}\n` };
}

export function closedNotice(reference: string, lang: Lang): Notice {
  return polish(lang)
    ? { subject: `Zgłoszenie ${reference} zostało zamknięte`, body: `Zgłoszenie ${reference} zostało zamknięte.\n` }
    : { subject: `Claim ${reference} is closed`, body: `Claim ${reference} is closed.\n` };
}

export function newLinkNotice(reference: string, lang: Lang, shareToken: string): Notice {
  const link = linkTo(`/s/${shareToken}`);
  return polish(lang)
    ? { subject: `Nowy link do zgłoszenia ${reference}`, body: `Oto nowy link do Twojego zgłoszenia:\n${link}\n` }
    : { subject: `New link for claim ${reference}`, body: `Here is the new link to your claim:\n${link}\n` };
}

/** Every notice but the confirmation is written to the shared queue together with the action that caused it. */
export async function enqueueNotice(db: Db, claim: Pick<LiveClaimRow, "reference" | "email">, notice: Notice): Promise<void> {
  await rows(db, "INSERT INTO notice_queue (claim_reference, recipient, subject, body, created_at) VALUES ($1, $2, $3, $4, $5)", [
    claim.reference,
    claim.email,
    notice.subject,
    notice.body,
    now(),
  ]);
}

interface QueuedNotice {
  id: number;
  recipient: string;
  subject: string;
  body: string;
}

/**
 * Sends every waiting notice. A copy holds the row lock while it talks to Mailpit, so a notice is sent
 * exactly once even when several copies share the queue; if Mailpit is down the row stays for the next pass.
 */
async function drainNotices(): Promise<void> {
  for (;;) {
    const sent = await transaction(async (db) => {
      const next = await one<QueuedNotice>(db, "SELECT id, recipient, subject, body FROM notice_queue ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED");
      if (!next) return false;
      await sendMail(next.recipient, next.subject, next.body);
      await rows(db, "DELETE FROM notice_queue WHERE id = $1", [next.id]);
      return true;
    });
    if (!sent) return;
  }
}

/** Every copy checks the queue every 10 seconds; a notice that cannot be sent stays queued for the next pass. */
export function startNoticeWorker(): void {
  setInterval(() => void drainNotices().catch(() => undefined), 10_000).unref();
}

/** Sends one claim's waiting notices now, inside the action that queued them; a notice Mailpit refuses stays queued. */
export async function deliverClaimNotices(db: Db, reference: string): Promise<void> {
  const queued = await rows<QueuedNotice>(db, "SELECT id, recipient, subject, body FROM notice_queue WHERE claim_reference = $1 ORDER BY id FOR UPDATE SKIP LOCKED", [reference]);
  for (const notice of queued) {
    try {
      await sendMail(notice.recipient, notice.subject, notice.body);
    } catch {
      return;
    }
    await rows(db, "DELETE FROM notice_queue WHERE id = $1", [notice.id]);
  }
}
