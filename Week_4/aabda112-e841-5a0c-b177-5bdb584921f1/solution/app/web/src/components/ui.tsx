import { useEffect, useRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from '../lib/router';
import { useMotion } from '../lib/env';
import { initials } from '../lib/format';

type PillProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'mint' | 'blue' | 'outline' | 'ghost'; busy?: boolean };

/** A pill button. A busy one is disabled and marked busy while keeping its label. */
export function Pill({ variant = 'mint', busy, className = '', disabled, ...rest }: PillProps) {
  return <button type="button" {...rest} disabled={disabled || busy} aria-busy={busy ? true : undefined} className={`pill pill-${variant} ${className}`} />;
}

export function PillLink({ variant = 'mint', to, className = '', ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: 'mint' | 'blue' | 'outline'; to: string }) {
  return <Link to={to} {...rest} className={`pill pill-${variant} ${className}`} />;
}

export function Chip({ tone = 'plain', children, className = '' }: { tone?: 'plain' | 'rose' | 'mint' | 'sky'; children: ReactNode; className?: string }) {
  return <span className={`chip chip-${tone} ${className}`}>{children}</span>;
}

/** The dark circular arrow chip; its arrow nudges right on hover and focus. */
export function ArrowChip({ to, label }: { to: string; label: string }) {
  const motion = useMotion();
  return (
    <Link to={to} className="arrow-chip" aria-label={label} {...motion('chip-nudge', 250, 'ease-in-out')}>
      <ArrowRight aria-hidden="true" size={20} />
    </Link>
  );
}

export function Avatar({ name, photoId, size = 48 }: { name: string; photoId?: string | null; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.max(12, size * 0.36) }}>
      {photoId ? <img src={`/api/files/${photoId}/content`} alt="" width={size} height={size} /> : initials(name)}
    </span>
  );
}

/** An empty state: one tinted card with a small drawing, a bold title and one pill. */
export function EmptyCard({ title, tone = 'mint', children }: { title: string; tone?: 'mint' | 'rose' | 'sky'; children?: ReactNode }) {
  return (
    <div className={`empty-card tint-${tone}`}>
      <svg aria-hidden="true" width="96" height="64" viewBox="0 0 96 64" className="empty-art">
        <rect x="4" y="14" width="64" height="40" rx="10" fill="currentColor" opacity="0.18" />
        <rect x="16" y="4" width="48" height="26" rx="8" fill="currentColor" opacity="0.32" />
        <circle cx="76" cy="40" r="14" fill="currentColor" opacity="0.5" />
        <path d="M70 40h12M76 34v12" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <p className="empty-title">{title}</p>
      {children}
    </div>
  );
}

/** An error or outage banner: navy, in the page flow, light-blue title. Renders nothing without a message. */
export function Banner({ message, id }: { message: string | null | undefined; id?: string }) {
  if (!message) return null;
  return (
    <div role="alert" className="banner" id={id}>
      <p className="banner-title">{message}</p>
    </div>
  );
}

export interface SummaryItem {
  field?: string;
  message: string;
}

/** The in-dialog error summary: an alert whose items link to their fields. Focus moves here each time `token` changes. */
export function ErrorSummary({ items, token, fieldId }: { items: SummaryItem[]; token: number; fieldId: (field: string) => string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (token > 0) ref.current?.focus();
  }, [token]);
  if (items.length === 0) return null;
  return (
    <div role="alert" ref={ref} tabIndex={-1} className="error-summary">
      <ul>
        {items.map((item) => (
          <li key={`${item.field ?? ''}${item.message}`}>
            {item.field ? (
              <a
                href={`#${fieldId(item.field)}`}
                onClick={(event) => {
                  event.preventDefault();
                  document.getElementById(fieldId(item.field!))?.focus();
                }}
              >
                {item.message}
              </a>
            ) : (
              item.message
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A labelled control with its inline message, tied to it as its description. */
export function Field({ id, label, error, children, hint }: { id: string; label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <p className="hint">{hint}</p>}
      {children}
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

export const describedBy = (id: string, error?: string) => (error ? { 'aria-describedby': `${id}-error`, 'aria-invalid': true as const } : {});

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} />
      ))}
    </div>
  );
}

