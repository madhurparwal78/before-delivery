import { GitMerge, PackageCheck } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import type { Company, CompanyDetail, Me } from "../../shared/api.js";
import { monthLabel } from "../../shared/months.js";
import { api } from "../api.js";
import { useFeedback } from "../feedback.js";
import { shortDate } from "../format.js";
import { Link, navigate } from "../router.js";
import { Dialog } from "../ui/Dialog.js";
import { StatusWord } from "../ui/StatusWord.js";

export function CompanyPage({ me, companyId }: { me: Me; companyId: string }) {
  const feedback = useFeedback();
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [merging, setMerging] = useState(false);

  const load = useCallback(() => {
    setMissing(false);
    api.get<{ company: CompanyDetail }>(`/api/companies/${companyId}`).then((r) => setCompany(r.company), (error: unknown) => {
      setCompany(null);
      setMissing(true);
      feedback.fail(error, (f) => (f.status === 404 ? "This company no longer exists. It may have been merged." : null));
    });
  }, [companyId, feedback]);
  useEffect(load, [load]);

  if (missing) return <div className="page-body"><h1>Company not found</h1><p><Link href="/companies">Back to companies</Link></p></div>;
  if (!company) return <div className="page-body" aria-busy="true" />;
  return (
    <div className="page-body">
      <p className="crumb"><Link href="/companies">Companies</Link></p>
      <header className="page-head">
        <h1>{company.name}</h1>
        {me.user.role !== "customer_success" && (
          <button type="button" className="button-quiet" onClick={() => setMerging(true)}><GitMerge aria-hidden="true" size={16} />Merge into…</button>
        )}
      </header>
      <p className="lede">{company.domains.join(", ")}</p>
      <div className="detail-grid">
        <section className="panel">
          <h2>Requests</h2>
          {company.requests.length === 0 ? <p className="empty-line">No requests linked to this company yet.</p> : (
            <ul aria-label="Requests" className="plain-list requests">
              {company.requests.map((r) => (
                <li key={r.featureId}>
                  <Link href={`/features/${r.featureId}`}>{r.featureName}</Link>
                  <span className="badge"><StatusWord status={r.status} /></span>
                  {r.shipped && r.releaseName && r.targetMonth && (
                    <span className="shipped-line"><PackageCheck aria-hidden="true" size={14} />Shipped in {r.releaseName} · {monthLabel(r.targetMonth)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel">
          <h2>Contacts</h2>
          {company.contacts.length === 0 ? <p className="empty-line">No contacts.</p> : (
            <ul aria-label="Contacts" className="plain-list">
              {company.contacts.map((c) => <li key={c.id}>{c.name} · {c.email}</li>)}
            </ul>
          )}
        </section>
      </div>
      <section className="panel">
        <h2>Notes</h2>
        {company.notes.length === 0 ? <p className="empty-line">No notes from this company.</p> : (
          <ul aria-label="Company notes" className="plain-list">
            {company.notes.map((n) => <li key={n.id}><Link href={`/inbox/${n.id}`}>{n.title}</Link> · <span className="num">{shortDate(n.createdAt, me.workspace.timeZone)}</span></li>)}
          </ul>
        )}
      </section>
      {merging && <MergeDialog source={company} onClosed={() => setMerging(false)} />}
    </div>
  );
}

function MergeDialog({ source, onClosed }: { source: Company; onClosed: () => void }) {
  const feedback = useFeedback();
  const id = useId();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get<{ companies: Company[] }>("/api/companies").then((r) => {
      const others = r.companies.filter((c) => c.id !== source.id);
      setCompanies(others);
      setTarget((t) => t || (others[0]?.name ?? ""));
    }, () => undefined);
  }, [source.id]);

  const merge = async (close: () => void): Promise<void> => {
    const into = companies.find((c) => c.name === target);
    if (!into) return;
    setBusy(true);
    feedback.clearAlert();
    try {
      const result = await api.post<{ company: Company }>(`/api/companies/${source.id}/merge`, { intoCompanyId: into.id });
      feedback.say("save", `Merged ${source.name} into ${result.company.name}.`);
      close();
      navigate(`/companies/${result.company.id}`);
    } catch (error) {
      feedback.fail(error);
      setBusy(false);
    }
  };

  return (
    <Dialog title="Merge company" onClosed={onClosed}>
      {(close) => (
        <form className="dialog-body" onSubmit={(e) => { e.preventDefault(); void merge(close); }}>
          <p>{source.name}’s contacts, notes and domains move to the company you choose, and {source.name} is removed.</p>
          <div className="field">
            <label htmlFor={`${id}-into`}>Merge into</label>
            <select id={`${id}-into`} value={target} onChange={(e) => setTarget(e.target.value)}>
              {companies.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div className="dialog-actions">
            <button type="button" className="button-quiet" onClick={close}>Cancel</button>
            <button type="submit" className="button" aria-busy={busy} disabled={busy}>{busy ? "Merging…" : "Merge companies"}</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
