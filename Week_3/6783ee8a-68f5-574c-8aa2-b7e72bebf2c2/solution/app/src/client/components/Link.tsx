import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { navigate } from "../router";

interface Props extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string;
  children: ReactNode;
}

/** An internal link: a real anchor that changes screens without reloading. */
export function Link({ to, children, onClick, ...rest }: Props): ReactNode {
  const follow = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={follow} {...rest}>
      {children}
    </a>
  );
}
