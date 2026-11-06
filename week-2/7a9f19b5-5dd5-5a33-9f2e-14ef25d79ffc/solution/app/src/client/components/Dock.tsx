import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/** Fixed bars (comparison tray, quick-add) render outside the page's stacking context, inside the app root. */
export function Dock({ children }: { children: ReactNode }) {
  const host = document.getElementById("docks");
  return host ? createPortal(children, host) : null;
}
