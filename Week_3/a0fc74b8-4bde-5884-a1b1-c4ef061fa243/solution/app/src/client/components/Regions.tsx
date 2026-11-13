import type { ReactNode } from "react";
import { SERVICE_NOTICE } from "../../shared/copy";
import { useLive } from "../lib/live";

export function Status({ label, children, className = "" }: { label: string; children?: ReactNode; className?: string }) {
  return (
    <div role="status" aria-label={label} className={className}>
      {children}
    </div>
  );
}

export function ServiceNotice() {
  const { services } = useLive();
  return (
    <Status label="Service notice" className="banner-stack">
      {services.mail ? null : <p className="banner">{SERVICE_NOTICE.mail}</p>}
      {services.storage ? null : <p className="banner">{SERVICE_NOTICE.storage}</p>}
    </Status>
  );
}
