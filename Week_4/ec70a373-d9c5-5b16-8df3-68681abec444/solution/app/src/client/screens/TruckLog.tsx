// Truck log: the member's own truck's visit log, read-only, with any overdue notice.
import { useEffect, useState, type ReactNode } from "react";
import type { Me, TruckLog } from "../../shared/api.ts";
import { api } from "../api.ts";
import { useSites } from "../useSites.ts";
import { OverdueNotice, VisitTable } from "../VisitTable.tsx";

const VISITS_REFRESH_MS = 60_000;

export function TruckLogScreen({ me }: { me: Me }): ReactNode {
  const truck = me.member?.truck;
  const [log, setLog] = useState<TruckLog | null>(null);
  const zone = useSites().find((site) => site.id === me.member?.home_site_id)?.time_zone ?? "UTC";
  useEffect(() => {
    if (!truck) return undefined;
    const load = (): void => {
      void api<TruckLog>(`/api/trucks/${truck.id}/visits`).then((result) => {
        if (result.ok) setLog(result.data);
      });
    };
    load();
    const id = setInterval(load, VISITS_REFRESH_MS);
    return () => clearInterval(id);
  }, [truck]);
  return (
    <div className="screen">
      <h1 className="screen-title">Truck log</h1>
      {truck && (
        <p className="lede">
          {truck.name} · permit <span className="mono">{truck.permit_number}</span>
        </p>
      )}
      {log && <OverdueNotice overdue={log.overdue} lastDepartedAt={log.last_departed_at} timeZone={zone} />}
      <VisitTable name="Visit log" visits={log?.visits ?? []} timeZone={zone} />
    </div>
  );
}
