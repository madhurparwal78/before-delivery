import { config } from '../config';
import { DrawRow, MemberRow, PhlebotomistRow, VisitPageRow, liveVisitPage } from '../data';
import { newId, query, queryOne } from '../db';
import { endOfLocalDay, displayDate, parseDateOnly, zoneLabel } from '../shared/time';
import { newToken } from '../http/sessions';
import { queueMail } from './mailer';

export function visitPageEnd(draw: DrawRow, sentAt: Date): Date {
  const date = parseDateOnly(draw.local_date);
  if (!date) throw new Error(`Bad draw date ${draw.local_date}`);
  const endOfDay = endOfLocalDay(draw.time_zone, date);
  if (config.drawPageSeconds === null) return endOfDay;
  const windowEnd = new Date(sentAt.getTime() + config.drawPageSeconds * 1000);
  return windowEnd.getTime() < endOfDay.getTime() ? windowEnd : endOfDay;
}

export function shortMemberName(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1] as string) : '';
  return last === '' ? first : `${first} ${last.charAt(0).toUpperCase()}.`;
}

export async function endVisitPages(drawId: string): Promise<void> {
  await query('update visit_pages set ended_at = now() where draw_id = $1 and ended_at is null', [
    drawId,
  ]);
}

/** Ends any live address and mails the phlebotomist a new private visit page. */
export async function sendVisitPage(
  draw: DrawRow,
  member: MemberRow,
  phlebotomist: PhlebotomistRow,
): Promise<VisitPageRow> {
  await endVisitPages(draw.id);
  const sentAt = new Date();
  const id = newId();
  const token = newToken();
  await query(
    'insert into visit_pages (id, draw_id, token, sent_at, ends_at) values ($1, $2, $3, $4, $5)',
    [id, draw.id, token, sentAt, visitPageEnd(draw, sentAt)],
  );
  await queueMail({
    to: phlebotomist.email,
    subject: `Visit page for ${displayDate(draw.local_date)}`,
    body: [
      `Visit for ${shortMemberName(member.name ?? '')}`,
      `Draw time: ${displayDate(draw.local_date)}, ${draw.local_time} ${zoneLabel(draw.time_zone)}.`,
      `Open the visit page: ${config.publicUrl}/visit/${token}`,
      'The address is shown on the visit day.',
    ].join('\n'),
  });
  const page = await queryOne<VisitPageRow>('select * from visit_pages where id = $1', [id]);
  if (!page) throw new Error('Visit page vanished after create');
  return page;
}

export async function livePage(drawId: string): Promise<VisitPageRow | null> {
  const page = await liveVisitPage(drawId);
  if (!page) return null;
  return page.ends_at.getTime() > Date.now() ? page : null;
}
