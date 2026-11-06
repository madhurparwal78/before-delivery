/** The expiry notice ladder: at most one 14-day and one 3-day notice per current document. */
import { db } from '../db/pool.js';
import { currentDocument, dueNotice } from '../domain/documents.js';
import { localDateOf } from '../domain/time.js';
import type { DocumentType, Kitchen, Member } from '../domain/types.js';
import { memberDocuments, noticeSent } from '../store/documents.js';
import { allKitchens, loadMembers } from '../store/kitchens.js';
import { expiryNoticeMessage, queueMail } from './emails.js';

const documentTypes: DocumentType[] = ['insurance_certificate', 'food_handler_card'];

export async function sendNoticesForMember(kitchen: Kitchen, member: Member): Promise<void> {
  const today = localDateOf(kitchen.timeZone, Date.now());
  const documents = await memberDocuments(db(), member.id);
  for (const type of documentTypes) {
    const current = currentDocument(documents, type);
    if (!current) continue;
    const kind = dueNotice(current, today);
    if (!kind) continue;
    if (!(await noticeSent(db(), current.id, kind))) continue;
    await queueMail(db(), {
      ...expiryNoticeMessage({
        to: member.email,
        business: member.businessName,
        type,
        expiryDate: current.expiryDate,
        kind,
      }),
    });
  }
}

export async function sendDueExpiryNotices(): Promise<void> {
  for (const kitchen of await allKitchens()) {
    for (const member of await loadMembers(db(), kitchen.id)) {
      await sendNoticesForMember(kitchen, member);
    }
  }
}
