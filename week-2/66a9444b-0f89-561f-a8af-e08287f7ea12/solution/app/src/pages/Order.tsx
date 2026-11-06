// The order page: ref and status, the ruled line table with pass downloads, the proof panel for reduced-rate
// orders and a transfer dialog for each transferable line. It refreshes every 10 seconds.
import { Download, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { euro } from "../../shared/money.ts";
import { api, download } from "../api.ts";
import { closeWithMotion, Dialog } from "../components/Dialog.tsx";
import { Field } from "../components/Field.tsx";
import { Gate, ScreenHeader } from "../components/Screen.tsx";
import { copy } from "../copy.ts";
import { useSession } from "../session.tsx";
import type { Line, Order, Proof } from "../types.ts";
import { statusName } from "./Tickets.tsx";

const REFRESH_MS = 10_000;

function statusLines(order: Order): string[] {
  const out = [order.confirmation_mail === "sent" ? copy.mailSent : copy.mailPending];
  if (order.status === "proof_pending") out.push(copy.proofPending);
  const states = order.lines.map((l) => l.state);
  if (order.rate === "reduced" && states.every((s) => s === "voided")) out.push(copy.rejected);
  if (order.rate === "reduced" && states.some((s) => s === "expired")) out.push(copy.lapsed);
  if (order.refunds.some((r) => r.status === "pending")) out.push(copy.refundPending);
  return out;
}

function TransferDialog({ line, order, opener, onDone, onClose }: { line: Line; order: Order; opener: HTMLElement | null; onDone: (text: string) => void; onClose: () => void }) {
  const name = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    onDone(copy.transferring);
    const r = await api.post(`/api/orders/${order.id}/lines/${line.id}/transfer`, { recipient_name: form.get("name"), recipient_email: form.get("email") });
    setBusy(false);
    if (r.ok) {
      onDone(copy.transferred(String(form.get("name")).trim()));
      closeWithMotion(panel.current, onClose);
      return;
    }
    if (r.errors) {
      setErrors({ ...(r.errors.recipient_name ? { name: "Enter the recipient's name." } : {}), ...(r.errors.recipient_email ? { email: "Enter a valid email address." } : {}) });
      onDone("Check the recipient's details.");
    } else onDone(r.error === "storage_unavailable" ? copy.transferDown : r.error === "already_transferred" ? "This ticket was already transferred." : copy.transferDown);
  };
  return (
    <Dialog label="Transfer ticket" onClose={() => closeWithMotion(panel.current, onClose)} initialFocus={name} returnFocus={opener} className="dialog--narrow">
      <form ref={panel} className="stack" onSubmit={(e) => void submit(e)} noValidate>
        <h2 className="dialog__title">Transfer {line.title}</h2>
        <p className="hint">The recipient gets a new pass by email. Your current pass for this ticket stops scanning straight away. Nothing is charged.</p>
        <Field label="Recipient name" error={errors.name}><input ref={name} name="name" type="text" autoComplete="off" /></Field>
        <Field label="Recipient email" error={errors.email}><input name="email" type="email" autoComplete="off" /></Field>
        <div className="dialog__actions">
          <button type="button" className="button" onClick={() => closeWithMotion(panel.current, onClose)}>Cancel</button>
          <button type="submit" className="button button--primary" disabled={busy}>Transfer ticket</button>
        </div>
      </form>
    </Dialog>
  );
}

function ProofPanel({ order, onUploaded }: { order: Order; onUploaded: () => void }) {
  const [kind, setKind] = useState("student");
  const [status, setStatus] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const upload = async () => {
    const chosen = file.current?.files?.[0];
    if (!chosen) return setStatus("Choose your proof document first.");
    setStatus(copy.uploading);
    const form = new FormData();
    form.append("kind", kind);
    form.append("file", chosen, chosen.name);
    const r = await api.post<Proof>(`/api/orders/${order.id}/proof`, form);
    if (r.ok) {
      setStatus(copy.proofReceived(r.data.deadline));
      onUploaded();
      return;
    }
    const code = r.errors?.file;
    if (r.status === 413) setStatus(copy.proofTooLarge);
    else if (code === "unsupported_type" || code === "empty") setStatus(copy.proofWrongType);
    else if (code === "invalid_name") setStatus(copy.badFileName);
    else if (r.error === "storage_unavailable") setStatus(copy.storageDown);
    else if (r.error === "proof_already_uploaded") setStatus("We already have your proof for this order.");
    else setStatus("Choose your proof document first.");
  };
  return (
    <fieldset className="panel proof">
      <legend className="panel__title">Proof of reduced rate</legend>
      <p className="hint">Upload a PDF, JPEG or PNG of your student card or jobseeker certificate, up to 5,000,000 bytes. Box office decides before the deadline.</p>
      <div className="radios">
        <label className="radio"><input type="radio" name="kind" value="student" checked={kind === "student"} onChange={() => setKind("student")} /><span>Student</span></label>
        <label className="radio"><input type="radio" name="kind" value="jobseeker" checked={kind === "jobseeker"} onChange={() => setKind("jobseeker")} /><span>Jobseeker</span></label>
      </div>
      <Field label="Proof document"><input ref={file} type="file" accept="application/pdf,image/jpeg,image/png" /></Field>
      <button type="button" className="button button--primary" onClick={() => void upload()}>Upload proof</button>
      <p role="status" aria-label="Upload status" className="status-line">{status}</p>
    </fieldset>
  );
}

