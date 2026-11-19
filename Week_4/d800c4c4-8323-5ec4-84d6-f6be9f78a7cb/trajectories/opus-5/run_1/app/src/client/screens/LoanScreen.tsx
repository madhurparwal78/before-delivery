import { formatDollars } from '../../shared/format';
import { loanStatusWord, shapeClassFor } from '../../shared/status-words';
import type { Loan } from '../../shared/types';
import { FormProblems } from '../components/FormProblems';
import { DueLine } from '../components/loan-lines';
import { PhotoComparison } from '../components/PhotoComparison';
import { Announcements } from '../components/Shell';
import { useApp } from '../lib/app-context';
import { usePoll } from '../lib/hooks';

export function LoanScreen({ loanId }: { readonly loanId: number }): JSX.Element {
  const { navigate } = useApp();
  const read = usePoll<{ loan: Loan }>(`/api/loans/${loanId}`, 10000);
  const loan = read.data?.loan ?? null;

  if (!loan) return <Announcements kind="account" />;

  const rules = loan.fee_rules;

  return (
    <>
      <Announcements kind="account" />
      <FormProblems problems={null} onJump={() => undefined} />
      <section className="panel">
        <h1 className="numerals">Loan {loan.ref}</h1>
        <p>
          <span className={shapeClassFor(loanStatusWord(loan.status))}>
            {loanStatusWord(loan.status)}
          </span>
        </p>
        {rules ? (
          <p className="numerals fee-rules-line">
            Late fee ${formatDollars(rules.late_fee_cents)} per open day, damage fee $
            {formatDollars(rules.damage_fee_cents)}
          </p>
        ) : null}
        <p>
          <DueLine loan={loan} />
        </p>
        {loan.fee_id !== null ? (
          <p>
            <a
              href={`/fees/${loan.fee_id}`}
              onClick={(event) => {
                event.preventDefault();
                navigate(`/fees/${loan.fee_id}`);
              }}
            >
              Fee {loan.fee_id}
            </a>
          </p>
        ) : null}
      </section>

      <section className="panel">
        <h2>Tools on this loan</h2>
        <table className="ledger" aria-label="Loan items">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Tag</th>
              <th>Grade</th>
              <th>Cap</th>
            </tr>
          </thead>
          <tbody>
            {loan.items.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td className="numerals">{item.tag}</td>
                <td>{item.grade ?? ''}</td>
                <td className="numerals">
                  {rules ? `Cap $${formatDollars(rules.replacement_costs_cents[String(item.id)] ?? 0)}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Parts</h2>
        <ul className="part-states">
          {loan.parts.map((part) => (
            <li key={part.id}>
              {part.name} — {part.state}
            </li>
          ))}
        </ul>
      </section>

      {loan.status !== 'reserved' ? <PhotoComparison photos={loan.photos} /> : null}
    </>
  );
}
