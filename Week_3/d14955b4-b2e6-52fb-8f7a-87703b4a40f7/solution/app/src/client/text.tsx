import type { ReactNode } from 'react';
import { parseInline } from '../shared/format.js';
import { sanitise } from '../shared/sanitiser.js';
import type { InlineNode } from '../shared/format.js';
import { formatAmount } from '../shared/amount.js';
import type { EventBody, LinkPreviewBody, PurchaseBody } from '../shared/types.js';

function render(nodes: InlineNode[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return node.text;
      case 'em':
        return <em key={index}>{render(node.children)}</em>;
      case 'code':
        return <code key={index}>{node.text}</code>;
      case 'link':
        return (
          <a key={index} href={node.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
            {render(node.children)}
          </a>
        );
    }
  });
}

export function Formatted({ text }: { text: string }): ReactNode {
  return <span className="formatted">{render(parseInline(sanitise(text).after))}</span>;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (value: number): string => String(value).padStart(2, '0');

export function formatTime(iso: string): string {
  const date = new Date(iso);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

export function eventWords(event: EventBody): string {
  if (event.verdict === 'refused') return `Refused game-server event: ${event.type}`;
  switch (event.type) {
    case 'purchase.receipt':
      return `Purchase recorded: ${event.item}, ${formatAmount(event.amount_minor as number, event.currency as NonNullable<EventBody['currency']>)}`;
    case 'purchase.refunded':
      return event.refund_applied === false
        ? `Refund not applied: ${event.receipt_id}, currency differs`
        : `Refund recorded: ${event.receipt_id}, ${formatAmount(event.amount_minor as number, event.currency as NonNullable<EventBody['currency']>)}`;
    case 'match.finished':
      return `Match ${event.result}: ${event.mode}, ${Math.floor((event.duration_seconds as number) / 60)} min`;
  }
}

export const statusWord = (status: PurchaseBody['status']): string => status.replace('_', ' ');

export function purchaseStatusWords(purchase: PurchaseBody): string {
  if (purchase.status === 'partly_refunded') return `${statusWord(purchase.status)}: ${formatAmount(purchase.refunded_minor, purchase.currency)}`;
  return statusWord(purchase.status);
}

export function LinkPreview({ preview }: { preview: LinkPreviewBody }) {
  return (
    <p className="preview">
      <span className="preview-title">{preview.title}</span>
      {preview.description ? <span> {preview.description}</span> : null}
      <span className="preview-host"> {new URL(preview.url).host}</span>
    </p>
  );
}
