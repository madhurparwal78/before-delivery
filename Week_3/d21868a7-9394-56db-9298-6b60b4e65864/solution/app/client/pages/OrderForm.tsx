import { AlertTriangle } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Modal } from "../components/Modal.tsx";
import { Select } from "../components/Select.tsx";
import { AllocationCounter, Page } from "../components/Shell.tsx";
import { SESSION_ENDED, WINDOW_STATUS_LABEL, api, navigate, setFlash, useLocation, usePoll, type Reply } from "../lib.ts";
import type { Channel, DeliveryWindow, Operator, Order, User } from "../types.ts";

const QUOTE_DELAY_MS = 300;
const RESTORED_COPY = "Your session ended. Your order is as you left it. Check it and place it again.";

/** The order draft, kept in this browser tab per grower. `ended` marks a draft whose session ended
 * on the form: only such a draft is restored, once, when the same grower lands on the form again. */
interface Draft {
  turnout: string;
  windowId: string;
  volume: string;
  operator: string;
  standby: string;
  ended: boolean;
}

const draftKey = (growerId: number) => `ditchbook:order-draft:${growerId}`;

function readDraft(growerId: number): Draft | null {
  const text = sessionStorage.getItem(draftKey(growerId));
  return text === null ? null : (JSON.parse(text) as Draft);
}

const writeDraft = (growerId: number, draft: Draft) => sessionStorage.setItem(draftKey(growerId), JSON.stringify(draft));

/** The reply to one quote input (`turnout|window|volume`): the rate on success, else its field errors. */
interface Quote {
  key: string;
  rate: string | null;
  errors: Record<string, string>;
}

/** The selected window's `remaining_ml` from the server reply for it that arrived last. */
interface Remaining {
  windowId: string;
  value: string;
}

function Field({ label, error, id, children }: { label: string; error?: string; id: string; children: ReactNode }) {
  return (
    <div className="field">
      <label className="field-label" id={`${id}-label`} htmlFor={id}>{label}</label>
      {children}
      {error && <p className="field-error" id={`${id}-error`}>{error}</p>}
    </div>
  );
}

