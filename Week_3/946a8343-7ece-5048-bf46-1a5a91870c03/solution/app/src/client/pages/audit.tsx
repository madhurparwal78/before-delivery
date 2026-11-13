// `/projects/<id>/-/audit`: the project's audit events, newest first (actor, action, target, before and after, server time).
import "../styles/project.css";
import { api, useResource } from "../api.ts";
import { useRoute } from "../router.ts";
import { EmptyState } from "../ui/empty-state.tsx";
import { Notice, Skeleton } from "../ui/feedback.tsx";
import { Page } from "../ui/page.tsx";
import { Time } from "../ui/time.tsx";
import type { AuditEvent } from "./project/types.ts";

function shown(value: unknown): string {
  return value === null || value === undefined ? "none" : JSON.stringify(value);
}

function AuditBody({ id }: { id: string }) {
  const events = useResource(async (signal) => (await api.get<{ events: AuditEvent[] }>(`/api/projects/${id}/audit`, { signal })).events, [id]);
  if (events.error) return <Notice>{events.error.message}</Notice>;
  if (!events.data) return <Skeleton rows={6} height={48} />;
  if (events.data.length === 0) return <EmptyState eyebrow="AUDIT" headline="No audit events yet" tone="dark" />;
  return (
    <div class="sp-audit-scroll">
      <table class="sp-audit">
        <caption class="sp-visually-hidden">Audit events</caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Actor</th>
            <th scope="col">Action</th>
            <th scope="col">Target</th>
            <th scope="col">Before</th>
            <th scope="col">After</th>
          </tr>
        </thead>
        <tbody>
          {events.data.map((event) => (
            <tr key={event.id}>
              <td>
                <Time iso={event.at} />
              </td>
              <td>{event.actor}</td>
              <td class="sp-mono">{event.action}</td>
              <td class="sp-mono">{event.target}</td>
              <td class="sp-mono">{shown(event.before)}</td>
              <td class="sp-mono">{shown(event.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AuditPage() {
  const { id = "" } = useRoute().params;
  return (
    <Page title="Audit events" project={id} pageKeys={["project"]}>
      <AuditBody id={id} />
    </Page>
  );
}
