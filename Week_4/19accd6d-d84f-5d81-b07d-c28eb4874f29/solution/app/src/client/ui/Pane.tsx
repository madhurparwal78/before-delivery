import type { ComponentProps, ReactNode } from "react";

/** The fixed-height header every pane starts with: a bold title at the left, icon buttons at the right. */
export function TitleBar({ title, heading, children }: { title: ReactNode; heading?: 1 | 2; children?: ReactNode }) {
  const Heading = heading === 1 ? "h1" : "h2";
  return (
    <div className="title-bar">
      <Heading className="pane-title">{title}</Heading>
      <div className="title-actions">{children}</div>
    </div>
  );
}

/** A borderless icon button with a 34 pixel hit area. */
export function IconButton({ label, children, className, ...rest }: { label: string; children: ReactNode } & ComponentProps<"button">) {
  return (
    <button type="button" className={`icon-button ${className ?? ""}`.trim()} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}
