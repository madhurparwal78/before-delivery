import { useEffect, useState, type ReactNode } from 'react';
import type { HistoryRow } from '../../shared/api.js';
import { api, failureOf } from '../api.js';
import { FormatObject } from '../art/Objects.js';
import { Chrome, EmptyState } from '../components/Chrome.js';
import { NotFound } from './NotFound.js';

export function HistoryPage({ username }: { username: string }): ReactNode {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [missing, setMissing] = useState('');
  useEffect(() => {
    api.get<{ rows: HistoryRow[] }>(`/api/users/${username}/history`).then((body) => setRows(body.rows), (error) => setMissing(failureOf(error).message));
  }, [username]);
  if (missing) return <NotFound text={missing} />;
  return (
    <Chrome>
      <div className="stack">
        <h1 className="page-title">{username}</h1>
        {rows === null ? <p className="loading">Loading...</p> : rows.length === 0 ? (
          <EmptyState object={<FormatObject format="round_robin" fill="mint" label="Round robin medal" />} text="No finished tournaments yet." />
        ) : (
          <ul aria-label="Tournament history" className="plain-list big-list">
            {rows.map((row) => <li key={row.tournament_id}>{row.text}</li>)}
          </ul>
        )}
      </div>
    </Chrome>
  );
}
