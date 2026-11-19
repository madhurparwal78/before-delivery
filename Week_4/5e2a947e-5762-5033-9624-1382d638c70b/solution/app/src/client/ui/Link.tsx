import type { ComponentChildren, JSX } from 'preact';
import { navigate } from '../router.ts';

interface LinkProps extends Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'children'> {
  href: string;
  children?: ComponentChildren;
}

/** An anchor with a real href that moves inside the app without a reload; modified clicks keep the browser's behaviour. */
export function Link({ href, children, onClick, target, ...rest }: LinkProps) {
  const handle = (event: JSX.TargetedMouseEvent<HTMLAnchorElement>): void => {
    if (typeof onClick === 'function') onClick.call(event.currentTarget, event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (target && target !== '_self') return;
    if (!href.startsWith('/') || href.startsWith('//')) return;
    event.preventDefault();
    navigate(href);
  };
  return (
    <a {...rest} href={href} target={target} onClick={handle}>
      {children}
    </a>
  );
}
