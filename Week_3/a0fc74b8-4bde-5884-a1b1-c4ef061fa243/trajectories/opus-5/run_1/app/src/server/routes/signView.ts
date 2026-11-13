import type { SignFieldJson, SignViewJson } from '../../shared/types.ts';
import { currentRecipient, recipientStatus } from '../model/document.ts';
import type { LinkContext } from '../model/flow.ts';

/** The signer's view of a link: only their own fields, and only on their turn. */
export const signViewJson = (context: LinkContext, now: Date): SignViewJson => {
  const { aggregate, recipient, state } = context;
  const current = currentRecipient(aggregate);
  const decliner = aggregate.recipients.find((row) => row.id === aggregate.doc.declined_by) ?? null;
  return {
    state,
    title: aggregate.doc.title,
    recipient: {
      id: recipient.id,
      name: recipient.name,
      order: recipient.order_index,
      status: recipientStatus(recipient, now),
    },
    signerCount: aggregate.recipients.length,
    current: current === null ? null : { name: current.name, order: current.order_index },
    senderName: aggregate.doc.owner_name,
    declinedBy: decliner === null ? null : decliner.name,
    voidReason: aggregate.doc.void_reason,
    pageCount: aggregate.doc.page_count,
    timeZone: aggregate.doc.time_zone,
    fields:
      state === 'your_turn'
        ? aggregate.fields
            .filter((field) => field.recipient_id === recipient.id)
            .map(
              (field): SignFieldJson => ({
                id: field.id,
                recipientId: field.recipient_id,
                kind: field.kind,
                label: field.label,
                required: field.required,
                page: field.page,
                x: field.x,
                y: field.y,
                w: field.w,
                h: field.h,
                value: field.value,
              }),
            )
        : [],
    otherFields: aggregate.fields
      .filter((field) => field.recipient_id !== recipient.id)
      .map((field) => ({ page: field.page, x: field.x, y: field.y, w: field.w, h: field.h })),
  };
};
