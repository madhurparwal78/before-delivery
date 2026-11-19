import type { ButtonHTMLAttributes, ReactNode } from "react";
import { FEEDBACK_PENDING } from "../../shared/domain.ts";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  children: ReactNode;
  /** Black pill (primary action) when true; a ruled pill otherwise. */
  primary?: boolean;
  /** While an action waits the button reads the pending word and is disabled (brief: While an action waits). */
  pending?: keyof typeof FEEDBACK_PENDING | false;
}

export function Button({ children, primary = false, pending = false, className, disabled, type = "button", ...rest }: ButtonProps): ReactNode {
  return (
    <button type={type} className={`btn${primary ? " btn-primary" : ""}${className ? ` ${className}` : ""}`} disabled={disabled || pending !== false} {...rest}>
      {pending ? FEEDBACK_PENDING[pending] : children}
    </button>
  );
}
