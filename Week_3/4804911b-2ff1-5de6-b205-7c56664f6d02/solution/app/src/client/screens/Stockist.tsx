import { useEffect, useRef, useState } from "preact/hooks";
import { COPY } from "../../shared/copy";
import type { Deliveries, Delivery, Endpoint, Session } from "../../shared/types";
import { Alerts } from "../lib/Alerts";
import { DataTable } from "../lib/DataTable";
import { useEvery, useWide } from "../lib/hooks";
import { Icon } from "../lib/icons";
import { Modal } from "../lib/Modal";
import { ApiFailure, LostRequest, del, get, messageOf, post } from "../lib/net";
import { navigate } from "../lib/router";
import { Slide } from "../lib/Slide";
import { discardHeld, setSession, takeHeld } from "../lib/session";
import { useAccountWatch } from "../lib/useAccount";

const LABEL: Record<Delivery["state"], string> = { pending: "Pending", delivered: "Delivered", failed: "Failed", redelivered: "Redelivered", cancelled: "Cancelled" };

interface Secret {
  value: string;
  endpointId: string;
  after: "save" | "rotate";
}

export function Stockist({ session }: { session: Session }) {
  const wide = useWide();
  const held = useRef(takeHeld(session.accountId));
  const [endpoints, setEndpoints] = useState<Endpoint[] | null>(null);
  const [log, setLog] = useState<Deliveries | null>(null);
  const [url, setUrl] = useState(held.current?.endpoint ?? "");
  const [fieldError, setFieldError] = useState("");
  const [status, setStatus] = useState(held.current ? COPY.workKept : "");
  const [announce, setAnnounce] = useState<string[]>([]);
  const [secret, setSecret] = useState<Secret | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const busyRef = useRef(new Set<string>());
  const labels = useRef<Map<string, string> | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const focused = useRef<string | null>(null);
  const urlRef = useRef(url);
  urlRef.current = url;

  useAccountWatch(session.accountId, () => (urlRef.current ? { accountId: session.accountId, drafts: {}, correction: null, endpoint: urlRef.current } : null));

  const setBusyKey = (key: string, on: boolean) => {
    if (on) busyRef.current.add(key);
    else busyRef.current.delete(key);
    setBusy(new Set(busyRef.current));
  };

  const load = async () => {
    const [e, d] = await Promise.all([get<{ endpoints: Endpoint[] }>("/api/stockist/endpoints"), get<Deliveries>("/api/stockist/deliveries")]);
    setEndpoints((old) => (old && JSON.stringify(old) === JSON.stringify(e.endpoints) ? old : e.endpoints));
    setLog((old) => (old && JSON.stringify(old) === JSON.stringify(d) ? old : d));
    const next = new Map(d.deliveries.map((x) => [x.eventId, LABEL[x.state]]));
    if (labels.current) {
      const said: string[] = [];
      for (const [id, label] of next) {
        const before = labels.current.get(id);
        if (before === undefined ? label !== "Pending" : before !== label) said.push(`Delivery ${id} is now ${label}.`);
      }
      if (said.length) setAnnounce(said);
    }
    labels.current = next;
  };

  useEffect(() => {
    void load().catch(() => undefined);
  }, []);
  useEvery(5000, () => void load().catch(() => undefined));

  // a focused control that left because its entry changed hands focus to the delivery log
  useEffect(() => {
    const key = focused.current;
    if (key && !document.querySelector(`[data-keep="${CSS.escape(key)}"]`) && (!document.activeElement || document.activeElement === document.body)) {
      logRef.current?.focus({ preventScroll: true });
      focused.current = null;
    }
  });

  const guard = async (key: string, pending: string, work: () => Promise<string | void>, lost?: string) => {
    if (busyRef.current.has(key)) return;
    setBusyKey(key, true);
    setStatus(pending);
    try {
      const message = await work();
      if (typeof message === "string") setStatus(message);
    } catch (error) {
      setStatus(error instanceof LostRequest && lost ? lost : messageOf(error, COPY.unavailable));
    } finally {
      setBusyKey(key, false);
    }
  };

  const save = () =>
    void guard("save", "Checking the address.", async () => {
      setFieldError("");
      try {
        const saved = await post<{ id: string; signingSecret: string }>("/api/stockist/endpoints", { url: url.trim() });
        setSecret({ value: saved.signingSecret, endpointId: saved.id, after: "save" });
        setUrl("");
        await load();
        return "Endpoint saved.";
      } catch (error) {
        if (error instanceof ApiFailure) setFieldError(error.body.message);
        throw error;
      }
    });

  const test = (e: Endpoint) => void guard(`test-${e.id}`, "Checking the address.", async () => (await post(`/api/stockist/endpoints/${e.id}/test`), "Test message accepted. Check the delivery log for the result."));
  const rotate = (e: Endpoint) =>
    void guard(`rotate-${e.id}`, "Rotating the secret.", async () => {
      const r = await post<{ signingSecret: string }>(`/api/stockist/endpoints/${e.id}/rotate-secret`);
      setSecret({ value: r.signingSecret, endpointId: e.id, after: "rotate" });
      return "Secret rotated.";
    });
  const recover = (e: Endpoint) =>
    void guard(`recover-${e.id}`, "Asking for recovery.", async () => {
      const r = await post<{ requested: string[] }>(`/api/stockist/endpoints/${e.id}/recover`);
      await load();
      return `Recovery requested: ${r.requested.length}. Check the delivery log for the result.`;
    });
  const redeliver = (d: Delivery) =>
    void guard(`redeliver-${d.eventId}`, "Asking for a redelivery.", async () => {
      await post(`/api/stockist/deliveries/${d.eventId}/redeliver`);
      await load();
      return "Redelivery requested. Check the delivery log for the result.";
    });
  const remove = (e: Endpoint) =>
    void guard(
      `remove-${e.id}`,
      "Removing the endpoint.",
      async () => {
        try {
          await del(`/api/stockist/endpoints/${e.id}`);
        } catch (error) {
          if (!(error instanceof ApiFailure && error.status === 404)) throw error;
        }
        setEndpoints((list) => (list ?? []).filter((x) => x.id !== e.id));
        requestAnimationFrame(() => field.current?.focus());
        void load().catch(() => undefined);
        return "Endpoint removed.";
      },
      COPY.lostRemoval,
    );

  const closeSecret = () => {
    const s = secret;
    setSecret(null);
    requestAnimationFrame(() => {
      if (s?.after === "rotate") document.querySelector<HTMLElement>(`[data-keep="rotate-${s.endpointId}"]`)?.focus();
      else saveButton.current?.focus();
    });
  };

  const live = new Map((endpoints ?? []).map((e) => [e.id, e]));
  const aria = (key: string) => (busy.has(key) ? "true" : undefined);
  const guarded = (key: string, run: () => void) => () => {
    if (busyRef.current.has(key)) return;
    run();
  };
  const track = (e: FocusEvent) => {
    focused.current = (e.target as HTMLElement | null)?.closest?.("[data-keep]")?.getAttribute("data-keep") ?? null;
  };

  const rows = (log?.deliveries ?? []).map((d) => ({
    key: d.eventId,
    cells: [
      <span class="wrap">{d.eventId}</span>,
      d.noticeNumber ? `${d.noticeNumber} v${d.noticeVersion}` : "Test",
      <span class="wrap">
        {d.endpointUrl}
        {d.endpointRemoved ? " (removed)" : ""}
      </span>,
      LABEL[d.state],
      d.attempts.length ? d.attempts.map((a) => `${a.responseStatus ?? "none"} ${a.outcome}`).join(", ") : "No attempts yet",
      d.state === "failed" && live.has(d.endpointId) && !d.endpointRemoved ? (
        <button type="button" class="rect-button small" data-keep={`redeliver-${d.eventId}`} aria-disabled={aria(`redeliver-${d.eventId}`)} aria-label={`Redeliver ${d.eventId}`} onClick={guarded(`redeliver-${d.eventId}`, () => redeliver(d))}>
          <span aria-hidden="true">Redeliver</span>
        </button>
      ) : null,
    ],
  }));

  return (
    <main class="desk-page stockist" onFocusIn={track}>
      <Alerts messages={!!log?.messagesQueued} work={!!log?.workQueued} />
      <header class="desk-head">
        <h1>{session.displayName}</h1>
        <SignOut />
      </header>
      <div class="two">
        <div class="col">
          <form
            class="block"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <label for="endpoint-url">Endpoint URL</label>
            <input id="endpoint-url" ref={field} type="text" inputMode="url" autocomplete="off" spellcheck={false} value={url} aria-describedby={fieldError ? "endpoint-error" : undefined} aria-invalid={fieldError ? "true" : undefined} onInput={(e) => setUrl((e.currentTarget as HTMLInputElement).value)} />
            {fieldError && (
              <p id="endpoint-error" class="field-error">
                {fieldError}
              </p>
            )}
            <button ref={saveButton} type="submit" class="rect-button" aria-disabled={aria("save")} onClick={(e) => busyRef.current.has("save") && e.preventDefault()}>
              Save endpoint
            </button>
            <div role="status" aria-label="Endpoint status" class="status">
              {status}
            </div>
          </form>
          <section class="endpoints" aria-label="Endpoints">
            <h2>Endpoints</h2>
            {endpoints && endpoints.length === 0 && <Slide line="NO SCREEN BOOKED" sentence="Save an endpoint to receive price messages." tone="charcoal" />}
            <ul role="list" class="endpoint-list">
              {(endpoints ?? []).map((e) => (
                <li key={e.id} class="endpoint">
                  <p class="endpoint-url">{e.url}</p>
                  <p class="endpoint-meta">{e.registered ? "Registered with the message service" : "Waiting for the message service"}</p>
                  <div class="row-actions">
                    <button type="button" class="rect-button small" data-keep={`test-${e.id}`} aria-label={`Send test to ${e.url}`} aria-disabled={aria(`test-${e.id}`)} onClick={guarded(`test-${e.id}`, () => test(e))}>
                      <Icon name="arrow" size={18} />
                      <span aria-hidden="true">Send test</span>
                    </button>
                    <button type="button" class="rect-button small" data-keep={`rotate-${e.id}`} aria-label={`Rotate secret for ${e.url}`} aria-disabled={aria(`rotate-${e.id}`)} onClick={guarded(`rotate-${e.id}`, () => rotate(e))}>
                      <span aria-hidden="true">Rotate secret</span>
                    </button>
                    <button type="button" class="rect-button small" data-keep={`recover-${e.id}`} aria-label={`Recover failed for ${e.url}`} aria-disabled={aria(`recover-${e.id}`)} onClick={guarded(`recover-${e.id}`, () => recover(e))}>
                      <span aria-hidden="true">Recover failed</span>
                    </button>
                    <button type="button" class="rect-button small" data-keep={`remove-${e.id}`} aria-label={`Remove ${e.url}`} aria-disabled={aria(`remove-${e.id}`)} onClick={guarded(`remove-${e.id}`, () => remove(e))}>
                      <Icon name="x" size={18} />
                      <span aria-hidden="true">Remove</span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
          <a class="rect-button" href="/api/stockist/price-sheet.csv" download>
            <Icon name="download" size={20} />
            <span>Download price sheet</span>
          </a>
        </div>
        <div class="col">
          <section class="log" aria-label="Deliveries">
            <h2>Deliveries</h2>
            <div role="status" aria-label="Delivery status" class="status delivery-status">
              {announce.map((l) => (
                <div key={l}>{l}</div>
              ))}
            </div>
            {log && log.deliveries.length === 0 && <Slide line="NOTHING ON THE REEL" sentence="No messages have gone to your endpoints yet." tone="charcoal" />}
            <div ref={logRef} tabIndex={-1} class="log-focus">
              {log && log.deliveries.length > 0 && (
                <DataTable
                  label="Delivery log"
                  wide={wide}
                  columns={[{ head: "Event", lead: true }, { head: "Notice" }, { head: "Endpoint" }, { head: "State" }, { head: "Attempts" }, { head: "Action" }]}
                  rows={rows}
                />
              )}
            </div>
          </section>
        </div>
      </div>
      {secret && (
        <Modal label="Signing secret" initialFocus="button">
          <h2>Signing secret</h2>
          <p class="secret-note">Copy it now. It is shown once.</p>
          <p class="secret">{secret.value}</p>
          <button type="button" class="rect-button" onClick={closeSecret}>
            I have saved it
          </button>
        </Modal>
      )}
    </main>
  );
}

export function SignOut() {
  return (
    <button
      type="button"
      class="rect-button"
      onClick={() => {
        void del("/api/session", { quiet: true })
          .catch(() => undefined)
          .then(() => {
            discardHeld();
            setSession(null);
            navigate("/");
          });
      }}
    >
      Sign out
    </button>
  );
}
