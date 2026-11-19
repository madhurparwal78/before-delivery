import { useEffect, useState } from 'react';
import { COPY } from '../copy.js';
import { RequestFailed, get } from '../api.js';
import { monthLabel } from '../format.js';
import { Shell } from '../components/Shell.js';
import { Banner } from '../components/Banner.js';
import type { Me, StatementRecord } from '../api.js';

export function StatementsScreen(props: { me: Me }): React.JSX.Element {
  const [statements, setStatements] = useState<StatementRecord[] | null>(null);
  const [outage, setOutage] = useState(false);

  useEffect(() => {
    void get<{ statements: StatementRecord[] }>('/api/statements')
      .then((value) => setStatements(value.statements))
      .catch(() => setStatements([]));
  }, []);

  /** Opened only by its owner through a short signed link. */
  const open = async (id: string): Promise<void> => {
    try {
      const link = await get<{ url: string; expires_at: string }>(`/api/statements/${id}/link`);
      setOutage(false);
      window.open(link.url, '_blank', 'noopener');
    } catch (error) {
      if (error instanceof RequestFailed && error.code === 'statements_unavailable') {
        setOutage(true);
        return;
      }
      throw error;
    }
  };

  return (
    <Shell me={props.me} path="/statements" field="slate" stickers={['envelope']}>
      <h1>Statements</h1>
      {outage ? <Banner>{COPY.statementsUnavailable}</Banner> : null}
      <div className="card">
        {statements === null ? (
          <div className="skeleton" />
        ) : statements.length === 0 ? (
          <p className="empty-line">{COPY.emptyStatements}</p>
        ) : (
          <ul className="log" aria-label="Statements">
            {statements.map((statement) => (
              <li key={statement.id}>
                <a
                  className="skip-link"
                  href={`/api/statements/${statement.id}/link`}
                  onClick={(click) => {
                    click.preventDefault();
                    void open(statement.id);
                  }}
                >
                  Download {monthLabel(statement.month)} statement
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Shell>
  );
}
