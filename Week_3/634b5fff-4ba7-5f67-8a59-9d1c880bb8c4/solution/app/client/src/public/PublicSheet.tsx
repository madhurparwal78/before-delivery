import { useRef, type ReactNode } from "react";
import { Link, navigate } from "../router.js";
import { Sheet } from "../ui.js";
import { LABELS } from "./copy.js";
import { ArrowIcon, CloseIcon } from "./icons.js";
import { useDialog } from "./useDialog.js";
import "../styles/sheets.css";

/** A sheet over the dimmed scene: focus goes into it and wraps inside it, Escape closes it to the shelf. */
export const PublicSheet = ({ children, closeLabel = LABELS.sheet.close }: { children: ReactNode; closeLabel?: string }) => {
  const layer = useRef<HTMLDivElement>(null);
  const onKeyDown = useDialog(layer, { focusRoot: true, onEscape: () => navigate("/shelf") });
  return (
    <div ref={layer} className="sheet-layer" tabIndex={-1} onKeyDown={onKeyDown}>
      <Sheet>
        <Link href="/shelf" className="sheet__close">
          {closeLabel === LABELS.sheet.close ? <CloseIcon /> : <ArrowIcon />}
          {closeLabel}
        </Link>
        {children}
      </Sheet>
    </div>
  );
};
