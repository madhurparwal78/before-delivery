import { CircleCheck, CircleX } from "lucide-react";
import type { ServiceName, Services } from "../lib/types";
import { money } from "../../shared/format";
import { Loading, PageFailure, useOfficeData } from "./shared";

// The owner's last 30 days of dunning recovery and refunds, and each service's live status.

const DASHBOARD_POLL_MS = 10000;

interface DashboardBody {
  dunning: { entered: number; recovered: number; cancelled: number; in_progress: number };
  refunds: { count: number; total_cents: number };
  services: Services;
}

const SERVICE_NAMES: [ServiceName, string][] = [
  ["killbill", "Kill Bill"],
  ["postgres", "Postgres"],
  ["pocketbase", "PocketBase"],
  ["minio", "MinIO"],
  ["mailpit", "Mailpit"],
];

function Figure({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="figure-card">
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

export function Dashboard() {
  const { data, failure } = useOfficeData<DashboardBody>("/api/owner/dashboard", DASHBOARD_POLL_MS);
  return (
    <div className="office-page">
      <h1>Dashboard</h1>
      {failure && !data && <PageFailure failure={failure} />}
      {!data && !failure && <Loading />}
      {data && (
        <div className="office-grid">
          <section aria-labelledby="dash-dunning" className="panel span-6">
            <h2 id="dash-dunning">Dunning recovery</h2>
            <p className="muted">Last 30 days</p>
            <dl className="figures">
              <Figure label="Entered dunning" value={data.dunning.entered} />
              <Figure label="Recovered" value={data.dunning.recovered} />
              <Figure label="Cancelled" value={data.dunning.cancelled} />
              <Figure label="In progress" value={data.dunning.in_progress} />
            </dl>
          </section>
          <section aria-labelledby="dash-refunds" className="panel span-6">
            <h2 id="dash-refunds">Refunds</h2>
            <p className="muted">Last 30 days</p>
            <dl className="figures">
              <Figure label="Refunds applied" value={data.refunds.count} />
              <Figure label="Refunded total" value={money(data.refunds.total_cents)} />
            </dl>
          </section>
          <section aria-labelledby="dash-services" className="panel span-12">
            <h2 id="dash-services">Service status</h2>
            <ul aria-label="Services" className="service-list">
              {SERVICE_NAMES.map(([key, name]) => {
                const up = data.services[key] === "up";
                return (
                  <li key={key} className={up ? "service-up" : "service-down"}>
                    {up ? <CircleCheck size={20} aria-hidden="true" /> : <CircleX size={20} aria-hidden="true" />}
                    <span>{`${name}: ${up ? "Up" : "Down"}`}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
