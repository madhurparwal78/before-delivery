import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { navigate } from "../lib/router";

interface Props extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  to: string;
  children: ReactNode;
}

/** An ordinary link that navigates inside the app without a reload. */
export function Link({ to, children, onClick, ...rest }: Props) {
  const handle = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} {...rest} onClick={handle}>
      {children}
    </a>
  );
}
