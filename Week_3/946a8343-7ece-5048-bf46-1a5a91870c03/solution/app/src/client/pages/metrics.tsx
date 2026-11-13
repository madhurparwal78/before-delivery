import { api, useResource } from "../api.ts";
import { setQuery, useRoute } from "../router.ts";
import { useUser } from "../session.ts";
import { Notice, Page, Select, Skeleton } from "../ui/index.ts";
import "../styles/ci.css";
import type { Metrics } from "./ci/types.ts";

const RANGES = [7, 30, 90];

function zoneOptions(selected: string, own: string): string[] {
  const known = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return [...new Set(["UTC", own, selected, ...known])].sort();
}

function Figure({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <p class="sp-figure">
      <span class="sp-figure__label sp-mono">{label}</span> <span class={`sp-figure__value${unit === undefined && !/\d/.test(value) ? " sp-figure__value--words" : ""}`}>{value}</span>
      {unit ? <span class="sp-figure__unit"> {unit}</span> : null}
    </p>
  );
}

export default function MetricsPage() {
  const { params, query } = useRoute();
  const project = Number(params.id);
  const own = useUser()?.time_zone ?? "UTC";
  const zone = query.get("zone") ?? own;
  const days = Number(query.get("days") ?? "7");
  const resource = useResource<Metrics>(
    (signal) => api.get<Metrics>(`/api/projects/${project}/metrics?zone=${encodeURIComponent(zone)}&days=${days}`, { signal }),
    [project, zone, days],
  );
  const metrics = resource.data;
  return (
    <Page title="Delivery metrics" project={params.id}>
      <div class="sp-ci-page">
        <div class="sp-metrics__controls">
          <Select
            label="Time zone"
            name="zone"
            value={zone}
            options={zoneOptions(zone, own).map((value) => ({ value, label: value }))}
            onChange={(event) => setQuery({ zone: event.currentTarget.value })}
          />
          <Select
            label="Range"
            name="days"
            value={String(days)}
            options={(RANGES.includes(days) ? RANGES : [...RANGES, days]).map((value) => ({ value: String(value), label: `${value} days` }))}
            onChange={(event) => setQuery({ days: event.currentTarget.value })}
          />
        </div>
        {resource.error ? <Notice>{resource.error.message}</Notice> : null}
        {!metrics && !resource.error ? <Skeleton rows={2} height={96} /> : null}
        {metrics ? (
          <section class="sp-metrics" aria-label="Delivery metrics">
            <Figure label="Deployment frequency" value={(metrics.deployment_frequency ?? 0).toFixed(2)} unit="per day" />
            <Figure label="Lead time" value={metrics.lead_time_hours === null ? "No data" : metrics.lead_time_hours.toFixed(2)} unit={metrics.lead_time_hours === null ? undefined : "hours"} />
            <Figure label="Change failure rate" value={metrics.change_failure_rate === null ? "No data" : `${metrics.change_failure_rate.toFixed(1)}%`} />
            <Figure label="Recovery time" value={metrics.recovery_time_hours === null ? "No failures" : metrics.recovery_time_hours.toFixed(2)} unit={metrics.recovery_time_hours === null ? undefined : "hours"} />
          </section>
        ) : null}
      </div>
    </Page>
  );
}
