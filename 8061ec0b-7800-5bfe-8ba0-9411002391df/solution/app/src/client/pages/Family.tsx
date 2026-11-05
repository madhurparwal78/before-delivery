// My family: the family totals and one section per child with their contracts.

import { useEffect, useState, type ReactNode } from "react";
import type { FamilyOverview } from "../../shared/api.js";
import { formatMoney } from "../../shared/money.js";
import { CONTRACT_STATUS_WORDS, OPEN_CONTRACT_STATUSES } from "../../shared/vocabulary.js";
import { call, NETWORK_COPY } from "../api.js";
import { Link } from "../app.js";
import { errorNotice, quiet, Status, type Notice } from "../components/ui.js";

export function Family(): ReactNode {
  const [overview, setOverview] = useState<FamilyOverview | null>(null);
  const [notice, setNotice] = useState<Notice>(quiet);

  useEffect(() => {
    void call<FamilyOverview>("GET", "/api/family").then((r) => {
      if (r.ok) setOverview(r.data);
      else setNotice(errorNotice(NETWORK_COPY));
    });
  }, []);

  return (
    <section className="page family">
      <header className="page__head">
        <p className="eyebrow">{overview ? overview.family.parent_name : "Keel & Bell Music"}</p>
        <h1>My family</h1>
        <Status label="Family status" notice={notice} />
      </header>
      {overview === null ? <p className="muted">Loading your family…</p> : (
        <>
          <section className="totals" aria-labelledby="family-totals-title">
            <h2 id="family-totals-title" className="visually-hidden">Family totals</h2>
            <p className="totals__figure">
              <span className="totals__label">Equity across open contracts</span>{" "}
              <span className="figure equity totals__amount">{formatMoney(overview.totals.equity_cents)}</span>
            </p>
            <p className="totals__figure">
              <span className="figure totals__amount">{overview.totals.owned}</span>{" "}
              <span className="totals__label">owned</span>
            </p>
            <p className="totals__figure">
              <span className="figure totals__amount">{overview.totals.open_contracts}</span>{" "}
              <span className="totals__label">open {overview.totals.open_contracts === 1 ? "contract" : "contracts"}</span>
            </p>
          </section>
          <div className="children">
            {overview.students.map((student) => {
              const open = student.contracts.some((c) => OPEN_CONTRACT_STATUSES.includes(c.status));
              return (
                <section key={student.id} className="child" aria-label={student.name}>
                  <header className="child__head">
                    <h2>{student.name}</h2>
                    <p className="muted">{student.school.name} · Grade {student.grade}</p>
                  </header>
                  {student.contracts.length === 0
                    ? <p className="empty">No instrument on contract yet.</p>
                    : (
                      <ul className="child__contracts">
                        {[...student.contracts].reverse().map((c) => (
                          <li key={c.id} className={`contract-line contract-line--${c.status}`}>
                            <Link to={`/contracts/${c.id}`} className="figure contract-line__id">{c.id}</Link>
                            <span className="contract-line__what">{c.instrument_label} <span className="figure">{c.serial}</span></span>
                            <span className={`word word--${c.status}`}>{CONTRACT_STATUS_WORDS[c.status]}</span>
                            <span className="figure equity">{formatMoney(c.equity_cents)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  {!open && <Link to={`/reserve?${new URLSearchParams({ student: student.id })}`} className="button button--secondary">Reserve an instrument</Link>}
                </section>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
