import type { ReactNode } from "react";

/** An error shown where it happened, and announced as an alert. */
export function InlineAlert({ children, tone = "error", icon }: { children: ReactNode; tone?: "error" | "banner"; icon?: ReactNode }) {
  return (
    <div role="alert" className={`inline-alert inline-alert--${tone}`}>
      {icon}
      <div>{children}</div>
    </div>
  );
}
