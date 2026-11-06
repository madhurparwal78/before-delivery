// Box office: the proof queue, door scan and admissions by festival day (three tabs at 375).
import { Check, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { deadlineText, sessionTimeText } from "../../shared/brussels.ts";
import { api } from "../api.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { Field } from "../components/Field.tsx";
import { Gate, ScreenHeader, Tabs } from "../components/Screen.tsx";
import { copy } from "../copy.ts";
import { useSession } from "../session.tsx";
import { useProgramme } from "../state/programme.ts";
import type { Proof } from "../types.ts";

type Region = "proofs" | "door" | "admissions";
type Admissions = { festival_day: string; starts_at: string; ends_at: string; length_hours: number; venues: { venue_id: string; name: string; admissions: number }[]; total: number };

function ProofQueue() {
  const [proofs, setProofs] = useState<Proof[] | null>(null);
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState("");
  const load = useCallback(async () => {
    const r = await api.get<{ proofs: Proof[] }>("/api/box-office/proofs?status=pending");
    if (r.ok) setProofs(r.data.proofs);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const view = async (p: Proof) => {
    const r = await api.post<{ url: string }>(`/api/box-office/proofs/${p.id}/read`);
    if (r.ok) window.open(r.data.url, "_blank", "noopener");
    else setDecision(r.error === "storage_unavailable" ? copy.storageDown : "The proof can't be opened right now.");
  };

  const decide = async (p: Proof, choice: "approve" | "reject") => {
    if (choice === "reject" && !reason.trim()) return setDecision(`Write a reason before rejecting order ${p.order_ref}.`);
    setDecision(choice === "approve" ? `Approving order ${p.order_ref}…` : `Rejecting order ${p.order_ref}…`);
    const r = await api.post(`/api/box-office/proofs/${p.id}/decision`, { decision: choice, reason: choice === "reject" ? reason.trim() : null });
    if (r.ok) {
      setDecision(choice === "approve" ? copy.approved(p.order_ref) : copy.rejectedProof(p.order_ref));
      setReason("");
    } else if (r.error === "proof_hold_expired") setDecision(copy.decisionLate(p.order_ref));
    else if (r.error === "payment_unavailable") setDecision(copy.decisionPaymentsDown);
    else if (r.error === "storage_unavailable") setDecision(copy.decisionStorageDown);
    else if (r.error === "already_decided") setDecision(`Order ${p.order_ref} was already decided.`);
    else setDecision(`Write a reason before rejecting order ${p.order_ref}.`);
    void load();
  };

  return (
    <section aria-label="Proof queue" id="panel-proofs" className="panel bo__proofs">
      <h2 className="panel__title">Proof queue</h2>
      {!!proofs?.length && <Field label="Reason" hint="Needed to reject a proof; it is sent to the buyer."><input type="text" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      <p role="status" aria-label="Proof decision" className="status-line">{decision}</p>
      {proofs && proofs.length === 0 && <EmptyState text="No proofs waiting. New uploads appear here, oldest first." />}
      <ul className="queue" hidden={!proofs?.length}>
        {proofs?.map((p) => (
          <li key={p.id} className="queue__item">
            <p className="queue__ref figures">{p.order_ref}</p>
            <p>{p.buyer_name} · {p.kind} · {p.content_type.replace("application/", "").replace("image/", "").toUpperCase()}</p>
            <p className="figures hint">Decide by {deadlineText(Date.parse(p.deadline))}</p>
            <div className="queue__actions">
              <button type="button" className="button" aria-label={`View proof for ${p.order_ref}`} onClick={() => void view(p)}>View proof</button>
              <button type="button" className="button button--primary" aria-label={`Approve ${p.order_ref}`} onClick={() => void decide(p, "approve")}>Approve</button>
              <button type="button" className="button button--danger" aria-label={`Reject ${p.order_ref}`} onClick={() => void decide(p, "reject")}>Reject</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DoorScan({ onAdmitted }: { onAdmitted: () => void }) {
  const programme = useProgramme(true);
  const sessions = (programme?.sessions ?? []).filter((s) => s.status === "published");
  const [sessionId, setSessionId] = useState("");
  const [code, setCode] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const chosen = sessionId || sessions[0]?.id || "";
  const scan = async (e: FormEvent) => {
    e.preventDefault();
    const r = await api.post<{ holder_name: string; item_title: string }>("/api/box-office/scans", { pass_code: code.trim(), session_id: chosen });
    if (r.ok) {
      setResult({ ok: true, text: copy.admitted(r.data.holder_name, r.data.item_title) });
      onAdmitted();
    } else if (r.error === "unknown_pass") setResult({ ok: false, text: copy.unknownPass });
    else if (r.error === "admission_refused") {
      const reason = String(r.body.reason) as keyof typeof copy.refusal;
      setResult({ ok: false, text: copy.refusal[reason]?.((r.body.first_admitted_at as string | null) ?? null) ?? copy.refusal.pass_voided() });
    } else setResult({ ok: false, text: "Choose a session at this door." });
    setCode("");
    input.current?.focus();
  };
  return (
    <section aria-label="Door scan" id="panel-door" className="panel bo__door">
      <h2 className="panel__title">Door scan</h2>
      <form className="stack" onSubmit={(e) => void scan(e)}>
        <Field label="Session">
          <select value={chosen} onChange={(e) => setSessionId(e.target.value)}>
            {sessions.map((s) => <option key={s.id} value={s.id}>{s.title} — {sessionTimeText(Date.parse(s.starts_at), Date.parse(s.ends_at))}</option>)}
          </select>
        </Field>
        <Field label="Pass code"><input ref={input} type="text" autoComplete="off" spellCheck={false} className="figures" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        <button type="submit" className="button button--primary">Scan</button>
      </form>
      <div role="status" aria-label="Door scan result" className={`scan-result${result ? (result.ok ? " is-admitted" : " is-refused") : ""}`}>
        {result && (result.ok ? <Check aria-hidden="true" size={28} /> : <TriangleAlert aria-hidden="true" size={28} />)}
        <span>{result?.text ?? "Waiting for a pass code."}</span>
      </div>
    </section>
  );
}

function AdmissionsReport({ version }: { version: number }) {
  const programme = useProgramme();
  const [day, setDay] = useState("");
  const [report, setReport] = useState<Admissions | null>(null);
  const chosen = day || programme?.festival_days[0]?.date || "";
  useEffect(() => {
    if (!chosen) return;
    void api.get<Admissions>(`/api/box-office/admissions?festival_day=${chosen}`).then((r) => { if (r.ok) setReport(r.data); });
  }, [chosen, version]);
  return (
    <section aria-label="Admissions" id="panel-admissions" className="panel bo__admissions">
      <h2 className="panel__title">Admissions</h2>
      <Field label="Festival day" hint="Each festival day runs from 05:00 to 05:00 Brussels time.">
        <select value={chosen} onChange={(e) => setDay(e.target.value)}>
          {programme?.festival_days.map((d) => <option key={d.date} value={d.date}>{d.label}</option>)}
        </select>
      </Field>
      <table aria-label="Admissions by venue" className="ruled figures">
        <thead><tr><th scope="col">Venue</th><th scope="col">Admissions</th></tr></thead>
        <tbody>{report?.venues.map((v) => <tr key={v.venue_id}><td>{v.name}</td><td>{v.admissions}</td></tr>)}</tbody>
        <tfoot><tr><th scope="row">Total ({report?.length_hours ?? 24} h day)</th><td>{report?.total ?? 0}</td></tr></tfoot>
      </table>
    </section>
  );
}

export function BoxOffice() {
  const { user } = useSession();
  const [region, setRegion] = useState<Region>("proofs");
  const [version, setVersion] = useState(0);
  return (
    <div className="screen" data-ground="screen">
      <ScreenHeader title="Box office" lede="Decide reduced-rate proofs, scan passes at the door, follow each festival day's admissions." />
      <Gate user={user} roles={["box_office"]}>
        <div className="grid screen__body">
          <div className="bo__tabs"><Tabs label="Box office regions" tabs={[["proofs", "Proof queue"], ["door", "Door scan"], ["admissions", "Admissions"]]} current={region} onChange={setRegion} /></div>
          <div className="bo" data-region={region}>
            <ProofQueue />
            <DoorScan onAdmitted={() => setVersion((v) => v + 1)} />
            <AdmissionsReport version={version} />
          </div>
        </div>
      </Gate>
    </div>
  );
}
