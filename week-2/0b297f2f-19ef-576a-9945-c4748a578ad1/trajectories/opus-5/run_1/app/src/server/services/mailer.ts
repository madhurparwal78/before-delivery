import type { Snapshot } from '../../shared/types';
import { config } from '../config';
import { withClient, withTransaction } from '../db/pool';
import { formatMuseumDisplay } from '../time';
import { MailRelayUnavailableError, sendMail } from './mail';

type Row = Record<string, unknown>;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function previewLink(token: string): string {
  return `${config.publicUrl.replace(/\/$/, '')}/p/${token}`;
}

interface QueuedPreviewMail {
  previewId: string;
  lenderId: string;
  email: string;
  lenderName: string;
  token: string;
  publishDisplay: string;
  exhibitionTitle: string;
  snapshot: Snapshot;
}

async function loadQueued(): Promise<QueuedPreviewMail[]> {
  return withClient(async (client) => {
    const rows = (
      await client.query(
        `select r.preview_id, r.lender_id, r.token, l.email, l.name as lender_name,
                r.snapshot_json, p.publish_at, e.title as exhibition_title, e.time_zone
         from preview_recipients r
         join previews p on p.id = r.preview_id
         join lenders l on l.id = r.lender_id
         join exhibitions e on e.id = p.exhibition_id
         where r.delivery = 'queued' and p.status = 'published'
         order by l.sort`,
      )
    ).rows as Row[];
    return rows.map((row) => ({
      previewId: String(row['preview_id']),
      lenderId: String(row['lender_id']),
      email: String(row['email']),
      lenderName: String(row['lender_name']),
      token: String(row['token']),
      publishDisplay: formatMuseumDisplay(
        new Date(String(row['publish_at'])),
        String(row['time_zone']),
      ),
      exhibitionTitle: String(row['exhibition_title']),
      snapshot: JSON.parse((row['snapshot_json'] as Buffer).toString('utf8')) as Snapshot,
    }));
  });
}

interface PendingNotice {
  previewId: string;
  lenderId: string;
  email: string;
  lenderName: string;
  exhibitionTitle: string;
}

async function loadNotices(): Promise<PendingNotice[]> {
  return withClient(async (client) => {
    const rows = (
      await client.query(
        `select r.preview_id, r.lender_id, l.email, l.name as lender_name,
                e.title as exhibition_title
         from preview_recipients r
         join previews p on p.id = r.preview_id
         join lenders l on l.id = r.lender_id
         join exhibitions e on e.id = p.exhibition_id
         where r.notice_pending = true
         order by l.sort`,
      )
    ).rows as Row[];
    return rows.map((row) => ({
      previewId: String(row['preview_id']),
      lenderId: String(row['lender_id']),
      email: String(row['email']),
      lenderName: String(row['lender_name']),
      exhibitionTitle: String(row['exhibition_title']),
    }));
  });
}

function previewMailBody(mail: QueuedPreviewMail): { text: string; html: string } {
  const link = previewLink(mail.token);
  const works = mail.snapshot.works.map((work) => `${work.title} - ${work.wallName}`);
  const text = [
    `Dear ${mail.lenderName},`,
    '',
    `Your loans to ${mail.exhibitionTitle} at Ashgrove Museum of Art are in place.`,
    `This preview was published ${mail.publishDisplay}.`,
    '',
    'Your works in place:',
    ...works.map((line) => `- ${line}`),
    '',
    'See your preview:',
    link,
    '',
    'Ashgrove Museum of Art',
  ].join('\n');
  const html = [
    '<!doctype html><html><body>',
    `<p>Dear ${escapeHtml(mail.lenderName)},</p>`,
    `<p>Your loans to ${escapeHtml(mail.exhibitionTitle)} at Ashgrove Museum of Art are in place.`,
    ` This preview was published ${escapeHtml(mail.publishDisplay)}.</p>`,
    '<p>Your works in place:</p><ul>',
    ...works.map((line) => `<li>${escapeHtml(line)}</li>`),
    '</ul>',
    `<p><a href="${escapeHtml(link)}">See your preview</a><br>${escapeHtml(link)}</p>`,
    '<p>Ashgrove Museum of Art</p>',
    '</body></html>',
  ].join('');
  return { text, html };
}

let running = false;

/** Sends each queued preview email and each pending withdrawal notice exactly once. */
export async function deliverPendingMail(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const mail of await loadQueued()) {
      const body = previewMailBody(mail);
      await sendMail({
        to: mail.email,
        subject: `Preview of ${mail.exhibitionTitle}: your loans in place`,
        text: body.text,
        html: body.html,
      });
      await withTransaction(async (client) => {
        await client.query(
          `update preview_recipients set delivery = 'sent', sent_at = now()
           where preview_id = $1 and lender_id = $2 and delivery = 'queued'`,
          [mail.previewId, mail.lenderId],
        );
      });
    }
    for (const notice of await loadNotices()) {
      const text = [
        `Dear ${notice.lenderName},`,
        '',
        `The lender preview for ${notice.exhibitionTitle} has been withdrawn by the museum.`,
        'The preview link we sent you earlier no longer works.',
        '',
        'Ashgrove Museum of Art',
      ].join('\n');
      const html =
        '<!doctype html><html><body>' +
        `<p>Dear ${escapeHtml(notice.lenderName)},</p>` +
        `<p>The lender preview for ${escapeHtml(notice.exhibitionTitle)} has been withdrawn by ` +
        'the museum. The preview link we sent you earlier no longer works.</p>' +
        '<p>Ashgrove Museum of Art</p></body></html>';
      await sendMail({
        to: notice.email,
        subject: `Preview withdrawn: ${notice.exhibitionTitle}`,
        text,
        html,
      });
      await withTransaction(async (client) => {
        await client.query(
          `update preview_recipients set notice_pending = false
           where preview_id = $1 and lender_id = $2`,
          [notice.previewId, notice.lenderId],
        );
      });
    }
  } catch (error) {
    if (!(error instanceof MailRelayUnavailableError)) throw error;
  } finally {
    running = false;
  }
}
