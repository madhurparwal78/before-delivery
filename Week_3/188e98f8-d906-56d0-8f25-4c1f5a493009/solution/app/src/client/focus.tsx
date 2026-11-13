import { useLayoutEffect, useRef } from "react";
import type { ButtonHTMLAttributes } from "react";

interface RescuingProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Where focus goes if this button holds focus when it is removed; looked up after the commit. */
  rescue: () => HTMLElement | null;
}

/** A button that never lets focus fall to the page when an update removes it while focused. */
export function RescuingButton({ rescue, ...rest }: RescuingProps) {
  const self = useRef<HTMLButtonElement>(null);
  const where = useRef(rescue);
  where.current = rescue;
  useLayoutEffect(
    () => () => {
      if (self.current !== null && document.activeElement === self.current) {
        queueMicrotask(() => where.current()?.focus({ preventScroll: true }));
      }
    },
    [],
  );
  return <button type="button" ref={self} {...rest} />;
}

/** Focus without scrolling the page: the app places focus, it does not move the view. */
export function focusQuietly(element: HTMLElement | null | undefined): void {
  element?.focus({ preventScroll: true });
}

export function freshKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
