import { forwardRef, type ButtonHTMLAttributes } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  busy?: boolean;
  tone?: "primary" | "secondary" | "quiet";
}

/** A button that shows the accent progress mark while its action is pending. */
export const Button = forwardRef<HTMLButtonElement, Props>(function Button({ busy, tone = "secondary", className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={`btn btn-${tone}${className ? ` ${className}` : ""}`}
      aria-busy={busy || undefined}
      data-busy={busy ? "true" : undefined}
    >
      {busy && <span className="busy-mark" aria-hidden="true" />}
      {children}
    </button>
  );
});
