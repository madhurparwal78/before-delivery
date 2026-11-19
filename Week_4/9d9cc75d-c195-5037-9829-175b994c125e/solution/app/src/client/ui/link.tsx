import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { navigate } from '../router.ts';

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;
}

/** An anchor that changes the route without a page load. Modified clicks keep their browser meaning. */
export function Link({ to, onClick, ...rest }: LinkProps) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={follow} {...rest} />;
}
