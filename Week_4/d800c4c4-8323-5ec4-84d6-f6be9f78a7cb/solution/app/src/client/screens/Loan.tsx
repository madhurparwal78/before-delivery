import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { request, type Loan } from "../api";
import { LOAN_WORD } from "../board/outline";
import { PhotoComparison } from "../components/PhotoComparison";
import { DueLine, Num, PegStrip, Status, usePoll } from "../components/ui";
import { dollars, libraryStamp } from "../format";
import type { Me } from "../shell";
import { NotFound } from "./NotFound";
import { PaneAnnouncements } from "./Pegboard";
import { useAnnouncer } from "./useAnnouncer";

const PART_WORD = { hung: "on the wall", out: "out", missing: "missing" } as const;

export function LoanPage({ me, id }: { me: Me; id: number }) {
  const [loan, setLoan] = useState<Loan | null | "missing">(null);
  const news = useAnnouncer(me);
  const summary = useRef<HTMLDivElement>(null);
  const read = useCallback(async () => {
    const answer = await request<{ loan: Loan }>("GET", `/api/loans/${id}`);
    if (answer.status === 200) setLoan(answer.body.loan);
    else if (answer.status === 404) setLoan("missing");
  }, [id]);
  useEffect(() => {
    void read();
  }, []);
  usePoll(read, 10_000, loan !== "missing");
  if (loan === "missing") return <NotFound />;
  return (
    <div class="page record-page">
      <PegStrip />
      <PaneAnnouncements news={news} summary={summary} />
      {loan === null ? (
        <p class="loading-line">Loading the loan…</p>
      ) : (
        <>
          <div class="title-row">
            <h1>
              Loan <Num>{loan.ref}</Num>
            </h1>
            <Status word={LOAN_WORD[loan.status]!} />
          </div>
          <dl class="facts wide">
            <div>
              <dt>Member</dt>
              <dd>{loan.member_name}</dd>
            </div>
            <div>
              <dt>Checked out</dt>
              <dd>{loan.checked_out_at ? <Num>{libraryStamp(loan.checked_out_at)}</Num> : "—"}</dd>
            </div>
            <div>
              <dt>Due</dt>
              <dd>{loan.due_date ? <DueLine loan={loan} /> : "—"}</dd>
            </div>
            <div>
              <dt>Returned</dt>
              <dd>{loan.returned_at ? <Num>{libraryStamp(loan.returned_at)}</Num> : "—"}</dd>
            </div>
            <div>
              <dt>Fee rules</dt>
              <dd>
                {loan.fee_rules ? (
                  <>
                    Late fee <Num>${dollars(loan.fee_rules.late_fee_cents)}</Num> per open day, damage fee <Num>${dollars(loan.fee_rules.damage_fee_cents)}</Num>
                  </>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt>Fee</dt>
              <dd>
                {loan.fee_id !== null ? (
                  <a href={`/fees/${loan.fee_id}`}>
                    Fee <Num>{loan.fee_id}</Num>
                  </a>
                ) : (
                  "None"
                )}
              </dd>
            </div>
          </dl>
          <h2>Tools</h2>
          <table class="ledger" aria-label="Tools on this loan">
            <thead>
              <tr>
                <th scope="col">Tool</th>
                <th scope="col">Tag</th>
                <th scope="col">Grade</th>
                <th scope="col">Cap</th>
              </tr>
            </thead>
            <tbody>
              {loan.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>
                    <Num>{item.tag}</Num>
                  </td>
                  <td>{item.grade ?? "—"}</td>
                  <td>{loan.fee_rules && <Num>Cap ${dollars(loan.fee_rules.replacement_costs_cents[String(item.id)]!)}</Num>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2>Parts</h2>
          <table class="ledger" aria-label="Parts on this loan">
            <thead>
              <tr>
                <th scope="col">Part</th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {loan.parts.map((part) => (
                <tr key={part.id}>
                  <td>{part.name}</td>
                  <td>
                    <Status word={PART_WORD[part.state]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loan.status !== "reserved" && (
            <>
              <h2>Condition photos</h2>
              <PhotoComparison photos={loan.photos} />
            </>
          )}
        </>
      )}
    </div>
  );
}
