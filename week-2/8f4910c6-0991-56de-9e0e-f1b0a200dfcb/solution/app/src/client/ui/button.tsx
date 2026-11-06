// A button that shows its pending copy (ending in "…") and is disabled while its action runs.

import type { ButtonHTMLAttributes, Ref } from "react";

export function Button({ pending = false, pendingLabel, variant = "primary", children, disabled, ref, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & {
    pending?: boolean;
    pendingLabel?: string;
    variant?: "primary" | "quiet" | "text";
    ref?: Ref<HTMLButtonElement>;
  }) {
  const className = { primary: "btn", quiet: "btn-quiet", text: "btn-text" }[variant];
  return (
    <button ref={ref} type="button" className={className} disabled={disabled || pending} {...rest}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
