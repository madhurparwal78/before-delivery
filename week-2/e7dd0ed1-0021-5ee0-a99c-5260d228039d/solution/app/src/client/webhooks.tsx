// Webhooks and Deliveries pages (brief: Screens and layout; Interactions, Webhooks; Feedback states, Webhooks).
import type { JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { formatCount, formatTime } from "../shared/format";
import { ApiError, type Delivery, type Endpoint, WEBHOOK_EVENTS, api, query } from "./api";
import type { Scope } from "./console";
import { ILLEGAL_TRANSITION } from "./copy";
import { useCursorPages } from "./cursorPages";
import { Dialog, Field, Status } from "./dialog";
import { Icon } from "./icons";
import { BucketScopeField } from "./keys";
import { follow } from "./router";
import { copyText } from "./share";

const dash = "—";

export function Webhooks({ scope }: { scope: Scope }): JSX.Element {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [status, setStatus] = useState("");
  const [adding, setAdding] = useState(false);
  const path = `/api/w/${scope.ws}/webhooks`;

  const load = async (): Promise<void> => setEndpoints((await api<{ endpoints: Endpoint[] }>("GET", path)).endpoints);
  useEffect(() => {
    load().catch((e: unknown) => setStatus(scope.report(e)));
  }, [scope.ws]);

  const change = async (endpoint: Endpoint, action: "disable" | "enable" | "delete"): Promise<void> => {
    try {
      if (action === "delete") {
        await api("DELETE", `${path}/${endpoint.id}`);
        setEndpoints((all) => all.filter((e) => e.id !== endpoint.id));
        setStatus("Endpoint deleted.");
        return;
      }
      const updated = await api<Endpoint>("POST", `${path}/${endpoint.id}/${action}`);
      setEndpoints((all) => all.map((e) => (e.id === endpoint.id ? updated : e)));
      setStatus(action === "disable" ? "Endpoint disabled. New events are not queued for it." : "Endpoint enabled.");
    } catch (error) {
      setStatus(error instanceof ApiError && error.code === "invalid_transition" ? ILLEGAL_TRANSITION : scope.report(error));
    }
  };

  return (
    <section class="page" aria-labelledby="hooks-title">
      <div class="page__head">
        <h1 id="hooks-title" class="page__title">
          Webhooks
        </h1>
        <button type="button" class="button button--primary" onClick={() => setAdding(true)}>
          <Icon name="plus" />
          Add endpoint
        </button>
      </div>
      <Status label="Webhook status" text={status} />
      <div class="table-frame">
        <table class="table table--cards" aria-label="Webhook endpoints">
          <thead>
            <tr>
              <th scope="col">URL</th>
              <th scope="col">Events</th>
              <th scope="col">Buckets</th>
              <th scope="col">Description</th>
              <th scope="col">State</th>
              <th scope="col">Created (UTC)</th>
              <th scope="col" class="cell--actions">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {endpoints.map((endpoint) => {
              const deliveries = `/console/${scope.ws}/_webhooks/${endpoint.id}/deliveries`;
              return (
                <tr key={endpoint.id}>
                  <td data-label="URL" class="mono cell--key">{endpoint.url}</td>
                  <td data-label="Events" class="mono">{endpoint.events.join(", ")}</td>
                  <td data-label="Buckets">{endpoint.buckets === null ? "All buckets" : endpoint.buckets.join(", ")}</td>
                  <td data-label="Description">{endpoint.description || dash}</td>
                  <td data-label="State">
                    <span class={`state state--${endpoint.state}`}>{endpoint.state}</span>
                  </td>
                  <td data-label="Created (UTC)" class="mono">{formatTime(endpoint.created_at)}</td>
                  <td class="cell--actions">
                    <a class="button button--small" href={deliveries} aria-label={`Deliveries for ${endpoint.url}`}
                      onClick={(e) => follow(e, deliveries)}>
                      Deliveries
                    </a>
                    {endpoint.state === "active" ? (
                      <button type="button" class="button button--small" onClick={() => void change(endpoint, "disable")}>
                        Disable endpoint
                      </button>
                    ) : (
                      <>
                        <button type="button" class="button button--small" onClick={() => void change(endpoint, "enable")}>
                          Enable endpoint
                        </button>
                        <button type="button" class="button button--small" onClick={() => void change(endpoint, "delete")}>
                          Delete endpoint
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {endpoints.length === 0 && <p class="empty">No webhook endpoints yet.</p>}
      {adding && <AddEndpointDialog scope={scope} path={path} onStatus={setStatus} onCreated={() => void load()} onClose={() => setAdding(false)} />}
    </section>
  );
}

interface AddEndpointDialogProps {
  scope: Scope;
  path: string;
  onStatus: (text: string) => void;
  onCreated: () => void;
  onClose: () => void;
}

function AddEndpointDialog({ scope, path, onStatus, onCreated, onClose }: AddEndpointDialogProps): JSX.Element {
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [buckets, setBuckets] = useState<string[] | null>(null);
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const secretField = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => secretField.current?.focus(), [secret]);

  const create = async (event: Event): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setErrors({});
    onStatus("Saving endpoint…");
    try {
      const created = await api<Endpoint>("POST", path, { url, events, buckets, description });
      setSecret(created.secret ?? "");
      onStatus("Endpoint added. Copy the signing secret now; Farshore won't show it again.");
      onCreated();
    } catch (error) {
      setPending(false);
      if (error instanceof ApiError && error.code === "validation_failed") {
        setErrors(error.body.errors ?? {});
        onStatus("Endpoint not added. Fix the highlighted fields.");
      } else if (error instanceof ApiError && error.code === "endpoint_limit") {
        onStatus("This workspace already has 5 webhook endpoints.");
      } else {
        onStatus(scope.report(error));
      }
    }
  };

  return (
    <Dialog title="Add webhook endpoint" onClose={onClose}>
      {secret === null ? (
        <form class="form" noValidate onSubmit={create}>
          <Field label="Endpoint URL" error={errors["url"]}>
            {(described, id) => (
              <input id={id} type="url" class="mono-input" value={url} spellcheck={false} aria-describedby={described}
                aria-invalid={errors["url"] ? true : undefined} onInput={(e) => setUrl(e.currentTarget.value)} />
            )}
          </Field>
          <fieldset class="choices">
            <legend>Events</legend>
            {WEBHOOK_EVENTS.map((name) => (
              <label key={name} class="choice">
                <input type="checkbox" checked={events.includes(name)}
                  onChange={(e) => setEvents(e.currentTarget.checked ? [...events, name] : events.filter((n) => n !== name))} />
                <span class="mono">{name}</span>
              </label>
            ))}
            {errors["events"] && (
              <p class="field__error">
                <Icon name="circle-x" />
                {errors["events"]}
              </p>
            )}
          </fieldset>
          <BucketScopeField buckets={scope.buckets} value={buckets} onChange={setBuckets} error={errors["buckets"]} />
          <Field label="Description" error={errors["description"]}>
            {(described, id) => (
              <input id={id} value={description} aria-describedby={described} aria-invalid={errors["description"] ? true : undefined}
                onInput={(e) => setDescription(e.currentTarget.value)} />
            )}
          </Field>
          <div class="form__actions">
            <button type="button" class="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" class="button button--primary" disabled={pending}>
              Create endpoint
            </button>
          </div>
        </form>
      ) : (
        <div class="secret">
          <Field label="Signing secret" hint="Shown once. Use it to verify the Farshore-Signature header.">
            {(described, id) => <input ref={secretField} id={id} class="mono-input" readOnly value={secret} aria-describedby={described} />}
          </Field>
          <div class="form__actions">
            <button type="button" class="button" onClick={() => void copyText(secret, secretField.current)}>
              <Icon name="copy" />
              Copy secret
            </button>
            <button type="button" class="button button--primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

export function Deliveries({ scope, endpointId }: { scope: Scope; endpointId: string }): JSX.Element {
  const [status, setStatus] = useState("");
  const [endpoint, setEndpoint] = useState<Endpoint | null>(null);
  const path = `/api/w/${scope.ws}/webhooks/${endpointId}`;
  const pages = useCursorPages<Delivery>(
    async (cursor) => {
      const page = await api<{ deliveries: Delivery[]; next_cursor: string | null }>("GET", `${path}/deliveries${query({ cursor: cursor ?? undefined })}`);
      return { rows: page.deliveries, next: page.next_cursor };
    },
    (error) => setStatus(scope.report(error)),
  );
  useEffect(() => {
    api<{ endpoints: Endpoint[] }>("GET", `/api/w/${scope.ws}/webhooks`).then(
      (r) => setEndpoint(r.endpoints.find((e) => e.id === endpointId) ?? null),
      (e: unknown) => setStatus(scope.report(e)),
    );
  }, [endpointId]);

  const redeliver = async (delivery: Delivery): Promise<void> => {
    try {
      const updated = await api<Delivery>("POST", `${path}/deliveries/${delivery.id}/redeliver`);
      pages.replace((rows) => rows.map((d) => (d.id === delivery.id ? updated : d)));
      setStatus(`Delivery ${formatCount(delivery.sequence)} queued again.`);
    } catch (error) {
      setStatus(error instanceof ApiError && error.code === "invalid_transition" ? ILLEGAL_TRANSITION : scope.report(error));
    }
  };

  return (
    <section class="page" aria-labelledby="deliveries-title">
      <h1 id="deliveries-title" class="page__title">
        Deliveries
      </h1>
      {endpoint && <p class="page__lead mono">{endpoint.url}</p>}
      <Status label="Webhook status" text={status} />
      <div class="table-frame">
        <table class="table table--cards" aria-label="Deliveries">
          <thead>
            <tr>
              <th scope="col" class="num">Sequence</th>
              <th scope="col">Event type</th>
              <th scope="col">State</th>
              <th scope="col" class="num">Attempts</th>
              <th scope="col" class="num">Last status</th>
              <th scope="col">Last error</th>
              <th scope="col">Next attempt (UTC)</th>
              <th scope="col">Delivered (UTC)</th>
              <th scope="col" class="cell--actions">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {pages.rows.map((delivery) => (
              <tr key={delivery.id}>
                <td data-label="Sequence" class="num">{formatCount(delivery.sequence)}</td>
                <td data-label="Event type" class="mono">{delivery.event_type}</td>
                <td data-label="State">
                  <span class={`state state--${delivery.state}`}>
                    {delivery.state === "dead" && <Icon name="circle-x" />}
                    {delivery.state}
                  </span>
                </td>
                <td data-label="Attempts" class="num">{formatCount(delivery.attempts)}</td>
                <td data-label="Last status" class="num">{delivery.last_status === null ? dash : String(delivery.last_status)}</td>
                <td data-label="Last error">{delivery.last_error ?? dash}</td>
                <td data-label="Next attempt (UTC)" class="mono">{delivery.next_attempt_at ? formatTime(delivery.next_attempt_at) : dash}</td>
                <td data-label="Delivered (UTC)" class="mono">{delivery.delivered_at ? formatTime(delivery.delivered_at) : dash}</td>
                <td class="cell--actions">
                  {delivery.state === "dead" && (
                    <button type="button" class="button button--small" onClick={() => void redeliver(delivery)}>
                      Redeliver<span class="vh"> {formatCount(delivery.sequence)}</span>
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages.controls}
    </section>
  );
}
