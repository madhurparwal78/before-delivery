import type { ReactNode } from 'react';

export function StatusRegion({
  label,
  text,
  late,
}: {
  label: string;
  text: string;
  late?: boolean;
}): JSX.Element {
  return (
    <p className={late ? 'status status-late' : 'status'} role="status" aria-label={label}>
      {text}
    </p>
  );
}

export function FieldError({ id, message }: { id: string; message?: string }): JSX.Element | null {
  if (!message) return null;
  return (
    <span className="error" id={id}>
      {message}
    </span>
  );
}

export function describedBy(id: string, message?: string): string | undefined {
  return message ? id : undefined;
}

export function HostHeader({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}): JSX.Element {
  return (
    <header className="host-header">
      <span className="host-title">Lastbell</span>
      <span className="visually-hidden">{title}</span>
      <span className="spacer" />
      {children}
    </header>
  );
}
