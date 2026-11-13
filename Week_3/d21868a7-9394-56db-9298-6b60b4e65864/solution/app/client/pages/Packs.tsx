import { AlertTriangle, Download, FileText } from "lucide-react";
import { useState, type FormEvent } from "react";
import { DistrictTotals, Page } from "../components/Shell.tsx";
import { api, capitalised, districtTime, navigate, usePoll } from "../lib.ts";
import type { Pack, User } from "../types.ts";

const go = (href: string) => (event: { preventDefault: () => void }) => {
  event.preventDefault();
  navigate(href);
};

export function Packs() {
  const packs = usePoll(() => api<{ packs: Pack[] }>("/api/packs"), []);
  return (
    <Page title="Regulator packs" lead={<DistrictTotals />}>
      <p>
        <a className="btn btn-ink" href="/packs/new" onClick={go("/packs/new")}>Prepare a new pack</a>
      </p>
      {packs.data === null ? (
        <p className="muted">Loading…</p>
      ) : packs.data.packs.length === 0 ? (
        <p className="empty"><FileText size={18} aria-hidden="true" /> No packs yet. Prepare one for the regulator from New pack.</p>
      ) : (
        <table className="table">
          <thead>
            <tr><th scope="col">Pack</th><th scope="col">Period</th><th scope="col">State</th><th scope="col">Signatory</th><th scope="col">Created</th></tr>
          </thead>
          <tbody>
            {packs.data.packs.map((p) => (
              <tr key={p.id}>
                <td data-label="Pack"><a className="link" href={`/packs/${p.id}`} onClick={go(`/packs/${p.id}`)}>{p.number}</a></td>
                <td data-label="Period" className="num">{p.from} to {p.to}</td>
                <td data-label="State">
                  <span className={`badge${p.stalled_on ? " badge-alert" : ""}`}>{capitalised(p.state)}{p.stalled_on ? `, waiting on the ${p.stalled_on}` : ""}</span>
                </td>
                <td data-label="Signatory" className="wrap">{p.signatory}</td>
                <td data-label="Created">{districtTime(p.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Page>
  );
}

interface Previewed {
  from: string;
  to: string;
  signatory: string;
  document: string;
}

export function NewPack() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [signatory, setSignatory] = useState("");
  const [preview, setPreview] = useState<Previewed | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const edit = (set: (value: string) => void) => (value: string) => {
    set(value);
    setPreview(null);
  };

  const previewPack = async (event: FormEvent) => {
    event.preventDefault();
    setErrors({});
    setStatus("");
    const query = new URLSearchParams({ from, to, signatory });
    const reply = await api<string>(`/api/packs/preview?${query}`);
    if (reply.ok) setPreview({ from, to, signatory, document: reply.data });
    else {
      setPreview(null);
      setErrors(reply.error.errors ?? {});
      setStatus(reply.error.message ?? "Check the period and signatory.");
    }
  };

  const submit = async () => {
    if (!preview) return;
    setBusy(true);
    setStatus("Storing and mailing the pack.");
    const reply = await api<{ pack: Pack }>("/api/packs", { method: "POST", body: preview });
    setBusy(false);
    if (reply.ok) {
      navigate(`/packs/${reply.data.pack.id}`);
      return;
    }
    if (reply.error.errors) setErrors(reply.error.errors);
    setStatus(reply.error.message ?? "Check the period and signatory.");
  };

  const fieldError = (name: string) => errors[name] && <p className="field-error">{errors[name]}</p>;

  return (
    <Page title="New pack" lead={<DistrictTotals />}>
      <form className="pack-form card-sheet" aria-label="New pack" onSubmit={previewPack} noValidate>
        <div className="field-row">
          <div className="field">
            <label className="field-label" htmlFor="pack-from">From</label>
            <input id="pack-from" type="text" inputMode="numeric" placeholder="YYYY-MM-DD" value={from} onChange={(e) => edit(setFrom)(e.target.value)} />
            {fieldError("from")}
          </div>
          <div className="field">
            <label className="field-label" htmlFor="pack-to">To</label>
            <input id="pack-to" type="text" inputMode="numeric" placeholder="YYYY-MM-DD" value={to} onChange={(e) => edit(setTo)(e.target.value)} />
            {fieldError("to")}
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="pack-signatory">Signatory</label>
          <input id="pack-signatory" type="text" autoComplete="name" value={signatory} onChange={(e) => edit(setSignatory)(e.target.value)} />
          {fieldError("signatory")}
        </div>
        <button type="submit" className="btn btn-ink">Preview pack</button>
      </form>
      <section className="pack-preview" role="region" aria-label="Pack preview">
        <h2 className="panel-title">Preview</h2>
        {preview ? <pre className="preview-text">{preview.document}</pre> : <p className="muted">Preview a period to read the pack before you sign it.</p>}
      </section>
      <div className="form-actions">
        <button type="button" className="btn btn-commit" disabled={!preview || busy} onClick={submit}>Sign and submit pack</button>
      </div>
      <p role="status" aria-label="Pack status" className="status-line">{status}</p>
    </Page>
  );
}

const PACK_STORE_DOWN = "The evidence store is not answering. The pack will be stored and mailed when it returns.";
const PACK_MAIL_DOWN = "The mail service is not answering. The pack is stored and will be mailed when it returns.";

function packStatus(p: Pack): string {
  if (p.state === "withdrawn") return `Pack ${p.number} withdrawn. Nothing was mailed.`;
  if (p.state === "mailed") return `Pack ${p.number} stored and mailed to the regulator.`;
  if (p.stalled_on === "store") return PACK_STORE_DOWN;
  if (p.stalled_on === "mail") return PACK_MAIL_DOWN;
  return "Storing and mailing the pack.";
}

export function PackPage({ id, user }: { id: string; user: User }) {
  const pack = usePoll(() => api<{ pack: Pack }>(`/api/packs/${encodeURIComponent(id)}`), [id]);
  const [action, setAction] = useState("");
  const p = pack.data?.pack;

  const withdraw = async () => {
    setAction("Withdrawing.");
    const reply = await api<{ pack: Pack }>(`/api/packs/${encodeURIComponent(id)}`, { method: "DELETE" });
    setAction(reply.ok ? "" : reply.error.message ?? "");
    pack.reload();
  };

  if (pack.failure?.status === 404) {
    return (
      <Page title={`Pack ${id}`} lead={<DistrictTotals />}>
        <p>There is no pack {id} in your reach.</p>
      </Page>
    );
  }

  const stalled = p && p.state !== "withdrawn" && p.state !== "mailed" && p.stalled_on;
  return (
    <Page title={`Pack ${p?.number ?? id}`} lead={<DistrictTotals />}>
      {stalled && (
        <p className="banner banner-alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>{p.stalled_on === "store" ? PACK_STORE_DOWN : PACK_MAIL_DOWN}</span>
        </p>
      )}
      <p role="status" aria-label="Pack status" className="status-line">{action || (p ? packStatus(p) : "")}</p>
      {p && (
        <div className="record card-sheet">
          <dl className="facts">
            <div><dt>Number</dt><dd>{p.number}</dd></div>
            <div><dt>Period</dt><dd className="num">{p.from} to {p.to}</dd></div>
            <div><dt>State</dt><dd><span className={`badge${stalled ? " badge-alert" : ""}`}>{capitalised(p.state)}</span></dd></div>
            <div><dt>Signatory</dt><dd className="wrap">{p.signatory}</dd></div>
            <div><dt>Created</dt><dd>{districtTime(p.created_at)}</dd></div>
            {p.mailed_at && <div><dt>Mailed</dt><dd>{districtTime(p.mailed_at)}</dd></div>}
          </dl>
          {p.sha256 && (
            <p role="group" aria-label="Pack digest" className="digest">
              <span className="digest-text">SHA-256 {p.sha256}</span>
            </p>
          )}
          <div className="form-actions">
            {(p.state === "stored" || p.state === "mailed") && (
              <a className="btn btn-ink" href={`/api/packs/${encodeURIComponent(p.id)}/document`} download={`${p.number}.txt`}>
                <Download size={16} aria-hidden="true" />
                Download pack
              </a>
            )}
            {user.role === "clerk" && (p.state === "building" || p.state === "stored") && (
              <button type="button" className="btn btn-quiet" onClick={withdraw}>Withdraw pack</button>
            )}
          </div>
        </div>
      )}
    </Page>
  );
}
