import type { Queryable } from '../db/pool.js';
import { queueMail } from '../services/mail.js';
import { issuePass, passFace, passFileName, type LineRow, type OrderRow } from './orders.js';

export interface TransferResult {
  passCode: string;
}

/**
 * Reissues the ticket to the recipient with no new charge: the old pass stops scanning from that
 * moment and a new pass is stored for the new holder.
 */
export async function transferLine(
  db: Queryable,
  order: OrderRow,
  line: LineRow,
  recipientName: string,
  recipientEmail: string,
): Promise<TransferResult> {
  const issued = await issuePass(db, order, line, recipientName);
  await db.query(
    `UPDATE passes SET status = 'transferred'
     WHERE line_id = $1 AND status = 'valid' AND code <> $2`,
    [line.id, issued.code],
  );
  await db.query(`UPDATE order_lines SET state = 'transferred', holder_name = $2 WHERE id = $1`, [
    line.id,
    recipientName,
  ]);

  const face = await passFace(db, line);

  await queueMail(db, {
    eventKey: `transfer-sender:${line.id}:${issued.code}`,
    to: order.buyer_email,
    subject: `You transferred a ticket — order ${order.ref}`,
    body: [
      `You transferred ${line.title} to ${recipientName}.`,
      '',
      'Your old pass no longer scans.',
    ].join('\n'),
  });

  await queueMail(db, {
    eventKey: `transfer-recipient:${line.id}:${issued.code}`,
    to: recipientEmail,
    subject: `A ticket for ${line.title} is yours`,
    body: [
      `${recipientName}, a ticket is yours.`,
      '',
      `Item: ${line.title}`,
      `When: ${face.whenText}`,
      `Venue: ${face.venueName}`,
      '',
      'Your pass is attached.',
    ].join('\n'),
    attachments: [{ filename: passFileName(issued.code), key: issued.objectKey }],
  });

  return { passCode: issued.code };
}
