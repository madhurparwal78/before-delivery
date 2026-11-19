import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "../lib/router.tsx";
import { ArrowIcon } from "./Icons.tsx";

type PillVariant = "solid" | "outline";

export function LinkPill({ to, variant = "solid", arrow = true, children, className = "" }: {
  to: string;
  variant?: PillVariant;
  arrow?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link to={to} className={`pill pill--${variant} ${className}`.trim()}>
      {children}
      {arrow && <ArrowIcon />}
    </Link>
  );
}

export function ButtonPill({ variant = "solid", className = "", children, ...rest }: {
  variant?: PillVariant;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} className={`pill pill--${variant} ${className}`.trim()}>
      {children}
    </button>
  );
}
