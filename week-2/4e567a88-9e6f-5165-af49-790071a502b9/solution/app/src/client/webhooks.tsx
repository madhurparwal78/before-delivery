// The Webhooks screen: add an endpoint (secret shown once), the endpoints table and a delivery log.

import { useState } from "preact/hooks";
import { ApiError, get, query, request, type Delivery, type Endpoint } from "./api";
import { Dialog } from "./dialog";
import { capitalised, usePoll, when } from "./hooks";
import { Icon } from "./icons";
import { useSession } from "./session";
import { Alert, ScreenHead, StateWord, TeamPicker } from "./ui";

const OUTCOMES: Record<Delivery["outcome"], string> = {
  delivered: "Delivered", failed: "Failed", skipped_disabled: "Skipped (disabled)",
};

export function WebhooksScreen() {
  const session = useSession();
  const { me, teamId, notify } = session;
  const [endpoints, setEndpoints] = useState<Endpoint[] | null>(null);
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [logFor, setLogFor] = useState<Endpoint | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);

  usePoll(async () => {
    const { endpoints: listed } = await get<{ endpoints: Endpoint[] }>(`/api/webhook-endpoints${query({ team: teamId })}`);
    setEndpoints(listed);
  }, 2000, [teamId]);

  usePoll(async () => {
    if (!logFor) {
      setDeliveries(null);
      return;
    }
    const { deliveries: log } = await get<{ deliveries: Delivery[] }>(`/api/webhook-endpoints/${logFor.id}/deliveries`);
    setDeliveries(log);
  }, 2000, [logFor?.id]);

  const reload = async () => {
    const { endpoints: listed } = await get<{ endpoints: Endpoint[] }>(`/api/webhook-endpoints${query({ team: teamId })}`);
    setEndpoints(listed);
  };

  const add = async (event: Event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setUrlError(null);
    setAlert(null);
    notify("Checking address…");
    try {
      const { data } = await request<{ endpoint: Endpoint }>("POST", "/api/webhook-endpoints", { body: { url: url.trim() } });
      notify("");
      setUrl("");
      setCopied(false);
      setSecret(data.endpoint.secret ?? "");
      await reload();
    } catch (error) {
      notify("");
      if (error instanceof ApiError && error.body.code === "validation_failed") {
        const message = error.body.fields?.url ?? Object.values(error.body.fields ?? {})[0] ?? error.message;
        setUrlError(message);
        setAlert(message);
        document.getElementById("endpoint-url")?.focus();
      } else if (error instanceof ApiError && error.body.code === "endpoint_limit_reached") {
        setAlert("This team already has 5 endpoints.");
      } else setAlert(error instanceof ApiError ? error.message : "The address could not be checked. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const act = async (pending: string, done: string, call: () => Promise<unknown>, conflict: string) => {
    setAlert(null);
    notify(pending);
    try {
      await call();
      notify(done);
      await reload();
    } catch (error) {
      notify("");
      setAlert(error instanceof ApiError && error.status === 409 ? conflict
        : error instanceof ApiError ? error.message : "The request did not reach Dispatch. Try again.");
    }
  };

  return (
    <div class="screen">
      <ScreenHead title="Webhooks"><TeamPicker id="webhooks-team" /></ScreenHead>
      {me.role === "member" && (
        <form class="panel inline-form" aria-label="Add endpoint" onSubmit={add} noValidate>
          <div class={`field field--grow${urlError ? " field--invalid" : ""}`}>
            <label for="endpoint-url">Endpoint URL</label>
            <input id="endpoint-url" type="url" class="input" value={url} placeholder="https://hooks.example.com/dispatch"
              aria-describedby={urlError ? "endpoint-url-error" : undefined} aria-invalid={urlError ? "true" : undefined}
              onInput={(e) => setUrl(e.currentTarget.value)} />
            {urlError && <p id="endpoint-url-error" class="field__error">{urlError}</p>}
          </div>
          <button type="submit" class="btn btn--primary" disabled={busy}>{busy ? "Checking address…" : "Add endpoint"}</button>
        </form>
      )}
      <Alert text={alert} />
      <section class="panel">
        <header class="panel__head"><h2 class="panel__title">Endpoints</h2></header>
        <div class="table-wrap" tabIndex={0} role="region" aria-label="Endpoints table">
          <table class="table" aria-label="Endpoints">
            <thead>
              <tr>
                <th scope="col" class="col-wide">URL</th>
                <th scope="col">State</th>
                <th scope="col" class="num-col">Consecutive failures</th>
                <th scope="col" class="fold">Added</th>
                <th scope="col"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {endpoints === null && <tr><td colSpan={5} class="muted">Loading…</td></tr>}
              {endpoints?.length === 0 && <tr><td colSpan={5} class="muted">No endpoints yet.</td></tr>}
              {endpoints?.map((e) => (
                <tr key={e.id}>
                  <td class="url-cell">{e.url}</td>
                  <td><StateWord word={capitalised(e.state)} tone={e.state === "active" ? undefined : "alert"} /></td>
                  <td class="num num-col">{e.consecutive_failures}</td>
                  <td class="fold num">{when(e.created_at)}</td>
                  <td>
                    <div class="row-actions">
                      <button type="button" class="btn btn--secondary" aria-label={`Deliveries for ${e.url}`}
                        aria-pressed={logFor?.id === e.id ? "true" : "false"} onClick={() => setLogFor(e)}>Deliveries</button>
                      {me.role === "admin" && e.state === "disabled" && (
                        <button type="button" class="btn btn--primary" aria-label={`Re-enable ${e.url}`}
                          onClick={() => act("Re-enabling…", "Endpoint re-enabled.",
                            () => request("POST", `/api/webhook-endpoints/${e.id}/enable`), "That endpoint is not disabled.")}>
                          Re-enable
                        </button>
                      )}
                      <button type="button" class="btn btn--quiet" aria-label={`Remove ${e.url}`}
                        onClick={() => act("Removing…", "Endpoint removed.", async () => {
                          await request("DELETE", `/api/webhook-endpoints/${e.id}`);
                          if (logFor?.id === e.id) setLogFor(null);
                        }, "That endpoint could not be removed.")}>
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {logFor && (
        <section class="panel">
          <header class="panel__head">
            <h2 class="panel__title">Delivery log</h2>
            <span class="panel__meta url-cell">{logFor.url}</span>
          </header>
          <div class="table-wrap" tabIndex={0} role="region" aria-label="Deliveries table">
            <table class="table" aria-label="Deliveries">
              <thead>
                <tr>
                  <th scope="col">Event</th>
                  <th scope="col">Type</th>
                  <th scope="col" class="fold">Job</th>
                  <th scope="col" class="num-col">Attempt</th>
                  <th scope="col" class="fold">Attempted</th>
                  <th scope="col" class="num-col">Status code</th>
                  <th scope="col">Outcome</th>
                  <th scope="col" class="fold">Next attempt</th>
                </tr>
              </thead>
              <tbody>
                {deliveries === null && <tr><td colSpan={8} class="muted">Loading…</td></tr>}
                {deliveries?.length === 0 && <tr><td colSpan={8} class="muted">No deliveries yet.</td></tr>}
                {deliveries?.map((d) => (
                  <tr key={`${d.event_id}-${d.attempt}-${d.attempted_at}`}>
                    <td class="num id-cell">{d.event_id}</td>
                    <td class="num">{d.event_type}</td>
                    <td class="fold num">{d.job_id}</td>
                    <td class="num num-col">{d.attempt}</td>
                    <td class="fold num">{when(d.attempted_at)}</td>
                    <td class="num num-col">{d.status_code ?? "no answer"}</td>
                    <td><StateWord word={OUTCOMES[d.outcome]} tone={d.outcome === "delivered" ? undefined : "alert"} /></td>
                    <td class="fold num">{when(d.next_attempt_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <Dialog open={secret !== null} title="Signing secret" closable={false} onClose={() => setSecret(null)}>
        <p>Endpoint added. Copy the signing secret now; it is shown once.</p>
        <p class="secret num">{secret}</p>
        <div class="dialog__actions">
          <button type="button" class="btn btn--secondary" aria-label="Copy secret" onClick={async () => {
            await navigator.clipboard.writeText(secret ?? "");
            setCopied(true);
          }}>
            <Icon name="copy" size={18} /><span>{copied ? "Copied" : "Copy secret"}</span>
          </button>
          <button type="button" class="btn btn--primary" onClick={() => setSecret(null)}>Done</button>
        </div>
      </Dialog>
    </div>
  );
}
