import { forwardRef } from 'react';

interface StatusLineProps {
  name: string;
  text: string;
  error?: boolean;
}

/** A named live region that can also take focus after an action finishes. */
export const StatusLine = forwardRef<HTMLParagraphElement, StatusLineProps>(function StatusLine(
  { name, text, error },
  ref,
) {
  return (
    <p
      className={error === true ? 'status error' : 'status'}
      role="status"
      aria-label={name}
      tabIndex={-1}
      ref={ref}
    >
      {text}
    </p>
  );
});
