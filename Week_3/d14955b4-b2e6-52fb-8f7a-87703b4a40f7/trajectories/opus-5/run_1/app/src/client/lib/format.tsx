import type { ReactNode } from 'react';
import { formatAmount } from '../../shared/amount';
import { sanitise } from '../../shared/sanitiser';
import { addressEnd, addressStartsAt } from '../../shared/links';
import type { EventDetail, Purchase, PurchaseComparison, Rule, RuleTopic } from '../../shared/types';

const ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:'];

function allowedTarget(target: string): string | null {
  const trimmed = target.replace(/^[\u0000-\u0020\u007f]+/, '');
  const lower = trimmed.toLowerCase();
  return ALLOWED_SCHEMES.some((scheme) => lower.startsWith(scheme)) ? trimmed : null;
}

function matchingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The published formatting allowlist. Everything else stays literal text. */
export function formatText(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let literal = '';
  let key = 0;
  const flush = (): void => {
    if (literal !== '') {
      parts.push(literal);
      literal = '';
    }
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === '`') {
      const close = text.indexOf('`', i + 1);
      if (close !== -1) {
        flush();
        parts.push(
          <code className="inline-code" key={`c${key}`}>
            {text.slice(i + 1, close)}
          </code>,
        );
        key += 1;
        i = close + 1;
        continue;
      }
    }
    if (ch === '[') {
      const labelEnd = text.indexOf(']', i + 1);
      if (labelEnd !== -1 && text[labelEnd + 1] === '(') {
        const close = matchingParen(text, labelEnd + 1);
        if (close !== -1) {
          const href = allowedTarget(text.slice(labelEnd + 2, close));
          if (href !== null) {
            flush();
            parts.push(
              <a href={href} target="_blank" rel="noreferrer noopener" key={`l${key}`}>
                {text.slice(i + 1, labelEnd)}
              </a>,
            );
            key += 1;
            i = close + 1;
            continue;
          }
        }
      }
    }
    if ((ch === 'h' || ch === 'H') && addressStartsAt(text, i)) {
      const end = addressEnd(text, i);
      const url = text.slice(i, end);
      flush();
      parts.push(
        <a href={url} target="_blank" rel="noreferrer noopener" key={`u${key}`}>
          {url}
        </a>,
      );
      key += 1;
      i = end;
      continue;
    }
    if (ch === '*' || ch === '_') {
      const close = text.indexOf(ch, i + 1);
      if (close > i + 1) {
        flush();
        parts.push(<em key={`e${key}`}>{text.slice(i + 1, close)}</em>);
        key += 1;
        i = close + 1;
        continue;
      }
    }
    literal += ch;
    i += 1;
  }
  flush();
  return parts;
}

/** Player text is shown through the sanitiser's record of what was kept. */
export function formatPlayerText(body: string): ReactNode[] {
  return formatText(sanitise(body).after);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatTime(iso: string): string {
  const at = new Date(iso);
  const hours = String(at.getHours()).padStart(2, '0');
  const minutes = String(at.getMinutes()).padStart(2, '0');
  return `${at.getDate()} ${MONTHS[at.getMonth()] ?? ''} ${hours}:${minutes}`;
}

export function eventWords(event: EventDetail): string {
  if (event.verdict === 'refused') return `Refused game-server event: ${event.type}`;
  if (event.type === 'purchase.receipt') {
    return `Purchase recorded: ${event.item ?? ''}, ${formatAmount(event.amount_minor ?? 0, event.currency ?? '')}`;
  }
  if (event.type === 'purchase.refunded') {
    if (event.refund_applied === false) {
      return `Refund not applied: ${event.receipt_id ?? ''}, currency differs`;
    }
    return `Refund recorded: ${event.receipt_id ?? ''}, ${formatAmount(event.amount_minor ?? 0, event.currency ?? '')}`;
  }
  const minutes = Math.floor((event.duration_seconds ?? 0) / 60);
  return `Match ${event.result ?? ''}: ${event.mode ?? ''}, ${minutes} min`;
}

export function refundWords(purchase: Purchase): string {
  if (purchase.status === 'paid') return 'paid';
  if (purchase.status === 'refunded') return 'refunded';
  return `partly refunded: ${formatAmount(purchase.refunded_minor, purchase.currency)}`;
}

export function statusWords(status: string): string {
  if (status === 'partly_refunded') return 'partly refunded';
  return status;
}

export function comparisonWords(comparison: PurchaseComparison | undefined): string | null {
  if (!comparison || comparison.on_game_server === null) return null;
  if (!comparison.on_game_server) return 'not on the game server';
  if (comparison.differences.length === 0) return 'on the game server';
  return `on the game server, differs: ${comparison.differences.join(', ')}`;
}

export function topicWords(topic: RuleTopic): string {
  return topic === '*' ? 'all topics' : `${topic} threads`;
}

export function ruleText(rule: Rule): string {
  return `${rule.effect} ${rule.action} on ${topicWords(rule.topic)}`;
}
