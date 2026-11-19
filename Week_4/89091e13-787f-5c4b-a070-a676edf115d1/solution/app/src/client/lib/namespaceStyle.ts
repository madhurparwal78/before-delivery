import type { CSSProperties } from "react";
import { cssVarsOf } from "./cssVars.ts";

/** Hue and stroke pattern of a namespace: the pattern differs per namespace, so identity never depends on hue alone. */
export function namespaceStyle(hex: string): CSSProperties {
  const id = parseInt(hex.slice(-6), 16);
  return cssVarsOf({
    "--hue": 246 + (id % 44),
    "--angle": `${(id % 6) * 30 + 15}deg`,
    "--gap": `${5 + (id % 3) * 2}px`,
    "--stroke": `${1 + (id % 2)}px`,
  });
}
