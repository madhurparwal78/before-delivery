import { Link } from '../lib/router.js';
import { Icon } from './Icon.js';

/**
 * A polite live region whose text is also visible on screen. Never an alert:
 * only the error summary uses that role.
 */
export function StatusRegion({
  label,
  message,
  className,
}: {
  label: string;
  message: string | null;
  className?: string;
}): JSX.Element {
  return (
    <p
      role="status"
      aria-live="polite"
      aria-label={label}
      className={`status-region ${className ?? ''}${message ? ' status-region--filled' : ''}`}
    >
      {message ?? ''}
    </p>
  );
}

/** An empty state: one large display sentence and one yellow next-action link. */
export function EmptyState({
  sentence,
  actionLabel,
  actionTo,
}: {
  sentence: string;
  actionLabel: string;
  actionTo: string;
}): JSX.Element {
  return (
    <div className="empty-state">
      <p className="empty-state__sentence display">{sentence}</p>
      <Link to={actionTo} className="next-action">
        {actionLabel}
        <Icon name="arrow-right" className="next-action__arrow" />
      </Link>
    </div>
  );
}

/** A full-width charcoal banner with a yellow bar down its left edge. */
export function OutageBanner({ message }: { message: string }): JSX.Element {
  return <p className="outage-banner">{message}</p>;
}

export function SectionEyebrow({ number, name }: { number: string; name: string }): JSX.Element {
  return (
    <p className="section-eyebrow">
      <span className="section-eyebrow__number tabular">{number}</span>
      <span className="section-eyebrow__name muted">{name}</span>
    </p>
  );
}

export function ArrowLink({ to, children }: { to: string; children: string }): JSX.Element {
  return (
    <Link to={to} className="arrow-link">
      {children}
      <Icon name="arrow-right" className="arrow-link__arrow" />
    </Link>
  );
}
