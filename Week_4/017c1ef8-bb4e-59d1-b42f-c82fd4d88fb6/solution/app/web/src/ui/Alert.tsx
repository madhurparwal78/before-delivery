import type { ReactNode } from 'react';

/** Failure text beside the control that failed. Renders nothing without content. Announced assertively. */
export function Alert({ children, className }: { children?: ReactNode; className?: string }) {
  if (!children) return null;
  return (
    <div role="alert" className={className ? `alert ${className}` : 'alert'}>
      {children}
    </div>
  );
}
