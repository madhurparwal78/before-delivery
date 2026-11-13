import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "yellow" | "dark";
  small?: boolean;
  icon?: boolean;
  /** A request is in flight: the button shows a spinner and stays disabled until the reply. */
  busy?: boolean;
}

export function Button({ variant = "default", small, icon, busy, className, disabled, children, type = "button", ...rest }: ButtonProps): ReactNode {
  const classes = ["btn", variant !== "default" && `btn--${variant}`, small && "btn--small", icon && "btn--icon", className].filter(Boolean).join(" ");
  return (
    <button {...rest} type={type} className={classes} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy && <Loader2 className="spinner" size={20} aria-hidden="true" />}
      {children}
    </button>
  );
}
