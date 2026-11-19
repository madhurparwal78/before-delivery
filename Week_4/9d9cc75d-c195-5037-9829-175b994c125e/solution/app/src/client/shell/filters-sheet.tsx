import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../ui/button.tsx';
import { BottomSheet } from '../ui/dialog.tsx';
import { usePhone } from '../ui/phone.ts';

/**
 * Where a published view keeps its Controls: inline from 768 up; below 768 behind `button "Filters"`, which opens
 * `dialog "Filters"` as a bottom sheet holding the same children.
 */
export function FiltersSheet({ children }: { children: ReactNode }) {
  const phone = usePhone();
  const [open, setOpen] = useState(false);
  if (!phone) return <>{children}</>;
  return (
    <>
      <Button onClick={() => setOpen(true)} aria-haspopup="dialog">
        Filters
      </Button>
      {open ? (
        <BottomSheet name="Filters" onClose={() => setOpen(false)}>
          {children}
        </BottomSheet>
      ) : null}
    </>
  );
}
