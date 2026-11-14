import type { ReactNode } from "react";
import { PictureIcon } from "./Icons";

/** A lime inline band with ink text; `alert` for errors that follow an action. */
export function ErrorBand({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <p role="alert" className="error-band" id={id}>
      {children}
    </p>
  );
}

/** A lime band under a field. */
export function FieldBand({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p className="error-band error-band--field" id={id}>
      {children}
    </p>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="empty-state">
      <PictureIcon size={36} />
      <p>{children}</p>
    </div>
  );
}
