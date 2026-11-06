import { useCallback, useEffect, useState } from 'react';
import type { Company, CompanyDetail as CompanyDetailShape } from '../../shared/types';
import { monthLabel } from '../../shared/format';
import { ApiError, request } from '../api';
import { useApp } from '../app-state';
import { Dialog } from '../components/Dialog';
import { FEATURE_STATUS_LABELS } from '../labels';
import { Link, navigate, useRoute } from '../router';

export function Companies(): JSX.Element {
  const [companies, setCompanies] = useState<Company[]>([]);

  useEffect(() => {
    void request<{ companies: Company[] }>('/api/companies').then((data) => setCompanies(data.companies));
  }, []);

  return (
    <main className="companies">
      <h1 className="display">Companies</h1>
      <table aria-label="Companies">
        <thead>
          <tr>
            <th scope="col">Company</th>
            <th scope="col">Domains</th>
            <th scope="col">Contacts</th>
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          {companies.map((company) => (
            <tr key={company.id}>
              <td>
                <Link to={`/companies/${company.id}`}>{company.name}</Link>
              </td>
              <td>{company.domains.join(', ')}</td>
              <td className="figure">{company.contacts.length}</td>
              <td className="figure">{company.noteCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

export function CompanyDetail(): JSX.Element {
  const app = useApp();
  const route = useRoute();
  const companyId = route.slice('/companies/'.length);
  const [company, setCompany] = useState<CompanyDetailShape | null>(null);
  const [others, setOthers] = useState<Company[]>([]);
  const [merging, setMerging] = useState(false);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await request<{ company: CompanyDetailShape }>(`/api/companies/${companyId}`);
      setCompany(data.company);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) setMissing(true);
    }
    const list = await request<{ companies: Company[] }>('/api/companies');
    setOthers(list.companies.filter((candidate) => candidate.id !== companyId));
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (missing) {
    return (
      <main className="company-detail">
        <h1 className="display">Company not found</h1>
      </main>
    );
  }
  if (company === null) return <main className="company-detail" />;

  const canMerge = app.user?.role === 'head_of_product' || app.user?.role === 'product_manager';

  return (
    <main className="company-detail">
      <h1 className="display">{company.name}</h1>
      <p className="hint">{company.domains.join(', ')}</p>
      {canMerge ? (
        <button type="button" className="button" onClick={() => setMerging(true)}>
          Merge into…
        </button>
      ) : null}

      <section className="panel">
        <h2>Contacts</h2>
        <ul>
          {company.contacts.map((contact) => (
            <li key={contact.id}>
              {contact.name} · {contact.email}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Requests</h2>
        <ul aria-label="Requests">
          {company.requests.map((entry) => (
            <li key={entry.featureId}>
              <Link to={`/features/${entry.featureId}`}>{entry.featureName}</Link> ·{' '}
              {FEATURE_STATUS_LABELS[entry.status]}
              {entry.shipped && entry.releaseName !== null && entry.targetMonth !== null ? (
                <span className="shipped-line">
                  {' '}
                  Shipped in {entry.releaseName} · {monthLabel(entry.targetMonth)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Notes</h2>
        <p className="figure">{company.noteCount}</p>
      </section>

      {merging ? (
        <MergeDialog
          company={company}
          others={others}
          onClose={() => setMerging(false)}
          onMerged={(target) => {
            setMerging(false);
            app.setSaveStatus(`Merged ${company.name} into ${target.name}.`);
            navigate(`/companies/${target.id}`);
          }}
        />
      ) : null}
    </main>
  );
}

function MergeDialog({
  company,
  others,
  onClose,
  onMerged,
}: {
  company: CompanyDetailShape;
  others: Company[];
  onClose: () => void;
  onMerged: (target: Company) => void;
}): JSX.Element {
  const app = useApp();
  const [targetId, setTargetId] = useState(others[0]?.id ?? '');
  return (
    <Dialog label="Merge company" onClose={onClose}>
      <div className="field">
        <label htmlFor="merge-into">Merge into</label>
        <select
          id="merge-into"
          aria-label="Merge into"
          value={targetId}
          onChange={(event) => setTargetId(event.target.value)}
        >
          {others.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
      </div>
      <div className="dialog-actions">
        <button
          type="button"
          className="button accent"
          disabled={targetId === ''}
          onClick={() => {
            app.setPending('Merging…');
            void request<{ company: Company }>(`/api/companies/${company.id}/merge`, {
              method: 'POST',
              body: { intoCompanyId: targetId },
            })
              .then((data) => onMerged(data.company))
              .catch((error: unknown) => {
                app.setSaveStatus('');
                if (error instanceof ApiError) app.setAlert(error.fields.intoCompanyId ?? error.message);
              });
          }}
        >
          Merge companies
        </button>
      </div>
    </Dialog>
  );
}
