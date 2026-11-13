import type { MouseEvent, ReactNode } from 'react';
import { navigate } from '../nav';

interface Props {
  href: string;
  className?: string;
  children: ReactNode;
}

const isPlainClick = (event: MouseEvent): boolean => event.button === 0 && !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);

/** A link to another route of the app: a plain click navigates without a page load, anything else keeps the browser's behaviour. */
export function InternalLink({ href, className, children }: Props) {
  const follow = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.defaultPrevented || !isPlainClick(event)) return;
    event.preventDefault();
    navigate(href);
    window.scrollTo(0, 0);
  };
  return (
    <a href={href} className={className} onClick={follow}>
      {children}
    </a>
  );
}
