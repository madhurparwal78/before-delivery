// Settings card: webhooks. Click a webhook's URL to select it; `region "Deliveries"` then lists its deliveries, refreshed live.
import { useLayoutEffect, useState } from "preact/hooks";
import { announce } from "../../announce.tsx";
import { api, useAction } from "../../api.ts";
import { useLiveResource } from "../../live.ts";
import { Button } from "../../ui/button.tsx";
import { Card } from "../../ui/card.tsx";
import { Checkbox, TextField } from "../../ui/fields.tsx";
import { Notice } from "../../ui/feedback.tsx";
import { Heading } from "../../ui/heading.tsx";
import { Time } from "../../ui/time.tsx";
import type { CardProps } from "./settings-protection.tsx";
import type { Delivery } from "./types.ts";
import { FeedbackView, feedbackOf } from "./write.tsx";

const EVENTS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "push", label: "Pushes" },
  { value: "merge_request", label: "Merge requests" },
  { value: "pipeline", label: "Pipelines" },
  { value: "deployment", label: "Deployments" },
  { value: "issue", label: "Issues" },
];

const POLL_MS = 2000;

function DeliveryRow({ delivery, reload }: { delivery: Delivery; reload: () => Promise<void> }) {
  const last = delivery.attempts[delivery.attempts.length - 1];
  const redeliver = useAction(async () => {
    await api.post(`/api/deliveries/${delivery.id}/redeliver`);
    announce("Redelivery queued.");
    await reload();
  });
  return (
    <li class="sp-delivery">
      <span class="sp-delivery__text sp-mono">
        Delivery {delivery.short_id}, attempt {last ? last.number : 1}, {last && last.status_code !== null ? last.status_code : "no response"}, next try{" "}
        {delivery.next_at !== null ? <Time iso={delivery.next_at} /> : "none"}
      </span>
      <Button variant="secondary" pending={redeliver.pending} onClick={() => void redeliver.run()}>
        Redeliver
      </Button>
    </li>
  );
}

function Deliveries({ projectId, hook }: { projectId: string; hook: number }) {
  const deliveries = useLiveResource<Delivery[]>({
    project: projectId,
    types: ["push", "merge_request", "pipeline", "deployment", "issue"],
    load: async (signal) => {
      const body = await api.get<{ deliveries: Delivery[] }>(`/api/projects/${projectId}/webhooks/${hook}/deliveries`, { signal });
      return body.deliveries;
    },
    deps: [projectId, hook],
  });
  const reload = deliveries.reload;
  useLayoutEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [reload]);
  return (
    <section class="sp-deliveries" aria-labelledby={`deliveries-${hook}`}>
      <Heading level={3} id={`deliveries-${hook}`} class="sp-deliveries__title">
        Deliveries
      </Heading>
      {deliveries.error ? <Notice>{deliveries.error.message}</Notice> : null}
      {deliveries.data && deliveries.data.length === 0 ? <p class="sp-muted">No deliveries yet.</p> : null}
      {deliveries.data && deliveries.data.length > 0 ? (
        <ul class="sp-delivery-list">
          {deliveries.data.map((delivery) => (
            <DeliveryRow key={delivery.id} delivery={delivery} reload={reload} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function WebhooksCard({ projectId, data, editable, reload }: CardProps) {
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [events, setEvents] = useState<readonly string[]>(["push"]);
  const [selected, setSelected] = useState<number | null>(null);
  const add = useAction(async () => {
    await api.post(`/api/projects/${projectId}/webhooks`, { url: url.trim(), secret, events });
    announce("Webhook added.");
    setUrl("");
    setSecret("");
    await reload();
  });
  const feedback = feedbackOf(add.error, "hook", ["url", "secret", "events"]);
  const toggle = (value: string, on: boolean) => setEvents(on ? [...events, value] : events.filter((item) => item !== value));
  return (
    <Card
      kicker="WEBHOOKS"
      title="Webhooks"
      explanation="Each event is posted with a signature of the secret. Select a webhook to see its deliveries and send one again."
    >
      {data.webhooks.length === 0 ? <p class="sp-muted">No webhooks.</p> : null}
      <ul class="sp-rule-list">
        {data.webhooks.map((hook) => (
          <li key={hook.id} class="sp-rule-row">
            <button
              type="button"
              class="sp-hook-url sp-mono"
              aria-pressed={selected === hook.id ? "true" : "false"}
              onClick={() => setSelected(selected === hook.id ? null : hook.id)}
            >
              {hook.url}
            </button>
            <span class="sp-rule-row__summary">Events: {hook.events.join(", ")}</span>
          </li>
        ))}
      </ul>
      {selected !== null && data.webhooks.some((hook) => hook.id === selected) ? <Deliveries projectId={projectId} hook={selected} /> : null}
      {editable ? (
        <form
          class="sp-rule-form"
          onSubmit={(event) => {
            event.preventDefault();
            void add.run();
          }}
        >
          <FeedbackView feedback={feedback} signal={add.error} />
          <TextField label="Payload URL" name="hook-url" type="url" value={url} error={feedback.byField["url"]} onInput={(event) => setUrl(event.currentTarget.value)} />
          <TextField
            label="Signing secret"
            name="hook-secret"
            type="password"
            autocomplete="off"
            value={secret}
            error={feedback.byField["secret"]}
            onInput={(event) => setSecret(event.currentTarget.value)}
          />
          <fieldset class="sp-events" id="field-hook-events" tabIndex={-1}>
            <legend>Events</legend>
            {EVENTS.map((event) => (
              <Checkbox key={event.value} label={event.label} name={`hook-event-${event.value}`} checked={events.includes(event.value)} onChange={(change) => toggle(event.value, change.currentTarget.checked)} />
            ))}
            {feedback.byField["events"] ? <p class="sp-field__error">{feedback.byField["events"]}</p> : null}
          </fieldset>
          <Button type="submit" pending={add.pending}>
            Add webhook
          </Button>
        </form>
      ) : null}
    </Card>
  );
}
