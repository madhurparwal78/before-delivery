import type { ReactNode } from 'react';

/** A white card that scrolls a wide table sideways inside itself, so the page never does. */
export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="table-wrap" tabIndex={0}>
      {children}
    </div>
  );
}
