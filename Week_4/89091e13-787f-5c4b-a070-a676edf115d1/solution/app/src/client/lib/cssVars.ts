import type { CSSProperties } from "react";

/** Inline custom properties for a style attribute. */
export function cssVarsOf(vars: Record<string, string | number>): CSSProperties {
  return vars as CSSProperties;
}
