import type { HTMLAttributes } from 'react';

interface NoticeProps extends HTMLAttributes<HTMLDivElement> {
  /** `error` adds the ink-bright rule on the left; the text stays ink */
  tone?: 'plain' | 'error';
}

/** A plain sentence in a surface block. Pass `role="status"` and `aria-label` for the named live regions. */
export function Notice({ tone = 'plain', className, ...rest }: NoticeProps) {
  return <div className={['notice', `notice--${tone}`, className ?? ''].filter(Boolean).join(' ')} {...rest} />;
}