export function OrderForm({ user }: { user: User }) {
  const { query } = useLocation();
  const [restored] = useState(() => {
    const draft = readDraft(user.id);
    return draft?.ended ? draft : null;
  });
  const [windowId, setWindowId] = useState(restored?.windowId ?? query.get("window") ?? "");
  const [turnout, setTurnout] = useState(restored?.turnout ?? "");
  const [volume, setVolume] = useState(restored?.volume ?? "");
  const [operator, setOperator] = useState(restored?.operator ?? "");
  const [standby, setStandby] = useState(restored?.standby ?? "");
  const [status, setStatus] = useState(restored ? RESTORED_COPY : "");

  // The draft follows every edit; an ended session marks it so the next landing restores it.
  const draft = { turnout, windowId, volume, operator, standby };
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => writeDraft(user.id, { ...draft, ended: false }), [user.id, turnout, windowId, volume, operator, standby]);
  useEffect(() => {
    const onEnded = () => writeDraft(user.id, { ...draftRef.current, ended: true });
    window.addEventListener(SESSION_ENDED, onEnded);
    return () => window.removeEventListener(SESSION_ENDED, onEnded);
  }, [user.id]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [taken, setTaken] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [placed, setPlaced] = useState<{ key: string; errors: Record<string, string> } | null>(null);
  const [remaining, setRemaining] = useState<Remaining | null>(null);
  const [allocationReread, setAllocationReread] = useState(0);
  const placeRef = useRef<HTMLButtonElement>(null);

  const channels = usePoll(() => api<{ channels: Channel[] }>("/api/channels"), [], 10_000);
  const windows = usePoll(() => api<{ windows: DeliveryWindow[] }>("/api/windows"), []);
  const turnouts = usePoll(() => api<{ turnouts: { code: string; channel_id: string }[] }>("/api/turnouts"), []);
  const operators = usePoll(() => api<{ operators: Operator[] }>("/api/operators"), [], 10_000);
  const idle = (): Promise<Reply<never>> => Promise.resolve({ ok: false, status: 400, error: {} });
  const windowRead = usePoll(
    (): Promise<Reply<{ window: DeliveryWindow }>> => (windowId ? api(`/api/windows/${encodeURIComponent(windowId)}`) : idle()),
    [windowId],
  );
  const selected = windowRead.data?.window.id === windowId ? windowRead.data.window : null;
  const selectedRef = useRef(windowId);
  selectedRef.current = windowId;
  const noteRemaining = (w: { id: string; remaining_ml: string }) => {
    if (w.id === selectedRef.current) setRemaining({ windowId: w.id, value: w.remaining_ml });
  };
  useEffect(() => {
    if (selected) noteRemaining(selected);
  }, [windowRead.seq]);

  // The quote answers the latest turnout, window and volume on screen only: a reply to an earlier input is dropped.
  const inputKey = `${turnout}|${windowId}|${volume.trim()}`;
  const latestInput = useRef(inputKey);
  latestInput.current = inputKey;
  useEffect(() => {
    if (!windowId || !volume.trim()) return;
    const key = inputKey;
    const params = new URLSearchParams({ window: windowId, volume_ml: volume.trim() });
    if (turnout) params.set("turnout", turnout);
    const timer = setTimeout(async () => {
      const reply = await api<{ rate_ml_day: string; window: DeliveryWindow }>(`/api/orders/quote?${params}`);
      if (latestInput.current !== key) return;
      if (reply.ok) {
        setQuote({ key, rate: reply.data.rate_ml_day, errors: {} });
        noteRemaining(reply.data.window);
      } else {
        setQuote({ key, rate: null, errors: reply.error.errors ?? {} });
      }
    }, QUOTE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [inputKey]);

  const railIndex = new Map((channels.data?.channels ?? []).map((c, index) => [c.id, index]));
  const myTurnouts = [...(turnouts.data?.turnouts ?? [])].sort(
    (a, b) => railIndex.get(a.channel_id)! - railIndex.get(b.channel_id)! || a.code.localeCompare(b.code),
  );
  const myChannels = new Set(myTurnouts.map((t) => t.channel_id));
  const turnoutChannel = myTurnouts.find((t) => t.code === turnout)?.channel_id;
  // The selected window stays listed in its opening position whatever its status; any other closed window is not listed.
  const choices = (windows.data?.windows ?? []).filter(
    (w) => (w.status !== "closed" || w.id === windowId) && (turnoutChannel ? w.channel_id === turnoutChannel : myChannels.has(w.channel_id)),
  );

  const quoted = quote?.key === inputKey && windowId && volume.trim() ? quote : null;
  const rate = quoted?.rate ?? null;
  const errors = { ...(quoted?.errors ?? {}), ...(placed?.key === inputKey ? placed.errors : {}) };
  const remainingShown = windowId && remaining?.windowId === windowId ? remaining.value : null;
  const orderable = Boolean(selected?.orderable);
  const operatorChoices = (operators.data?.operators ?? [])
    .filter((o) => o.name !== null)
    .map((o) => ({ value: o.code, text: `${o.name} (${o.code})` }));
  const statusText = selected
    ? WINDOW_STATUS_LABEL[selected.status] +
      (selected.restriction_cap_ml_day ? ` Restricted to ${selected.restriction_cap_ml_day} ML/day, ${selected.remaining_ml} ML left.` : "")
    : "Choose a delivery window.";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // One press sends one request, and none while the window is not orderable.
    if (busyRef.current || !orderable) return;
    busyRef.current = true;
    setBusy(true);
    setPlaced(null);
    setStatus("Placing your order.");
    const key = inputKey;
    const reply = await api<{ order: Order }>("/api/orders", {
      method: "POST",
      body: { turnout: turnout || null, window_id: windowId || null, volume_ml: volume.trim(), operator_code: operator || null, standby_code: standby || null },
    });
    busyRef.current = false;
    setBusy(false);
    if (reply.ok) {
      sessionStorage.removeItem(draftKey(user.id));
      const number = reply.data.order.number;
      setFlash(`order:${number}`, `Order ${number} scheduled.`);
      navigate(`/orders/${number}`);
      return;
    }
    if (reply.error.errors) {
      setPlaced({ key, errors: reply.error.errors });
      setStatus("Check the fields marked below.");
      if (reply.error.errors.volume_ml) setAllocationReread((n) => n + 1);
    } else if (reply.error.error === "window_full") {
      setStatus("");
      noteRemaining({ id: windowId, remaining_ml: String(reply.error.remaining_ml) });
      setAllocationReread((n) => n + 1);
      setTaken(true);
    } else {
      setStatus(reply.error.message ?? "");
    }
  };

  const describedBy = (field: string) => (errors[field] ? `${field}-error` : undefined);

  return (
    <Page title="New order" lead={<AllocationCounter reread={allocationReread} />}>
      {!channels.data || !windows.data || !turnouts.data || !operators.data ? (
        <p className="muted">Loading…</p>
      ) : (
      <form className="order-form card-sheet" aria-label="New order" onSubmit={submit} noValidate>
        <Field label="Turnout" id="turnout" error={errors.turnout}>
          <Select
            id="turnout"
            labelId="turnout-label"
            value={turnout}
            placeholder="Choose a turnout"
            choices={myTurnouts.map((t) => ({ value: t.code, text: t.code }))}
            onChange={(code) => {
              const channel = myTurnouts.find((t) => t.code === code)?.channel_id;
              if (selected && selected.channel_id !== channel) setWindowId("");
              setTurnout(code);
            }}
            describedBy={describedBy("turnout")}
            invalid={Boolean(errors.turnout)}
          />
        </Field>
        <Field label="Delivery window" id="window_id" error={errors.window_id}>
          <Select
            id="window_id"
            labelId="window_id-label"
            value={windowId}
            placeholder="Choose a delivery window"
            choices={choices.map((w) => ({ value: w.id, text: `${w.channel_name}, ${w.label}` }))}
            onChange={setWindowId}
            describedBy={describedBy("window_id")}
            invalid={Boolean(errors.window_id)}
          />
        </Field>
        <div className="field">
          <span className="field-label" id="window-status-label">Window status</span>
          <p role="status" aria-label="Window status" className={`window-status${selected?.restriction_cap_ml_day ? " is-restricted" : ""}`}>
            {statusText}
          </p>
        </div>
        <Field label="Volume (ML)" id="volume_ml" error={errors.volume_ml}>
          <input
            id="volume_ml"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            className="num-input"
            value={volume}
            onChange={(e) => setVolume(e.target.value)}
            aria-invalid={Boolean(errors.volume_ml)}
            aria-describedby={describedBy("volume_ml")}
          />
        </Field>
        <div className="derived">
          <div role="group" aria-label="Flow rate" className="derived-item">
            <span className="field-label">Flow rate</span>
            <span className="derived-value num">{rate === null ? "—" : <>{rate} <span className="unit">ML/day</span></>}</span>
          </div>
          <div role="group" aria-label="Window remaining" className="derived-item">
            <span className="field-label">Window remaining</span>
            <span className="derived-value num">{remainingShown === null ? "—" : <>{remainingShown} <span className="unit">ML</span></>}</span>
          </div>
        </div>
        <Field label="Gate worked by" id="operator_code" error={errors.operator_code}>
          <Select
            id="operator_code"
            labelId="operator_code-label"
            value={operator}
            placeholder="Choose an operator"
            choices={operatorChoices}
            onChange={setOperator}
            describedBy={describedBy("operator_code")}
            invalid={Boolean(errors.operator_code)}
          />
        </Field>
        <Field label="Standby operator" id="standby_code" error={errors.standby_code}>
          <Select
            id="standby_code"
            labelId="standby_code-label"
            value={standby}
            placeholder="No standby"
            choices={[{ value: "", text: "No standby" }, ...operatorChoices]}
            onChange={setStandby}
            describedBy={describedBy("standby_code")}
            invalid={Boolean(errors.standby_code)}
          />
        </Field>
        <button ref={placeRef} type="submit" className="btn btn-commit btn-block" aria-disabled={busy || !orderable}>
          Place order
        </button>
        <p role="status" aria-label="Order status" className="status-line">{status}</p>
      </form>
      )}
      {taken && (
        <Modal role="alertdialog" labelledBy="taken-heading" variant="alert" returnFocus={placeRef} onClose={() => setTaken(false)}>
          <div className="modal-body">
            <h2 id="taken-heading" className="modal-title alert-title">
              <AlertTriangle size={22} aria-hidden="true" />
              Capacity taken
            </h2>
            <p>Another order took the last of this window's capacity. Nothing was debited from your allocation.</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-ink" onClick={() => setTaken(false)}>Back to the order</button>
            </div>
          </div>
        </Modal>
      )}
    </Page>
  );
}
