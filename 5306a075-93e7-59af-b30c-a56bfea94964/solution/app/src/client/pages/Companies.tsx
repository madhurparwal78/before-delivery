import { useEffect, useState } from "react";
import type { Company } from "../../shared/api.js";
import { api } from "../api.js";
import { useFeedback } from "../feedback.js";
import { Link } from "../router.js";

export function CompaniesPage() {
  const feedback = useFeedback();
  const [companies, setCompanies] = useState<Company[] | null>(null);
  useEffect(() => {
    api.get<{ companies: Company[] }>("/api/companies").then((r) => setCompanies(r.companies), (error: unknown) => feedback.fail(error));
  }, [feedback]);
  return (
    <div className="page-body">
      <header className="page-head"><h1>Companies</h1></header>
      <table aria-label="Companies" className="table companies">
        <thead>
          <tr>
            <th scope="col">Company</th>
            <th scope="col" className="col-extra">Domains</th>
            <th scope="col" className="cell-num">Contacts</th>
            <th scope="col" className="cell-num">Notes</th>
          </tr>
        </thead>
        <tbody>
          {companies?.map((c) => (
            <tr key={c.id}>
              <td><Link href={`/companies/${c.id}`}>{c.name}</Link></td>
              <td className="col-extra">{c.domains.join(", ")}</td>
              <td className="cell-num num">{c.contacts.length}</td>
              <td className="cell-num num">{c.noteCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {companies?.length === 0 && <p className="empty-line">No companies yet. Import legacy feedback to add them.</p>}
    </div>
  );
}
