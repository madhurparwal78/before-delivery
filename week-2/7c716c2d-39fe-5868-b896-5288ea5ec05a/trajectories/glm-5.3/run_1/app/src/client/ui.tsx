import { useEffect, useRef, useState } from "react";
import type { Knock, Person, Room, ServiceStatus } from "./types.ts";
import { statusLabel } from "./types.ts";

export function StatusRegion({ children, politeness = "polite", role = "status" }: { children: React.ReactNode; politeness?: "polite" | "assertive"; role?: "status" | "alert" }): React.ReactNode {
  return (
    <div role={role} aria-live={politeness}>
      {children}
    </div>
  );
}

export function ServiceNotices({ status, workspace }: { status: ServiceStatus | null; workspace: { seats: { limit: number } | null; name: string } | null }): React.ReactNode {
  if (!status) return null;
  const alerts: React.ReactNode[] = [];
  if (status.database === "unavailable") {
    alerts.push(
      <div key="db" role="alert">
        Tallyroom can't reach its database. Changes are not being saved.
      </div>
    );
  }
  if (status.storage === "unavailable") {
    alerts.push(
      <div key="st" role="alert">
        Attachments are unavailable right now. Nothing new can be attached.
      </div>
    );
  }
  if (status.billing === "unavailable" && workspace?.seats) {
    alerts.push(
      <div key="bi" role="alert">
        {`Billing unavailable. Your seat limit stays at ${workspace.seats.limit} until billing is back.`}
      </div>
    );
  }
  if (status.mail === "delayed" && status.held_mail !== null && status.held_mail > 0) {
    alerts.push(
      <div key="ma" role="alert">
        {status.held_mail === 1
          ? "Mail delayed: 1 message waiting to send."
          : `Mail delayed: ${status.held_mail} messages waiting to send.`}
      </div>
    );
  }
  if (alerts.length === 0) return null;
  return <div className="notices">{alerts}</div>;
}

export function TitleBlock({ keyText, state, changed }: { keyText: string; state: string; changed: string }): React.ReactNode {
  return (
    <div className="sheet-title-block">
      <div>{keyText}</div>
      <div>{state}</div>
      <div>{changed}</div>
    </div>
  );
}

export function NotFoundDetail(): React.ReactNode {
  return (
    <div className="not-found">
      <h1 role="heading">Not found</h1>
      <p>That item doesn't exist or isn't shared with you.</p>
    </div>
  );
}

export function personOrUnassigned(name: string | null): string {
  return name && name.length > 0 ? name : "Unassigned";
}

export function roomPersonStatus(room: Room | undefined, personId: string): "active" | "away" | null {
  const occ = room?.occupants.find((o) => o.person_id === personId);
  return occ ? occ.status : null;
}

export function useInterval(fn: () => void, ms: number): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function knockCopy(status: Knock["status"] | null): string | null {
  if (!status) return null;
  switch (status) {
    case "waiting":
      return "Waiting";
    case "let_in":
      return "Let in";
    case "not_now":
      return "Not now";
    case "expired":
      return "Knock expired";
  }
}

export function personLabel(person: Person | null): string {
  return person ? person.name : "";
}
