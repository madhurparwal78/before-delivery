import { ReactElement } from 'react';
export function LiveRegion({
  label,
  message,
  className,
}: {
  label: string;
  message: string;
  className?: string;
}): ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={className ?? 'status-line'}
    >
      {message}
    </div>
  );
}