export function OrderPage({ id }: { id: string }) {
  const { user } = useSession();
  const [order, setOrder] = useState<Order | null>(null);
  const [missing, setMissing] = useState(false);
  const [note, setNote] = useState("");
  const [transfer, setTransfer] = useState<{ line: Line; opener: HTMLElement } | null>(null);
  const load = useCallback(async () => {
    const r = await api.get<Order>(`/api/orders/${encodeURIComponent(id)}`);
    if (r.ok) setOrder(r.data);
    else if (r.status === 404) setMissing(true);
  }, [id]);
  useEffect(() => {
    if (!user) return;
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [user, load]);

  const save = async (code: string) => {
    const r = await download(`/api/orders/${order!.id}/passes/${code}`);
    if (!r.ok) return setNote(r.status === 503 ? copy.passDown : "This pass can't be downloaded.");
    const url = URL.createObjectURL(r.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${code}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="screen" data-ground="screen">
      <ScreenHeader title={order ? `Order ${order.ref}` : "Order"} />
      <Gate user={user} roles={["visitor", "group_booker", "finance"]}>
        <div className="grid screen__body">
          {missing && <p className="hint">This order can't be found.</p>}
          {order && (
            <>
              <div role="status" aria-label="Order status" className="banner">
                <span className="badge" data-state={order.status}>{statusName(order.status)}</span>
                {statusLines(order).map((line) => <p key={line}>{line}</p>)}
                {note && <p>{note}</p>}
              </div>
              <div className="table-wrap">
                <table aria-label="Order lines" className="ruled figures cards">
                  <thead><tr><th scope="col">Item</th><th scope="col">Holder</th><th scope="col">State</th><th scope="col">Amounts</th><th scope="col">Pass</th></tr></thead>
                  <tbody>
                    {order.lines.map((l) => (
                      <tr key={l.id}>
                        <td data-label="Item">{l.title}</td>
                        <td data-label="Holder">{l.holder_name}</td>
                        <td data-label="State"><span className="badge" data-state={l.state}>{statusName(l.state)}</span></td>
                        <td data-label="Amounts">
                          {euro(l.list_cents)}
                          {l.group_discount_cents > 0 && <span className="amount-note"> − {euro(l.group_discount_cents)} group</span>}
                          {l.voucher_cents > 0 && <span className="amount-note"> − {euro(l.voucher_cents)} voucher</span>}
                          <span className="amount-note"> = {euro(l.charged_cents)}</span>
                        </td>
                        <td data-label="Pass" className="order__pass">
                          {l.pass && l.state === "captured" && (
                            <a href={`/api/orders/${order.id}/passes/${l.pass.code}`} className="button button--quiet" onClick={(e) => { e.preventDefault(); void save(l.pass!.code); }}>
                              <Download aria-hidden="true" size={16} />Download pass {l.pass.code}
                            </a>
                          )}
                          {l.state === "transferred" && <span className="hint">Held by {l.holder_name}</span>}
                          {l.state === "captured" && (
                            <button type="button" className="button button--quiet" onClick={(e) => setTransfer({ line: l, opener: e.currentTarget })}>
                              <Send aria-hidden="true" size={16} />Transfer {l.title}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><th scope="row" colSpan={3}>Total</th><td colSpan={2}>{euro(order.total_cents)}</td></tr></tfoot>
                </table>
              </div>
              {order.status === "proof_pending" && <ProofPanel order={order} onUploaded={() => void load()} />}
              {transfer && (
                <TransferDialog line={transfer.line} order={order} opener={transfer.opener}
                  onDone={(text) => { setNote(text); void load(); }} onClose={() => setTransfer(null)} />
              )}
            </>
          )}
        </div>
      </Gate>
    </div>
  );
}
